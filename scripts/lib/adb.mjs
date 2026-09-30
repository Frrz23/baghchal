import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ADB = `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function adbRaw(serial, args, encoding = 'utf8', timeout = 10000) {
  return execFileSync(ADB, ['-s', serial, ...args], {
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    timeout,
    windowsHide: true,
  });
}

export function adb(serial, args, { allowFail = false, buffer = false, timeout = 10000 } = {}) {
  try {
    const out = adbRaw(serial, args, buffer ? 'buffer' : 'utf8', timeout);
    return buffer ? out : out.trim();
  } catch (e) {
    if (allowFail) return buffer ? Buffer.alloc(0) : (e.stdout ?? '').toString().trim();
    throw new Error(`adb ${args.join(' ')} failed: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
  }
}

export function findDevice() {
  const out = execFileSync(ADB, ['devices'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const rows = out.split('\n').slice(1).map((l) => l.trim()).filter((l) => /\bdevice$/.test(l));
  if (!rows.length) return null;
  const serials = rows.map((l) => l.split(/\s+/)[0]);
  return serials.find((s) => s.startsWith('emulator-')) || serials[0];
}

export async function waitForDevice(ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const d = findDevice();
    if (d) return d;
    if (Date.now() > end) return null;
    await sleep(2000);
  }
}

export async function waitFor(fn, ms, interval = 400) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(interval);
  }
}

function timeoutErr(e, timeout, what) {
  if (e.killed || e.signal) return new Error(`adb not responding (${timeout / 1000}s timeout): ${what}`);
  return new Error(`adb ${what} failed: ${(e.stderr || e.message || '').toString().slice(0, 300)}`);
}

export async function adbAsync(serial, args, { timeout = 3000 } = {}) {
  try {
    const { stdout } = await execFileAsync(ADB, ['-s', serial, ...args], {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout.trim();
  } catch (e) {
    throw timeoutErr(e, timeout, args.join(' '));
  }
}

export async function listDeviceStates(timeout = 3000) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(ADB, ['devices', '-l'], {
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }));
  } catch (e) {
    throw timeoutErr(e, timeout, 'devices');
  }
  const rows = [];
  for (const line of stdout.split('\n').slice(1)) {
    const m = /^(\S+)\s+(\S+)/.exec(line.trim());
    if (m) rows.push({ serial: m[1], state: m[2] });
  }
  return rows;
}
