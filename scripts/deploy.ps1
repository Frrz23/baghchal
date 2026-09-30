$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '[1/4] build web'
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

Write-Host '[2/4] cap sync'
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '[3/4] gradle assembleDebug'
Push-Location (Join-Path $root 'android')
try {
  & '.\gradlew.bat' assembleDebug --console=plain
  if ($LASTEXITCODE -ne 0) { exit 1 }
}
finally {
  Pop-Location
}

$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  Write-Host "adb not found at $adb"
  exit 1
}
$online = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '^(\S+)\s+device$' } | ForEach-Object { $Matches[1] }
if (-not $online) {
  Write-Host 'No device connected. Plug in the phone and enable USB debugging, then re-run.'
  & $adb devices
  exit 1
}
# prefer a physical phone; fall back to an emulator if that's all there is
$target = $online | Where-Object { $_ -notmatch '^emulator-' } | Select-Object -First 1
if (-not $target) { $target = $online[0] }
Write-Host "  target: $target"

Write-Host '[4/4] install + launch'
$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
& $adb -s $target install -r $apk
if ($LASTEXITCODE -ne 0) {
  # signature mismatch from an older install (e.g. release-signed test) -> wipe and retry
  Write-Host '  install failed - uninstalling existing np.baghchal.game and retrying'
  & $adb -s $target uninstall np.baghchal.game | Out-Null
  & $adb -s $target install $apk
  if ($LASTEXITCODE -ne 0) { exit 1 }
}
& $adb -s $target shell am start -n np.baghchal.game/.MainActivity
Write-Host 'Deployed to device.'
