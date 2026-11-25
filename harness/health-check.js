#!/usr/bin/env node
/* Selector-only health check: no extension, no browser, no network. Runs the instructions' selectors against SAVED HTML
 * snapshots of the chat page and prints per-step pass/fail JSON. Cheap enough to run on every commit or hourly.
 *
 *   node harness/health-check.js [--instructions extension/instructions/chatgpt.json]
 *        --idle idle.html [--typing typing.html] [--streaming streaming.html] [--replied replied.html] [--expect-files]
 *
 * Snapshot states:  idle = empty composer; typing = text (and attachment) in the composer, send button visible;
 *                   streaming = while the reply is being generated; replied = finished reply (with files/links if any).
 * Each check reports the index of the selector entry that matched (0 = primary; >0 = a fallback was needed, which
 * means the primary is stale: update the instructions file). Capture real snapshots with harness/save-snapshot.js. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const I = require('../extension/lib/interpreter.js');

function load(file) {
  const d = new JSDOM(fs.readFileSync(file, 'utf8'), { url: 'https://chatgpt.com/' });
  return d.window;
}
function run(instr, snaps, opts = {}) {
  const out = [];
  const add = (state, name, selectors, extra = {}) => {
    const win = snaps[state];
    if (!win) return;
    const r = I.resolveAll(win.document, selectors);
    out.push(Object.assign({ state, name, ok: r.els.length > 0, selectorIndex: r.index, matches: r.els.length, usedFallback: r.index > 0, selectors: selectors.length }, extra));
  };
  const absent = (state, name, selectors) => {
    const win = snaps[state]; if (!win) return;
    const r = I.resolveAll(win.document, selectors);
    out.push({ state, name, ok: r.els.length === 0, matches: r.els.length, expect: 'absent' });
  };
  const s = instr.steps;
  add('idle', 'prompt', s.prompt.selectors);
  // v0.1.6: a site whose file input only appears once its upload menu is opened (menuFileInput) is checked by its menu button.
  const menu = s.attach.strategies.find((x) => x.type === 'menuFileInput');
  const fi = (s.attach.strategies.find((x) => x.type === 'fileInput') || {}).selectors;
  if (menu) add('idle', 'attach.menu', menu.openSelectors);
  else if (fi) add('idle', 'attach.fileInput', fi);
  if (s.loggedOut) absent('idle', 'loggedOut_not_shown', s.loggedOut.selectors);
  add('typing', 'send', s.send.selectors, { note: 'send button must exist once text is typed' });
  if (s.attach.confirm) add('typing', 'attach.confirm', s.attach.confirm.selectors);
  add('streaming', 'stop', s.stop.selectors);
  absent('replied', 'stop_gone_when_done', s.stop.selectors);
  add('replied', 'assistantMessage', s.assistantMessage.selectors);
  if (snaps.replied) {
    const msgs = I.resolveAll(snaps.replied.document, s.assistantMessage.selectors).els;
    const last = msgs[msgs.length - 1];
    if (last && s.assistantMessage.textSelectors) {
      const r = I.resolveAll(last, s.assistantMessage.textSelectors);
      out.push({ state: 'replied', name: 'assistantMessage.text', ok: r.els.length > 0, selectorIndex: r.index, usedFallback: r.index > 0 });
    }
    if (last && s.files) {
      const files = I.readFiles(snaps.replied, last, s.files, null);
      out.push({ state: 'replied', name: 'files', ok: opts.expectFiles ? files.length > 0 : true, informational: !opts.expectFiles, found: files.length });
    }
  }
  const required = out.filter((c) => !c.informational);
  return { ok: required.length > 0 && required.every((c) => c.ok), instructionsVersion: instr.version, revision: instr.revision, verified: !!instr.verified, staleFallbacks: out.filter((c) => c.ok && c.usedFallback).map((c) => c.name), checks: out };
}
module.exports = { run, load };

if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf('--' + n); return i < 0 ? null : a[i + 1]; };
  const instr = JSON.parse(fs.readFileSync(get('instructions') || path.join(__dirname, '../extension/instructions/chatgpt.json'), 'utf8'));
  const snaps = {};
  for (const st of ['idle', 'typing', 'streaming', 'replied']) if (get(st)) snaps[st] = load(get(st));
  if (!Object.keys(snaps).length) { console.error('give at least --idle snapshot.html'); process.exit(2); }
  const res = run(instr, snaps, { expectFiles: a.includes('--expect-files') });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : 1);
}
