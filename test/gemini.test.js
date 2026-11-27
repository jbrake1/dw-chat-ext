// v0.1.6: Gemini provider. Runs the generic runner against mock/gemini.html (a best-effort mimic of gemini.google.com)
// and the saved fixtures in harness/snapshots/gemini-fixture-*.html. The live Gemini selectors are NOT verified yet.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const Ajv = require('ajv');
const I = require('../extension/lib/interpreter.js');
const { runJob } = require('../extension/lib/runner.js');
const { validateSchema } = require('../extension/lib/schema.js');
const { canonical } = require('../extension/lib/util.js');
const { run, load } = require('../harness/health-check.js');
const { geminiInstr, bundled, schema, mockGemini, sleep, root } = require('./helpers.js');
const R = require('../extension/lib/providers/registry.js');
require('../extension/lib/providers/chatgpt.js'); require('../extension/lib/providers/gemini.js');

const SHOT = { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
const PAGE = [{ name: 'index.html', type: 'text/html', dataUrl: 'data:text/html;base64,PGgxPkhpPC9oMT4=' }, { name: 'site.css', type: 'text/css', dataUrl: 'data:text/css;base64,aDF7fQ==' }];
const JOB = () => ({ prompt: 'Change the headline to "Family owned since 1998"', file: SHOT, files: PAGE });
function fast() {
  const i = geminiInstr();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.stream.noReplyGraceMs = 600;
  i.steps.attach.confirm.timeoutMs = 2000; i.steps.attach.strategies.forEach((s) => { if (s.confirmMs) s.confirmMs = 600; }); i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000; i.steps.newChat.timeoutMs = 2000;
  return i;
}
const collect = () => { const ev = []; return { ev, emit: (e) => ev.push(e) }; };
const snap = (n) => load(path.join(root, 'harness/snapshots', `gemini-fixture-${n}.html`));

test('gemini.json: valid against the schema (Ajv and built-in agree), sealed, unverified, needs ext 0.1.12, rev 4 with the hooked chooser, the inline fallback and markdown reply text', () => {
  const i = geminiInstr();
  const ajv = new Ajv({ allErrors: true, strict: false });
  assert.equal(ajv.validate(schema(), i), true, JSON.stringify(ajv.errors));
  assert.deepEqual(validateSchema(schema(), i), { ok: true, errors: [] });
  const body = Object.assign({}, i); delete body.integrity;
  assert.equal(crypto.createHash('sha256').update(canonical(body)).digest('hex'), i.integrity.hash, 'run npm run seal');
  assert.equal(i.verified, false, 'live Gemini selectors are not verified yet');
  assert.equal(i.minExtVersion, '0.1.12'); assert.ok(i.revision >= 4); assert.ok(i.steps.files.generated && i.steps.files.generated.useHook === true); assert.equal(i.steps.blocks.markdownText, true);
  assert.deepEqual(i.steps.attach.strategies.map((s) => s.type), ['fileInput', 'hookedChooser', 'drop', 'paste']);
  assert.ok(i.steps.attach.inlineFallback.maxBytes > 0);
  assert.ok(i.steps.attach.strategies.every((s) => !s.confirmMs || s.confirmMs <= 12000), 'each attempt is bounded');
  assert.ok(i.steps.attach.strategies[1].openSelectors.includes("button[aria-label='Upload & tools']"));
  assert.deepEqual(i.match.hosts, ['gemini.google.com']);
  assert.equal(i.flow[0], 'newChat', 'always starts a New chat');
  assert.deepEqual(validateSchema(schema(), bundled()), { ok: true, errors: [] }, 'chatgpt.json still valid');
});

test('full relay against mock Gemini: new chat -> text -> "Upload & tools" menu + page hook -> send -> stream -> done, code blocks with File: labels', async () => {
  const win = await mockGemini('?speed=5&tokens=15');
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  assert.deepEqual(ev.filter((e) => e.kind === 'step').map((e) => e.step).slice(0, 6), ['newChat', 'prompt', 'text', 'attach', 'send', 'stream']);
  const attach = ev.find((e) => e.step === 'attach').detail;
  assert.equal(attach.strategy, 'hookedChooser'); assert.equal(attach.count, 3); assert.equal(attach.pageFiles, 2); assert.equal(attach.shown, 3);
  assert.equal(win.__menuOpened, 1); assert.equal(win.__chooserCalls, 1);
  assert.equal(win.document.querySelector('uploader .menu'), null, 'menu closed again');
  assert.deepEqual(win.__received[0].files.map((f) => f.name), ['markup.jpg', 'index.html', 'site.css'], 'one message, screenshot first');
  assert.match(win.__received[0].text, /Family owned since 1998/);
  const chunks = ev.filter((e) => e.kind === 'chunk'); assert.ok(chunks.length >= 3);
  const done = ev.find((e) => e.kind === 'done');
  assert.equal(done.status, 'complete'); assert.match(done.text, /^OK\. Gemini got your request/);
  assert.equal(done.blocks.length, 2);
  assert.match(done.blocks[0].label, /File: \/index\.html$/); assert.equal(done.blocks[0].lang, 'html');
  assert.equal(done.blocks[0].code, '<!doctype html>\n<html><body><h1>Family owned since 1998</h1></body></html>\n');
  assert.equal(done.blocks[1].label, 'File: /css/site.css', 'header text (language chip, copy icon) is not in the label'); assert.equal(done.blocks[1].lang, 'css');
  assert.deepEqual(win.__forbidden, [], 'never touched the model picker, Upgrade, Get app or the OS file chooser');
});

test('reused tab on an old conversation: clicks New chat first, the old answer is not read', async () => {
  const win = await mockGemini('?speed=5&tokens=10&convo=1');
  assert.equal(win.location.pathname, '/app/abc123');
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  assert.equal(ev.find((e) => e.step === 'newChat').detail.strategy, 'clicked');
  assert.equal(win.__newChat, 1);
  const done = ev.find((e) => e.kind === 'done');
  assert.equal(/old answer/.test(done.text), false);
  assert.equal(win.document.querySelectorAll('model-response').length, 1);
});

test('page hook not available: falls back to dropping the files on the input area', async () => {
  const win = await mockGemini('?speed=5&tokens=8', { hook: false });
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  const at = ev.find((e) => e.step === 'attach').detail;
  assert.equal(at.strategy, 'drop');
  assert.ok(at.trace.some((t) => /^hookedChooser:hook_unavailable:/.test(t)), at.trace.join());
  assert.equal(win.__received[0].files.length, 3);
  assert.deepEqual(win.__forbidden, []);
});

test('uploads silently ignored: sends the text files INSIDE the message, says so, and never fails the request', async () => {
  const win = await mockGemini('?speed=5&tokens=8&attach=0');
  const { ev, emit } = collect();
  const t0 = Date.now();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  assert.ok(Date.now() - t0 < 15000, 'bounded');
  assert.equal(ev.some((e) => e.step === 'attach' && e.ok), false, 'no attach success is reported');
  const inl = ev.find((e) => e.step === 'attach_inline');
  assert.equal(inl.ok, true); assert.equal(inl.detail.files, 2); assert.equal(inl.detail.skipped, 0);
  assert.ok(inl.detail.trace.length >= 3, inl.detail.trace.join());
  assert.equal(ev.find((e) => e.step === 'send').detail.inline, true);
  assert.equal(win.__received[0].files.length, 0);
  assert.match(win.__received[0].text, /Family owned since 1998/);
  assert.match(win.__received[0].text, /----- FILE: index\.html -----\n<h1>Hi<\/h1>\n----- END FILE: index\.html -----/);
  assert.match(win.__received[0].text, /did not work, so the contents of 2 files are pasted below/);
  assert.deepEqual(win.__forbidden, []);
});

test('a chip, Remove button or thumbnail that was already on the page is not mistaken for the upload', async () => {
  const win = await mockGemini('?speed=5&tokens=8&attach=0');
  win.document.getElementById('previews').innerHTML = '<uploader-file-preview><div class="file-preview"><button aria-label="Remove file">x</button></div></uploader-file-preview>';
  const { ev, emit } = collect();
  await runJob(win, fast(), JOB(), { emit }).promise;
  assert.ok(ev.some((e) => e.step === 'attach_inline'), 'growth over the count before the attempt is required');
});

test('no inlineFallback in the instructions: the failure is reported with a per-strategy trace, sent:false, in bounded time', async () => {
  const win = await mockGemini('?attach=0');
  const i = fast(); delete i.steps.attach.inlineFallback;
  const { ev, emit } = collect();
  const t0 = Date.now();
  const res = await runJob(win, i, JOB(), { emit }).promise;
  assert.equal(res.ok, false); assert.equal(res.code, 'attach_not_confirmed');
  assert.ok(Date.now() - t0 < 12000);
  const err = ev.find((e) => e.kind === 'error');
  assert.equal(err.sent, false); assert.deepEqual(err.trace.map((t) => t.split(':')[0]), ['fileInput', 'hookedChooser', 'drop', 'paste']);
  assert.equal(win.__received.length, 0);
});

test('the menu click and the upload item go through the guard: a hijacked "Upload files" selector pointing at Upgrade is refused', async () => {
  const win = await mockGemini('?speed=5&tokens=5');
  const i = fast(); i.steps.attach.strategies[1].openSelectors = ['.upgrade'];
  const res = await runJob(win, i, JOB(), { emit: () => {} }).promise;
  assert.equal(res.code, 'blocked_click'); assert.deepEqual(win.__forbidden, []);
});

test('Gemini usage-limit reply is reported as a limit (file_limit from the v0.1.5 detector, or usage_limit), sent, with a clear message', async () => {
  const win = await mockGemini('?limit=1');
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, false); assert.ok(['file_limit', 'usage_limit'].includes(res.code), res.code);
  const err = ev.find((e) => e.kind === 'error'); assert.equal(err.sent, true);
  assert.match(R.message('gemini', 'usage_limit'), /Gemini says a usage or upload limit was reached/);
});

