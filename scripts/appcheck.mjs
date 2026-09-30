import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { assertCommon, assertGame, makeReport, tap } from './lib/asserts.mjs';
import { adb, findDevice, sleep, waitFor, waitForDevice } from './lib/adb.mjs';

const PKG = 'np.baghchal.game';
const ACTIVITY = `${PKG}/.MainActivity`;
const PORT = 9333;
const PANEL_PORT = 5199;
const OUT = '.smoke/emulator';

function shot(serial, path, report, label) {
  try {
    const buf = adb(serial, ['exec-out', 'screencap', '-p'], { buffer: true });
    if (buf.length < 2000) throw new Error(`empty screencap (${buf.length}b)`);
    writeFileSync(path, buf);
  } catch (e) {
    report.warn(label, 'shot', `screenshot failed: ${e.message.slice(0, 120)}`);
  }
}

async function relaunchAndConnect(serial) {
  adb(serial, ['shell', 'am', 'force-stop', PKG]);
  await sleep(600);
  adb(serial, ['shell', 'am', 'start', '-n', ACTIVITY]);

  const pid = await waitFor(() => adb(serial, ['shell', 'pidof', PKG], { allowFail: true }).split(/\s+/)[0], 12000);
  if (!pid) throw new Error('app did not start (no pid)');

  const sock = await waitFor(() => {
    const unix = adb(serial, ['shell', 'cat', '/proc/net/unix'], { allowFail: true });
    return unix.includes(`webview_devtools_remote_${pid}`) ? `webview_devtools_remote_${pid}` : null;
  }, 12000);
  if (!sock) throw new Error(`WebView debug socket for pid ${pid} not found (debug build required)`);

  adb(serial, ['forward', `tcp:${PORT}`, `localabstract:${sock}`]);
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
  const pages = await browser.pages();
  const page = pages.find((p) => /localhost|capacitor/.test(p.url())) || pages[0];
  if (!page) throw new Error('no page target in WebView');
  return { browser, page };
}

async function viewportStable(page) {
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const v = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    if (prev && prev.w === v.w && prev.h === v.h) return v;
    prev = v;
    await sleep(500);
  }
  return prev;
}

function deviceCss(serial, forceRot) {
  const sizeOut = adb(serial, ['shell', 'wm', 'size']);
  const sizes = [...sizeOut.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  if (!sizes.length) throw new Error(`cannot read wm size: ${sizeOut}`);
  const [, sw, sh] = sizes.at(-1);
  const densOut = adb(serial, ['shell', 'wm', 'density']);
  const dens = [...densOut.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  if (!dens.length) throw new Error(`cannot read wm density: ${densOut}`);
  const dpr = Number(dens.at(-1)[1]) / 160;
  const rot =
    forceRot !== undefined
      ? forceRot
      : adb(serial, ['shell', 'settings', 'get', 'system', 'user_rotation']) === '1'
        ? 1
        : 0;
  const wpx = rot ? Number(sh) : Number(sw);
  const hpx = rot ? Number(sw) : Number(sh);
  return { w: Math.round(wpx / dpr), h: Math.round(hpx / dpr), dpr };
}

async function playFlow(page, report, size, key, { shots }) {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });

  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 10000 });
  if (shots) shot(serial, `${OUT}/${key}-menu.png`, report, size.name);
  await assertCommon(page, size, 'menu', report);

  await tap(page, '[data-act="pick-ai"]');
  await page.waitForSelector('[data-act="side"][data-side="goat"]', { timeout: 5000 });
  await assertCommon(page, size, 'side', report);

  await tap(page, '[data-act="side"][data-side="goat"]');
  await page.waitForSelector('.board', { timeout: 5000 });
  await assertCommon(page, size, 'game-start', report);

  await tap(page, '[data-node="12"]');
  await page.waitForFunction(() => /[-×]/.test(document.querySelector('.last-move')?.textContent || ''), { timeout: 20000 });
  await sleep(300);
  if (shots) shot(serial, `${OUT}/${key}-game.png`, report, size.name);
  await assertGame(page, size, report);

  if (pageErrors.length) report.err(key, 'page', pageErrors.join('; '));
}

