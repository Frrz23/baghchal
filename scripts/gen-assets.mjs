import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, '..');
mkdirSync(path.join(root, 'resources'), { recursive: true });

const cleanSvg = (file) =>
  readFileSync(path.join(root, 'src', 'assets', file), 'utf8')
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/<!--[\s\S]*?-->\s*/, '');
const tigerSvg = cleanSvg('tiger.svg');

const art = (size, shadow) =>
  `<div style="width:${size}px;height:${size}px;filter:drop-shadow(${shadow})">${tigerSvg}</div>`;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});

async function shot(file, w, h, body) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
      body {
        background: radial-gradient(circle at 50% 38%, #3a2a1a 0%, #241a12 55%, #1a130d 100%);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        font-family: 'Nirmala UI', sans-serif;
      }
      body svg { display: block; width: 100%; height: 100%; }
    </style></head><body>${body}</body></html>`,
    { waitUntil: 'networkidle0' },
  );
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.join(root, 'resources', file) });
  await page.close();
}

await shot('icon.png', 1024, 1024, art(560, '0 18px 30px rgba(0,0,0,.55)'));

await shot('icon-512.png', 512, 512, art(280, '0 9px 15px rgba(0,0,0,.55)'));

await shot(
  'feature-graphic.png',
  1024,
  500,
  `<div style="display:flex;align-items:center;gap:56px">
     ${art(230, '0 12px 24px rgba(0,0,0,.55)')}
     <div style="display:flex;flex-direction:column;align-items:flex-start;gap:18px">
       <div style="font-size:104px;font-weight:700;color:#f7b955;line-height:1;text-shadow:0 6px 18px rgba(0,0,0,.6)">बाघचाल</div>
       <div style="font-size:28px;color:#e8dcc8;text-shadow:0 3px 10px rgba(0,0,0,.6)">Tiger &amp; Goats — Nepali strategy board game</div>
     </div>
   </div>`,
);

await shot(
  'splash.png',
  2732,
  2732,
  `${art(700, '0 24px 40px rgba(0,0,0,.5)')}
   <div style="font-size:280px;font-weight:700;color:#f7b955;margin-top:90px;text-shadow:0 8px 24px rgba(0,0,0,.6)">बाघचाल</div>`,
);

await browser.close();
console.log('resources/icon.png, icon-512.png, feature-graphic.png + splash.png generated');