test('signed-out Gemini (anonymous chat box, Sign in link): not_logged_in, nothing typed or sent', async () => {
  const win = await mockGemini('?signedout=1');
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.code, 'not_logged_in');
  assert.equal(ev.find((e) => e.kind === 'error').sent, false);
  assert.equal(win.__received.length, 0);
  assert.equal(win.document.querySelector('.ql-editor').textContent, '');
});

test('Stop mid-stream clicks Gemini\'s Stop response and keeps the partial reply', async () => {
  const win = await mockGemini('?speed=40&tokens=60');
  const { ev, emit } = collect();
  const job = runJob(win, fast(), JOB(), { emit });
  while (!ev.some((e) => e.kind === 'chunk' && e.text.length > 10)) await sleep(10);
  assert.equal(job.stop(), true);
  const res = await job.promise;
  assert.equal(res.status, 'stopped'); assert.ok(res.text.length > 0);
  assert.deepEqual(win.__forbidden, []);
});

test('guard: never clicks the model picker, Upgrade or Get app, even if a selector points at them', async () => {
  const win = await mockGemini('?convo=1');
  const d = win.document, g = geminiInstr().guard;
  for (const sel of ['.model-picker', '.upgrade', '.get-app']) assert.equal(I.blockedByGuard(d.querySelector(sel), g), true, sel);
  for (const sel of ['.send-button', 'uploader button', '[data-test-id=new-chat-button] a']) assert.equal(I.blockedByGuard(d.querySelector(sel), g), false, sel);
  const i = fast(); i.steps.newChat.selectors = ['.upgrade'];
  const { ev, emit } = collect();
  const res = await runJob(win, i, JOB(), { emit }).promise;
  assert.equal(res.code, 'blocked_click'); assert.deepEqual(win.__forbidden, []);
  assert.equal(ev.find((e) => e.kind === 'error').sent, false);
  const j = fast(); j.steps.send.selectors = ['.model-picker']; j.steps.send.fallbackKey = undefined; delete j.steps.send.fallbackKey; j.steps.send.timeoutMs = 500;
  const w2 = await mockGemini('?speed=5&tokens=5');
  const r2 = await runJob(w2, j, JOB(), { emit: () => {} }).promise;
  assert.equal(r2.ok, false); assert.deepEqual(w2.__forbidden, []);
});

