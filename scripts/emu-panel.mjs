import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { adb, adbAsync, findDevice, listDeviceStates } from './lib/adb.mjs';
import { CUSTOM_DEVICES, listDevices, resolveDevice } from './devices.mjs';

export const PANEL_MARKER = 'baghchal';

const { custom, builtins } = listDevices();
const devices = [...custom, ...builtins].map((name) => {
  const v = resolveDevice(name).viewport;
  return { name, w: v.width, h: v.height, dpr: v.deviceScaleFactor, custom: custom.includes(name) };
});

async function computeState() {
  const rows = await listDeviceStates(3000);
  const online = rows.find((r) => r.state === 'device');
  if (!online) {
    if (!rows.length) {
      return { panel: PANEL_MARKER, online: false, reason: 'no emulator attached - run: npm run lab' };
    }
    const r = rows[0];
    if (r.state === 'offline') {
      return {
        panel: PANEL_MARKER,
        online: false,
        serial: r.serial,
        reason: `${r.serial} is starting (adb: offline) - usually 30-60s, waiting...`,
      };
    }
    if (r.state === 'unauthorized') {
      return {
        panel: PANEL_MARKER,
        online: false,
        serial: r.serial,
        reason: `${r.serial} unauthorized - accept the adb prompt on the emulator`,
      };
    }
    return { panel: PANEL_MARKER, online: false, serial: r.serial, reason: `${r.serial} state: ${r.state}` };
  }
  const serial = online.serial;
  let out;
  try {
    out = await adbAsync(serial, ['shell', 'wm size; wm density; settings get system user_rotation'], 3000);
  } catch (e) {
    return {
      panel: PANEL_MARKER,
      online: false,
      serial,
      reason: `device online but shell not responding: ${e.message.slice(0, 160)}`,
    };
  }
  const sizes = [...out.matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const dens = [...out.matchAll(/(?:Physical|Override) density:\s*(\d+)/g)];
  if (!sizes.length || !dens.length) {
    return {
      panel: PANEL_MARKER,
      online: false,
      serial,
      reason: `device online but unexpected wm output: ${out.slice(0, 120)}`,
    };
  }
  const sw = Number(sizes.at(-1)[1]);
  const sh = Number(sizes.at(-1)[2]);
  const den = Number(dens.at(-1)[1]);
  const lines = out.trim().split('\n');
  const rot = Number(lines.at(-1)) || 0;
  const dpr = den / 160;
  const swap = rot % 2 === 1;
  return {
    panel: PANEL_MARKER,
    online: true,
    serial,
    size: { w: sw, h: sh, override: sizes.length > 1 },
    density: { dpr, override: dens.length > 1 },
    rotation: rot,
    css: { w: Math.round((swap ? sh : sw) / dpr), h: Math.round((swap ? sw : sh) / dpr) },
  };
}

// coalesce concurrent polls into one adb round; never serve stale cache
let statePromise = null;
function refreshState() {
  if (statePromise) return statePromise;
  statePromise = (async () => {
    let st;
    try {
      st = await computeState();
    } catch (e) {
      st = { panel: PANEL_MARKER, online: false, reason: e.message.slice(0, 200) };
    }
    st.checkedAt = Date.now();
    return st;
  })().finally(() => {
    statePromise = null;
  });
  return statePromise;
}

function requireDevice() {
  const serial = findDevice();
  if (!serial) throw new Error('emulator not running - run: npm run lab');
  return serial;
}

function applyDevice(name) {
  const known = devices.find((d) => d.name === name);
  if (!known) throw new Error(`unknown device "${name}"`);
  const serial = requireDevice();
  const pw = Math.round(known.w * known.dpr);
  const ph = Math.round(known.h * known.dpr);
  const den = Math.round(known.dpr * 160);
  adb(serial, ['shell', `wm size ${pw}x${ph}`]);
  adb(serial, ['shell', `wm density ${den}`]);
}

function rotate(rot) {
  if (rot !== 0 && rot !== 1) throw new Error(`bad rotation ${rot}`);
  const serial = requireDevice();
  adb(serial, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
  adb(serial, ['shell', 'settings', 'put', 'system', 'user_rotation', String(rot)]);
}

function resetSize() {
  const serial = requireDevice();
  adb(serial, ['shell', 'wm', 'size', 'reset']);
  adb(serial, ['shell', 'wm', 'density', 'reset']);
}

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>बाघचाल · Emulator Device Panel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.45 "Segoe UI", system-ui, sans-serif; background: #1b1b1f; color: #e6e6e9; }
  header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #232329; border-bottom: 1px solid #34343c; }
  h1 { font-size: 14px; margin: 0; font-weight: 600; letter-spacing: .3px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #d04545; box-shadow: 0 0 6px #d0454588; }
  .dot.on { background: #45c76e; box-shadow: 0 0 6px #45c76e88; }
  #conn { color: #9a9aa5; font-size: 12px; }
  .banner { display: none; margin: 10px 16px 0; padding: 9px 12px; background: #4a1f22; border: 1px solid #a53c44; color: #ffb4ba; border-radius: 6px; white-space: pre-wrap; word-break: break-word; font-family: Consolas, monospace; font-size: 12px; }
  .banner.show { display: block; }
  .controls { display: flex; gap: 10px; align-items: center; padding: 12px 16px 8px; flex-wrap: wrap; }
  #q { flex: 1 1 260px; background: #121215; color: #e6e6e9; border: 1px solid #3c3c46; border-radius: 6px; padding: 8px 10px; font-size: 13px; outline: none; }
  #q:focus { border-color: #5b7cff; }
  .seg { display: flex; border: 1px solid #3c3c46; border-radius: 6px; overflow: hidden; }
  .seg button { background: #121215; color: #b9b9c4; border: 0; padding: 7px 14px; font-size: 12px; cursor: pointer; }
  .seg button.on { background: #3752c4; color: #fff; }
  button.act { background: #232329; color: #d7d7de; border: 1px solid #3c3c46; border-radius: 6px; padding: 7px 14px; font-size: 12px; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  .state { margin: 0 16px; padding: 8px 12px; background: #16161a; border: 1px solid #34343c; border-radius: 6px; font-family: Consolas, monospace; font-size: 12px; color: #8fd3ff; }
  .state.warn { border-color: #8a6d1f; background: #221d10; color: #ffd68a; }
  .state .muted { color: #7a7a86; }
  .state .badge { display: inline-block; background: #3752c4; color: #fff; border-radius: 4px; padding: 0 6px; margin-left: 6px; font-size: 11px; }
  #list { list-style: none; margin: 10px 16px 16px; padding: 0; max-height: calc(100vh - 300px); overflow: auto; border: 1px solid #34343c; border-radius: 6px; }
  #list li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #26262d; cursor: pointer; }
  #list li:last-child { border-bottom: 0; }
  #list li:hover { background: #26262e; }
  #list li.active { background: #1f3a2b; outline: 1px solid #45c76e; outline-offset: -1px; }
  #list .meta { color: #8b8b96; font-family: Consolas, monospace; font-size: 12px; white-space: nowrap; }
  #list .custom { color: #ffc66d; }
  .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: #2b2b33; border: 1px solid #4a4a56; color: #e6e6e9; padding: 8px 16px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.bad { background: #4a1f22; border-color: #a53c44; color: #ffb4ba; }
  .hint { color: #7a7a86; font-size: 12px; padding: 0 16px 8px; }
</style>
</head>
<body>
<header>
  <h1>बाघचाल · Emulator Device Panel</h1>
  <span id="dot" class="dot"></span>
  <span id="conn">checking…</span>
</header>
<div id="banner" class="banner"></div>
<div class="controls">
  <input id="q" type="search" placeholder="Search devices…" autofocus>
  <div class="seg">
    <button id="b0">Portrait</button>
    <button id="b1">Landscape</button>
  </div>
  <button id="reset" class="act">Reset native</button>
</div>
<div id="state" class="state">reading…</div>
<div class="hint">Click a device to resize the emulator live. Size &amp; density changes apply instantly; the app re-lays out without restarting.</div>
<ul id="list"></ul>
<div id="toast" class="toast"></div>
<script>
  var devices = [];
  var state = null;
  var netErr = null;      // null | 'down' | 'timeout'
  var persistent = null;  // {msg, kind:'mut'|'net'}

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function stamp(st) {
    return st && st.checkedAt ? ' <span class="muted">(checked ' + new Date(st.checkedAt).toLocaleTimeString() + ')</span>' : '';
  }

  function j(url, body) {
    var opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {};
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || d.error) throw new Error(d.error || 'HTTP ' + r.status);
        return d;
      });
    });
  }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast' + (bad ? ' bad' : ''); }, 2500);
  }

  function renderBanner() {
    var b = document.getElementById('banner');
    if (persistent) { b.textContent = persistent.msg; b.className = 'banner show'; }
    else { b.className = 'banner'; }
  }
  function setPersistent(msg, kind) { persistent = { msg: msg, kind: kind }; renderBanner(); }
  function clearPersistent(kind) {
    if (!persistent || !kind || persistent.kind === kind) { persistent = null; renderBanner(); }
  }

  function presetIndex(st) {
    if (!st || !st.online) return -1;
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      var pw = Math.round(d.w * d.dpr), ph = Math.round(d.h * d.dpr), den = Math.round(d.dpr * 160) / 160;
      if (st.size.w === pw && st.size.h === ph && Math.abs(st.density.dpr - den) < 0.001) return i;
    }
    return -1;
  }

  function setCtrls(enabled) {
    [document.getElementById('b0'), document.getElementById('b1'), document.getElementById('reset')]
      .forEach(function (b) { b.disabled = !enabled; });
  }

  function renderState() {
    var dot = document.getElementById('dot');
    var conn = document.getElementById('conn');
    var box = document.getElementById('state');
    var st = state;

    if (netErr === 'down') {
      dot.className = 'dot';
      conn.textContent = 'panel server down';
      box.className = 'state warn';
      box.innerHTML = 'Panel server unreachable at localhost:5199 &mdash; restart it with: <b>npm run lab</b>';
      setCtrls(false);
      return;
    }
    if (netErr === 'timeout') {
      dot.className = 'dot';
      conn.textContent = 'state check timed out';
      box.className = 'state warn';
      box.innerHTML = 'State check timed out (adb hung?) &mdash; retrying every 2s';
      setCtrls(false);
      return;
    }
    if (!st || !st.online) {
      dot.className = 'dot';
      conn.textContent = 'emulator offline';
      box.className = 'state warn';
      box.innerHTML = esc((st && st.reason) || 'no emulator attached - run: npm run lab') + stamp(st);
      setCtrls(false);
      renderList();
      return;
    }

    dot.className = 'dot on';
    conn.textContent = st.serial + (st.size.override || st.density.override ? ' · pinned' : '');
    box.className = 'state';
    var land = st.rotation % 2 === 1;
    var badge = presetIndex(st) >= 0 ? '' : '<span class="badge">custom</span>';
    box.innerHTML =
      st.size.w + '×' + st.size.h +
      ' @' + st.density.dpr + 'x (' + st.css.w + '×' + st.css.h + ' css) · ' +
      (land ? 'landscape' : 'portrait') + badge +
      '<span class="muted"> · ' + st.serial + (st.size.override ? ' · wm size override' : '') + '</span>' +
      stamp(st);
    setCtrls(true);
    document.getElementById('b0').className = land ? '' : 'on';
    document.getElementById('b1').className = land ? 'on' : '';
    renderList();
  }

  function renderList() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var active = presetIndex(state);
    var ul = document.getElementById('list');
    ul.innerHTML = '';
    var shown = 0;
    for (var i = 0; i < devices.length; i++) {
      var d = devices[i];
      if (q && d.name.toLowerCase().indexOf(q) < 0) continue;
      shown++;
      var li = document.createElement('li');
      if (i === active) li.className = 'active';
      var sp = document.createElement('span');
      sp.textContent = d.name;
      if (d.custom) sp.className = 'custom';
      var mt = document.createElement('span');
      mt.className = 'meta';
      mt.textContent = d.w + '×' + d.h + ' · ' + d.dpr + 'x';
      li.appendChild(sp);
      li.appendChild(mt);
      li.addEventListener('click', (function (dev) { return function () { apply(dev); }; })(d));
      ul.appendChild(li);
    }
    if (!shown) {
      var li2 = document.createElement('li');
      li2.textContent = 'no match';
      ul.appendChild(li2);
    }
  }

  function apply(d) {
    j('/api/apply', { name: d.name })
      .then(function () {
        clearPersistent('mut'); clearPersistent('net');
        toast('✓ ' + d.name);
        return refresh();
      })
      .catch(function (e) {
        setPersistent('apply ' + d.name + ' failed: ' + e.message, 'mut');
        toast('apply failed', true);
        return refresh();
      });
  }

  function rotateTo(rot) {
    j('/api/rotate', { rot: rot })
      .then(function () { clearPersistent('mut'); toast(rot ? 'landscape' : 'portrait'); return refresh(); })
      .catch(function (e) { setPersistent('rotate failed: ' + e.message, 'mut'); toast('rotate failed', true); return refresh(); });
  }

  function resetNative() {
    j('/api/reset', {})
      .then(function () { clearPersistent('mut'); toast('✓ native size restored'); return refresh(); })
      .catch(function (e) { setPersistent('reset failed: ' + e.message, 'mut'); toast('reset failed', true); return refresh(); });
  }

  function refresh() {
    return fetch('/api/state', { signal: AbortSignal.timeout(8000) })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || d.error) {
            state = { online: false, reason: d.error || ('HTTP ' + r.status) };
            netErr = null;
            return null;
          }
          return d;
        });
      })
      .then(function (s) {
        if (s) {
          var wasDown = netErr === 'down';
          state = s;
          netErr = null;
          if (wasDown) clearPersistent('net');
        }
        renderState();
      })
      .catch(function (e) {
        var timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
        netErr = timeout ? 'timeout' : 'down';
        if (netErr === 'down') setPersistent('panel server unreachable - restart it with: npm run lab', 'net');
        renderState();
      });
  }

  document.getElementById('q').addEventListener('input', renderList);
  document.getElementById('b0').addEventListener('click', function () { rotateTo(0); });
  document.getElementById('b1').addEventListener('click', function () { rotateTo(1); });
  document.getElementById('reset').addEventListener('click', resetNative);

  j('/api/devices').then(function (d) { devices = d.devices; renderState(); });
  refresh();
  setInterval(refresh, 2000);
