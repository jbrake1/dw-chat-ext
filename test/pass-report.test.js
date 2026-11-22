const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto');
const { verifyPass, signedPart } = require('../extension/lib/pass.js');
const { buildReport, Reporter, REPORT_FIELDS } = require('../extension/lib/report.js');
const subtle = crypto.webcrypto.subtle;

const NOW = 1_800_000_000;
const mk = (o) => Object.assign({ ok: true, pass: 'abcdef0123456789', site: 'mingapothecary.com', sub: 'p_linda', role: 'editor', iat: NOW, exp: NOW + 300, now: NOW }, o);
const ctx = (o) => Object.assign({ host: 'mingapothecary.com', receivedAt: 1_000_000, nowMs: 1_000_000 + 1000, subtle, publicKeyJwk: null }, o);

test('pass: valid editor pass for this host', async () => {
  const r = await verifyPass(mk(), ctx());
  assert.equal(r.ok, true); assert.equal(r.sub, 'p_linda'); assert.equal(r.validUntilMs, 1_000_000 + 300_000);
});
test('pass: www. prefix is treated as the same site', async () => {
  assert.equal((await verifyPass(mk({ site: 'www.mingapothecary.com' }), ctx())).ok, true);
});
test('pass: refuses wrong site, non-editor, missing fields, expired, too long, stale receipt', async () => {
  const code = async (p, c) => (await verifyPass(p, ctx(c))).code;
  assert.equal(await code(mk({ site: 'evil.example' })), 'wrong_site');
  assert.equal(await code(mk({ role: 'viewer' })), 'not_editor');
  assert.equal(await code(null), 'no_pass');
  assert.equal(await code(mk({ ok: false })), 'no_pass');
  assert.equal(await code(mk({ sub: '' })), 'no_subject');
  assert.equal(await code(mk({ exp: NOW - 1 })), 'expired');
  assert.equal(await code(mk({ exp: NOW + 5000 })), 'ttl_too_long');
  assert.equal(await code(mk(), { nowMs: 1_000_000 + 301_000 }), 'expired');   // received 301 s ago, ttl 300 s
  assert.equal(await code(mk(), { nowMs: 1_000_000 - 60_000 }), 'expired');    // receipt in the future
  assert.equal(await code(mk({ now: undefined })), 'bad_times');
});
test('pass: Ed25519 signature enforced when a key is configured', async () => {
  const kp = crypto.generateKeyPairSync('ed25519'); const jwk = kp.publicKey.export({ format: 'jwk' });
  const p = mk(); p.sig = crypto.sign(null, Buffer.from(signedPart(p)), kp.privateKey).toString('base64url');
  assert.equal((await verifyPass(p, ctx({ publicKeyJwk: jwk }))).ok, true);
  assert.equal((await verifyPass(Object.assign({}, p, { sub: 'p_other' }), ctx({ publicKeyJwk: jwk }))).code, 'bad_signature');
  assert.equal((await verifyPass(mk(), ctx({ publicKeyJwk: jwk }))).code, 'unsigned');
});

test('report: payload has exactly the six allowed fields and nothing else', () => {
  const p = buildReport({ site: 'chatgpt', step: 'send', extVersion: '0.1.0', instructionsVersion: '2026.11.21-1', errorCode: 'send_not_found',
    prompt: 'SECRET PROMPT', text: 'reply', screenshot: 'data:image/jpeg;base64,AAAA', email: 'linda@example.com', url: 'https://mingapothecary.com/x' }, 1_800_000_000_123);
  assert.deepEqual(Object.keys(p).sort(), [...REPORT_FIELDS].sort());
  assert.deepEqual(p, { site: 'chatgpt', step: 'send', extVersion: '0.1.0', instructionsVersion: '2026.11.21-1', errorCode: 'send_not_found', ts: 1_800_000_000 });
});
test('report: free text in any field is neutralised (cannot smuggle a prompt/URL/email through a field)', () => {
  const p = buildReport({ site: 'https://mingapothecary.com/secret', step: 'Please change the headline', extVersion: 'v 1', instructionsVersion: 'linda@example.com', errorCode: 'Reply: here is the text' }, 5000);
  assert.deepEqual(p, { site: 'unknown', step: 'unknown', extVersion: 'unknown', instructionsVersion: 'unknown', errorCode: 'unknown', ts: 5 });
});
test('report: sent without cookies, dedupes within an hour, honours the opt-out', async () => {
  const calls = []; const store = (() => { const m = {}; return { get: async (k) => m[k], set: async (k, v) => { m[k] = v; } }; })();
  let t = 1_000_000_000, enabled = true;
  const r = new Reporter({ fetch: async (u, o) => { calls.push([u, o]); }, url: 'https://app.dwalliance.com/_dw/ext/report', enabled: async () => enabled, store, now: () => t });
  const rep = { site: 'chatgpt', step: 'prompt', extVersion: '0.1.0', instructionsVersion: '1', errorCode: 'selector_not_found' };
  assert.equal((await r.report(rep)).sent, true);
  assert.equal(calls[0][1].credentials, 'omit'); assert.equal(calls[0][1].method, 'POST');
  assert.deepEqual(Object.keys(JSON.parse(calls[0][1].body)).sort(), [...REPORT_FIELDS].sort());
  assert.equal((await r.report(rep)).why, 'deduped');
  t += 3600 * 1000 + 1; assert.equal((await r.report(rep)).sent, true);
  enabled = false; t += 3600 * 1000 + 1; assert.equal((await r.report(rep)).why, 'disabled');
  assert.equal(calls.length, 2);
});
