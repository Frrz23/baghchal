import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { printDeviceList, resolveDevice, slug } from './devices.mjs';
import { assertCommon, assertGame, makeReport, tap } from './lib/asserts.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SMOKE_URL || 'http://localhost:5173/';

const SIZE_MATRIX = [
  { name: 'small-phone', w: 360, h: 640 },
  { name: 'phone', w: 390, h: 844 },
  { name: 'tall-phone', w: 412, h: 915 },
  { name: 'large-phone', w: 428, h: 926 },
  { name: 'tablet', w: 768, h: 1024 },
  { name: 'tablet-wide', w: 820, h: 1180 },
  { name: 'laptop', w: 1280, h: 800 },
  { name: 'desktop', w: 1920, h: 1080 },
];

function parseArgs(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--devices') return argv[i + 1];
    if (argv[i].startsWith('--devices=')) return argv[i].slice('--devices='.length);
  }
  return null;
}

const devicesArg = parseArgs(process.argv.slice(2));
if (devicesArg === 'list') {
  printDeviceList();
  process.exit(0);
}
if (devicesArg !== null && !devicesArg.trim()) {
  console.error('Missing value for --devices. Use --devices list to see options.');
  process.exit(1);
}

let cases;
let outDir;
if (devicesArg) {
  cases = devicesArg.split(',').map((raw) => {
    const name = raw.trim();
    const device = resolveDevice(name);
    return { key: slug(name), name, w: device.viewport.width, h: device.viewport.height, device };
  });
  outDir = '.smoke/devices';
} else {
  cases = SIZE_MATRIX.map((s) => ({ ...s, key: s.name, device: null }));
  outDir = '.smoke/responsive';
}

const report = makeReport();
const { errors, warnings, err, warn } = report;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

mkdirSync(outDir, { recursive: true });

for (const c of cases) {
  const page = await browser.newPage();
  // seed before first page script runs: first-run tutorial must never auto-open,
  // so the screenshots/centering asserts below always measure the real menu
  // (try/catch: about:blank has an opaque origin where localStorage throws)
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('tutSeen', '1');
    } catch {}
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(m.text());
  });

  try {
    if (c.device) await page.emulate(c.device);
    else
      await page.setViewport({
        width: c.w,
        height: c.h,
        deviceScaleFactor: 1,
        isMobile: c.w < 768,
        hasTouch: true,
      });

    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-act="pick-ai"]', { timeout: 5000 });
    await page.screenshot({ path: `${outDir}/${c.key}-menu.png` });
    await assertCommon(page, c, 'menu', report);

    await tap(page, '[data-act="pick-ai"]');
    await page.waitForSelector('[data-act="side"][data-side="goat"]', { timeout: 5000 });
    await page.screenshot({ path: `${outDir}/${c.key}-side.png` });
    await assertCommon(page, c, 'side', report);

    await tap(page, '[data-act="side"][data-side="goat"]');
    await page.waitForSelector('.board', { timeout: 5000 });
    await assertCommon(page, c, 'game-start', report);

    await tap(page, '[data-node="12"]');
    await page.waitForFunction(
      () => {
        const t = document.querySelector('.last-move')?.textContent || '';
        return /[-×]/.test(t);
      },
      { timeout: 20000 },
    );
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: `${outDir}/${c.key}-game.png` });
    await assertGame(page, c, report);

    if (pageErrors.length) err(c.name, 'page', pageErrors.join('; '));
    console.log(`  ${c.key.padEnd(24)} ${c.w}x${c.h}${c.device ? ' [device]' : ''}  done`);
  } catch (e) {
    err(c.name, 'flow', e.message);
    await page.screenshot({ path: `${outDir}/${c.key}-error.png` }).catch(() => {});
  }
  await page.close();
}

await browser.close();

for (const w of warnings) console.warn('  WARN', w);
if (errors.length) {
  for (const e of errors) console.error('  FAIL', e);
  console.error(`\nRESPONSIVE FAIL: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(
  `RESPONSIVE OK: ${cases.length} case(s), screenshots in ${outDir}/` +
    (warnings.length ? ` (${warnings.length} warning(s))` : ''),
);
