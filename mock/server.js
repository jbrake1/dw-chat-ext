/* Mock DW site + mock ChatGPT for local tests. Two listeners (two origins):
 *   DW   http://localhost:<port>   : /, /_dw/whoami, /_dw/ext/pass, /_dw/ext/report, /_dw/ext/sites/chatgpt.json, /markup/
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
    passTtl: 300, passBehavior: 'ok', instructions: null, instructionsStatus: 200, reports: [], markup: [], passCalls: 0, whoamiCalls: 0,
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
    if (u.pathname === '/__state') return json(res, 200, { reports: state.reports, markup: state.markup, passCalls: state.passCalls, whoamiCalls: state.whoamiCalls, requests: state.extraRequests });
    if (u.pathname === '/__set' && req.method === 'POST') { Object.assign(state, JSON.parse((await readBody(req)).toString())); return json(res, 200, { ok: true }); }
    if (u.pathname === '/__reset') { state.reports = []; state.markup = []; state.passCalls = 0; state.whoamiCalls = 0; state.extraRequests = []; return json(res, 200, { ok: true }); }
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
    if (u.pathname === '/_dw/ext/sites/chatgpt.json') {
      if (state.instructions == null || state.instructionsStatus !== 200) { res.writeHead(state.instructionsStatus === 200 ? 404 : state.instructionsStatus); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(typeof state.instructions === 'string' ? state.instructions : JSON.stringify(state.instructions));
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
  return new Promise((resolve) => {
    dw.listen(opts.dwPort || 0, '127.0.0.1', () => gpt.listen(opts.gptPort || 0, '127.0.0.1', () => {
      resolve({
        state, dwUrl: 'http://localhost:' + dw.address().port, gptUrl: 'http://127.0.0.1:' + gpt.address().port,
        close: () => new Promise((r) => dw.close(() => gpt.close(r)))
      });
    }));
  });
}
module.exports = { startMock };
if (require.main === module) startMock({ dwPort: 8801, gptPort: 8802 }).then((m) => console.log('DW mock', m.dwUrl, ' ChatGPT mock', m.gptUrl, '(log in at /__login)'));
