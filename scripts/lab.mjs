import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_MARKER, startPanel } from './emu-panel.mjs';
import { listDeviceStates, sleep } from './lib/adb.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PS_SCRIPT = join(ROOT, 'scripts', 'emulator.ps1');

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PORT = Number(flag('--port', '5199'));

function psCount(needle) {
  const cmd =
    `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${needle}*' }).Count`;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    return Number(out.trim()) || 0;
  } catch {
    return -1;
  }
}

function psHasEmulatorScript() {
  return psCount('emulator.ps1') > 0;
}

async function probePanel(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(400) });
    const d = await r.json();
    return d && d.panel === PANEL_MARKER ? 'ours' : 'foreign';
  } catch (e) {
    if (e.name === 'TimeoutError') return 'foreign';
    if (e instanceof TypeError || (e.cause && e.cause.code === 'ECONNREFUSED')) return 'free';
    return 'foreign';
  }
}

async function selftestShutdown() {
  const tmp = join(tmpdir(), `lab-selftest-${Date.now()}.ps1`);
  writeFileSync(tmp, 'Start-Sleep -Seconds 120\n');
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await sleep(1500);
  const before = psCount(tmp);
  ps.kill();
  await Promise.race([once(ps, 'exit'), sleep(3000)]);
  await sleep(500);
  const after = psCount(tmp);
  try {
    rmSync(tmp, { force: true });
  } catch {}
  if (before >= 1 && after === 0) {
    console.log('SHUTDOWN SELFTEST OK (child powershell killed, no zombie)');
    process.exit(0);
  }
  console.error(`SHUTDOWN SELFTEST FAIL: before=${before} after=${after}`);
  process.exit(1);
}

if (args.includes('--selftest-shutdown')) {
  await selftestShutdown();
}

// ---- fail fast before any boot work ----
const probe = await probePanel(PORT);
if (probe === 'ours') {
  console.log(`Lab already running at http://localhost:${PORT} - open that tab (not starting a second lab).`);
  process.exit(0);
}
if (probe === 'foreign') {
  console.error(`Port ${PORT} is in use by another program - try: npm run lab -- --port ${PORT + 1}`);
  process.exit(1);
}

let panel;
try {
  panel = await startPanel({ port: PORT, autoOpen: !args.includes('--no-open') });
} catch (e) {
  console.error(e.message);
  process.exit(/already running/.test(e.message) ? 0 : 1);
}
console.log('[lab] panel up - waiting for device (panel shows live reasons meanwhile)');

// ---- emulator.ps1: join an existing boot, otherwise spawn ----
let child = null;
let childExited = false;
let childOk = false;
let waitingExisting = false;

function prefixer(tag) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.trim()) console.log(`${tag} ${line}`);
    }
  };
}

if (psHasEmulatorScript()) {
  waitingExisting = true;
  console.log('[lab] existing emulator boot detected - waiting for it instead of spawning another');
} else {
  child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  console.log('[lab] running emulator.ps1 (build + boot + install + launch)...');
  child.stdout.on('data', prefixer('[emu]'));
  child.stderr.on('data', prefixer('[emu]'));
  child.on('exit', (code) => {
    childExited = true;
    childOk = code === 0;
    if (code === 0) console.log('[lab] emulator.ps1 completed');
    else
      console.error(
        `[lab] emulator.ps1 FAILED (exit ${code}) - panel stays up for diagnostics; to retry: Ctrl+C this lab, then npm run lab`,
      );
  });
}

// ---- live status loop + ready detection ----
let lastKey = null;
let warnShown = false;
let ready = false;

function printReady(rows) {
  ready = true;
  console.log('[lab] ---------------------------------------------------------------');
  console.log(`[lab] LAB READY  panel: ${panel.url}   device: ${rows.map((r) => r.serial).join(', ')}`);
  console.log('[lab] pick devices in the browser. Ctrl+C stops the panel; the emulator window stays open (close with X).');
}

const timer = setInterval(async () => {
  let rows;
  try {
    rows = await listDeviceStates(3000);
    warnShown = false;
  } catch (e) {
    if (!warnShown) {
      console.warn(`[lab] ${e.message}`);
      warnShown = true;
    }
    return;
  }
  const key = rows.map((r) => `${r.serial}:${r.state}`).join(',') || 'none';
  if (key !== lastKey) {
    console.log(`[lab] adb: ${key}`);
    lastKey = key;
  }
  if (ready) return;
  const online = rows.filter((r) => r.state === 'device');
  if (childExited) {
    if (childOk && online.length) printReady(online);
    return;
  }
  if (waitingExisting && !psHasEmulatorScript() && online.length) printReady(online);
}, 2000);

// ---- clean shutdown: kill our spawned .ps1, keep the emulator window ----
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(timer);
  const killingPs = Boolean(child) && !childExited;
  console.log(
    `\n[lab] ${sig}: stopping panel${killingPs ? ' + emulator.ps1' : ''} (emulator window stays open - close it with X)`,
  );
  if (killingPs) {
    try {
      child.kill();
    } catch {}
  }
  try {
    await panel.close();
  } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
process.on('exit', () => {
  if (child && !childExited) {
    try {
      child.kill();
    } catch {}
  }
});
