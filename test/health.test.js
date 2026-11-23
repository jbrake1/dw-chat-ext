const test = require('node:test'), assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { run, load } = require('../harness/health-check.js');
const { bundled } = require('./helpers.js');
const snap = (n) => load(path.join(__dirname, '../harness/snapshots', n));
const all = (v) => ({ idle: snap(`mock-idle${v}.html`), typing: snap(`mock-typing${v}.html`), streaming: snap(`mock-streaming${v}.html`), replied: snap(`mock-replied${v}.html`) });

test('selector-only health check passes on the mock ChatGPT snapshots (the mock models the OLD layout, so the legacy fallbacks carry it)', () => {
  const r = run(bundled(), all(''), { expectFiles: true });
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.ok(r.staleFallbacks.includes('assistantMessage'), 'real-page primaries are not the mock page selectors');
});

test('health check detects a redesign: reply selector fails and stale primaries are listed', () => {
  const r = run(bundled(), all('-v2'), {});
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name === 'assistantMessage' && !c.ok));
  assert.ok(r.staleFallbacks.includes('prompt') && r.staleFallbacks.includes('send'));
});

test('an updated instructions file makes the v2 snapshots healthy again (the daily fix needs no extension release)', () => {
  const i = bundled();
  i.steps.assistantMessage.selectors.unshift("[data-role='assistant']"); i.steps.assistantMessage.textSelectors.unshift('.prose');
  assert.equal(run(i, all('-v2'), {}).ok, true);
});

// Scrubbed snapshots (no text, no ids, no sidebar) of the REAL signed-in chatgpt.com, captured 2026-11-22.
// The public export does not ship those snapshot files; skip when they are absent.
const live = (n) => snap(`chatgpt-live-${n}.html`);
const hasLive = fs.existsSync(path.join(__dirname, '../harness/snapshots', 'chatgpt-live-idle.html'));
const liveTest = hasLive ? test : test.skip;
liveTest('LIVE snapshots (real signed-in chatgpt.com, 2026-11-22): every primary selector matches, no fallback needed', () => {
  const r = run(bundled(), { idle: live('idle'), typing: live('typing'), streaming: live('streaming'), replied: live('replied') }, {});
  assert.equal(r.ok, true, JSON.stringify(r.checks.filter((c) => !c.ok)));
  assert.deepEqual(r.staleFallbacks, []);
});
liveTest('LIVE snapshots: code reply and a stopped (cancelled) reply are also healthy', () => {
  for (const n of ['replied-code', 'stopped']) {
    const r = run(bundled(), { idle: live('idle'), replied: live(n) }, {});
    assert.equal(r.ok, true, n + ' ' + JSON.stringify(r.checks.filter((c) => !c.ok)));
  }
});
liveTest('LIVE snapshots: the pre-verification (revision 1) assistant selector would have failed on the real page', () => {
  const i = bundled();
  i.steps.assistantMessage.selectors = ["[data-message-author-role='assistant']", "article[data-testid^='conversation-turn'] [data-message-author-role='assistant']"];
  assert.equal(run(i, { idle: live('idle'), replied: live('replied') }, {}).ok, false);
});
