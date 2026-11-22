#!/usr/bin/env node
/* Daily health check: loads the unpacked extension in Chromium and runs one fixed sample request through the whole relay,
 * printing per-step pass/fail JSON (exit code 1 on any failure).
 *
 *   node harness/run-daily.js                      mock ChatGPT (deterministic; checks the code + bundled JSON)
 *   node harness/run-daily.js --mode live          REAL chatgpt.com in the persistent test profile (sign in once with `npm run login`)
 *
 * Options (live): --profile DIR            default ~/.dw-chat-ext-test-profile
 *                 --instructions prod|bundled   prod (default) = fetch the published file from app.dwalliance.com like customers' browsers do;
 *                                                bundled = ignore the server
 *                 --chat-url URL           default https://chatgpt.com/?temporary-chat=true
 *                 live always runs headed (chatgpt.com tends to block headless); on a server use: xvfb-run -a node harness/run-daily.js --mode live
 *                 --yes-send               required: confirms one real test message is sent to chatgpt.com from the test profile
 *                 --headed                 (mock mode) show the browser
 *                 --send-reports           allow the extension's anonymous error report (off during tests by default)
 * Writes harness/results/<timestamp>.json as well as stdout. Never automates login; does not create schedules. */
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const { scenarios, makeEnv } = require('./scenarios');
const args = process.argv.slice(2);

const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const mode = opt('mode', 'mock');
cp.execFileSync('node', [path.join(__dirname, '../scripts/build-test.js')], { stdio: 'ignore', env: Object.assign({}, process.env, mode === 'live' ? { DW_LIVE: '1' } : {}) });
const extDir = path.join(__dirname, '../.build/test-ext');

(async () => {
  const live = mode === 'live';
  const profileDir = live ? opt('profile', path.join(os.homedir(), '.dw-chat-ext-test-profile')) : undefined;
  if (live && !fs.existsSync(path.join(profileDir, '.dw-test-profile'))) { console.error(`No test profile at ${profileDir} (marker .dw-test-profile missing). Run once: npm run login  (sign in to a dedicated TEST ChatGPT account by hand).`); process.exit(2); }
  if (live && !opt('yes-send', false)) { console.error('Live mode sends one real message ("reply with OK" plus a sample screenshot) to chatgpt.com from that profile. Re-run with --yes-send to confirm.'); process.exit(2); }
  const dwBase = live && opt('instructions', 'prod') === 'prod' ? 'https://app.dwalliance.com' : undefined;
  const env = await makeEnv({ extDir, headless: live ? false : !opt('headed', false), profileDir, live, liveChatUrl: opt('chat-url', 'https://chatgpt.com/?temporary-chat=true'), dwBase, reports: !live || !!opt('send-reports', false) });
  let steps = [], error = null;
  try {
    if (dwBase) await env.sw.evaluate(() => self.__dw.refreshInstructions('daily-harness'));
    steps = await scenarios[live ? 'live' : (opt('scenario', 'basic'))](env);
  } catch (e) { error = e.message; }
  const instr = await env.sw.evaluate(() => self.__dw.getInstructions('chatgpt')).catch(() => null);
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
  await env.close();
  const ok = !error && steps.length > 0 && steps.every((s) => s.ok || s.informational);
  const result = { ok, mode, ts: new Date().toISOString(), extVersion: manifest.version, instructions: instr && { source: instr.source, version: instr.instr.version, revision: instr.instr.revision, verified: !!instr.instr.verified }, error, steps };
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'results', result.ts.replace(/[:.]/g, '-') + '.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
})();
