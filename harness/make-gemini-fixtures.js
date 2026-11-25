#!/usr/bin/env node
/* Writes saved DOM fixtures of the MOCK Gemini page (mock/gemini.html) in each relay state, for the selector-only
 * health check and unit tests: harness/snapshots/gemini-fixture-{idle,typing,streaming,replied,limit,signedout}.html.
 * These model what we believe gemini.google.com looks like; they are NOT captures of the live site. Replace them with
 * scrubbed live captures (harness/save-snapshot.js) once a signed-in Gemini page has been checked. */
const fs = require('fs'), path = require('path');
const { runJob } = require('../extension/lib/runner.js');
const { mockGemini, geminiInstr, sleep } = require('../test/helpers.js');
const out = path.join(__dirname, 'snapshots');
const save = (name, win) => fs.writeFileSync(path.join(out, `gemini-fixture-${name}.html`), '<!doctype html>\n' + win.document.documentElement.outerHTML.replace(/<script>[\s\S]*?<\/script>/g, '') + '\n');
const JOB = { prompt: 'Change the headline', file: { name: 'markup.jpg', type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }, files: [{ name: 'index.html', type: 'text/html', dataUrl: 'data:text/html;base64,PGgxPkhpPC9oMT4=' }] };
function fast() { const i = geminiInstr(); i.stream.done.all[2].ms = 100; i.stream.emitMinIntervalMs = 0; return i; }

(async () => {
  let w = await mockGemini('?speed=30&tokens=12'); save('idle', w);
  // typing: text in, menu opened, files attached (before Send)
  const pr = w.document.querySelector('.ql-editor'); pr.textContent = 'Change the headline'; pr.dispatchEvent(new w.Event('input', { bubbles: true }));
  const dt = new w.DataTransfer(); dt.items.add(new w.File(['x'], 'markup.jpg', { type: 'image/jpeg' }));
  w.document.getElementById('dropzone').dispatchEvent(new w.DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await sleep(350); save('typing', w);
  // streaming + replied
  w = await mockGemini('?speed=40&tokens=20');
  const ev = []; const job = runJob(w, fast(), JOB, { emit: (e) => ev.push(e) });
  while (!ev.some((e) => e.kind === 'chunk')) await sleep(10);
  save('streaming', w);
  await job.promise; save('replied', w);
  w = await mockGemini('?limit=1'); await runJob(w, fast(), JOB, { emit: () => {} }).promise; save('limit', w);
  w = await mockGemini('?signedout=1'); save('signedout', w);
  console.log('wrote gemini fixtures to', out);
})();
