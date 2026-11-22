const test = require('node:test'), assert = require('node:assert');
const crypto = require('crypto');
const Ajv = require('ajv');
const U = require('../extension/lib/util.js');
const S = require('../extension/lib/schema.js');
const Ins = require('../extension/lib/instructions.js');
const { bundled, schema } = require('./helpers.js');

const subtle = crypto.webcrypto.subtle;
const B = bundled().revision; // the bundled file's revision; remote test files are always newer than it
const ctx = (o) => Object.assign({ schema: schema(), siteId: 'chatgpt', extVersion: '0.1.0', floorRevision: B, subtle, publicKeyJwk: null }, o);
const remote = (mut) => { const i = bundled(); i.revision = B + 1; i.version = '2026.12.01-1'; i.integrity = { alg: 'sha256', hash: '', sig: '', keyId: '' }; if (mut) mut(i); return i; };
const seal = (i) => { const b = Object.assign({}, i); delete b.integrity; i.integrity = { alg: 'sha256', hash: crypto.createHash('sha256').update(U.canonical(b)).digest('hex'), sig: '', keyId: '' }; return i; };

test('bundled chatgpt.json is valid against the schema (Ajv and the built-in validator agree)', () => {
  const ajv = new Ajv({ allErrors: true, strict: false }); const v = ajv.compile(schema());
  assert.equal(v(bundled()), true, JSON.stringify(v.errors));
  assert.equal(S.validateSchema(schema(), bundled()).ok, true);
});

test('built-in validator agrees with Ajv on a set of broken documents', () => {
  const ajv = new Ajv({ allErrors: true, strict: false }); const v = ajv.compile(schema());
  const muts = [
    (i) => { delete i.steps.send; }, (i) => { i.schemaVersion = 2; }, (i) => { i.steps.prompt.selectors = []; },
    (i) => { i.steps.prompt.selectors = [42]; }, (i) => { i.flow = ['text', 'eval']; }, (i) => { i.extra = 1; },
    (i) => { i.stream.done.all = [{ type: 'bogus' }]; }, (i) => { i.stream.done.all = []; }, (i) => { i.revision = 0; },
    (i) => { i.steps.send.fallbackKey = 'Tab'; }, (i) => { i.integrity.hash = 'xyz'; }, (i) => { i.steps.prompt.selectors = [{ css: 'a', onclick: 'x' }]; },
    (i) => { i.match.hosts = ['Bad Host']; }, (i) => { i.steps.attach.strategies = [{ type: 'script' }]; }, (i) => { i.stream.done.all = [{ type: 'textStable', ms: 'a lot' }]; },
    (i) => { i.site = 'ChatGPT!'; }, (i) => { i.steps.files.links = [{ selectors: ['a'], kind: 'exec' }]; }
  ];
  for (const m of muts) {
    const i = bundled(); m(i);
    assert.equal(S.validateSchema(schema(), i).ok, v(i), 'disagree on ' + m.toString());
    assert.equal(v(i), false, 'should be invalid: ' + m.toString());
  }
});

test('validateRemote accepts a good newer file', async () => {
  const r = await Ins.validateRemote(JSON.stringify(remote()), ctx());
  assert.equal(r.ok, true); assert.equal(r.instr.revision, B + 1); assert.equal(r.integrityChecked, false);
});

test('validateRemote rejects: bad json, too large, schema, site, min version, downgrade, bad regex', async () => {
  const code = async (t, c) => (await Ins.validateRemote(t, ctx(c))).code;
  assert.equal(await code('{nope'), 'bad_json');
  assert.equal(await code('x'.repeat(Ins.MAX_BYTES + 1)), 'too_large');
  assert.equal(await code(JSON.stringify(remote((i) => { delete i.steps.stop; }))), 'schema_invalid');
  assert.equal(await code(JSON.stringify(remote((i) => { i.schemaVersion = 7; }))), 'schema_version');
  assert.equal(await code(JSON.stringify(remote((i) => { i.site = 'claude'; }))), 'site_mismatch');
  assert.equal(await code(JSON.stringify(remote((i) => { i.minExtVersion = '0.2.0'; }))), 'min_version');
  assert.equal(await code(JSON.stringify(remote((i) => { i.revision = B; })), { floorRevision: B + 2 }), 'revision_downgrade');
  assert.equal(await code(JSON.stringify(remote((i) => { i.steps.loggedOut.selectors = [{ css: 'button', textMatches: '([unclosed' }]; }))), 'bad_selector');
});

