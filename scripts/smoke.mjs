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

  // --- first-run tutorial (fresh profile every run) ---
  await page.waitForSelector('.tut-card', { timeout: 5000 });
  const tutSections = await page.$$eval('.tut-card .tut-section', (els) => els.length);
  if (tutSections !== 8) fail(`expected 8 tutorial sections, got ${tutSections}`);
  const tutBefore = await page.evaluate(() => localStorage.getItem('tutSeen'));
  if (tutBefore !== null) fail(`tutSeen should be unset before close, got ${tutBefore}`);
  await page.screenshot({ path: '.smoke/tutorial.png' });
  await page.click('[data-act="tut-close"]');
  if (await page.$('.tut-card')) fail('tut-close did not close the tutorial');
  const tutAfter = await page.evaluate(() => localStorage.getItem('tutSeen'));
  if (tutAfter !== '1') fail(`tutSeen not persisted after close, got ${tutAfter}`);

  // persistence: reload must NOT auto-open again
  await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 5000 });
  if (await page.$('.tut-card')) fail('tutorial auto-opened on reload despite tutSeen=1');

  // reopen from the menu button, then close again
  await page.click('[data-act="tut"]');
  await page.waitForSelector('.tut-card', { timeout: 3000 });
  await page.click('[data-act="tut-close"]');
  if (await page.$('.tut-card')) fail('tutorial did not close after reopen');

  // --- learn screen: guided taps through the WHOLE goat track, finish buttons, other side ---
  await page.click('[data-act="tut"]');
  await page.waitForSelector('.tut-card', { timeout: 3000 });
  await page.click('[data-act="tut-next"]');
  await page.waitForFunction(
    () => document.getElementById('app').dataset.screen === 'tut',
    { timeout: 3000 },
  );
  const phaseChoose = await page.evaluate(() => document.getElementById('app').dataset.phase);
  if (phaseChoose !== 'choose') fail(`expected choose phase, got "${phaseChoose}"`);
  if (!(await page.$('[data-act="tut-side"]'))) fail('choose view has no side buttons');
  await page.click('[data-act="tut-side"][data-side="goat"]');
  await page.waitForSelector('.tut-instr', { timeout: 3000 });
  if (!(await page.$('.hint-ring'))) fail('place step should show a hint ring');
  if (await page.$('.board .target')) fail('place step must be ring-only (no place-dots)');
  const step0 = await page.$eval('.tut-dots', (el) => el.dataset.step);
  if (step0 !== '0') fail(`expected step 0 after side pick, got ${step0}`);

  // wrong tap: step must not advance, ring shakes
  await page.click('[data-node="0"]');
  const still0 = await page.$eval('.tut-dots', (el) => el.dataset.step);
  if (still0 !== '0') fail(`wrong tap advanced to step ${still0}`);
  if (!(await page.$('.hint-ring.shake'))) fail('wrong tap did not shake the hint ring');
  await page.screenshot({ path: '.smoke/tut-learn.png' });

  // correct tap DURING the shake window must still advance
  await page.click('[data-node="12"]');
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '1',
    { timeout: 3000 },
  );
  // step 1 = watch: auto chain plays the tiger reply (1400ms), then advances to step 2
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '2',
    { timeout: 6000 },
  );
  if (!(await page.$('.hint-ring'))) fail('place2 step should show a hint ring');
  const piecesAfterWatch = await page.$$eval('.piece', (els) => els.length);
  if (piecesAfterWatch !== 5) fail(`expected 5 pieces after place+tiger reply, got ${piecesAfterWatch}`);

  // 2nd goat -> fast-forward step: board must stay small until the user taps
  await page.click('[data-node="13"]');
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '3',
    { timeout: 3000 },
  );
  if (!(await page.$('[data-act="tut-ff"]'))) fail('fast-forward step should show the fill button');
  const beforeFill = await page.$$eval('.piece', (els) => els.length);
  if (beforeFill !== 6) fail(`board must stay at 6 pieces before the tap, got ${beforeFill}`);
  await page.screenshot({ path: '.smoke/tut-fastforward.png' });
  await page.click('[data-act="tut-ff"]');
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '4',
    { timeout: 3000 },
  );
  const instrAll = await page.$eval('.tut-instr', (el) => el.textContent || '');
  if (!instrAll.includes('२०')) fail(`all-placed narration missing, got "${instrAll}"`);
  const allPlacedPieces = await page.$$eval('.piece', (els) => els.length);
  if (allPlacedPieces !== 24) fail(`expected 24 pieces after fast-forward, got ${allPlacedPieces}`);
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '5',
    { timeout: 5000 },
  );

  // select the ringed goat, guide arrow appears, step it into the centre hole
  await page.click('[data-node="11"]');
  if (!(await page.$('.tut-arrow'))) fail('selected goat should show the guide arrow');
  await page.click('[data-node="12"]');
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '6',
    { timeout: 3000 },
  );
  // win beat (all tigers blocked) auto-advances to the finish screen
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '7',
    { timeout: 5000 },
  );

  // finish screen: 3 buttons, gold = side-explicit other-side, block centered
  const finBtns = await page.$$eval('.tut-game .menu-buttons .btn', (els) =>
    els.map((b) => ({ act: b.getAttribute('data-act'), text: (b.textContent || '').trim() })),
  );
  if (finBtns.length !== 3) fail(`expected 3 finish buttons, got ${finBtns.length}`);
  if (finBtns[0].act !== 'tut-other' || !finBtns[0].text.includes('🐅'))
    fail(`gold should be side-explicit other-side, got ${JSON.stringify(finBtns[0])}`);
  if (finBtns[1].act !== 'tut-start') fail(`second button should be tut-start, got ${finBtns[1].act}`);
  const fin = await page.evaluate(() => {
    const b = document.querySelector('.tut-game .menu-buttons');
    const r = b.getBoundingClientRect();
    return { cx: r.left + r.width / 2, mid: window.innerWidth / 2 };
  });
  if (Math.abs(fin.cx - fin.mid) > 10)
    fail(`finish buttons not centered: block cx=${Math.round(fin.cx)}, viewport mid=${Math.round(fin.mid)}`);
  await page.screenshot({ path: '.smoke/tut-final.png' });

  // "learn other side" = tiger teaching (board + ring), NOT a game
  await page.click('[data-act="tut-other"]');
  await page.waitForFunction(
    () =>
      document.getElementById('app').dataset.screen === 'tut' &&
      document.querySelector('.tut-dots')?.dataset.step === '0',
    { timeout: 3000 },
  );
  if (!(await page.$('.hint-ring'))) fail('tiger track should start with a hint ring');
  const tInstr = await page.$eval('.tut-instr', (el) => el.textContent || '');
  if (!tInstr.includes('बाघ')) fail(`expected tiger instruction after other-side, got "${tInstr}"`);
  if (await page.$('[data-act="undo"]')) fail('other side landed on a game instead of teaching');

  // exit mid-flow: back to menu, no rules card reopened, tutSeen still set
  await page.click('.tut-game [data-act="menu"]');
  await page.waitForFunction(
    () => document.getElementById('app').dataset.screen === 'menu',
    { timeout: 3000 },
  );
  if (await page.$('.tut-card')) fail('rules card reopened after learn exit');
  const seenAfterLearn = await page.evaluate(() => localStorage.getItem('tutSeen'));
  if (seenAfterLearn !== '1') fail(`tutSeen lost after learn flow, got ${seenAfterLearn}`);
  await page.screenshot({ path: '.smoke/menu.png' });

  // re-enter, walk the tiger track to its finish, Start playing -> setup (not a game)
  await page.click('[data-act="tut"]');
  await page.waitForSelector('.tut-card', { timeout: 3000 });
  await page.click('[data-act="tut-next"]');
  await page.waitForFunction(
    () =>
      document.getElementById('app').dataset.screen === 'tut' &&
      document.getElementById('app').dataset.phase === 'choose',
    { timeout: 3000 },
  );
  await page.click('[data-act="tut-side"][data-side="tiger"]');
  await page.waitForSelector('.tut-instr', { timeout: 3000 });
  await page.click('[data-node="0"]'); // select tiger
  await page.click('[data-node="1"]'); // step 0 -> 1
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '1',
    { timeout: 3000 },
  );
  await page.click('[data-node="0"]'); // select on the jump position
  await page.click('[data-node="2"]'); // jump over the ringed goat
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '2',
    { timeout: 3000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.tut-dots')?.dataset.step === '3',
    { timeout: 5000 },
  );
  await page.click('[data-act="tut-start"]');
  await page.waitForFunction(
    () => document.getElementById('app').dataset.screen === 'side',
    { timeout: 3000 },
  );
  if (await page.$('[data-act="undo"]')) fail('tut-start started a live game instead of setup');
  if (!(await page.$('[data-act="side"]'))) fail('setup screen missing side buttons');
  await page.click('[data-act="menu"]');
  await page.waitForFunction(
    () => document.getElementById('app').dataset.screen === 'menu',
    { timeout: 3000 },
  );

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

  // --- last-move toggle: hides line + board dots, persists across renders ---
  const lmVisible = await page.$eval('.last-move', (el) => getComputedStyle(el).display !== 'none');
  if (!lmVisible) fail('last-move line should start visible (default ON)');
  const dotsOn = await page.$$eval('.last-dot', (els) => els.length);
  if (dotsOn < 1) fail(`expected >=1 board last-dot with toggle ON, got ${dotsOn}`);
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  await page.click('[data-act="lastmove"]');
  const offState = await page.evaluate(() => ({
    lm: getComputedStyle(document.querySelector('.last-move')).display,
    dots: document.querySelectorAll('.last-dot').length,
    active: document.querySelector('[data-act="lastmove"]').classList.contains('active'),
    stored: localStorage.getItem('lastMove'),
    hist: !!document.querySelector('.pause-history') || !!document.querySelector('.pause-empty'),
  }));
  if (offState.lm !== 'none') fail(`last-move line should be display:none when OFF, got ${offState.lm}`);
  if (offState.dots !== 0) fail(`board last-dots should be gone when OFF, got ${offState.dots}`);
  if (offState.active) fail('toggle chip should lose active when OFF');
  if (offState.stored !== '0') fail(`toggle OFF not persisted, got ${offState.stored}`);
  if (offState.hist) fail('pause-menu move list should be removed from DOM when OFF');
  await page.click('[data-act="lastmove"]');
  const onState = await page.evaluate(() => ({
    lm: getComputedStyle(document.querySelector('.last-move')).display,
    dots: document.querySelectorAll('.last-dot').length,
    active: document.querySelector('[data-act="lastmove"]').classList.contains('active'),
    stored: localStorage.getItem('lastMove'),
    chips: document.querySelectorAll('.pause-history .chip').length,
  }));
  if (onState.lm === 'none') fail('last-move line should re-show when toggle back ON');
  if (onState.dots < 1) fail('board last-dots should return when toggle back ON');
  if (!onState.active) fail('toggle chip should be active when ON');
  if (onState.stored !== '1') fail(`toggle ON not persisted, got ${onState.stored}`);
  if (onState.chips < 1) fail(`pause-menu move list should return when ON, got ${onState.chips} chips`);
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

  // --- stats: the finished local game was recorded and the screen renders ---
  await page.click('[data-act="pause"]');
  await page.waitForSelector('.pause-card [data-act="menu"]', { timeout: 3000 });
  await page.click('.pause-card [data-act="menu"]');
  await page.waitForSelector('[data-act="stats"]', { timeout: 3000 });
  await page.click('[data-act="stats"]');
  await page.waitForSelector('#app[data-screen="stats"]', { timeout: 3000 });
  const gamesVal = (await page.$eval('.stat-row b', (el) => el.textContent || '')).trim();
  if (!['1', '१'].includes(gamesVal)) fail(`stats should show >=1 recorded game, got "${gamesVal}"`);
  const unlockedAch = await page.$$eval('.ach:not(.locked)', (els) => els.length);
  if (unlockedAch < 3) fail(`expected >=3 unlocked achievements after a win, got ${unlockedAch}`);
  await page.screenshot({ path: '.smoke/stats.png' });

  if (errors.length) fail('page errors occurred');
  console.log('SMOKE OK: first-run tutorial (auto-open/close/persist/reopen), learn screen (choose/goat track/tap-to-fill fast-forward/wrong-tap shake/centered finish/other-side teaching/tiger track/start-playing setup/exit), menu, vs-AI, placement, AI reply, pause/resume/reset, selection, move, last-move, move list, undo, last-move toggle (line+dots+history), lang, difficulty, win overlay, stats recorded + achievements screen');
  await browser.close();
  process.exit(0);
} catch (e) {
  fail(e.message);
}
