#!/usr/bin/env node
/* Runs all mock scenarios (or the ones named on the command line) against the unpacked TEST BUILD in Chromium.
 * Usage: node harness/e2e.js [scenario ...]   Output: one JSON document, exit code 1 if anything failed. */
const path = require('path'), cp = require('child_process');
const { scenarios, makeEnv } = require('./scenarios');
cp.execFileSync('node', [path.join(__dirname, '../scripts/build-test.js')], { stdio: 'ignore' });
const extDir = path.join(__dirname, '../.build/test-ext');
(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
  const results = [];
  for (const name of names) {
    const t0 = Date.now(); let steps, error = null;
    const env = await makeEnv({ extDir });
    try { steps = await scenarios[name](env); } catch (e) {
      error = e.message; steps = [];
      if (env.dwPage) { const t = await env.dwPage.evaluate(() => { const r = document.getElementById('dw-ext-root'); return r ? r.shadowRoot.querySelector('.wrap').innerText : '(no panel)'; }).catch(() => '?'); process.stderr.write('--- panel at failure ---\n' + t + '\n'); }
    }
    await env.close();
    results.push({ scenario: name, ok: !error && steps.every((s) => s.ok || s.informational), ms: Date.now() - t0, error, steps });
    process.stderr.write(`${results.at(-1).ok ? 'PASS' : 'FAIL'} ${name} (${results.at(-1).ms} ms)${error ? ' ERROR ' + error : ''}\n`);
    if (!results.at(-1).ok) for (const s of steps.filter((x) => !x.ok && !x.informational)) process.stderr.write(`   x ${s.name} ${JSON.stringify(s.detail)}\n`);
  }
  const ok = results.every((r) => r.ok);
  console.log(JSON.stringify({ ok, ts: new Date().toISOString(), scenarios: results }, null, 2));
  process.exit(ok ? 0 : 1);
})();