test('integrity: hash must match when present; placeholder (empty) hash is accepted but flagged unchecked', async () => {
  const good = seal(remote());
  const r = await Ins.validateRemote(JSON.stringify(good), ctx());
  assert.deepEqual([r.ok, r.integrityChecked], [true, true]);
  good.steps.send.timeoutMs = 1234; // tampered after sealing
  assert.equal((await Ins.validateRemote(JSON.stringify(good), ctx())).code, 'hash_mismatch');
  // key order / whitespace changes do not break the hash
  const sealed = seal(remote());
  const reordered = JSON.stringify(Object.fromEntries(Object.entries(sealed).reverse()), null, 4);
  assert.equal((await Ins.validateRemote(reordered, ctx())).ok, true);
});

test('signature: required when a public key is configured; verified with Ed25519', async () => {
  const kp = crypto.generateKeyPairSync('ed25519');
  const jwk = kp.publicKey.export({ format: 'jwk' });
  const signed = (tamper) => { const i = seal(remote()); i.integrity.alg = 'sha256+ed25519'; i.integrity.sig = crypto.sign(null, Buffer.from(i.integrity.hash), kp.privateKey).toString('base64url'); if (tamper) i.integrity.sig = crypto.sign(null, Buffer.from('other'), kp.privateKey).toString('base64url'); return i; };
  assert.equal((await Ins.validateRemote(JSON.stringify(signed()), ctx({ publicKeyJwk: jwk }))).ok, true);
  assert.equal((await Ins.validateRemote(JSON.stringify(signed(true)), ctx({ publicKeyJwk: jwk }))).code, 'bad_signature');
  assert.equal((await Ins.validateRemote(JSON.stringify(seal(remote())), ctx({ publicKeyJwk: jwk }))).code, 'unsigned');
  assert.equal((await Ins.validateRemote(JSON.stringify(remote()), ctx({ publicKeyJwk: jwk }))).code, 'unsigned');
});

function mem() { const m = {}; return { m, get: async (k) => m[k], set: async (k, v) => { m[k] = v; } }; }
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, text: async () => body, headers: { get: (k) => headers[k] || null } });
const base = (store, fetch, extra) => Object.assign({ fetch, url: 'https://x/chatgpt.json', store, bundled: bundled(), schema: schema(), extVersion: '0.1.0', now: () => 1000, subtle, publicKeyJwk: null, siteId: 'chatgpt' }, extra);

test('refresh: updated -> cached; unchanged on identical body and on 304 (sends If-None-Match); rejected keeps previous', async () => {
  const store = mem(); const seen = [];
  const body1 = JSON.stringify(remote());
  let r = await Ins.refresh(base(store, async (u, o) => { seen.push(o.headers); return res(200, body1, { ETag: '"a"' }); }));
  assert.deepEqual([r.status, r.revision], ['updated', B + 1]);
  assert.equal(store.m['instr:chatgpt'].etag, '"a"');
  r = await Ins.refresh(base(store, async (u, o) => { seen.push(o.headers); return res(304, ''); }));
  assert.equal(r.status, 'unchanged'); assert.equal(seen[1]['If-None-Match'], '"a"');
  r = await Ins.refresh(base(store, async () => res(200, body1)));
  assert.equal(r.status, 'unchanged');
  r = await Ins.refresh(base(store, async () => res(200, JSON.stringify(remote((i) => { i.revision = B; })))));
  assert.deepEqual([r.status, r.code], ['rejected', 'revision_downgrade']);
  assert.equal(store.m['instr:chatgpt'].instr.revision, B + 1, 'previous good copy kept');
  r = await Ins.refresh(base(store, async () => { throw new Error('offline'); }));
  assert.deepEqual([r.status, r.code], ['failed', 'fetch_failed']);
  r = await Ins.refresh(base(store, async () => res(500, 'x')));
  assert.deepEqual([r.status, r.code], ['failed', 'http_500']);
});

test('choose: remote wins only if newer than bundled and compatible; bundled wins ties and after an extension upgrade', () => {
  const b = bundled();
  const cached = (rev, min) => ({ instr: Object.assign(bundled(), { revision: rev, minExtVersion: min || '0.1.0' }), fetchedAt: 1 });
  assert.equal(Ins.choose(null, b, '0.1.0').source, 'bundled');
  assert.equal(Ins.choose(cached(B + 1), b, '0.1.0').source, 'remote');
  assert.equal(Ins.choose(cached(B), b, '0.1.0').source, 'bundled');
  assert.equal(Ins.choose(cached(B + 4, '0.3.0'), b, '0.1.0').source, 'bundled');
  const newer = Object.assign(bundled(), { revision: B + 8 });
  assert.equal(Ins.choose(cached(B + 1), newer, '0.2.0').source, 'bundled');
});
