param(
  [switch]$Install,
  [string]$BackupDir = 'D:\JS\baghchal-keystore-backup'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$srcProps = Join-Path $BackupDir 'keystore.properties'
$srcJks   = Join-Path $BackupDir 'baghchal-release.jks'

if (-not (Test-Path $srcProps) -or -not (Test-Path $srcJks)) {
  Write-Host "RELEASE ABORTED: signing backup not found at $BackupDir"
  Write-Host 'Expected: keystore.properties + baghchal-release.jks (see README.txt there).'
  exit 1
}

function Read-Props([string]$path) {
  $h = @{}
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -gt 0) { $h[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim() }
  }
  return $h
}

$props = Read-Props $srcProps
$expected = ($props['sha256'] -replace '[^0-9A-Fa-f]', '').ToLower()
if (-not $expected) { Write-Host 'RELEASE ABORTED: sha256 missing from keystore.properties'; exit 1 }

function Find-JavaTool([string]$name) {
  $cands = @()
  if ($env:JAVA_HOME) { $cands += (Join-Path $env:JAVA_HOME "bin\$name") }
  $cands += (Join-Path 'C:\Program Files\Java\jdk-23\bin' $name)
  $cands += (Join-Path "$env:USERPROFILE\.jdks\openjdk-23.0.2\bin" $name)
  foreach ($c in $cands) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "$name not found (install a JDK and/or set JAVA_HOME)"
}

function Get-Fingerprint([string]$text) {
  # colon form (keytool) or bare hex (apksigner) -> normalized bare lowercase
  if ($text -match 'SHA-?256[:\s]+([0-9A-Fa-f:]{50,})') { return ($Matches[1] -replace '[^0-9A-Fa-f]', '').ToLower() }
  if ($text -match '\b([0-9A-Fa-f]{64})\b') { return $Matches[1].ToLower() }
  return $null
}

Write-Host '[1/6] build web'
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '[2/6] cap sync'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '[3/6] stage signing props + gradle bundleRelease assembleRelease'
Copy-Item $srcProps (Join-Path $root 'android\keystore.properties') -Force
Push-Location (Join-Path $root 'android')
try {
  & '.\gradlew.bat' bundleRelease assembleRelease --console=plain
  if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
}
finally { Pop-Location }

$gradleBuild = Join-Path $root 'android\app\build.gradle'
$vc = (Select-String -Path $gradleBuild -Pattern 'versionCode\s+(\d+)').Matches[0].Groups[1].Value
$vn = (Select-String -Path $gradleBuild -Pattern 'versionName\s+"([^"]+)"').Matches[0].Groups[1].Value
$stamp = "r$vc"

$aabSrc = Join-Path $root 'android\app\build\outputs\bundle\release\app-release.aab'
$apkSrc = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $aabSrc)) { Write-Host "missing $aabSrc"; exit 1 }
if (-not (Test-Path $apkSrc)) { Write-Host "missing $apkSrc"; exit 1 }

$outDir = Join-Path $root 'release'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$aab = Join-Path $outDir "baghchal-$vn-$stamp-release.aab"
$apk = Join-Path $outDir "baghchal-$vn-$stamp-release.apk"
Copy-Item $aabSrc $aab -Force
Copy-Item $apkSrc $apk -Force

Write-Host '[4/6] verify APK signature (apksigner)'
$apksigner = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools\*\apksigner.bat') |
  Sort-Object { [version]$_.Directory.Name } -Descending | Select-Object -First 1
$certOut = & $apksigner.FullName verify --print-certs $apk 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Write-Host "apksigner FAILED:`n$certOut"; exit 1 }
$apkFp = Get-Fingerprint $certOut
if ($apkFp -ne $expected) {
  Write-Host "FINGERPRINT MISMATCH (APK)!"
  Write-Host "  expected: $expected"
  Write-Host "  actual:   $apkFp"
  exit 1
}
Write-Host "  APK SHA-256 OK: $expected"

Write-Host '[5/6] verify AAB signature (jarsigner + cert fingerprint)'
$keytool = Find-JavaTool 'keytool.exe'
$jarsigner = Find-JavaTool 'jarsigner.exe'
$verOut = & $jarsigner -verify -strict $aab 2>&1 | Out-String
# self-signed release keys and missing timestamps make -strict exit non-zero
# even when the signature itself is valid; 'jar verified' + fingerprint below are the gates
if ($verOut -notmatch 'jar verified') {
  Write-Host "jarsigner FAILED:`n$verOut"; exit 1
}
$td = Join-Path $env:TEMP ("aabcert-" + [guid]::NewGuid().ToString('N'))
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($aab, $td)
try {
  $rsa = Get-ChildItem (Join-Path $td 'META-INF') -Include '*.RSA', '*.DSA', '*.EC' -Recurse | Select-Object -First 1
  if (-not $rsa) { Write-Host 'no cert block in AAB META-INF'; exit 1 }
  $cOut = & $keytool -printcert -file $rsa.FullName 2>&1 | Out-String
  $aabFp = Get-Fingerprint $cOut
  if ($aabFp -ne $expected) {
    Write-Host "FINGERPRINT MISMATCH (AAB)!`n  expected: $expected`n  actual:   $aabFp"
    exit 1
  }
  Write-Host "  AAB SHA-256 OK: $expected"
}
finally { Remove-Item $td -Recurse -Force }

Write-Host '[6/6] summary'
Write-Host "  AAB : $aab"
Write-Host "  APK : $apk"
Write-Host "  key : baghchal-release @ $srcJks"
Write-Host "  SHA256: $expected"
Write-Host '  (keep the backup folder safe — README.txt)'

if ($Install) {
  $adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
  & $adb install -r $apk
  if ($LASTEXITCODE -ne 0) { exit 1 }
  & $adb shell am start -n np.baghchal.game/.MainActivity
  Write-Host 'Installed release APK + launched.'
}
Write-Host 'RELEASE OK'