test('saved Gemini fixtures: every primary selector matches (selector-only health check)', () => {
  const i = geminiInstr();
  const r = run(i, { idle: snap('idle'), typing: snap('typing'), streaming: snap('streaming'), replied: snap('replied') }, {});
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.deepEqual(r.staleFallbacks, []);
  const idle = snap('idle').document;
  for (const k of ['newChat', 'prompt']) assert.equal(I.resolve(idle, i.steps[k].selectors).index, 0, k);
  assert.equal(I.resolve(idle, i.steps.attach.strategies[1].openSelectors).index, 0, '"+" upload button');
  assert.equal(I.resolve(snap('typing').document, i.steps.attach.confirm.selectors).index, 0, 'attachment chip');
  assert.equal(I.resolve(snap('streaming').document, i.steps.stop.selectors).index, 0, 'Stop response');
  assert.equal(I.readNotice(snap('replied').document, i), null, 'a normal reply is not a notice');
  assert.equal(I.readNotice(snap('limit').document, i), 'usage_limit');
  assert.ok(I.resolve(snap('signedout').document, i.steps.loggedOut.selectors).el, 'Sign in link');
  assert.equal(I.resolve(snap('idle').document, i.steps.loggedOut.selectors).el, null, 'signed-in page is not "signed out"');
});

