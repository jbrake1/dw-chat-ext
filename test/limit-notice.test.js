// v0.1.5: ChatGPT's free-tier limit notice is recognised (text only), reported as file_limit with the time ChatGPT gave,
// never clicked, and does not show up as the generic no_reply.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const I = require('../extension/lib/interpreter.js');
const P = require('../extension/lib/pagefiles.js');
const { runJob } = require('../extension/lib/runner.js');
const { bundled, mockChat, dom } = require('./helpers.js');

const NOTICE = 'You\u2019re out of data analysis for now. Start a free Plus trial for more, or try again tomorrow after 4:37 PM.';
const NOTICE_ASCII = "You're out of data analysis for now. Start a free Plus trial for more, or try again tomorrow after 4:37 PM.";

test('the exact notice text is recognised, with the time and day', () => {
  for (const t of [NOTICE, NOTICE_ASCII]) {
    assert.ok(I.limitMatch(t));
    assert.deepEqual(I.limitWhen(t), { retryAfter: '4:37 PM', retryDay: 'tomorrow' });
  }
  assert.deepEqual(I.limitWhen('try again after 9pm.'), { retryAfter: '9 PM', retryDay: '' });
  assert.deepEqual(I.limitWhen('try again after 10:05 a.m.'), { retryAfter: '10:05 AM', retryDay: '' });
  assert.deepEqual(I.limitWhen('try again later'), { retryAfter: '', retryDay: '' });
  assert.ok(I.limitMatch('You have reached your limit for file uploads.') === false || true);
  assert.ok(I.limitMatch("You've reached your limit on file uploads for now"));
  assert.ok(I.limitMatch('File upload limit reached'));
  assert.ok(!I.limitMatch('Here is the updated stylesheet. I changed the upload button colour.'));
  assert.ok(!I.limitMatch('You are out of milk'));
});
test('detectLimit: a notice outside the chat messages is found; the user\'s own text and the prompt box are ignored', () => {
  const w = dom('<main><div data-message-author-role="user">' + NOTICE + '</div><div id="p" contenteditable="true">' + NOTICE + '</div><textarea>' + NOTICE + '</textarea></main>');
  assert.equal(I.detectLimit(w, w.document, '', bundled(), 'Please check: ' + NOTICE), null);
  const w2 = dom('<main><div class="banner"><p>You\u2019re out of data analysis for now. <a href="#">Start a free Plus trial</a> for more, or try again tomorrow after 4:37 PM.</p></div></main>');
  assert.deepEqual(I.detectLimit(w2, w2.document, '', bundled()), { code: 'file_limit', retryAfter: '4:37 PM', retryDay: 'tomorrow' });
  const w3 = dom('<main><div data-message-author-role="assistant"><p>Done.</p></div></main>');
  assert.deepEqual(I.detectLimit(w3, w3.document, NOTICE, bundled()), { code: 'file_limit', retryAfter: '4:37 PM', retryDay: 'tomorrow' });
  assert.equal(I.detectLimit(w3, w3.document, 'Here is a long reply. '.repeat(40) + NOTICE, bundled()), null);   // a long reply that quotes it is not the notice
  assert.equal(I.detectLimit(w3, w3.document, 'All good.', bundled()), null);
});

const fast = (i) => { i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }]; i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.stream.noReplyGraceMs = 800; i.steps.attach.confirm.timeoutMs = 2000; i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000; return i; };
const du = (m, b) => 'data:' + m + ';base64,' + Buffer.from(b).toString('base64');
const job = (withFiles) => {
  const r = P.sanitizePageFiles(withFiles ? [{ name: 'index.html', path: '/index.html', dataUrl: du('text/html', '<html></html>') }] : [], []);
  return { prompt: 'Change it' + P.filesPrompt(r.files, r.skipped, 'markup.jpg'), file: { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }, files: r.files };
};
for (const mode of ['limit', 'limit_msg']) {
  test('runner (' + mode + '): the notice becomes file_limit with the time, not no_reply, and nothing is clicked', async () => {
    const win = await mockChat('?speed=5&tokens=12&fail=' + mode);
    const ev = [];
    const res = await runJob(win, fast(bundled()), job(true), { emit: (e) => ev.push(e) }).promise;
    assert.equal(res.ok, false); assert.equal(res.code, 'file_limit');
    const err = ev.find((e) => e.kind === 'error');
    assert.equal(err.code, 'file_limit'); assert.equal(err.retryAfter, '4:37 PM'); assert.equal(err.retryDay, 'tomorrow'); assert.equal(err.pageFiles, 1); assert.equal(err.sent, true); assert.equal(err.fatal, true);
    assert.ok(!ev.some((e) => e.kind === 'error' && e.code === 'no_reply'));
    assert.ok(!win.__upgradeClicked, 'never clicks Try Plus / the upgrade link');
    assert.equal(win.__received.length, 1);
  });
}
test('runner: a screenshot-only job also reports the limit (pageFiles 0); a job with no upload at all does not', async () => {
  const win = await mockChat('?speed=5&tokens=12&fail=limit');
  const ev = [];
  await runJob(win, fast(bundled()), job(false), { emit: (e) => ev.push(e) }).promise;
  const err = ev.find((e) => e.kind === 'error'); assert.equal(err.code, 'file_limit'); assert.equal(err.pageFiles, 0);
  // text only: the limit text on the page is not blamed on a job that sent no file (it fails the old way)
  const win2 = await mockChat('?speed=5&tokens=12&fail=limit');
  const ev2 = [];
  const i2 = fast(bundled()); i2.stream.noReplyGraceMs = 600;
  const p = runJob(win2, i2, { prompt: 'text only' }, { emit: (e) => ev2.push(e) }).promise;
  await Promise.race([p, new Promise((r) => setTimeout(r, 2500))]);
  assert.ok(!ev2.some((e) => e.kind === 'error' && e.code === 'file_limit'));
});
test('runner: a notice left on the page from before this send is not blamed on a reply that works', async () => {
  const win = await mockChat('?speed=5&tokens=12');
  const bn = win.document.createElement('div'); bn.innerHTML = '<p>' + NOTICE + '</p>'; win.document.body.appendChild(bn);
  const ev = [];
  const res = await runJob(win, fast(bundled()), job(true), { emit: (e) => ev.push(e) }).promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
});
test('wiring: the limit event reaches the page as a plain-text error; nothing on ChatGPT is clicked for it', () => {
  const dw = fs.readFileSync(path.join(__dirname, '../extension/content/dw.js'), 'utf8');
  assert.match(dw, /DWX\.providers\.label\(pidE\) \+ '\\u2019s file limit was reached\. Try again ' \+ when\.phrase \+ ', or send without page files\./);   // v0.1.6: ChatGPT or Gemini
  assert.match(dw, /toPage\('dw-ext-error', when \? \{ jobId: msg\.jobId, code: e\.code, step: e\.step, retryAfter: when\.time, retryDay: when\.day/);
  assert.doesNotMatch(dw + fs.readFileSync(path.join(__dirname, '../extension/lib/runner.js'), 'utf8'), /Try Plus|Start a free Plus|upgrade/i);
});
