// Runs the generic runner against the mock ChatGPT page (mock/chatgpt.html) inside jsdom, with streaming.
const test = require('node:test'), assert = require('node:assert');
const { runJob } = require('../extension/lib/runner.js');
const { bundled, mockChat, sleep } = require('./helpers.js');

const JOB = () => ({ prompt: 'Change the headline to "Family owned since 1998"', file: { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } });
function fastInstr(extra) {
  const i = bundled();
  i.stream.done.all = [{ type: 'newMessage' }, { type: 'absent', step: 'stop' }, { type: 'textStable', ms: 120 }];
  i.stream.emitMinIntervalMs = 0; i.stream.startTimeoutMs = 3000; i.stream.noReplyGraceMs = 600;
  i.steps.attach.confirm.timeoutMs = 2000; i.steps.send.timeoutMs = 3000; i.steps.prompt.timeoutMs = 2000;
  return Object.assign(i, extra || {});
}
const collect = () => { const ev = []; return { ev, emit: (e) => ev.push(e) }; };

test('full relay against mock ChatGPT: text -> attach -> send -> stream -> done, files extracted', async () => {
  const win = await mockChat('?speed=5&tokens=25');
  const { ev, emit } = collect();
  const job = runJob(win, fastInstr(), JOB(), { emit });
  const res = await job.promise;
  assert.equal(res.ok, true, JSON.stringify(ev.filter((e) => e.kind === 'error')));
  const steps = ev.filter((e) => e.kind === 'step').map((e) => e.step);
  assert.deepEqual(steps.slice(0, 5), ['prompt', 'text', 'attach', 'send', 'stream']);
  const chunks = ev.filter((e) => e.kind === 'chunk');
  assert.ok(chunks.length >= 3, 'streamed in several snapshots, got ' + chunks.length);
  for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].text.length >= chunks[i - 1].text.length, 'snapshots only grow');
  assert.ok(chunks[0].text.length < chunks[chunks.length - 1].text.length);
  const done = ev.find((e) => e.kind === 'done');
  assert.equal(done.status, 'complete'); assert.match(done.text, /^OK\. Received your request/); assert.match(done.text, /markup\.jpg/);
  assert.deepEqual(done.files.map((f) => f.name + ':' + f.kind), ['result.html:file', 'notes.txt:file', 'docs:link']);
  assert.equal(win.__received.length, 1);
  assert.equal(win.__received[0].files[0].name, 'markup.jpg');
  assert.match(win.__received[0].text, /Family owned since 1998/);
  assert.equal(ev.filter((e) => e.kind === 'done').length, 1);
});

test('falls back to paste attach when the page has no file input', async () => {
  const win = await mockChat('?speed=5&tokens=10&fileinput=0');
  const { ev, emit } = collect();
  const res = await runJob(win, fastInstr(), JOB(), { emit }).promise;
  assert.equal(res.ok, true);
  assert.equal(ev.find((e) => e.step === 'attach').detail.strategy, 'paste');
  assert.equal(win.__received[0].files.length, 1);
});

test('pause holds chunks and the final result; resume flushes the latest snapshot', async () => {
  const win = await mockChat('?speed=10&tokens=30');
  const { ev, emit } = collect();
  const job = runJob(win, fastInstr(), JOB(), { emit });
  while (!ev.some((e) => e.kind === 'chunk')) await sleep(10);
  job.pause();
  const n = ev.filter((e) => e.kind === 'chunk').length;
  await sleep(1500); // stream finishes while paused
  assert.equal(ev.filter((e) => e.kind === 'chunk').length, n, 'no chunks while paused');
  assert.equal(ev.some((e) => e.kind === 'done'), false, 'done held while paused');
  job.resume();
  const done = ev.find((e) => e.kind === 'done');
  assert.ok(done, 'done flushed on resume'); assert.match(done.text, /word29/);
  assert.equal(ev.filter((e) => e.kind === 'done').length, 1);
});