test('readBlocks on the replied fixture: labels and languages from the code-block header', () => {
  const w = snap('replied');
  const b = I.readBlocks(w, w.document, geminiInstr(), 0);
  assert.deepEqual(b.map((x) => [x.label.replace(/^.*(File: \S+)$/, '$1'), x.lang]), [['File: /index.html', 'html'], ['File: /css/site.css', 'css']]);
});

test('notices: a reply that merely mentions an "upload limit" mid-text is not treated as a limit', () => {
  const { dom } = require('./helpers.js');
  const w = dom('<model-response><message-content><div class="markdown"><p>Sure. Note that PHP has an upload limit of 2M; raise upload_max_filesize.</p></div></message-content></model-response>', { url: 'https://gemini.google.com/app/x' });
  assert.equal(I.readNotice(w.document, geminiInstr()), null);
  const w2 = dom('<div role="alert">You\u2019ve reached your upload limit. Try again tomorrow.</div>', { url: 'https://gemini.google.com/app' });
  assert.equal(I.readNotice(w2.document, geminiInstr()), 'usage_limit');
});

test('provider registry: ChatGPT + Gemini, hosts match config, labels and messages', () => {
  assert.deepEqual(R.ids(), ['chatgpt', 'gemini']);
  assert.equal(R.forHost('gemini.google.com').id, 'gemini'); assert.equal(R.forHost('chatgpt.com').id, 'chatgpt'); assert.equal(R.forHost('evil.com'), null);
  assert.equal(R.valid('gemini'), true); assert.equal(R.valid('claude'), false); assert.equal(R.valid('__proto__'), false);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'extension/config.json'), 'utf8'));
  const m = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  for (const p of R.all()) {
    for (const h of p.hosts) { assert.equal(cfg.aiSites[h], p.id); assert.ok(m.host_permissions.includes(`https://${h}/*`)); assert.ok(m.content_scripts[1].matches.includes(`https://${h}/*`)); }
    assert.ok(fs.existsSync(path.join(root, 'extension', p.instructions)), p.instructions);
    assert.ok(p.newChatUrl.startsWith('https://' + p.hosts[0] + '/'));
  }
  assert.match(R.message('gemini', 'no_stream'), /Gemini did not start answering/);
  assert.equal(R.message('chatgpt', 'not_logged_in'), 'ChatGPT tab is not signed in.');
  assert.equal(R.message('gemini', 'something_unknown'), null);
  for (const f of ['content_scripts', 'background']) assert.ok(m[f]);
  assert.ok(m.content_scripts[0].js.includes('lib/providers/gemini.js'));
});

// ---- v0.1.10: reply as markdown, code blocks collapsed, raw HTML recovered ----
const runReply = async (query) => {
  const win = await mockGemini('?speed=3&tokens=8&' + query);
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  return { ev, done: ev.find((e) => e.kind === 'done'), chunks: ev.filter((e) => e.kind === 'chunk') };
};

