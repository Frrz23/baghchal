param([switch]$Cold)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$adb = Join-Path $env:ANDROID_HOME 'platform-tools\adb.exe'
$emu = Join-Path $env:ANDROID_HOME 'emulator\emulator.exe'
$avdName = 'baghchal'
$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'

Write-Host '[1/4] build web + apk'
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }
npx cap sync android
if ($LASTEXITCODE -ne 0) { exit 1 }
Push-Location (Join-Path $root 'android')
try {
  & '.\gradlew.bat' assembleDebug --console=plain
  if ($LASTEXITCODE -ne 0) { exit 1 }
}
finally {
  Pop-Location
}

function Get-EmulatorSerial {
  foreach ($line in (& $adb devices | Select-Object -Skip 1)) {
    if ($line -match '^(emulator-\d+)\s+device$') { return $Matches[1] }
  }
  return $null
}

function Stop-EmulatorProcs {
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'qemu-system|emulator\.exe' } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-Emulator([switch]$ColdBoot) {
  $emuArgs = @('-avd', $avdName, '-no-boot-anim')
  if ($ColdBoot) { $emuArgs += '-no-snapshot-load' }
  Start-Process -FilePath $emu -ArgumentList $emuArgs
}

function Wait-Device([int]$Minutes, [datetime]$Since) {
  $deadline = (Get-Date).AddMinutes($Minutes)
  $cleared = $false
  while ((Get-Date) -lt $deadline) {
    $s = Get-EmulatorSerial
    if ($s) { return $s }
    if (-not $cleared -and ((Get-Date) -gt $Since.AddSeconds(60))) {
      Write-Host '  still offline after 60s - refreshing stale adb server...'
      & $adb kill-server | Out-Null
      $cleared = $true
    }
    Start-Sleep -Seconds 3
  }
  return $null
}

Write-Host '[2/4] start emulator'
$serial = Get-EmulatorSerial
if (-not $serial) {
  $avds = @(& $emu -list-avds | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($avds -notcontains $avdName) {
    Write-Host "AVD '$avdName' missing - creating..."
    $avdmanager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\avdmanager.bat'
    cmd /c "echo no | `"$avdmanager`" create avd -n $avdName -k `"system-images;android-35;google_apis_playstore;x86_64`" -d pixel_7 --force"
    if ($LASTEXITCODE -ne 0) { exit 1 }
  }
  $since = Get-Date
  Start-Emulator -ColdBoot:$Cold
  Write-Host 'waiting for emulator to come online (first boot can take a few minutes)...'
  $serial = Wait-Device -Minutes 3 -Since $since
  if (-not $serial -and -not $Cold) {
    Write-Host 'emulator stayed offline (likely a corrupted quickboot snapshot) - retrying with a cold boot (-no-snapshot-load)...'
    Stop-EmulatorProcs
    & $adb kill-server | Out-Null
    Start-Sleep -Seconds 2
    $since = Get-Date
    Start-Emulator -ColdBoot:$true
    $serial = Wait-Device -Minutes 4 -Since $since
  }
  if (-not $serial) { Write-Host 'Emulator did not come online in time.'; exit 1 }
  $deadline = (Get-Date).AddMinutes(5)
  $booted = $false
  while ((Get-Date) -lt $deadline) {
    $boot = (& $adb -s $serial shell getprop sys.boot_completed | Out-String).Trim()
    if ($boot -eq '1') { $booted = $true; break }
    Start-Sleep -Seconds 3
  }
  if (-not $booted) { Write-Host 'Emulator did not finish booting in time.'; exit 1 }
}
& $adb -s $serial shell wm dismiss-keyguard | Out-Null

Write-Host '[3/4] install apk'
& $adb -s $serial install -r $apk
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '[4/4] launch app'
& $adb -s $serial shell am start -n np.baghchal.game/.MainActivity | Out-Null
Write-Host "Emulator ready - app running on $serial. Close it with the X on the emulator window."
