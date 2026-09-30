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
$device = & $adb devices | Where-Object { $_ -match "`tdevice$" }
if (-not $device) {
  Write-Host 'No device connected. Plug in the phone and enable USB debugging, then re-run.'
  & $adb devices
  exit 1
}

Write-Host '[4/4] install + launch'
& $adb install -r (Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk')
if ($LASTEXITCODE -ne 0) { exit 1 }
& $adb shell am start -n np.baghchal.game/.MainActivity
Write-Host 'Deployed to device.'
