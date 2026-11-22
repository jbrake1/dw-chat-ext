const test = require('node:test'), assert = require('node:assert');
const path = require('path');
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
