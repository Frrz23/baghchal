import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SMOKE_URL || 'http://localhost:5173/';

const errors = [];
const fail = (msg) => {
  console.error('CUSTOM-SMOKE FAIL:', msg);
  if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
const VW = Number(process.env.VW ?? 420);
const VH = Number(process.env.VH ?? 850);
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 2 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

mkdirSync('.smoke', { recursive: true });

const code = async () => page.$eval('#codeIn', (el) => el.value);
const clickN = async (sel, n) => {
  for (let i = 0; i < n; i++) await page.click(sel);
};
const text = async (sel) => page.$eval(sel, (el) => el.textContent.trim());

try {
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('.tut-card', { timeout: 5000 });
  await page.click('[data-act="tut-close"]');
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 5000 });

  // --- menu: four entries ---
  const acts = await page.$$eval('.menu-buttons .btn', (els) => els.map((e) => e.dataset.act));
  if (JSON.stringify(acts) !== JSON.stringify(['pick-ai', 'local', 'custom', 'tut'])) {
    fail(`menu acts should be [pick-ai, local, custom, tut], got ${JSON.stringify(acts)}`);
  }

  // --- custom screen structure ---
  await page.click('[data-act="custom"]');
  await page.waitForSelector('#app[data-screen="custom"]', { timeout: 3000 });
  const cards = await page.$$eval('.preset-card', (els) => els.map((e) => e.dataset.preset));
  if (cards.join(',') !== 'classic,speed,fortress,titan,sudden') {
    fail(`preset cards wrong: ${cards.join(',')}`);
  }
  if ((await code()) !== 'BCf0400') fail(`default code should be BCf0400, got ${await code()}`);
  await page.screenshot({ path: '.smoke/custom-screen.png' });

  // --- preset applies ---
  console.log('step: presets');
  await page.click('[data-preset="speed"]');
  await page.waitForFunction(() => document.querySelector('#codeIn').value === 'BCf0300');
  if (!(await page.$('.preset-card.active[data-preset="speed"]'))) fail('speed preset not active');

  // --- steppers with capture<=herd invariant ---
  console.log('step: steppers');
  await clickN('[data-field="goats"][data-dir="-1"]', 1); // 19 goats
  if ((await code())[2] !== 'e') fail(`goats- should encode 19 -> BCe..., got ${await code()}`);
  await clickN('[data-field="captures"][data-dir="1"]', 15); // capped at min(10, herd)
  await clickN('[data-field="goats"][data-dir="-1"]', 30); // bounded at herd-min 5, captures follow
  if ((await code()) !== 'BC00400') {
    fail(`herd-5/captures-5 invariant should encode BC00400, got ${await code()}`);
  }
  await page.click('[data-preset="speed"]'); // reset for next section

  // --- tigers 4/5 + movement + sudden-death ---
  await clickN('[data-field="tigers"][data-dir="1"]', 1);
  if ((await code())[3] !== '1') fail(`5 tigers should encode ...1..., got ${await code()}`);
  await page.click('[data-preset="classic"]');
  await page.click('[data-act="movement"][data-mode="orthogonal-only"]');
  if ((await code())[5] !== '1') fail(`ortho should encode M=1, got ${await code()}`);
  if (!(await page.$('[data-act="movement"][data-mode="orthogonal-only"].active'))) {
    fail('ortho chip not active');
  }
  await page.click('[data-act="sudden"]');
  if ((await code())[6] !== '1') fail(`sudden-death should encode S=1, got ${await code()}`);

  // --- code load: valid + invalid ---
  console.log('step: code load');
  await page.click('#codeIn');
  await page.$eval('#codeIn', (e) => e.select());
  await page.type('#codeIn', 'BCf0400');
  await page.click('[data-act="code-load"]');
  await page.waitForFunction(() => document.querySelector('#codeIn').value === 'BCf0400');
  if (!(await page.$('.preset-card.active[data-preset="classic"]'))) {
    fail('loading classic code did not activate the classic preset');
  }
  if (await page.$('.code-err')) fail('error shown for a valid code');
  await page.click('#codeIn');
  await page.$eval('#codeIn', (e) => e.select());
  await page.type('#codeIn', 'garbage');
  await page.click('[data-act="code-load"]');
  if (!(await page.$('.code-err'))) fail('invalid code did not show the error');
  await page.click('[data-preset="titan"]');
  if (await page.$('.code-err')) fail('error not cleared after picking a preset');

  // --- start a custom two-player game: titan (5th tiger) ---
  await page.click('[data-act="custom-local"]');
  await page.waitForSelector('#app[data-screen="game"]', { timeout: 3000 });
  const pieces = await page.$$eval('.piece', (els) => els.length);
  if (pieces !== 5) fail(`titan game should start with 5 tigers, got ${pieces}`);
  const variant = await text('.variant-chip');
  if (variant !== 'टाइटन युद्ध') fail(`variant chip should be टाइटन युद्ध, got "${variant}"`);

  // play one placement, counts move 20 -> 19
  await page.click('[data-act="node"][data-node="1"]'); // empty: corners/centre hold the tigers
  const hand0 = await text('.counts span:first-child');
  if (!hand0.includes('१९')) fail(`titan placement should leave १९ in hand, got "${hand0}"`);

  // --- speed preset: herd of 20 reflected in the topbar ---
  await page.click('[data-act="pause"]');
  await page.waitForSelector('[data-act="resume"]', { timeout: 3000 });
  await page.click('[data-act="menu"]');
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 3000 });
  await page.click('[data-act="custom"]');
  await page.click('[data-preset="speed"]');
  await page.click('[data-act="custom-local"]');
  await page.waitForSelector('#app[data-screen="game"]', { timeout: 3000 });
  const hand = await text('.counts span:first-child');
  if (!hand.includes('२०')) fail(`speed preset should show २० in hand, got "${hand}"`);
  if ((await text('.variant-chip')) !== 'छिटो') fail('variant chip should be छिटो');
  await page.click('[data-act="node"][data-node="12"]');
  const hand2 = await text('.counts span:first-child');
  if (!hand2.includes('१९')) fail(`after placing, in-hand should be १९, got "${hand2}"`);
  await page.click('[data-act="undo"]');
  const hand3 = await text('.counts span:first-child');
  if (!hand3.includes('२०')) fail(`undo should restore २०, got "${hand3}"`);

  // --- fortress: ortho board draws no diagonal lines ---
  await page.click('[data-act="pause"]');
  await page.click('[data-act="menu"]');
  await page.click('[data-act="custom"]');
  await page.click('[data-preset="fortress"]');
  await page.click('[data-act="custom-local"]');
  await page.waitForSelector('#app[data-screen="game"]', { timeout: 3000 });
  const lines = await page.$$eval('.board-line', (els) =>
    els.map((l) => ({
      dx: Math.abs(Number(l.getAttribute('x1')) - Number(l.getAttribute('x2'))),
      dy: Math.abs(Number(l.getAttribute('y1')) - Number(l.getAttribute('y2'))),
    })),
  );
  const diagonals = lines.filter((l) => l.dx > 0 && l.dy > 0);
  if (diagonals.length !== 0) fail(`fortress board still draws ${diagonals.length} diagonal lines`);

  // --- classic game after custom: no variant chip, 20 goats, 4 tigers (v1 parity) ---
  await page.click('[data-act="pause"]');
  await page.click('[data-act="menu"]');
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 3000 });
  await page.click('[data-act="local"]');
  await page.waitForSelector('#app[data-screen="game"]', { timeout: 3000 });
  if (await page.$('.variant-chip')) fail('classic game should show no variant chip');
  const classicHand = await text('.counts span:first-child');
  if (!classicHand.includes('२०')) fail(`classic should show 20 in hand, got "${classicHand}"`);
  const classicPieces = await page.$$eval('.piece', (els) => els.length);
  if (classicPieces !== 4) fail(`classic should start with 4 tigers, got ${classicPieces}`);

  console.log('CUSTOM-SMOKE OK: menu entry, presets, steppers + herd/capture clamp,');
  console.log('  tigers 4/5, movement modes, sudden-death toggle, code load/valid/invalid,');
  console.log('  titan 5-tiger game + variant chip, speed herd + undo, fortress line filter,');
  console.log('  classic v1 parity after custom games');
  await browser.close();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
