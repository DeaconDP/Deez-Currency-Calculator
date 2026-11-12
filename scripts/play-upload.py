#!/usr/bin/env python3
"""Google Play publishing for DeacsCurrencyConverter (Android Publisher API v3). Python 3 stdlib only.

Dry run by default: anything that would change Google Play is only printed unless --apply is given.
Reads (status, opening a scratch edit to look at the current state) always run.

Commands:
  status                   open an edit, list tracks, releases and bundles, then delete the edit (read-only)
  upload --track T --aab P edits.insert -> bundles.upload -> tracks.update -> edits.commit
                           [--status draft|completed] (default draft) [--notes TEXT | --notes-file F]
                           production needs --yes-production
  listing                  push store/play/en-US text + contact details; --images also replaces the icon,
                           feature graphic and phone screenshots from store/play/images

Auth: the owner's gcloud application-default credentials. The access token comes from
`gcloud auth application-default print-access-token` and is never printed. Every call carries
`x-goog-user-project: <quota_project_id>` from ~/.config/gcloud/application_default_credentials.json;
without it Play answers 403. ADC must have been created with the androidpublisher scope:
  gcloud auth application-default login \
    --scopes=https://www.googleapis.com/auth/androidpublisher,https://www.googleapis.com/auth/cloud-platform

Examples:
  python3 scripts/play-upload.py status
  python3 scripts/play-upload.py upload --track internal --aab build/android/DeacsCurrencyConverter-1.0.3-10004.aab
  python3 scripts/play-upload.py upload --track internal --aab build/android/... --apply
  python3 scripts/play-upload.py listing --images --apply
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import struct
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

PACKAGE = "com.worldbuildio.currencyconverter"
API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"
ADC_FILE = Path(os.environ.get("CLOUDSDK_CONFIG", Path.home() / ".config/gcloud")) / "application_default_credentials.json"
REPO = Path(__file__).resolve().parents[1]
PLAY_DIR = REPO / "store/play"
LANGUAGE = "en-US"
TRACKS = ("internal", "alpha", "beta", "production")
LIVE_STATUSES = ("completed", "inProgress", "halted")
LIMITS = {"title": 30, "shortDescription": 80, "fullDescription": 4000}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message


# --------------------------------------------------------------------------------------------------
# Auth + HTTP
# --------------------------------------------------------------------------------------------------
def quota_project() -> str:
    env = os.environ.get("PLAY_QUOTA_PROJECT")
    if env:
        return env
    try:
        data = json.loads(ADC_FILE.read_text())
    except (OSError, ValueError) as e:
        raise SystemExit(f"Can't read {ADC_FILE} ({e}). Run: gcloud auth application-default login "
                         "--scopes=https://www.googleapis.com/auth/androidpublisher,"
                         "https://www.googleapis.com/auth/cloud-platform")
    project = data.get("quota_project_id")
    if not project:
        raise SystemExit(f"No quota_project_id in {ADC_FILE}. Run: gcloud auth application-default "
                         "set-quota-project <project-with-androidpublisher-API-enabled>")
    return project


def access_token() -> str:
    try:
        out = subprocess.run(["gcloud", "auth", "application-default", "print-access-token"],
                             capture_output=True, text=True, timeout=60)
    except FileNotFoundError:
        raise SystemExit("gcloud not found on PATH.")
    if out.returncode != 0 or not out.stdout.strip():
        # stderr from gcloud never contains the token
        raise SystemExit(f"gcloud could not mint an access token:\n{out.stderr.strip()}")
    return out.stdout.strip()


def _error_message(raw: bytes) -> str:
    try:
        body = json.loads(raw)
        err = body.get("error", body)
        return str(err.get("message", err)) if isinstance(err, dict) else str(err)
    except ValueError:
        return raw.decode("utf-8", "replace")[:500]


class Play:
    """Reads always run; writes run only with apply=True, otherwise they are logged as [dry run]."""

    def __init__(self, package: str, apply: bool):
        self.package = package
        self.apply = apply
        self._token: str | None = None
        self._project: str | None = None

    def _headers(self) -> dict:
        if self._token is None:
            self._project = quota_project()
            self._token = access_token()
        return {"Authorization": f"Bearer {self._token}", "x-goog-user-project": self._project}

    def call(self, method: str, path: str, *, write: bool, upload: bool = False, params: dict | None = None,
             body: Any = None, data: bytes | None = None, content_type: str | None = None,
             dry_result: Any = None, allow_404: bool = False) -> Any:
        if write and not self.apply:
            size = f" ({len(data):,} bytes)" if data is not None else ""
            query = f" {params}" if params else ""
            print(f"  [dry run] {method} {path}{query}{size}")
            return dry_result if dry_result is not None else {}
        url = f"{UPLOAD_API if upload else API}/{self.package}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = self._headers()
        payload = data
        if body is not None:
            payload = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        elif content_type:
            headers["Content-Type"] = content_type
        if method in ("POST", "PUT", "PATCH") and payload is None:
            payload = b""
        req = urllib.request.Request(url, data=payload, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=900) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as e:
            if allow_404 and e.code == 404:
                return None
            raise ApiError(e.code, _error_message(e.read())) from None
        except urllib.error.URLError as e:
            raise SystemExit(f"Network error talking to Google Play: {e.reason}")
        return json.loads(raw) if raw.strip() else {}

    def get(self, path: str, **kw) -> Any:
        return self.call("GET", path, write=False, **kw)


class Edit:
    """A scratch edit. edits.insert changes nothing on the store, so it runs even in a dry run to read the
    current state. It is deleted on exit unless committed."""

    def __init__(self, play: Play):
        self.play = play
        self.id: str | None = None
        self.committed = False

    def __enter__(self) -> "Edit":
        res = self.play.call("POST", "/edits", write=False, body={})
        self.id = res["id"]
        print(f"  edit {self.id} opened")
        return self

    def __exit__(self, exc_type, exc, tb):
        if self.id and not self.committed:
            try:
                self.play.call("DELETE", f"/edits/{self.id}", write=False)
                print(f"  edit {self.id} deleted")
            except ApiError as e:  # edits expire on their own
                print(f"  (could not delete edit {self.id}: {e})")
        return False

    def path(self, rest: str = "") -> str:
        return f"/edits/{self.id}{rest}"

    def commit(self) -> None:
        if not self.play.apply:
            print("  [dry run] edits.commit skipped; nothing was changed on Google Play. Add --apply to do it.")
            return
        try:
            self.play.call("POST", self.path(":commit"), write=True)
        except ApiError as e:
            if e.status == 400 and "changesNotSentForReview" in e.message:
                print("  Play can't send these changes for review automatically; committing with "
                      "changesNotSentForReview=true. Send them for review in Play Console > Publishing overview.")
                self.play.call("POST", self.path(":commit"), write=True, params={"changesNotSentForReview": "true"})
            else:
                raise
        self.committed = True
        print(f"  edit {self.id} committed")


# --------------------------------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------------------------------
def cmd_status(play: Play, args) -> int:
    print(f"Google Play status for {play.package} (read-only)")
    with Edit(play) as edit:
        details = play.get(edit.path("/details")) or {}
        print(f"  default language {details.get('defaultLanguage')}, contact {details.get('contactEmail')}, "
              f"website {details.get('contactWebsite')}")
        tracks = (play.get(edit.path("/tracks")) or {}).get("tracks", [])
        print("  tracks:")
        for t in tracks:
            releases = t.get("releases", [])
            if not releases:
                print(f"    {t['track']}: (no releases)")
            for r in releases:
                frac = f" {r['userFraction']:.0%}" if "userFraction" in r else ""
                print(f"    {t['track']}: {r.get('name', '')!s} codes={r.get('versionCodes', [])} "
                      f"status={r.get('status')}{frac}")
        bundles = (play.get(edit.path("/bundles")) or {}).get("bundles", [])
        print(f"  bundles uploaded: {[b.get('versionCode') for b in bundles] or 'none'}")
        listing = play.get(edit.path(f"/listings/{LANGUAGE}"), allow_404=True) or {}
        print(f"  listing {LANGUAGE}: title={listing.get('title')!r}, short={len(listing.get('shortDescription', ''))} "
              f"chars, full={len(listing.get('fullDescription', ''))} chars")
    return 0


def bundle_info(aab: Path, package: str) -> list[str]:
    problems = []
    try:
        with zipfile.ZipFile(aab) as z:
            manifest = z.read("base/manifest/AndroidManifest.xml")
            if not any(n.startswith("META-INF/") and n.endswith((".RSA", ".EC", ".DSA")) for n in z.namelist()):
                problems.append("the bundle has no META-INF signature; Play needs it signed with the upload key")
    except (zipfile.BadZipFile, KeyError) as e:
        return [f"{aab} is not a readable app bundle ({e})"]
    if package.encode() not in manifest:
        problems.append(f"the bundle's manifest doesn't mention package {package}")
    return problems


def release_notes(args) -> list[dict]:
    text = args.notes
    if args.notes_file:
        text = Path(args.notes_file).read_text(encoding="utf-8").strip()
    if not text:
        return []
    if len(text) > 500:
        raise SystemExit(f"Release notes are {len(text)} chars; Play allows 500.")
    return [{"language": LANGUAGE, "text": text}]


def cmd_upload(play: Play, args) -> int:
    aab = Path(args.aab)
    if not aab.is_file():
        print(f"No bundle at {aab}.")
        return 1
    if args.track == "production" and not args.yes_production:
        print("Refusing to touch the production track without --yes-production.")
        return 2
    data = aab.read_bytes()
    print(f"Bundle {aab.name}: {len(data) / 1_048_576:.1f} MB, sha256 {hashlib.sha256(data).hexdigest()[:16]}…")
    problems = bundle_info(aab, play.package)
    for p in problems:
        print(f"  problem: {p}")
    if problems:
        return 1
    notes = release_notes(args)
    status = args.status
    with Edit(play) as edit:
        tracks = (play.get(edit.path("/tracks")) or {}).get("tracks", [])
        published = any(r.get("status") in LIVE_STATUSES for t in tracks for r in t.get("releases", []))
        if not published and status != "draft":
            print("  This app has never been published, so Play only accepts draft releases: using draft.")
            status = "draft"
        bundle = play.call("POST", edit.path("/bundles"), write=True, upload=True, params={"uploadType": "media"},
                           data=data, content_type="application/octet-stream", dry_result={"versionCode": 0})
        code = int(bundle.get("versionCode", 0))
        print(f"  bundle versionCode {code or '(known after upload)'}")
        release: dict[str, Any] = {"versionCodes": [str(code)], "status": status}
        if args.name:
            release["name"] = args.name
        if notes:
            release["releaseNotes"] = notes
        play.call("PUT", edit.path(f"/tracks/{args.track}"), write=True,
                  body={"track": args.track, "releases": [release]})
        print(f"  track {args.track}: {json.dumps(release)}")
        edit.commit()
    if status == "draft":
        print(f"  The release is a DRAFT. Roll it out in Play Console > Test and release > {args.track}.")
    return 0


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def png_info(path: Path) -> tuple[int, int, int]:
    b = path.read_bytes()[:26]
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    w, h, _depth, color = struct.unpack(">IIBB", b[16:26])
    return w, h, color


def image_sets(images: Path) -> dict[str, list[Path]]:
    return {
        "icon": [images / "icon-512.png"],
        "featureGraphic": sorted(images.glob("feature-graphic.*"))[:1],
        "phoneScreenshots": sorted(p for p in (images / "phone").glob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png")),
    }


def cmd_listing(play: Play, args) -> int:
    d = Path(args.play_dir) / LANGUAGE
    listing = {"language": LANGUAGE, "title": _read(d / "title.txt"),
               "shortDescription": _read(d / "short_description.txt"),
               "fullDescription": _read(d / "full_description.txt")}
    for k, limit in LIMITS.items():
        print(f"  {k}: {len(listing[k])}/{limit} chars")
        if len(listing[k]) > limit:
            print(f"  {k} is too long.")
            return 1
    details = {"defaultLanguage": LANGUAGE, "contactEmail": _read(d / "contact_email.txt"),
               "contactWebsite": _read(d / "contact_website.txt")}
    images: dict[str, list[Path]] = {}
    if args.images:
        images = image_sets(Path(args.play_dir) / "images")
        for kind, files in images.items():
            if not files or any(not f.is_file() for f in files):
                print(f"  missing {kind} image(s) in {Path(args.play_dir) / 'images'}")
                return 1
        w, h, color = png_info(images["icon"][0])
        if (w, h) != (512, 512) or color != 6:
            print(f"  icon must be a 512x512 32-bit PNG (got {w}x{h}, PNG colour type {color})")
            return 1
        if not 2 <= len(images["phoneScreenshots"]) <= 8:
            print("  Play needs 2-8 phone screenshots.")
            return 1
    print(f"  privacy policy URL ({_read(d / 'privacy_url.txt')}) is set in Play Console > App content, "
          "not through this API.")
    with Edit(play) as edit:
        play.call("PATCH", edit.path("/details"), write=True, body=details)
        print(f"  details: {details}")
        play.call("PUT", edit.path(f"/listings/{LANGUAGE}"), write=True, body=listing)
        print(f"  listing {LANGUAGE}: title {listing['title']!r}")
        for kind, files in images.items():
            play.call("DELETE", edit.path(f"/listings/{LANGUAGE}/{kind}"), write=True)
            for f in files:
                ctype = mimetypes.guess_type(f.name)[0] or "image/png"
                play.call("POST", edit.path(f"/listings/{LANGUAGE}/{kind}"), write=True, upload=True,
                          params={"uploadType": "media"}, data=f.read_bytes(), content_type=ctype)
            print(f"  {kind}: {len(files)} file(s) {[f.name for f in files]}")
        edit.commit()
    return 0


def make_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--package", default=PACKAGE, help=f"Android package (default {PACKAGE})")
    p.add_argument("--apply", action="store_true", help="actually change Google Play (default: dry run)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="tracks, releases and bundles (read-only)")
    up = sub.add_parser("upload", help="upload an .aab and put it on a track")
    up.add_argument("--track", choices=TRACKS, required=True)
    up.add_argument("--aab", required=True)
    up.add_argument("--status", choices=("draft", "completed"), default="draft")
    up.add_argument("--notes", help="release notes (en-US, max 500 chars)")
    up.add_argument("--notes-file", help="read release notes from this file")
    up.add_argument("--name", help="release name shown in Play Console (default: Play picks the versionName)")
    up.add_argument("--yes-production", action="store_true", help="required for --track production")
    li = sub.add_parser("listing", help="push store/play text and contact details")
    li.add_argument("--images", action="store_true", help="also replace icon, feature graphic and phone screenshots")
    li.add_argument("--play-dir", default=str(PLAY_DIR))
    return p


def main(argv: list[str] | None = None) -> int:
    args = make_parser().parse_args(argv)
    play = Play(args.package, args.apply)
    if not args.apply and args.cmd != "status":
        print("DRY RUN: reads run, writes are only printed. Add --apply to change Google Play.")
    try:
        return {"status": cmd_status, "upload": cmd_upload, "listing": cmd_listing}[args.cmd](play, args)
    except ApiError as e:
        if e.status == 404 and "not found" in e.message.lower():
            print(f"Package not found: {play.package} has no app record in Play Console yet "
                  f"(create the app first). [{e.message}]")
            return 3
        print(f"Google Play API error {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
