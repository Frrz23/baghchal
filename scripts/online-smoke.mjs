/**
 * Online multiplayer E2E smoke (M8): two browser pages on one dev server +
 * a local `wrangler dev` room server. Verifies create → share code → join →
 * both boards sync → move relay both ways → pause has no reset in online →
 * leaving shows the opponent-left overlay on the other phone.
 *
 * Needs: `npm run dev` running (5173) and no leftover wrangler on 8787
 * (this script starts/stops its own). Run: `npm run online-smoke`.
 */
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SMOKE_URL || 'http://localhost:5173/';
const WRANGLER_PORT = 8787;
const WRANGLER_LOG = '.smoke/wrangler.log';

const errors = [];
const fail = (msg) => {
  console.error('ONLINE-SMOKE FAIL:', msg);
  if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
};

mkdirSync('.smoke', { recursive: true });
writeFileSync(WRANGLER_LOG, '');

// --- 0. dev server must be up (contract shared with responsive/smoke) ---
try {
  const r = await fetch(BASE, { signal: AbortSignal.timeout(2500) });
  if (!r.ok) throw new Error('status ' + r.status);
} catch {
  fail(`dev server not reachable at ${BASE} - run \`npm run dev\` first`);
}

// --- 1. start wrangler dev (room server on 127.0.0.1:8787) unless SKIP_WRANGLER
//        (prod E2E: start dev with VITE_WS_URL=wss://<worker> so the client
//        talks to the deployed room server instead) ---
let wrangler = null;
function killWrangler() {
  if (!wrangler) return;
  try {
    wrangler.kill();
  } catch {
    /* already dead */
  }
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/PID', String(wrangler.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
    } catch {
      /* best effort */
    }
  }
}
function append(d) {
  try {
    appendFileSync(WRANGLER_LOG, d);
  } catch {
    /* best effort */
  }
}
if (process.env.SKIP_WRANGLER) {
  console.log('SKIP_WRANGLER set: using the deployed room server');
} else {
  wrangler = spawn('npx', ['wrangler', 'dev', '--port', String(WRANGLER_PORT)], {
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  wrangler.stdout.on('data', (d) => append(d));
  wrangler.stderr.on('data', (d) => append(d));
  let wranglerUp = false;
  for (let i = 0; i < 90 && !wranglerUp; i++) {
    await sleep(1000);
    try {
      const r = await fetch(`http://127.0.0.1:${WRANGLER_PORT}/`, { signal: AbortSignal.timeout(800) });
      if (r.ok) wranglerUp = true;
    } catch {
      /* not yet */
    }
  }
  if (!wranglerUp) {
    killWrangler();
    fail(`wrangler dev did not come up on :${WRANGLER_PORT} (see ${WRANGLER_LOG})`);
  }
  console.log('wrangler dev up on :' + WRANGLER_PORT);
}

// --- 2. two pages, one profile (localStorage shared: tutorial dismissed once) ---
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
  protocolTimeout: 20000,
});
console.log('browser launched');
const open = async () => {
  const p = await browser.newPage();
  await p.setViewport({ width: 420, height: 850, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn') errors.push('console[' + m.type() + ']: ' + m.text());
  });
  return p;
};
const phoneA = await open(); // host: goats
const phoneB = await open(); // guest: tigers
const text = async (p, sel) => p.$eval(sel, (el) => el.textContent.trim());
// NOTE: puppeteer's ElementHandle.click hangs when the browser has a second
// page (CDP Runtime.callFunctionOn never returns) - dispatch clicks in-page.
const click = (p, sel) =>
  p.evaluate(
    (s) => {
      const el = document.querySelector(s);
      if (!el) throw new Error('click target missing: ' + s);
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    },
    sel,
  );
const noAnim = async (p) =>
  p.addStyleTag({ content: '*{animation-duration:0.001s!important;transition-duration:0.001s!important}' });

