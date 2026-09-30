import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.SMOKE_URL || 'http://localhost:5173/';

const errors = [];
const fail = (msg) => {
  console.error('SMOKE FAIL:', msg);
  if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 420, height: 850, deviceScaleFactor: 2 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

mkdirSync('.smoke', { recursive: true });

try {
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 5000 });
  await page.screenshot({ path: '.smoke/menu.png' });

  // --- vs AI flow ---
  await page.click('[data-act="pick-ai"]');
  await page.waitForSelector('[data-act="side"][data-side="goat"]', { timeout: 3000 });
  await page.click('[data-act="side"][data-side="goat"]');
  await page.waitForSelector('.board', { timeout: 3000 });

  const pieces0 = await page.$$eval('.piece', (els) => els.length);
  if (pieces0 !== 4) fail(`expected 4 tigers at start, got ${pieces0}`);

  // place a goat on the centre (node 12 = 250,250)
  await page.click('[data-node="12"]');
  await page.waitForFunction(() => document.querySelectorAll('.piece').length === 5, {
    timeout: 15000,
  });
  await page.waitForFunction(() => !document.querySelector('.turn')?.textContent.includes('…'), {
    timeout: 15000,
  });
  const turn1 = await page.$eval('.turn', (el) => el.textContent || '');
  if (!turn1.includes('बाख्राको चाल')) fail(`expected goat's turn after AI reply, got "${turn1}"`);
  await page.screenshot({ path: '.smoke/after-ai-move.png' });

  // --- pause overlay: resume, reset, back to menu ---
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  await page.screenshot({ path: '.smoke/pause.png' });
  await page.click('[data-act="resume"]');
  if (await page.$('.pause-card')) fail('resume did not close the pause overlay');
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  await page.click('.pause-card [data-act="new"]');
  if (await page.$('.overlay')) fail('reset did not clear the pause overlay');
  const fresh0 = await page.$$eval('.piece', (els) => els.length);
  if (fresh0 !== 4) fail(`reset should show 4 tigers, got ${fresh0}`);
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  await page.click('.pause-card [data-act="menu"]');
  await page.waitForSelector('[data-act="local"]', { timeout: 3000 });
  await page.click('[data-act="local"]');
  await page.waitForSelector('.board', { timeout: 3000 });

  await page.click('[data-node="12"]'); // goat placed
  await page.waitForFunction(() => document.querySelectorAll('.piece').length === 5, {
    timeout: 3000,
  });

  await page.click('[data-node="0"]'); // select corner tiger
  const selected = await page.$('.selected');
  if (!selected) fail('tiger selection ring did not appear');
  const targets = await page.$$eval('.target', (els) => els.length);
  if (targets !== 3) fail(`corner tiger should have 3 targets, got ${targets}`);

  await page.click('[data-node="1"]'); // step right along the top edge
  const moved = await page.$('.piece[transform="translate(150 50)"]');
  if (!moved) fail('tiger did not move to node 1');
  if (await page.$('.selected')) fail('selection should clear after moving');
  const turn2 = await page.$eval('.turn', (el) => el.textContent || '');
  if (!turn2.includes('बाख्राको चाल')) fail(`turn should pass to goat, got "${turn2}"`);
  await page.screenshot({ path: '.smoke/local-game.png' });

  // --- last-move line + move list in pause + undo ---
  const lm = await page.$eval('.last-move', (el) => (el.textContent || '').trim());
  if (!lm.includes('A1-B1')) fail(`last-move line should show A1-B1, got "${lm}"`);
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  const chips = await page.$$eval('.pause-history .chip', (els) => els.length);
  if (chips !== 2) fail(`expected 2 history chips, got ${chips}`);
  await page.click('[data-act="resume"]');
  await page.click('[data-act="undo"]');
  const backAt0 = await page.$('.piece[transform="translate(50 50)"]');
  if (!backAt0) fail('undo did not return tiger to corner');
  const turn3 = await page.$eval('.turn', (el) => el.textContent || '');
  if (!turn3.includes('बाघको चाल')) fail(`after undo it should be tiger's turn, got "${turn3}"`);
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  const chipsAfter = await page.$$eval('.pause-history .chip', (els) => els.length);
  if (chipsAfter !== 1) fail(`undo should leave 1 chip, got ${chipsAfter}`);
  await page.click('[data-act="resume"]');

  // --- language toggle works inside a game ---
  await page.click('[data-act="lang"]');
  const turnEn = await page.$eval('.turn', (el) => el.textContent || '');
  if (!turnEn.includes("Tiger's move")) fail(`in-game English toggle failed, got "${turnEn}"`);
  await page.click('[data-act="lang"]');
  const turnBack = await page.$eval('.turn', (el) => el.textContent || '');
  if (!turnBack.includes('बाघको चाल')) fail(`toggle back to Nepali failed, got "${turnBack}"`);

  // --- pause menu → main menu, then language toggle + difficulty chips ---
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  await page.click('.pause-card [data-act="menu"]');
  await page.waitForSelector('.title', { timeout: 3000 });
  await page.click('[data-act="lang"]');
  const title = await page.$eval('.title', (el) => (el.textContent || '').trim());
  if (title !== 'Baghchal') fail(`English toggle failed, title="${title}"`);
  await page.click('[data-act="lang"]');

  await page.click('[data-act="pick-ai"]');
  await page.waitForSelector('[data-act="diff"][data-diff="hard"]', { timeout: 3000 });
  await page.click('[data-act="diff"][data-diff="hard"]');
  const hardActive = await page.$eval('[data-diff="hard"]', (el) => el.classList.contains('active'));
  if (!hardActive) fail('difficulty chip did not activate');
  await page.click('[data-act="diff"][data-diff="medium"]');
  await page.screenshot({ path: '.smoke/side-screen.png' });

  // --- full game to a tiger win (local mode, scripted 5 captures) ---
  await page.click('[data-act="menu"]');
  await page.waitForSelector('[data-act="local"]', { timeout: 3000 });
  await page.click('[data-act="local"]');
  await page.waitForSelector('.board', { timeout: 3000 });

  const placeGoat = (n) => page.click(`[data-node="${n}"]`);
  const tigerJump = async (from, to) => {
    await page.click(`[data-node="${from}"]`);
    await page.click(`[data-node="${to}"]`);
  };
  const snap = async (label) => {
    const turn = await page.$eval('.turn', (e) => e.textContent).catch(() => 'NO TURN');
    const counts = await page.$$eval('.counts span', (els) => els.map((e) => e.textContent).join(' | '));
    const pieces = await page.$$eval('.piece', (els) => els.length);
    console.log(`  ${label}: turn=${turn} counts=${counts} pieces=${pieces}`);
  };
  await placeGoat(1);
  await tigerJump(0, 2);
  await snap('T0x2');
  await placeGoat(7);
  await tigerJump(2, 12);
  await snap('T2x12');
  await placeGoat(13);
  await tigerJump(12, 14);
  await snap('T12x14');
  await placeGoat(13);
  await tigerJump(14, 12);
  await snap('T14x12');
  await placeGoat(11);
  await tigerJump(12, 10);
  await snap('T12x10');

  await page.waitForSelector('.overlay', { timeout: 3000 });
  const result = (await page.$eval('.card h2', (el) => el.textContent || '')).trim();
  if (!result.includes('जित्यो')) fail(`unexpected result text: "${result}"`);
  const reason = (await page.$eval('.card .reason', (el) => el.textContent || '')).trim();
  if (!reason.includes('५ वटा')) fail(`unexpected reason text: "${reason}"`);
  const captured = await page.$$eval('.counts span', (els) => els[1]?.textContent || '');
  if (!captured.includes('५')) fail(`captured count should show ५, got "${captured}"`);
  await page.screenshot({ path: '.smoke/game-over.png' });

  await page.click('[data-act="new"]');
  if (await page.$('.overlay')) fail('new game did not clear the overlay');
  const fresh = await page.$$eval('.piece', (els) => els.length);
  if (fresh !== 4) fail(`new game should show 4 tigers, got ${fresh}`);

  if (errors.length) fail('page errors occurred');
  console.log('SMOKE OK: menu, vs-AI, placement, AI reply, pause/resume/reset, selection, move, last-move, move list, undo, lang, difficulty, win overlay');
  await browser.close();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