test('stop clicks the page stop button and ends as stopped with the partial text', async () => {
  const win = await mockChat('?speed=20&tokens=200');
  const { ev, emit } = collect();
  const job = runJob(win, fastInstr(), JOB(), { emit });
  while (!ev.some((e) => e.kind === 'chunk' && e.text.length > 15)) await sleep(10);
  assert.equal(job.stop(), true);
  const res = await job.promise;
  assert.equal(res.status, 'stopped');
  const done = ev.find((e) => e.kind === 'done');
  assert.equal(done.status, 'stopped'); assert.ok(done.text.length > 5 && !/word199/.test(done.text));
  await sleep(300);
  assert.equal(win.document.querySelector("[data-testid='stop-button']"), null);
});

test('login wall -> not_logged_in; rate limit banner -> rate_limited; nothing sent in the first case', async () => {
  const w1 = await mockChat('?loggedout=1');
  const a = collect();
  const r1 = await runJob(w1, fastInstr(), JOB(), { emit: a.emit }).promise;
  assert.deepEqual([r1.ok, r1.code], [false, 'not_logged_in']);
  assert.equal(a.ev.find((e) => e.kind === 'error').sent, false);
  const w2 = await mockChat('?fail=ratelimit&speed=5');
  const b = collect();
  const r2 = await runJob(w2, fastInstr(), JOB(), { emit: b.emit }).promise;
  assert.equal(r2.code, 'rate_limited'); assert.equal(b.ev.find((e) => e.kind === 'error').sent, true);
});

test('changed UI (?v=2): bundled selectors reach the send step via fallbacks but the reply is not found -> no_reply, sent=true', async () => {
  const win = await mockChat('?v=2&speed=5');
  const { ev, emit } = collect();
  const i = fastInstr(); i.stream.startTimeoutMs = 1000;
  const res = await runJob(win, i, JOB(), { emit }).promise;
  assert.deepEqual([res.ok, res.code], [false, 'no_reply']);
  assert.equal(ev.find((e) => e.kind === 'error').sent, true);
  assert.ok(ev.find((e) => e.step === 'prompt').detail.selectorIndex > 0, 'prompt found through a fallback selector');
});

test('changed UI fixed by NEW instructions only (no code change): ?v=2 passes with an updated reply selector', async () => {
  const win = await mockChat('?v=2&speed=5&tokens=12');
  const { ev, emit } = collect();
  const i = fastInstr();
  i.steps.assistantMessage.selectors.unshift("[data-role='assistant']"); i.steps.assistantMessage.textSelectors.unshift('.prose');
  const res = await runJob(win, i, JOB(), { emit }).promise;
  assert.equal(res.ok, true); assert.equal(ev.find((e) => e.kind === 'done').status, 'complete');
});

test('abort() before send ends quietly; selectors missing -> StepError codes', async () => {
  const win = await mockChat('?speed=5');
  const i = fastInstr(); i.steps.prompt.selectors = ['#nope']; i.steps.prompt.timeoutMs = 50;
  const { ev, emit } = collect();
  const r = await runJob(win, i, JOB(), { emit }).promise;
  assert.deepEqual([r.step, r.code], ['prompt', 'selector_not_found']);
  assert.equal(ev.find((e) => e.kind === 'error').sent, false);
});

test('openFile clicks the original link element', async () => {
  const win = await mockChat('?speed=5&tokens=10');
  const { ev, emit } = collect();
  const job = runJob(win, fastInstr(), JOB(), { emit });
  await job.promise;
  const f = ev.find((e) => e.kind === 'done').files.find((x) => x.name === 'result.html');
  assert.equal(job.openFile(f.id), true);
  assert.deepEqual(win.__events, ['sandbox-click']);
});

test('stop before anything was sent cancels cleanly: done/stopped with nothingSent, chat untouched', async () => {
  const win = await mockChat('?speed=5');
  const { ev, emit } = collect();
  const job = runJob(win, fastInstr(), JOB(), { emit });
  assert.equal(job.stop(), true);
  const res = await job.promise;
  assert.equal(res.status, 'stopped');
  await sleep(700);
  const done = ev.filter((e) => e.kind === 'done');
  assert.equal(done.length, 1); assert.equal(done[0].nothingSent, true);
  assert.equal(win.__received.length, 0);
});
