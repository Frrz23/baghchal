export function makeReport() {
  const errors = [];
  const warnings = [];
  const err = (size, screen, msg) => errors.push(`[${size}] ${screen}: ${msg}`);
  const warn = (size, screen, msg) => warnings.push(`[${size}] ${screen}: ${msg}`);
  return { errors, warnings, err, warn };
}

export async function tap(page, selector) {
  const el = await page.$(selector);
  if (!el) throw new Error(`tap target not found: ${selector}`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

export async function assertCommon(page, size, screen, report) {
  const { err, warn } = report;
  const m = await page.evaluate(() => {
    const scrollW = document.documentElement.scrollWidth;
    const innerW = window.innerWidth;
    const smallBtns = [...document.querySelectorAll('.btn')].map((b) => b.getBoundingClientRect().height);
    const smallChips = [...document.querySelectorAll('.chip-btn')].map((b) => b.getBoundingClientRect().height);
    // vertical centering of the menu/side content (only when it fits; overflow
    // legitimately pins to top via justify-content: safe center)
    let menuCenter = null;
    let menuIh = 0;
    const menu = document.querySelector('.menu');
    if (menu && menu.children.length) {
      const box = menu.getBoundingClientRect();
      const first = menu.children[0].getBoundingClientRect();
      const last = menu.children[menu.children.length - 1].getBoundingClientRect();
      const fits = first.top >= box.top - 1 && last.bottom <= box.bottom + 1;
      if (fits) {
        menuCenter = (box.top + box.bottom) / 2;
        menuIh = window.innerHeight;
      }
    }
    return { scrollW, innerW, smallBtns, smallChips, menuCenter, menuIh };
  });
  if (m.scrollW > m.innerW + 1) {
    err(size.name, screen, `horizontal overflow: scrollWidth ${m.scrollW} > innerWidth ${m.innerW}`);
  }
  m.smallBtns.forEach((h, i) => {
    if (h > 0 && h < 40) err(size.name, screen, `button #${i} too short: ${h.toFixed(0)}px`);
  });
  m.smallChips.forEach((h, i) => {
    if (h > 0 && h < 30) warn(size.name, screen, `chip #${i} short: ${h.toFixed(0)}px`);
  });
  if (m.menuCenter !== null) {
    const delta = Math.abs(m.menuCenter - m.menuIh / 2);
    if (delta > 10) {
      err(size.name, screen, `menu not vertically centered: off by ${delta.toFixed(0)}px (tol 10)`);
    }
  }
}

export async function assertGame(page, size, report) {
  const { err } = report;
  const m = await page.evaluate(() => {
    const rect = (s) => document.querySelector(s)?.getBoundingClientRect();
    const top = rect('.topbar');
    const act = rect('.game-actions');
    const board = rect('.board');
    const turn = rect('.turn');
    const hint = rect('.hint');
    const hist = rect('.last-move');
    return {
      top,
      act,
      board,
      turn,
      hint,
      hist,
      ih: window.innerHeight,
      groupTop: top?.top,
      groupBottom: act?.bottom,
    };
  });
  const { top, act, board, turn, hint, hist, ih, groupTop, groupBottom } = m;
  if (!top || !act || !board || !turn || !hint || !hist) {
    err(size.name, 'game', 'missing layout elements');
    return;
  }

  if (groupBottom - groupTop <= ih) {
    const delta = Math.abs((groupTop + groupBottom) / 2 - ih / 2);
    const tol = Math.max(36, ih * 0.06);
    if (delta > tol) {
      err(size.name, 'game', `not vertically centered: center off by ${delta.toFixed(0)}px (tol ${tol.toFixed(0)})`);
    }
  }

  if (turn.bottom > board.top + 1) err(size.name, 'game', 'turn pill overlaps board');
  if (board.bottom > hint.top + 1) err(size.name, 'game', 'board overlaps hint');
  if (hist.bottom > act.top + 1) err(size.name, 'game', 'last-move line overlaps action buttons');

  const maxW = Math.min(size.w, 640, size.h - 260);
  if (board.width > maxW + 2) err(size.name, 'game', `board too wide: ${board.width.toFixed(0)} > ${maxW}`);
  if (board.width < 300) err(size.name, 'game', `board too small: ${board.width.toFixed(0)}px`);
}
