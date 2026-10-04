param([int]$Runs = 3)

$presets = @('classic', 'speed', 'fortress', 'titan', 'sudden')
$env:MATCH_RUNS = "$Runs"
$fail = $false

foreach ($p in $presets) {
  $env:MATCH_PRESET = $p
  $log = "match-$p.log"
  Write-Output "=== START $p $(Get-Date -Format HH:mm:ss) ==="
  npm run match *> $log
  if ($LASTEXITCODE -ne 0) {
    Write-Output "=== FAILED $p ==="
    $fail = $true
    break
  }
  Write-Output "=== DONE $p $(Get-Date -Format HH:mm:ss) ==="
}

Remove-Item Env:MATCH_PRESET -ErrorAction SilentlyContinue
Remove-Item Env:MATCH_RUNS -ErrorAction SilentlyContinue
if ($fail) { Set-Content match-runs.done 'FAILED' } else { Set-Content match-runs.done 'ALL-OK' }
