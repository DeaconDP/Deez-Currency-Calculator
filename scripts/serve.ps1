param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $root 'dist'
$port = 4173
$mutexName = 'Local\DeacCurrencyConverterServer'
$created = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$created)
if (-not $created) { if (-not $NoBrowser) { Start-Process "http://localhost:$port" }; exit 0 }
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
try { $listener.Start() } catch { exit 1 }
if (-not $NoBrowser) { Start-Process "http://localhost:$port" }
$mime = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.json'='application/json'; '.svg'='image/svg+xml'; '.png'='image/png'; '.webmanifest'='application/manifest+json'; '.woff2'='font/woff2' }
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
    $requestLine = $reader.ReadLine()
    while ($reader.ReadLine()) { }
    $requestParts = $requestLine -split ' '
    $requestPath = if ($requestParts.Length -gt 1) { ($requestParts[1] -split '\?')[0] } else { '/' }
    $relative = [Uri]::UnescapeDataString($requestPath.TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    $candidate = [IO.Path]::GetFullPath((Join-Path $webRoot $relative))
    if (-not $candidate.StartsWith([IO.Path]::GetFullPath($webRoot)) -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)) { $candidate = Join-Path $webRoot 'index.html' }
    $bytes = [IO.File]::ReadAllBytes($candidate)
    $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
    $contentType = if ($mime.ContainsKey($extension)) { $mime[$extension] } else { 'application/octet-stream' }
    $cacheControl = if ($extension -eq '.html') { 'no-cache' } else { 'public, max-age=3600' }
    $headers = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nCache-Control: $cacheControl`r`nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.coinbase.com; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`r`nConnection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($requestParts[0] -ne 'HEAD') { $stream.Write($bytes, 0, $bytes.Length) }
    $stream.Dispose()
    $client.Dispose()
  }
} finally { $listener.Stop(); $mutex.ReleaseMutex() }
