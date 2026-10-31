// Run: node tests/landing-ux.mjs (macOS Chrome, or set CHROME_PATH).
// Relay discovery is stubbed; no external services or packages are required.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bnos-ux-'));
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Type', mime[path.extname(pathname)] || 'text/html');
  if (pathname === '/b/js/services/discovery.js') {
    res.end('export async function discoverRecent() { await new Promise(r => setTimeout(r, 100)); return globalThis.__directoryResult || {items:[], errors:[{error:"Offline"}], nextUntil:null}; }');
    return;
  }
  if (pathname === '/b/js/config.js') {
    res.end('export const DEFAULT_RELAYS = [];');
    return;
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.end(fs.readFileSync(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let socket;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; }
    catch { await pause(100); }
  }
  assert.ok(port, 'Chrome must start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await once(socket, 'open');
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (!data.id) return;
    const task = pending.get(data.id);
    pending.delete(data.id);
    data.error ? task.reject(Error(JSON.stringify(data.error))) : task.resolve(data.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause(50);
    }
    throw Error(`Timed out: ${expression}`);
  };
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['https://*', 'wss://*'] });
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  await send('Page.navigate', { url: origin });
  await waitFor('document.querySelector(".cta-title") !== null');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('body [data-i18n]')].filter(e => !e.textContent.trim()).map(e => e.dataset.i18n)`), []);
  assert.equal(await evaluate(`[...document.querySelectorAll('.reveal')].every(e => getComputedStyle(e).opacity === '1')`), true);
  assert.equal(await evaluate(`document.querySelector('#business-status').textContent.includes('JavaScript')`), true);
  const links = await evaluate(`[...document.querySelectorAll('.use-card a')].map(a => a.getAttribute('href'))`);
  assert.equal(links.length, 4);
  const manual = fs.readFileSync(path.join(root, 'manual.html'), 'utf8');
  for (const link of links) assert.ok(manual.includes(`id="${link.split('#')[1]}"`));
  console.log('PASS: JavaScript-disabled content, reveal visibility, directory explanation and manual links');

  await send('Emulation.setScriptExecutionDisabled', { value: false });
  await send('Page.navigate', { url: origin });
  await waitFor('window.translations !== undefined');
  await evaluate(`import('./js/app.js').then(m => m.setLanguage('en'))`);
  await evaluate(`document.getElementById('businesses').scrollIntoView({behavior:'instant'})`);
  await waitFor(`document.getElementById('business-retry').hidden === false`);
  assert.equal(await evaluate(`document.getElementById('business-status').textContent`), 'Relays did not answer. Try again later.');
  await evaluate(`import('./js/app.js').then(m => m.setLanguage('th'))`);
  assert.equal(await evaluate(`document.getElementById('business-status').textContent === translations.th.businesses.error`), true);
  console.log('PASS: failed relay request exposes retry; language switching preserves error state');

  const item = { pubkey: 'a'.repeat(64), npub: 'npub-test', profile: { name: 'Test shop' } };
  await evaluate(`globalThis.__directoryResult = ${JSON.stringify({ items: [item], errors: [{ error: 'Partial' }], nextUntil: null })}; document.getElementById('business-retry').click()`);
  assert.equal(await evaluate(`document.getElementById('business-grid').getAttribute('aria-busy')`), 'true');
  assert.equal(await evaluate(`document.getElementById('business-retry').disabled`), true);
  await waitFor(`document.querySelectorAll('#business-grid .biz-card:not(.is-skeleton)').length === 1`);
  assert.equal(await evaluate(`document.getElementById('business-status').textContent.includes(translations.th.businesses.partial)`), true);
  assert.equal(await evaluate(`document.getElementById('business-retry').hidden`), false);
  await evaluate(`globalThis.__directoryResult = {items:[], errors:[{error:'Offline'}], nextUntil:null}; document.getElementById('business-retry').click()`);
  await waitFor(`document.getElementById('business-grid').getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.querySelectorAll('#business-grid .biz-card').length`), 1);
  console.log('PASS: busy semantics, partial results, and failed refresh retains business cards');

  await evaluate(`globalThis.__directoryResult = {items:[], errors:[], nextUntil:null}; document.getElementById('business-retry').click()`);
  await waitFor(`document.getElementById('business-grid').getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.getElementById('business-status').textContent === translations.th.businesses.empty`), true);
  assert.equal(await evaluate(`document.getElementById('business-retry').hidden`), false);
  await evaluate(`globalThis.__directoryResult = ${JSON.stringify({ items: [item], errors: [], nextUntil: null })}; document.getElementById('business-retry').click()`);
  await waitFor(`document.getElementById('business-grid').getAttribute('aria-busy') === 'false'`);
  assert.equal(await evaluate(`document.getElementById('business-retry').hidden`), true);
  console.log('PASS: empty state can refresh; successful retry restores results');

  for (const width of [1440, 768, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const lang of ['en', 'lo', 'th']) for (const theme of ['dark', 'light']) {
      await evaluate(`import('./js/app.js').then(m => {m.setLanguage('${lang}');m.setTheme('${theme}');})`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `${width}/${lang}/${theme}`);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('body [data-i18n]')].filter(e => !e.textContent.trim()).map(e => e.dataset.i18n)`), []);
    }
  }
  console.log('PASS: 24 viewport/language/theme combinations');
} finally {
  if (socket) socket.close();
  const exited = once(chrome, 'exit');
  chrome.kill();
  await Promise.race([exited, pause(3000)]);
  server.closeAllConnections();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
