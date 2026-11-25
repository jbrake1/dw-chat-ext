/* Mock DW site + mock ChatGPT for local tests. Two listeners (two origins):
 *   DW   http://localhost:<port>   : /, /_dw/whoami, /_dw/ext/pass, /_dw/ext/report, /editor-ai/patterns/<site>.json, /markup/
 *   GPT  http://127.0.0.1:<port>   : /  (mock chatgpt.html)
 * Test controls (DW origin): GET /__login /__logout, GET /__state, POST /__set {json}. Never use these in production. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { canonical } = require('../extension/lib/util.js');
const { signedPart } = require('../extension/lib/pass.js');

function startMock(opts = {}) {
  const state = {
    passTtl: 300, passBehavior: 'ok', instructions: null, instructionsStatus: 200, reports: [], markup: [], snapshots: [], passCalls: 0, whoamiCalls: 0,
    passKeys: crypto.generateKeyPairSync('ed25519'), signPass: false, extraRequests: []
  };
  const readBody = (req) => new Promise((res) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
  const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((s) => s.split('=')));
  const json = (res, code, obj, h = {}) => { res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, h)); res.end(JSON.stringify(obj)); };

  const dw = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const c = cookies(req);
    state.extraRequests.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'dw-editor.html'))); }
    if (u.pathname === '/__shot.jpg') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(fs.readFileSync(path.join(__dirname, '../harness/fixtures/sample-screenshot.jpg'))); }
    if (u.pathname === '/__login') { res.writeHead(200, { 'Set-Cookie': ['dw_s=1; Path=/', 'dw_ed=1; Path=/'], 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (u.pathname === '/__logout') { res.writeHead(200, { 'Set-Cookie': ['dw_s=; Max-Age=0; Path=/', 'dw_ed=; Max-Age=0; Path=/'], 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (u.pathname === '/__state') return json(res, 200, { reports: state.reports, markup: state.markup, snapshots: state.snapshots, passCalls: state.passCalls, whoamiCalls: state.whoamiCalls, requests: state.extraRequests });
    if (u.pathname === '/__set' && req.method === 'POST') { Object.assign(state, JSON.parse((await readBody(req)).toString())); return json(res, 200, { ok: true }); }
    if (u.pathname === '/__reset') { state.reports = []; state.markup = []; state.snapshots = []; state.passCalls = 0; state.whoamiCalls = 0; state.extraRequests = []; return json(res, 200, { ok: true }); }
    if (u.pathname === '/_dw/whoami') { state.whoamiCalls++; return json(res, 200, { edit: c.dw_s === '1' }); }
    if (u.pathname === '/_dw/ext/pass' && req.method === 'POST') {
      state.passCalls++;
      if (req.headers['x-dw-ext'] !== '1' || c.dw_s !== '1') return json(res, 403, { ok: false, error: 'forbidden' });
      if (state.passBehavior === 'deny') return json(res, 403, { ok: false, error: 'not_editor' });
      const now = Math.floor(Date.now() / 1000);
      const p = { ok: true, pass: crypto.randomBytes(16).toString('hex'), site: state.passBehavior === 'wrong_site' ? 'evil.example' : req.headers.host.replace(/:\d+$/, ''),
                  sub: state.passSub || 'p_linda', role: 'editor', iat: now, exp: now + (state.passBehavior === 'expired' ? -10 : state.passTtl), now };
      if (state.signPass) p.sig = crypto.sign(null, Buffer.from(signedPart(p)), state.passKeys.privateKey).toString('base64url');
      return json(res, 200, p);
    }
    if (u.pathname === '/_dw/ext/report' && req.method === 'POST') { state.reports.push(JSON.parse((await readBody(req)).toString())); res.writeHead(204); return res.end(); }
    const patt = u.pathname.match(/^\/(?:editor-ai\/patterns|_dw\/ext\/sites)\/([a-z0-9_-]{1,32})\.json$/);
    if (patt) {
      if (state.instructions == null || state.instructionsStatus !== 200) { res.writeHead(state.instructionsStatus === 200 ? 404 : state.instructionsStatus); return res.end('nope'); }
      const body = typeof state.instructions === 'string' ? state.instructions : JSON.stringify(state.instructions);
      const etag = '"' + crypto.createHash('sha256').update(body).digest('hex') + '"';
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'ETag': etag }); return res.end(body);
    }
    if (u.pathname === '/home-prod.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'home-prod.html'))); }   // v0.1.10: a saved copy of a real full-bleed-hero page
    if (u.pathname === '/_dw/edit.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(fs.readFileSync(path.join(__dirname, 'edit.js'))); }
    if (u.pathname === '/markup/markup.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); const sp = path.join(__dirname, '../server/markup/markup.js'); return res.end(fs.readFileSync(fs.existsSync(sp) ? sp : path.join(__dirname, 'markup.js'))); }
    if (u.pathname === '/markup/vendor/html2canvas.min.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end("window.html2canvas=function(el,o){var c=document.createElement('canvas');c.width=Math.max(1,(o&&o.width)||800);c.height=Math.max(1,(o&&o.height)||600);return Promise.resolve(c);};"); }
    if (u.pathname === '/markup/' && (u.searchParams.get('a') === 'status')) {
      return json(res, 200, { ok: true, show: true, csrf: 'mock-csrf' });
    }
    if (u.pathname === '/markup/' && req.method === 'POST' && u.searchParams.get('a') === 'snapshot') {
      if (req.headers['x-dw-markup'] !== '1' || req.headers['x-dw-csrf'] !== 'mock-csrf') return json(res, 403, { ok: false, error: 'bad token' });
      let body = {};
      try { body = JSON.parse((await readBody(req)).toString()); } catch (e) { return json(res, 400, { ok: false, error: 'bad_json' }); }
      const raw = JSON.stringify(body);
      const id = 's' + crypto.randomBytes(4).toString('hex');
      state.snapshots.push({ id, provider: body.provider, host: body.host, bytes: raw.length, selectorCount: Array.isArray(body.selectors) ? body.selectors.length : 0, hasSecret: /SECRET/.test(raw), hasQuery: /[?]/.test(String(body.host || '')) });
      return json(res, 200, { ok: true, id });
    }
    if (u.pathname === '/markup/' && req.method === 'POST') {
      const body = await readBody(req);
      state.markup.push({ bytes: body.length, hasHeader: req.headers['x-dw-markup'] === '1' });
      return json(res, 200, { ok: true, id: state.markup.length });
    }
    res.writeHead(404); res.end('404');
  });
  const gpt = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/c/test') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'chatgpt.html'))); }
    res.writeHead(404); res.end('404');
  });
  // v0.1.6: mock Gemini on a second loopback address (test build maps 127.0.0.2 -> gemini)
  const gem = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (/^\/app(\/[A-Za-z0-9]*)?$/.test(u.pathname)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'gemini.html'))); }
    res.writeHead(404); res.end('404');
  });
  return new Promise((resolve) => {
    dw.listen(opts.dwPort || 0, '127.0.0.1', () => gpt.listen(opts.gptPort || 0, '127.0.0.1', () => gem.listen(opts.gemPort || 0, '127.0.0.2', () => {
      resolve({
        state, dwUrl: 'http://localhost:' + dw.address().port, gptUrl: 'http://127.0.0.1:' + gpt.address().port, gemUrl: 'http://127.0.0.2:' + gem.address().port,
        close: () => new Promise((r) => dw.close(() => gpt.close(() => gem.close(r))))
      });
    })));
  });
}
module.exports = { startMock };
if (require.main === module) startMock({ dwPort: 8801, gptPort: 8802 }).then((m) => console.log('DW mock', m.dwUrl, ' ChatGPT mock', m.gptUrl, '(log in at /__login)'));
