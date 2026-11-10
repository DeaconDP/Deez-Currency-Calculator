#![allow(dead_code)]
use std::{env, fmt::Display, path::Path, path::PathBuf, process::Command};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwiftTarget {
    triple: String,
    unversioned_triple: String,
    module_triple: String,
    //pub swift_runtime_compatibility_version: String,
    #[serde(rename = "librariesRequireRPath")]
    libraries_require_rpath: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SwiftPaths {
    runtime_library_paths: Vec<String>,
    runtime_library_import_paths: Vec<String>,
    runtime_resource_path: String,
}

#[derive(Deserialize)]
struct SwiftEnv {
    target: SwiftTarget,
    paths: SwiftPaths,
}

impl SwiftEnv {
    fn new(minimum_macos_version: &str, minimum_ios_version: Option<&str>) -> Self {
        let rust_target = RustTarget::from_env();
        let target = rust_target.swift_target_triple(minimum_macos_version, minimum_ios_version);

        let swift_target_info_str = Command::new("swift")
            .args(["-target", &target, "-print-target-info"])
            .output()
            .unwrap()
            .stdout;

        serde_json::from_slice(&swift_target_info_str).unwrap()
    }
}

#[allow(clippy::upper_case_acronyms)]
enum RustTargetOS {
    MacOS,
    IOS,
}

impl RustTargetOS {
    fn from_env() -> Self {
        match env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
            "macos" => RustTargetOS::MacOS,
            "ios" => RustTargetOS::IOS,
            _ => panic!("unexpected target operating system"),
        }
    }

    fn to_swift(&self) -> &'static str {
        match self {
            Self::MacOS => "macosx",
            Self::IOS => "ios",
        }
    }
}

impl Display for RustTargetOS {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MacOS => write!(f, "macos"),
            Self::IOS => write!(f, "ios"),
        }
    }
}

#[allow(clippy::upper_case_acronyms)]
enum SwiftSDK {
    MacOS,
    IOS,
    IOSSimulator,
}

impl SwiftSDK {
    fn from_os(os: &RustTargetOS) -> Self {
        let target = env::var("TARGET").unwrap();
        let simulator = target.ends_with("ios-sim")
            || (target.starts_with("x86_64") && target.ends_with("ios"));

        match os {
            RustTargetOS::MacOS => Self::MacOS,
            RustTargetOS::IOS if simulator => Self::IOSSimulator,
            RustTargetOS::IOS => Self::IOS,
        }
    }

    fn clang_lib_extension(&self) -> &'static str {
        match self {
            Self::MacOS => "osx",
            Self::IOS => "ios",
            Self::IOSSimulator => "iossim",
        }
    }
}

impl Display for SwiftSDK {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MacOS => write!(f, "macosx"),
            Self::IOSSimulator => write!(f, "iphonesimulator"),
            Self::IOS => write!(f, "iphoneos"),
        }
    }
}

struct RustTarget {
    arch: String,
    os: RustTargetOS,
    sdk: SwiftSDK,
}

impl RustTarget {
    fn from_env() -> Self {
        let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let os = RustTargetOS::from_env();
        let sdk = SwiftSDK::from_os(&os);

        Self { arch, os, sdk }
    }

    fn swift_target_triple(
        &self,
        minimum_macos_version: &str,
        minimum_ios_version: Option<&str>,
    ) -> String {
        let unversioned = self.unversioned_swift_target_triple();
        format!(
            "{unversioned}{}{}",
            match (&self.os, minimum_ios_version) {
                (RustTargetOS::MacOS, _) => minimum_macos_version,
                (RustTargetOS::IOS, Some(version)) => version,
                _ => "",
            },
            // simulator suffix
            matches!(self.sdk, SwiftSDK::IOSSimulator)
                .then(|| "-simulator".to_string())
                .unwrap_or_default()
        )
    }

    fn unversioned_swift_target_triple(&self) -> String {
        format!(
            "{}-apple-{}",
            match self.arch.as_str() {
                "aarch64" => "arm64",
                a => a,
            },
            self.os.to_swift(),
        )
    }
}

struct SwiftPackage {
    name: String,
    path: PathBuf,
}

/// Builder for linking the Swift runtime and custom packages.
#[cfg(feature = "build")]
pub struct SwiftLinker {
    packages: Vec<SwiftPackage>,
    macos_min_version: String,
    ios_min_version: Option<String>,
}

impl SwiftLinker {
    /// Creates a new [`SwiftLinker`] with a minimum macOS verison.
    ///
    /// Minimum macOS version must be at least 10.13.
    pub fn new(macos_min_version: &str) -> Self {
        Self {
            packages: vec![],
            macos_min_version: macos_min_version.to_string(),
            ios_min_version: None,
        }
    }

    /// Instructs the [`SwiftLinker`] to also compile for iOS
    /// using the specified minimum iOS version.
    ///
    /// Minimum iOS version must be at least 11.
    pub fn with_ios(mut self, min_version: &str) -> Self {
        self.ios_min_version = Some(min_version.to_string());
        self
    }

