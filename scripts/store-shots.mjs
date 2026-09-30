import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { adb, findDevice, sleep, waitFor, waitForDevice } from './lib/adb.mjs';
import { tap } from './lib/asserts.mjs';

const PKG = 'np.baghchal.game';
const ACTIVITY = `${PKG}/.MainActivity`;
const PORT = 9333;
const OUT = 'store/screenshots';

function deviceCss(serial) {
  const sizeOut = adb(serial, ['shell', 'wm', 'size']);
  const sizes = [...sizeOut.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  if (!sizes.length) throw new Error(`cannot read wm size: ${sizeOut}`);
  const [, sw, sh] = sizes.at(-1);
  const densOut = adb(serial, ['shell', 'wm', 'density']);
  const dens = [...densOut.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  if (!dens.length) throw new Error(`cannot read wm density: ${densOut}`);
  const dpr = Number(dens.at(-1)[1]) / 160;
  return { w: Math.round(Number(sw) / dpr), sh: Number(sh), dpr };
}

// The window sits below the status bar (not edge-to-edge here): CDP's CSS
// viewport must match the real window, or content renders shifted down by the
// bar and the bottom is painted off-screen (screencap kept showing +45css).
function statusBarTopPx(serial) {
  const out = adb(serial, ['shell', 'dumpsys', 'window', 'displays']);
  const m = /type=statusBars\s+frame=\[0,0\]\[(\d+),(\d+)\]/.exec(out);
  return m ? Number(m[2]) : 0;
}

function shot(serial, file) {
  const buf = adb(serial, ['exec-out', 'screencap', '-p'], { buffer: true });
  if (buf.length < 2000) throw new Error(`empty screencap (${buf.length}b)`);
  writeFileSync(file, buf);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const ok = w >= 1080 && h >= 1080;
  console.log(`  ${file}  ${w}x${h}${ok ? '' : '  !! smaller than 1080'}`);
  if (!ok) throw new Error(`${file} is ${w}x${h}; Play wants >= 1080px on the small side`);
  return { w, h };
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
  return { browser, page };
}

let serial = findDevice();
if (!serial) {
  console.log('No device visible yet - waiting...');
  serial = await waitForDevice(60000);
}
if (!serial) {
  console.error('No device/emulator found. Run: npm run emulator');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

// natural portrait, no overrides
adb(serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
adb(serial, ['shell', 'settings', 'put', 'system', 'user_rotation', '0']);
adb(serial, ['shell', 'wm', 'size', 'reset'], { allowFail: true });
adb(serial, ['shell', 'wm', 'density', 'reset'], { allowFail: true });
await sleep(1500);

console.log(`STORE-SHOTS on ${serial}`);
const { browser, page } = await relaunchAndConnect(serial);
try {
  const real = deviceCss(serial);
  const statusTop = statusBarTopPx(serial);
  const winH = Math.round((real.sh - statusTop) / real.dpr);
  console.log(`viewport: ${real.w}x${winH} @${real.dpr} (status bar top=${statusTop}px)`);
  await page.setViewport({ width: real.w, height: winH, deviceScaleFactor: real.dpr, isMobile: true, hasTouch: true });
  await sleep(500);

  // 1 - main menu
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 10000 });
  // first-run tutorial (fresh installs) - dismiss BEFORE any screenshot
  if (await page.$('.tut-card')) {
    await tap(page, '[data-act="tut-close"]');
    await page.waitForFunction(() => !document.querySelector('.tut-card'), { timeout: 3000 });
    await sleep(200);
  }
  shot(serial, `${OUT}/01-menu.png`);

  // 2 - side + difficulty screen
  await tap(page, '[data-act="pick-ai"]');
  await page.waitForSelector('[data-act="diff"][data-diff="hard"]', { timeout: 5000 });
  shot(serial, `${OUT}/02-side-difficulty.png`);

  // 3 - vs-AI game, a few placements so the board looks alive
  await tap(page, '[data-act="side"][data-side="goat"]');
  await page.waitForSelector('.board', { timeout: 5000 });
  for (let placed = 0; placed < 5; placed++) {
    await page.waitForFunction(
      () => !document.querySelector('.turn')?.textContent.includes('…'),
      { timeout: 20000 },
    );
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
    if (free === null) break;
    const before = await page.evaluate(() => document.querySelector('.last-move')?.textContent ?? '');
    await tap(page, `[data-node="${free}"]`);
    await page.waitForFunction(
      (b) => (document.querySelector('.last-move')?.textContent ?? '') !== b,
      { timeout: 20000 },
      before,
    );
    await sleep(400);
  }
  await page.waitForFunction(
    () => !document.querySelector('.turn')?.textContent.includes('…'),
    { timeout: 20000 },
  );
  await sleep(600);
  shot(serial, `${OUT}/03-game.png`);

  // 4 - pause overlay with move history
  await tap(page, '[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 5000 });
  shot(serial, `${OUT}/04-pause-history.png`);
  await tap(page, '[data-act="resume"]');

  // 5 - scripted tiger win (local mode) -> win overlay
  await tap(page, '[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 5000 });
  await tap(page, '.pause-card [data-act="menu"]');
  await page.waitForSelector('[data-act="local"]', { timeout: 5000 });
  await tap(page, '[data-act="local"]');
  await page.waitForSelector('.board', { timeout: 5000 });
  const turnText = () => page.evaluate(() => document.querySelector('.turn')?.textContent ?? '');
  const act = async (fn) => {
    const prev = await turnText();
    await fn();
    await page.waitForFunction(
      (p) => (document.querySelector('.turn')?.textContent ?? '') !== p,
      { timeout: 5000 },
      prev,
    );
    await sleep(350);
  };
  try {
    for (const [type, from, to] of [
      ['place', 1], ['jump', 0, 2],
      ['place', 7], ['jump', 2, 12],
      ['place', 13], ['jump', 12, 14],
      ['place', 13], ['jump', 14, 12],
      ['place', 11], ['jump', 12, 10],
    ]) {
      if (type === 'place') {
        await act(() => tap(page, `[data-node="${from}"]`));
      } else {
        await act(async () => {
          await tap(page, `[data-node="${from}"]`);
          await sleep(400);
          await tap(page, `[data-node="${to}"]`);
        });
      }
    }
  } catch (e) {
    const lm = await page.evaluate(() => document.querySelector('.last-move')?.textContent ?? '');
    const pieces = await page.$$eval('.piece', (els) => els.length).catch(() => -1);
    throw new Error(`${e.message} (win script stuck; turn=${await turnText()} last-move=${lm} pieces=${pieces})`);
  }
  await page.waitForSelector('.overlay', { timeout: 5000 });
  shot(serial, `${OUT}/05-win.png`);

  console.log(`STORE-SHOTS OK: 5 shot(s) in ${OUT}/`);
} finally {
  try { browser.disconnect(); } catch {}
  adb(serial, ['forward', '--remove', `tcp:${PORT}`], { allowFail: true });
}
