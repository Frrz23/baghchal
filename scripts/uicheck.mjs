import puppeteer from 'puppeteer-core';
import { adb, findDevice, sleep, waitFor, waitForDevice } from './lib/adb.mjs';

const PKG = 'np.baghchal.game';
const ACTIVITY = `${PKG}/.MainActivity`;
const PORT = 9333;
let fails = 0;
const check = (name, cond, info) => {
  console.log(`  ${cond ? 'OK ' : 'FAIL'} ${name}${info !== undefined ? ` -- ${info}` : ''}`);
  if (!cond) fails++;
};
// "max(0px, 96px)" / "32px" -> numeric px (max of arms, so sum-vs-max logic stays honest)
const px = (s) => Math.max(0, ...[...String(s).matchAll(/([\d.]+)px/g)].map((m) => Number(m[1])));

const argSerial = process.argv.find((a) => /^emulator-\d+$|^[A-Za-z0-9]+$/.test(a) && !a.includes('='));
const serial = argSerial || findDevice() || (await waitForDevice(60000));
if (!serial) {
  console.error('no device/emulator');
  process.exit(1);
}
console.log(`UICHECK on ${serial}`);

adb(serial, ['shell', 'am', 'force-stop', PKG]);
await sleep(600);
adb(serial, ['shell', 'am', 'start', '-n', ACTIVITY]);
const pid = await waitFor(() => adb(serial, ['shell', 'pidof', PKG], { allowFail: true }).split(/\s+/)[0], 12000);
if (!pid) {
  console.error('app did not start');
  process.exit(1);
}
const sock = await waitFor(() => {
  const unix = adb(serial, ['shell', 'cat', '/proc/net/unix'], { allowFail: true });
  return unix.includes(`webview_devtools_remote_${pid}`) ? `webview_devtools_remote_${pid}` : null;
}, 12000);
if (!sock) {
  console.error('WebView debug socket not found (debug build required, screen must be on)');
  process.exit(1);
}
adb(serial, ['forward', `tcp:${PORT}`, `localabstract:${sock}`]);
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` });
const pages = await browser.pages();
const page = pages.find((p) => /localhost|capacitor/.test(p.url())) || pages[0];

const measure = () =>
  page.evaluate(() => {
    const app = document.querySelector('#app');
    const gc = document.querySelector('.game-controls');
    const ga = document.querySelector('.game-actions');
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;width:calc(100dvh - 260px - var(--safe-top) - var(--safe-bottom))';
    document.body.appendChild(probe);
    const probeW = probe.getBoundingClientRect().width;
    probe.remove();
    const rootStyle = document.documentElement.style;
    return {
      padTop: getComputedStyle(app).paddingTop,
      padBottom: getComputedStyle(app).paddingBottom,
      controlsTop: gc ? gc.getBoundingClientRect().top : null,
      actionsBottom: ga ? ga.getBoundingClientRect().bottom : null,
      probeW,
      safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
      safeBottom: getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom').trim(),
      inlineTop: rootStyle.getPropertyValue('--safe-area-inset-top'),
      inlineBottom: rootStyle.getPropertyValue('--safe-area-inset-bottom'),
      innerH: window.innerHeight,
    };
  });

try {
  await page.waitForSelector('[data-act="pick-ai"]', { timeout: 10000 });
  await sleep(700); // Capacitor SystemBars injects inline vars after bridge ready

  const us = await page.evaluate(() => getComputedStyle(document.documentElement).userSelect);
  check('global user-select: none', us === 'none', us);

  const menuM = await page.evaluate(() => {
    const menu = document.querySelector('.menu');
    if (!menu || !menu.children.length) return null;
    const box = menu.getBoundingClientRect();
    const first = menu.children[0].getBoundingClientRect();
    const last = menu.children[menu.children.length - 1].getBoundingClientRect();
    if (first.top < box.top - 1 || last.bottom > box.bottom + 1) return null; // overflow: pinned, skip
    return { center: (box.top + box.bottom) / 2, ih: window.innerHeight };
  });
  if (menuM === null) {
    console.log('  -- menu centering skipped (no menu / overflow)');
  } else {
    const d = Math.abs(menuM.center - menuM.ih / 2);
    check('menu content vertically centered', d <= 10, `off by ${d.toFixed(1)}px`);
  }

  await page.click('[data-act="local"]');
  await page.waitForSelector('.board', { timeout: 5000 });

  const base = await measure();
  const bTop = px(base.safeTop);
  const bBot = px(base.safeBottom);
  console.log(`  baseline: ${JSON.stringify(base)} -> safeTop=${bTop}px safeBottom=${bBot}px`);
  check('pad-top integrates inset arms (16+safe)', base.padTop === `${16 + bTop}px`, `${base.padTop} vs 16+${bTop}`);
  check('pad-bottom integrates inset arms', base.padBottom === `${16 + bBot}px`, `${base.padBottom} vs 16+${bBot}`);
  check('game-controls flows below inset', base.controlsTop === 16 + bTop, base.controlsTop);
  check('game-actions clears bottom inset', base.actionsBottom <= base.innerH - bBot + 1, `${base.actionsBottom} <= ${base.innerH - bBot}`);

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '96px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '48px');
  });
  await sleep(250);
  const forced = await measure();
  const fTop = px(forced.safeTop);
  const fBot = px(forced.safeBottom);
  console.log(`  forced 96/48: ${JSON.stringify(forced)} -> safeTop=${fTop}px safeBottom=${fBot}px`);
  check('--safe-top = max(env, 96)', fTop === Math.max(bTop, 96), `${fTop}`);
  check('--safe-bottom = max(env, 48)', fBot === Math.max(bBot, 48), `${fBot}`);
  check('pad-top 16+forced', forced.padTop === `${16 + fTop}px`, forced.padTop);
  check('pad-bottom 16+forced', forced.padBottom === `${16 + fBot}px`, forced.padBottom);
  check('game-controls below forced top', forced.controlsTop === 16 + fTop, forced.controlsTop);
  check('game-actions above forced bottom', forced.actionsBottom <= forced.innerH - fBot + 1, `${forced.actionsBottom} <= ${forced.innerH - fBot}`);
  const shrink = base.probeW - forced.probeW;
  check('board calc shrinks by insets', Math.abs(shrink - (fTop + fBot - bTop - bBot)) < 1, `${base.probeW} -> ${forced.probeW}`);

  await page.click('.game-actions [data-act="pause"]');
  await page.waitForSelector('.pause-card', { timeout: 3000 });
  const ov = await page.evaluate(() => {
    const o = document.querySelector('.overlay');
    const c = document.querySelector('.pause-card');
    return {
      padTop: getComputedStyle(o).paddingTop,
      cardTop: c.getBoundingClientRect().top,
      cardBottom: c.getBoundingClientRect().bottom,
      innerH: window.innerHeight,
    };
  });
  check('overlay pad-top 24+forced', ov.padTop === `${24 + fTop}px`, ov.padTop);
  check('pause card clears top inset', ov.cardTop >= fTop, `${ov.cardTop} >= ${fTop}`);
  check('pause card clears bottom inset', ov.cardBottom <= ov.innerH - fBot + 1, `${ov.cardBottom} <= ${ov.innerH - fBot}`);
  await page.click('[data-act="resume"]');
  await page.waitForSelector('.board', { timeout: 3000 });

  await page.click('[data-node="12"]'); // goat places (local mode)
  await sleep(400);
  await page.click('[data-node="0"]'); // select corner tiger
  const ring = await page.evaluate(() => {
    const s = document.querySelector('.selected');
    return s ? getComputedStyle(s).stroke : null;
  });
  check('selection ring present', !!ring);
  check('ring gold #f7b955', ring === 'rgb(247, 185, 85)', ring);

  // restore whatever was injected before (remove only if it was absent)
  await page.evaluate(
    (t, b) => {
      const root = document.documentElement.style;
      if (t) root.setProperty('--safe-area-inset-top', t);
      else root.removeProperty('--safe-area-inset-top');
      if (b) root.setProperty('--safe-area-inset-bottom', b);
      else root.removeProperty('--safe-area-inset-bottom');
    },
    base.inlineTop,
    base.inlineBottom,
  );
} catch (e) {
  console.error('FATAL', e.message);
  fails++;
} finally {
  try {
    browser.disconnect();
  } catch {}
  adb(serial, ['forward', '--remove', `tcp:${PORT}`], { allowFail: true });
}

console.log(fails ? `\nUICHECK FAIL: ${fails} check(s)` : '\nUICHECK OK: safe-area + ring + selection');
process.exit(fails ? 1 : 0);