test('v0.1.10: code blocks stay code in the reply text (fences), without header chrome, and the live text is already fenced', async () => {
  const { done, chunks } = await runReply('code=1');
  assert.match(done.text, /File: `\/index\.html`\n\n```html\n<!doctype html>\n<html><body><h1>Family owned since 1998<\/h1><\/body><\/html>\n```/);
  assert.match(done.text, /```css\nh1\{color:#1f4d2b\}\n```/);
  assert.equal(/content_copy|Copy code/.test(done.text), false, 'copy button / icon text is not in the reply');
  assert.match(done.text, /That is all\.$/);
  assert.ok(chunks.some((c) => /```html/.test(c.text)), 'streamed text carries the fence');
  assert.equal(done.blocks.length, 2); assert.match(done.blocks[0].label, /File: \/index\.html$/);
});

test('v0.1.10: a whole HTML page written into ordinary paragraphs becomes a fenced block AND a file block', async () => {
  const { done } = await runReply('reply=rawdoc');
  assert.equal(done.blocks.length, 1);
  assert.equal(done.blocks[0].lang, 'html'); assert.match(done.blocks[0].label, /File: \/index\.html$/);
  assert.match(done.blocks[0].code, /^<!doctype html>\n<html lang="en">[\s\S]*<\/html>\n$/);
  assert.match(done.text, /File: `\/index\.html`\n\n```html\n<!doctype html>[\s\S]*<\/html>\n```\n\nThat is all\./);
  assert.equal(/\n<h1 id="top">/.test(done.text.split('```')[0]), false, 'not left as paragraphs');
});

test('v0.1.10: an HTML fragment in paragraphs is shown as a code block, and is NOT offered as a file block', async () => {
  const { done } = await runReply('reply=rawfrag');
  assert.equal(done.blocks.length, 0);
  assert.match(done.text, /```html\n<p class="fine preview-note">Earlier previews remain available:[\s\S]*<h2 id="install">Install it in Chrome<\/h2>[\s\S]*```/);
  assert.equal(done.text.split('```').length, 3, 'one fenced block');
});

test('v0.1.10: ordinary prose with a little markup is untouched; a reply mentioning ``` inside code cannot break the fences', async () => {
  const I2 = require('../extension/lib/interpreter.js');
  const win = await mockGemini('?convo=1');
  const d = win.document, h = d.createElement('div');
  h.innerHTML = '<p>Use <strong>bold</strong> and <code>a &lt; b</code> here. See <a href="https://example.com/x">the docs</a>.</p><ul><li>one</li><li>two</li></ul><pre><code class="language-md">```js\nx\n```</code></pre><p>&lt;b&gt;not html lines&lt;/b&gt; end</p>';
  const out = I2.replyMarkdown ? I2.replyMarkdown(win, d, h, geminiInstr(), true) : null;
  assert.ok(out, 'exported');
  assert.match(out.text, /^Use \*\*bold\*\* and `a < b` here\. See \[the docs\]\(https:\/\/example\.com\/x\)\./);
  assert.match(out.text, /- one\n- two/);
  assert.equal(out.text.split('```').length, 3 + 0, 'inner fence neutralised: exactly one real fence pair');
  assert.equal(out.blocks[0].code, '```js\nx\n```', 'the block keeps the original code');
  assert.match(out.text, /<b>not html lines<\/b> end$/);
});

test('v0.1.10: the whole-page reply (code block or raw paragraphs) matches the sent page and would be staged; a fragment is not; prose is what is outside the fences', async () => {
  const fs = require('fs'), path = require('path');
  const sp = path.join(__dirname, '../server/markup/markup.js');
  const src = fs.readFileSync(fs.existsSync(sp) ? sp : path.join(__dirname, '../mock/markup.js'), 'utf8');   // the git tree keeps a copy of the served editor in mock/
  const grab = (name) => { const m = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(src); assert.ok(m, name); return m[0]; };
  const grabVar = (name) => { const m = new RegExp('var ' + name + ' = [^\\n]*;').exec(src); assert.ok(m, name); return m[0]; };
  const M = new Function('location', 'XT', 'brand', [grabVar('XT_LIM'), grabVar('XT_MIME'), grabVar('XT_SAVE_TYPES'), grabVar('XT_LANG'),
    grab('xtExt'), grab('xtBase'), grab('xtHtmlFrom'), grab('xtKind'), grab('xtMatchBlock'), grab('xtUpdatesFrom'), grab('xtCap'), grab('xtProse'),
    'return { xtUpdatesFrom, xtProse };'].join('\n'))({ href: 'https://example.com/' }, { app: false }, 'B1');
  const SENT = [{ path: '/index.html', name: 'index.html', base: 'index.html', kind: 'html', page: true, text: null }];
  for (const q of ['reply=rawdoc', 'code=1']) {
    const { done } = await runReply(q);
    const u = M.xtUpdatesFrom(done, SENT);
    assert.deepEqual(u.map((x) => x.file.path), ['/index.html'], q);
    assert.match(u[0].content, /<html/);
    assert.equal(/```/.test(M.xtProse(done)), false, 'prose has no fences: ' + q);
  }
  const frag = (await runReply('reply=rawfrag')).done;
  assert.deepEqual(M.xtUpdatesFrom(frag, SENT), []);
});

test('v0.1.11: peek (baseline = last message) re-reads a finished Gemini reply and its recovered HTML block', async () => {
  const I2 = require('../extension/lib/interpreter.js');
  const win = await mockGemini('?speed=3&tokens=8&reply=rawdoc');
  const { ev, emit } = collect();
  const res = await runJob(win, fast(), JOB(), { emit }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  const instr = geminiInstr();
  const n = I2.countMessages(win.document, instr);
  assert.ok(n >= 1);
  const baseline = Math.max(0, n - 1);
  const st = I2.readState(win, win.document, instr, baseline, null);
  const blocks = I2.readBlocks(win, win.document, instr, baseline);
  assert.match(st.text, /```html/);
  assert.match(st.text, /That is all/);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].code, /<!doctype html>/i);
});