    /// Adds a package to be linked against.
    /// `name` should match the `name` field in your `Package.swift`,
    /// and `path` should point to the root of your Swift package relative
    /// to your crate's root.
    pub fn with_package(mut self, name: &str, path: impl AsRef<Path>) -> Self {
        self.packages.extend([SwiftPackage {
            name: name.to_string(),
            path: path.as_ref().into(),
        }]);

        self
    }

    /// Links the Swift runtime, then builds and links the provided packages.
    /// This does not (yet) automatically rebuild your Swift files when they are modified,
    /// you'll need to modify/save your `build.rs` file for that.
    pub fn link(self) {
        let swift_env = SwiftEnv::new(&self.macos_min_version, self.ios_min_version.as_deref());

        #[allow(clippy::uninlined_format_args)]
        for path in swift_env.paths.runtime_library_paths {
            println!("cargo:rustc-link-search=native={path}");
        }

        let debug = env::var("DEBUG").unwrap() == "true";
        let configuration = if debug { "debug" } else { "release" };
        let rust_target = RustTarget::from_env();

        link_clang_rt(&rust_target);

        for package in self.packages {
            let package_path =
                Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join(&package.path);
            let out_path = Path::new(&env::var("OUT_DIR").unwrap())
                .join("swift-rs")
                .join(&package.name);

            let sdk_path_output = Command::new("xcrun")
                .args(["--sdk", &rust_target.sdk.to_string(), "--show-sdk-path"])
                .output()
                .unwrap();
            if !sdk_path_output.status.success() {
                panic!(
                    "Failed to get SDK path with `xcrun --sdk {} --show-sdk-path`",
                    rust_target.sdk
                );
            }

            let _sdk_path = String::from_utf8_lossy(&sdk_path_output.stdout);

            let arch = match std::env::consts::ARCH {
                "aarch64" => "arm64",
                arch => arch,
            };

            // Xcode 26+/27: `swift build --sdk iphoneos` mixes macOS+iOS SDKs and fails.
            // Build iOS packages with xcodebuild destination instead.
            let search_path = if matches!(
                rust_target.sdk,
                SwiftSDK::IOS | SwiftSDK::IOSSimulator
            ) {
                // Always Debug for the SPM package: Release WMO strips @_cdecl exports
                // (log_stdout / release_object / …) that Rust links against.
                let configuration_title = "Debug";
                let destination = match rust_target.sdk {
                    SwiftSDK::IOSSimulator => "generic/platform=iOS Simulator",
                    _ => "generic/platform=iOS",
                };
                let derived_data = out_path.join("DerivedData");
                let products_dir = derived_data
                    .join("Build")
                    .join("Products")
                    .join(format!(
                        "{}-{}",
                        configuration_title,
                        match rust_target.sdk {
                            SwiftSDK::IOSSimulator => "iphonesimulator",
                            _ => "iphoneos",
                        }
                    ));

                // Parent Xcode PhaseScriptExecution leaks PRODUCT_NAME / CONFIGURATION etc.
                // into this SPM build and Xcode 27 then emits duplicate *.debug.dylib /
                // __preview.dylib into the app bundle path. Build with a clean env.
                let mut clean = Command::new("xcodebuild");
                clean.env_clear();
                for key in [
                    "PATH",
                    "HOME",
                    "USER",
                    "LOGNAME",
                    "TMPDIR",
                    "TMP",
                    "TEMP",
                    "DEVELOPER_DIR",
                    "SSH_AUTH_SOCK",
                ] {
                    if let Ok(val) = std::env::var(key) {
                        clean.env(key, val);
                    }
                }
                // Prefer the active developer dir even if unset in parent.
                if std::env::var_os("DEVELOPER_DIR").is_none() {
                    clean.env(
                        "DEVELOPER_DIR",
                        "/Applications/Xcode.app/Contents/Developer",
                    );
                }

                let ios_min = self.ios_min_version.as_deref().unwrap_or("15.0");
                let status = clean
                    .current_dir(&package.path)
                    .args([
                        "-scheme",
                        &package.name,
                        "-destination",
                        destination,
                        "-derivedDataPath",
                        &derived_data.display().to_string(),
                        "-configuration",
                        configuration_title,
                        "BUILD_LIBRARY_FOR_DISTRIBUTION=YES",
                        "ONLY_ACTIVE_ARCH=NO",
                        "ENABLE_DEBUG_DYLIB=NO",
                        "ENABLE_PREVIEWS=NO",
                        "ENABLE_XOJIT_PREVIEWS=NO",
                        &format!("IPHONEOS_DEPLOYMENT_TARGET={ios_min}"),
                    ])
                    .status()
                    .unwrap();
                if !status.success() {
                    panic!(
                        "Failed to compile swift package {} with xcodebuild",
                        package.name
                    );
                }

                // Keep layout compatible with the historical swift-rs search path.
                let search_path = out_path
                    .join(format!("{}-apple-macosx", arch))
                    .join(configuration);
                std::fs::create_dir_all(&search_path).unwrap();

                let static_lib = search_path.join(format!("lib{}.a", package.name));

                // Prefer folding .o objects (swift build layout). Fall back to merging
                // any .a products xcodebuild emits for static SPM libraries.
                let mut objects: Vec<PathBuf> = std::fs::read_dir(&products_dir)
                    .into_iter()
                    .flatten()
                    .filter_map(|entry| entry.ok())
                    .map(|entry| entry.path())
                    .filter(|path| {
                        path.extension().and_then(|ext| ext.to_str()) == Some("o")
                    })
                    .collect();
                objects.sort();

                if objects.is_empty() {
                    let mut archives: Vec<PathBuf> = Vec::new();
                    // Walk Products for lib*.a (package + deps like SwiftRs).
                    collect_static_libs(&products_dir, &mut archives);
                    archives.sort();
                    archives.dedup();
                    if archives.is_empty() {
                        panic!(
                            "xcodebuild succeeded but no .o/.a products found in {}",
                            products_dir.display()
                        );
                    }
                    // If the main lib already exists, copy it; otherwise libtool-merge.
                    let main_a = archives.iter().find(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            == Some(&format!("lib{}.a", package.name))
                    });
                    if let Some(src) = main_a {
                        if archives.len() == 1 {
                            std::fs::copy(src, &static_lib).unwrap();
                        } else {
                            let mut libtool = Command::new("libtool");
                            libtool.args(["-static", "-o"]).arg(&static_lib);
                            for a in &archives {
                                libtool.arg(a);
                            }
                            if !libtool.status().unwrap().success() {
                                panic!(
                                    "Failed to merge static libraries into {}",
                                    static_lib.display()
                                );
                            }
                        }
                    } else {
                        let mut libtool = Command::new("libtool");
                        libtool.args(["-static", "-o"]).arg(&static_lib);
                        for a in &archives {
                            libtool.arg(a);
                        }
                        if !libtool.status().unwrap().success() {
                            panic!(
                                "Failed to merge static libraries into {}",
                                static_lib.display()
                            );
                        }
                    }
                } else {
                    let mut libtool = Command::new("libtool");
                    libtool.args(["-static", "-o"]).arg(&static_lib);
                    for obj in &objects {
                        libtool.arg(obj);
                    }
                    if !libtool.status().unwrap().success() {
                        panic!(
                            "Failed to create static library {} from {:?}",
                            static_lib.display(),
                            objects
                        );
                    }
                }

                search_path
            } else {
                let swift_target_triple = rust_target
                    .swift_target_triple(&self.macos_min_version, self.ios_min_version.as_deref());

                let mut command = Command::new("swift");
                command.current_dir(&package.path);
                command
                    .arg("build")
                    .args(["--sdk", _sdk_path.trim()])
                    .args(["-c", configuration])
                    .args(["--arch", arch])
                    .args(["--build-path", &out_path.display().to_string()])
                    .args(["-Xswiftc", "-sdk"])
                    .args(["-Xswiftc", _sdk_path.trim()])
                    .args(["-Xswiftc", "-target"])
                    .args(["-Xswiftc", &swift_target_triple])
                    .args(["-Xcc", &format!("--target={swift_target_triple}")])
                    .args(["-Xcxx", &format!("--target={swift_target_triple}")]);

                if !command.status().unwrap().success() {
                    panic!("Failed to compile swift package {}", package.name);
                }

                out_path
                    .join(format!("{}-apple-macosx", arch))
                    .join(configuration)
            };

            println!("cargo:rerun-if-changed={}", package_path.display());
            println!("cargo:rustc-link-search=native={}", search_path.display());
            println!("cargo:rustc-link-lib=static={}", package.name);
        }
    }
}

fn collect_static_libs(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_static_libs(&path, out);
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with("lib") && name.ends_with(".a") {
            out.push(path);
        }
    }
}

fn link_clang_rt(rust_target: &RustTarget) {
    println!(
        "cargo:rustc-link-lib=clang_rt.{}",
        rust_target.sdk.clang_lib_extension()
    );
    println!("cargo:rustc-link-search={}", clang_link_search_path());
}

fn clang_link_search_path() -> String {
    let output = std::process::Command::new(
        std::env::var("SWIFT_RS_CLANG").unwrap_or_else(|_| "/usr/bin/clang".to_string()),
    )
    .arg("--print-search-dirs")
    .output()
    .unwrap();
    if !output.status.success() {
        panic!("Can't get search paths from clang");
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if line.contains("libraries: =") {
            let path = line.split('=').nth(1).unwrap();
            return format!("{}/lib/darwin", path);
        }
    }
    panic!("clang is missing search paths");
}