</script>
</body>
</html>`;

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 8192) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('bad JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function makeHandler() {
  return async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML);
      } else if (req.method === 'GET' && url.pathname === '/api/state') {
        json(res, 200, await refreshState());
      } else if (req.method === 'GET' && url.pathname === '/api/devices') {
        json(res, 200, { devices });
      } else if (req.method === 'POST' && url.pathname === '/api/apply') {
        const body = await readBody(req);
        applyDevice(body.name);
        json(res, 200, { ok: true });
      } else if (req.method === 'POST' && url.pathname === '/api/rotate') {
        const body = await readBody(req);
        rotate(Number(body.rot));
        json(res, 200, { ok: true });
      } else if (req.method === 'POST' && url.pathname === '/api/reset') {
        resetSize();
        json(res, 200, { ok: true });
      } else {
        json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  };
}

export function startPanel({ port = 5199, autoOpen = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer(makeHandler());
    server.once('error', async (e) => {
      if (e.code === 'EADDRINUSE') {
        let ours = false;
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(500) });
          ours = (await r.json())?.panel === PANEL_MARKER;
        } catch {}
        reject(
          new Error(
            ours
              ? `Panel already running at http://localhost:${port} - open that tab instead.`
              : `Port ${port} is in use by another program - try: npm run panel -- --port ${port + 1}`,
          ),
        );
      } else reject(e);
    });
    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}`;
      console.log(`Device panel: ${url} (${devices.length} devices)`);
      if (autoOpen && process.platform === 'win32') {
        try {
          execFileSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true, windowsHide: true });
        } catch {}
      }
      resolve({ server, port, url, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let port = 5199;
  let autoOpen = true;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--port') port = Number(process.argv[++i]);
    else if (process.argv[i] === '--no-open') autoOpen = false;
  }
  startPanel({ port, autoOpen }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