function setRotation(serial, user) {
  adb(serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  adb(serial, ['shell', 'settings', 'put', 'system', 'user_rotation', String(user)]);
}
function setSize(serial, size) {
  if (size) {
    adb(serial, ['shell', 'wm', 'size', size]);
    adb(serial, ['shell', 'wm', 'density', '320']);
  } else {
    adb(serial, ['shell', 'wm', 'size', 'reset'], { allowFail: true });
    adb(serial, ['shell', 'wm', 'density', 'reset'], { allowFail: true });
  }
}

const scenarios = [
  { key: 'portrait', rot: 0, setup: (s) => { setRotation(s, 0); setSize(s, null); } },
  { key: 'landscape', rot: 1, setup: (s) => { setRotation(s, 1); setSize(s, null); } },
  { key: 'small-phone', rot: 0, setup: (s) => { setRotation(s, 0); setSize(s, '720x1280'); } },
  { key: 'tablet', rot: 0, setup: (s) => { setRotation(s, 0); setSize(s, '1600x2560'); } },
];

const report = makeReport();

let serial = findDevice();
if (!serial) {
  console.log('No device visible yet - waiting for emulator...');
  serial = await waitForDevice(60000);
}
if (!serial) {
  console.error('No device/emulator found. Run: npm run emulator');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
console.log(`APPCHECK on ${serial}`);

// warn if the device panel is up - both tools write wm size/density
try {
  const res = await fetch(`http://127.0.0.1:${PANEL_PORT}/api/state`, { signal: AbortSignal.timeout(300) });
  const data = await res.json();
  if (data?.panel === 'baghchal') {
    console.warn(
      `WARN: device panel is running (localhost:${PANEL_PORT}) - appcheck will overwrite wm size/density; close the panel (Ctrl+C) for clean results`,
    );
  }
} catch {}

async function runScenario(sc) {
  let browser = null;
  try {
    sc.setup(serial);
    const rotAfterSetup = adb(serial, ['shell', 'settings', 'get', 'system', 'user_rotation']);
    await sleep(1800);
    const conn = await relaunchAndConnect(serial);
    browser = conn.browser;
    const { page } = conn;
    // relaunch can revert system rotation - re-assert it while connected
    if (sc.rot) {
      setRotation(serial, sc.rot);
      await sleep(900);
    }
    const real = deviceCss(serial, sc.rot);
    const rotAtRead = adb(serial, ['shell', 'settings', 'get', 'system', 'user_rotation']);
    const disp = /mDisplayRotation=(ROTATION_\d+)/.exec(
      adb(serial, ['shell', 'dumpsys', 'window', 'displays'], { allowFail: true }) || '',
    );
    console.log(
      `    rot: setup=[${rotAfterSetup}] read=[${rotAtRead}] disp=[${disp?.[1] ?? '?'}] css=${real.w}x${real.h}@${real.dpr}`,
    );
    await page.setViewport({
      width: real.w,
      height: real.h,
      deviceScaleFactor: real.dpr,
      isMobile: true,
      hasTouch: true,
    });
    await sleep(400);
    const vp = await viewportStable(page);
    const size = { name: sc.key, w: vp.w, h: vp.h };
    await playFlow(page, report, size, sc.key, { shots: true });
    console.log(`  ${sc.key.padEnd(14)} ${vp.w}x${vp.h}  done`);
  } finally {
    try { browser?.disconnect(); } catch {}
    adb(serial, ['forward', '--remove', `tcp:${PORT}`], { allowFail: true });
  }
}

for (const sc of scenarios) {
  for (let attemptN = 1; ; attemptN++) {
    try {
      await runScenario(sc);
      break;
    } catch (e) {
      const devErr = /offline|not found|Target closed|detached|Protocol error|ECONNRESET/i.test(e.message);
      if (devErr && attemptN === 1) {
        console.log(`  ${sc.key.padEnd(14)} device hiccup - waiting to retry...`);
        const back = await waitForDevice(20000);
        if (back) {
          serial = back;
          await sleep(3000);
          continue;
        }
      }
      report.err(sc.key, 'flow', e.message);
      console.log(`  ${sc.key.padEnd(14)} FAILED: ${e.message}`);
      break;
    }
  }
}

// jank check: fresh portrait session, few moves, gfxinfo stats
let jankLine = 'jank: skipped (no data)';
try {
  const back = await waitForDevice(30000);
  if (!back) throw new Error('device did not come back for jank check');
  serial = back;
  setRotation(serial, 0);
  setSize(serial, null);
  await sleep(1500);
  const conn = await relaunchAndConnect(serial);
  try {
    const { page } = conn;
    const real = deviceCss(serial);
    await page.setViewport({
      width: real.w,
      height: real.h,
      deviceScaleFactor: real.dpr,
      isMobile: true,
      hasTouch: true,
    });
    await page.waitForSelector('[data-act="pick-ai"]', { timeout: 10000 });
    await tap(page, '[data-act="pick-ai"]');
    await page.waitForSelector('[data-act="side"][data-side="goat"]', { timeout: 5000 });
    await tap(page, '[data-act="side"][data-side="goat"]');
    await page.waitForSelector('.board', { timeout: 5000 });

    const placeOne = async () => {
      const free = await page.evaluate(() => {
        const taken = new Set(
          [...document.querySelectorAll('svg.board g.piece')].map((g) => {
            const m = /translate\(([\d.]+)[\s,]+([\d.]+)\)/.exec(g.getAttribute('transform') || '');
            if (!m) return -1;
            return Math.round((+m[2] - 50) / 100) * 5 + Math.round((+m[1] - 50) / 100);
          }),
        );
        for (let n = 0; n < 25; n++) if (!taken.has(n)) return n;
        return null;
      });
      if (free === null) throw new Error('no free node for jank taps');
      const before = await page.evaluate(() => document.querySelector('.last-move')?.textContent ?? '');
      await tap(page, `[data-node="${free}"]`);
      await page.waitForFunction(
        (b) => (document.querySelector('.last-move')?.textContent ?? '') !== b,
        { timeout: 20000 },
        before,
      );
    };

    await placeOne(); // warmup: shader/JIT/first-animation cost excluded
    await sleep(600);
    adb(serial, ['shell', 'dumpsys', 'gfxinfo', PKG, 'reset']);
    for (let i = 0; i < 4; i++) {
      await placeOne();
      await sleep(250);
    }
    await sleep(800);
    const gfx = adb(serial, ['shell', 'dumpsys', 'gfxinfo', PKG]);
    const total = Number(/Total frames rendered:\s*(\d+)/.exec(gfx)?.[1] ?? 0);
    const jankyPct = Number(/Janky frames:\s*\d+ \(([\d.]+)%\)/.exec(gfx)?.[1] ?? 0);
    const p90 = Number(/90th percentile:\s*(\d+)ms/.exec(gfx)?.[1] ?? 0);
    if (total < 20) {
      jankLine = `jank: ${total} frames (too few to judge)`;
      report.warn('jank', 'perf', `only ${total} frames rendered`);
    } else {
      jankLine = `jank ${jankyPct.toFixed(1)}% (p90 ${p90}ms, ${total} frames)`;
      if (jankyPct > 10 || p90 > 32) {
        const detail = gfx
          .split('\n')
          .filter((l) => /Missed Vsync|Slow UI thread|Slow bitmap|Slow issue/.test(l))
          .map((l) => l.trim())
          .join(' | ');
        const msg = `janky ${jankyPct}% (p90 ${p90}ms) exceeds limits (10% / 32ms) -- ${detail}`;
        if (serial.startsWith('emulator-')) {
          report.warn('jank', 'perf', `${msg} [emulator result advisory only: same build holds 60fps in Chrome]`);
        } else {
          report.err('jank', 'perf', msg);
        }
      }
      else if (jankyPct > 5 || p90 > 24) report.warn('jank', 'perf', `janky ${jankyPct}% (p90 ${p90}ms)`);
    }
  } finally {
    try { conn.browser.disconnect(); } catch {}
    adb(serial, ['forward', '--remove', `tcp:${PORT}`], { allowFail: true });
  }
} catch (e) {
  report.warn('jank', 'perf', `check failed: ${e.message}`);
}

// restore emulator defaults and leave the app open for manual poking
try {
  const origAccel = adb(serial, ['shell', 'settings', 'get', 'system', 'accelerometer_rotation'], { allowFail: true });
  adb(serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'], { allowFail: true });
  adb(serial, ['shell', 'settings', 'put', 'system', 'user_rotation', '0'], { allowFail: true });
  if (origAccel === '1') adb(serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1'], { allowFail: true });
  setSize(serial, null);
  adb(serial, ['shell', 'am', 'force-stop', PKG], { allowFail: true });
  await sleep(500);
  adb(serial, ['shell', 'am', 'start', '-n', ACTIVITY], { allowFail: true });
} catch (e) {
  console.warn('  WARN restore skipped:', e.message);
}

for (const w of report.warnings) console.warn('  WARN', w);
if (report.errors.length) {
  for (const e of report.errors) console.error('  FAIL', e);
  console.error(`\nAPPCHECK FAIL: ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`APPCHECK OK: ${scenarios.length} state(s), ${jankLine}, screenshots in ${OUT}/`);