let passed = false;
try {
  console.log('step: A goto');
  await phoneA.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await noAnim(phoneA);
  // first-run tutorial seeds on fresh profile: dismiss it
  await phoneA.waitForSelector('[data-act="tut-close"]', { timeout: 5000 }).catch(() => {});
  if (await phoneA.$('[data-act="tut-close"]')) await click(phoneA, '[data-act="tut-close"]');
  await phoneA.waitForSelector('[data-act="pick-ai"]', { timeout: 5000 });
  console.log('step: A on menu');

  // --- 3. host creates a room ---
  await click(phoneA, '[data-act="online"]');
  await phoneA.waitForSelector('#app[data-screen="online"]', { timeout: 3000 });
  console.log('step: A on online screen, creating');
  await click(phoneA, '[data-act="online-create"]');
  await phoneA.waitForSelector('#roomCode', { timeout: 8000 });
  console.log('step: A has roomCode');
  const roomCode = await phoneA.$eval('#roomCode', (el) => el.value);
  if (!/^[A-Z2-9]{4}$/.test(roomCode)) fail(`bad room code "${roomCode}"`);
  if ((await text(phoneA, '.code-hint')).length < 4) fail('missing share hint under the code');
  console.log('room created:', roomCode);

  // --- 4. guest joins with the code ---
  console.log('step: B goto');
  await phoneB.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await noAnim(phoneB);
  await phoneB.waitForSelector('[data-act="pick-ai"]', { timeout: 5000 });
  await click(phoneB, '[data-act="online"]');
  await phoneB.waitForSelector('#joinIn', { timeout: 3000 });
  await phoneB.evaluate((c) => { document.querySelector('#joinIn').value = c; }, roomCode);
  console.log('step: B joining');
  await click(phoneB, '[data-act="online-join"]');
  await phoneB.waitForSelector('#app[data-screen="game"]', { timeout: 8000 });
  console.log('guest joined, both on game screen');

  // host enters the game when the opponent arrives
  await phoneA.waitForSelector('#app[data-screen="game"]', { timeout: 8000 });

  // --- 5. host (goats) places a goat on node 7 (C2) ---
  console.log('step: A placing goat');
  await phoneA.waitForSelector('[data-node="7"]', { timeout: 5000 });
  await click(phoneA, '[data-node="7"]');
  await phoneB.waitForFunction(
    () => document.querySelector('.last-move')?.textContent?.includes('C2') === true,
    { timeout: 8000 },
  );
  console.log('goat placement relayed to guest');

  // --- 6. guest (tigers) steps A1→B1, host sees it ---
  // NOTE: A is the backgrounded page here; rAF-based waitForFunction polling
  // gets starved on it, so poll on a timer instead.
  await click(phoneB, '[data-node="0"]');
  await click(phoneB, '[data-node="1"]');
  {
    const t0 = Date.now();
    let ok = false;
    while (Date.now() - t0 < 8000) {
      const lm = await phoneA.evaluate(() => document.querySelector('.last-move')?.textContent ?? '');
      if (lm.includes('A1-B1')) { ok = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ok) throw new Error('host never saw tiger step; lm=' + await phoneA.evaluate(() => document.querySelector('.last-move')?.textContent ?? ''));
  }
  console.log('tiger step relayed to host');

  // --- 7. online pause: no local reset button ---
  console.log('step: A pause');
  await click(phoneA, '[data-act="pause"]');
  await phoneA.waitForSelector('.pause-card', { timeout: 3000 });
  if (await phoneA.$('.pause-card [data-act="new"]')) fail('online pause should not offer local reset');
  await click(phoneA, '[data-act="resume"]');

  // --- 8. host leaves: guest sees opponent-left overlay ---
  console.log('step: A leaving');
  await click(phoneA, '[data-act="pause"]');
  await phoneA.waitForSelector('.pause-card', { timeout: 3000 });
  await click(phoneA, '.pause-card [data-act="menu"]');
  await phoneA.waitForSelector('#app[data-screen="menu"]', { timeout: 3000 });
  await phoneB.waitForSelector('.overlay .card [data-act="menu"]', { timeout: 8000 });
  const overlayTxt = await text(phoneB, '.overlay .card');
  if (overlayTxt.length < 4) fail('opponent-left overlay has no text');
  console.log('guest saw the opponent-left overlay');

  await phoneA.screenshot({ path: '.smoke/online-a.png' });
  await phoneB.screenshot({ path: '.smoke/online-b.png' });
  passed = true;
} catch (err) {
  errors.push(String(err));
  for (const [name, pg] of [['A', phoneA], ['B', phoneB]]) {
    const diag = await pg
      .evaluate(() => ({
        screen: document.querySelector('#app')?.getAttribute('data-screen'),
        lm: document.querySelector('.last-move')?.textContent,
        frames: window.__wslog ?? null,
        body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 260),
      }))
      .catch((e) => String(e));
    errors.push(`diag ${name}: ${JSON.stringify(diag)}`);
  }
} finally {
  await browser.close().catch(() => {});
  killWrangler();
}

if (!passed) fail('see errors above');
console.log('ONLINE-SMOKE OK: create room (4-char code + share hint) → join by code → both enter game → goat placement and tiger step relay both ways → online pause has no reset → leaving shows opponent-left overlay');
