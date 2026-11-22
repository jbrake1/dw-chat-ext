/* Shared helpers for the Playwright harness. */
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const { canonical } = require('../extension/lib/util.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// direct=true (used for LIVE runs): start the browser binary ourselves (no --enable-automation, no navigator.webdriver) and attach
// over CDP. chatgpt.com sits behind a Cloudflare challenge that blocks Playwright-launched browsers but not this.
async function launchDirect({ profileDir, extDir, headless }) {
  const cp = require('child_process'), net = require('net'), http = require('http');
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const args = [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--window-size=1100,900', 'about:blank'];
  if (process.getuid && process.getuid() === 0) args.push('--no-sandbox');
  if (headless) args.push('--headless=new');
  const proc = cp.spawn(chromium.executablePath(), args, { stdio: 'ignore', detached: false });
  const up = () => new Promise((res) => http.get(`http://127.0.0.1:${port}/json/version`, (r) => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
  for (let i = 0; i < 100 && !(await up()); i++) await sleep(200);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  const isOurs = (w) => /^chrome-extension:\/\/.+\/background\/sw\.js$/.test(w.url());
  const sw = ctx.serviceWorkers().find(isOurs) || await ctx.waitForEvent('serviceworker', { timeout: 20000, predicate: isOurs });
  ctx.close = async () => { // graceful: lets Chrome flush the profile
    try { await (await browser.newBrowserCDPSession()).send('Browser.close'); } catch (e) {}
    await new Promise((r) => { if (proc.exitCode != null) return r(); const t = setTimeout(r, 8000); proc.once('exit', () => { clearTimeout(t); r(); }); });
  };
  return { ctx, sw, dir: profileDir };
}

async function launch({ profileDir, extDir, headless = true, direct = false }) {
  if (direct && profileDir) return launchDirect({ profileDir, extDir, headless });
  const dir = profileDir || fs.mkdtempSync(path.join(os.tmpdir(), 'dwx-profile-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chromium', headless, viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  return { ctx, sw, dir };
}

const setDev = (sw, dev) => sw.evaluate((d) => chrome.storage.local.set({ dev: d }), dev);
const swState = (sw) => sw.evaluate(() => self.__dw.state());
const iconLog = (sw) => sw.evaluate(() => self.__dw.iconLog);
const tabIdFor = (sw, urlPattern) => sw.evaluate(async (p) => { const t = (await chrome.tabs.query({ url: p }))[0]; return t ? t.id : null; }, urlPattern);
const pair = async (sw, urlPattern) => sw.evaluate(async (p) => { const t = (await chrome.tabs.query({ url: p }))[0]; return self.__dw.pairTab(t.id); }, urlPattern);
const refreshInstr = (sw) => sw.evaluate(() => self.__dw.refreshInstructions('test'));

async function mockApi(dwUrl, p, body) {
  const r = await fetch(dwUrl + p, body ? { method: 'POST', body: JSON.stringify(body) } : {});
  return r.headers.get('content-type') && r.headers.get('content-type').includes('json') ? r.json() : r.text();
}

function seal(instr, privateKey) {
  const o = JSON.parse(JSON.stringify(instr)); const b = Object.assign({}, o); delete b.integrity;
  const hash = crypto.createHash('sha256').update(canonical(b)).digest('hex');
  o.integrity = { alg: 'sha256', hash, sig: '', keyId: '' };
  return o;
}

// Drive the DW editor like a person: Suggest an edit -> type a note -> Send (real, trusted mouse events).
async function submitEdit(dwPage, note) {
  // a person needs > 1 s to draw and type; the extension falls back to its fetch tap ~0.5 s after activation
  await dwPage.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
  await sleep(800);
  await dwPage.locator('button.fab').click();
  await dwPage.locator('textarea#dw-mk-note').fill(note);
  await dwPage.locator('button[data-act=send]').click();
}
const panelText = (page, role) => page.locator(`[data-role=${role}]`).last().textContent({ timeout: 2000 }).catch(() => null);
async function installRecorder(page) {
  await page.evaluate(() => {
    window.__snaps = [];
    const root = document.getElementById('dw-ext-root').shadowRoot;
    new MutationObserver(() => {
      const r = root.querySelector('[data-role=reply]');
      if (r) { const t = r.textContent; if (t && window.__snaps[window.__snaps.length - 1] !== t) window.__snaps.push(t); }
    }).observe(root, { subtree: true, childList: true, characterData: true });
  });
}
const panelSteps = (page) => page.evaluate(() => {
  const root = document.getElementById('dw-ext-root') && document.getElementById('dw-ext-root').shadowRoot;
  return root ? Array.from(root.querySelectorAll('[data-step]')).map((e) => ({ step: e.dataset.step, ok: e.dataset.ok === '1', text: e.textContent })) : [];
});
const waitFor = async (fn, ms = 20000, label = 'condition') => {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + label); await sleep(60); }
};

class Checks {
  constructor() { this.steps = []; }
  check(name, ok, detail) { this.steps.push({ name, ok: !!ok, detail: detail === undefined ? null : detail }); return !!ok; }
  info(name, ok, detail) { this.steps.push({ name, ok: !!ok, informational: true, detail: detail === undefined ? null : detail }); }
  get ok() { return this.steps.every((s) => s.ok || s.informational); }
}

module.exports = { root, sleep, launch, setDev, swState, iconLog, tabIdFor, pair, refreshInstr, mockApi, seal, submitEdit, panelText, installRecorder, panelSteps, waitFor, Checks };
