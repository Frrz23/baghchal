# Stops the dev server (vite on :5173) and the emulator, clears adb forwards.
# Run after every check/test/build session - leaving them open heats the laptop.
$ErrorActionPreference = 'SilentlyContinue'
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (!(Test-Path $adb)) { $adb = 'adb' }

$did = @()

# 1. vite dev server (and vite preview, if somehow running)
foreach ($port in 5173, 4173) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
    if ($p -and $p.Name -match 'node|vite') {
      Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
      $did += "dev server :$port (pid $($c.OwningProcess))"
    }
  }
}

# 2. emulator: graceful first, then force
$emuOnline = & $adb devices 2>$null | Select-String 'emulator-\d+\s+device'
if ($emuOnline) {
  $name = (($emuOnline -split '\s+')[0])
  & $adb -s $name emu kill 2>$null | Out-Null
  $did += "emulator ($name, adb emu kill)"
  Start-Sleep -Milliseconds 1500
}
$leftover = Get-CimInstance Win32_Process -Filter "Name='qemu-system-x86_64.exe' or Name='emulator.exe'" -ErrorAction SilentlyContinue
if ($leftover) {
  $leftover | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $did += "emulator force-killed (pid $($leftover.ProcessId -join ','))"
}

# 3. adb port forwards (CDP etc.)
$fwd = & $adb forward --list 2>$null
if ($fwd) {
  & $adb forward --remove-all 2>$null | Out-Null
  $did += "adb forwards removed ($(@($fwd).Count) active)"
}

if ($did.Count) { Write-Host "STOPPED:"; $did | ForEach-Object { Write-Host "  - $_" } }
else { Write-Host 'STOP: nothing was running (dev server, emulator, forwards all clear)' }
