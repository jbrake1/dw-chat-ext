const EXT_VER = require('../extension/manifest.json').version;
/* End-to-end scenarios. Each takes an env (mock servers + Chromium with the unpacked TEST BUILD loaded) and returns
 * [{name, ok, detail}] step results. Mock scenarios run against mock/chatgpt.html (streaming) and mock/dw-editor.html. */
const fs = require('fs'), path = require('path');
const L = require('./lib');
const { startMock } = require('../mock/server');
const { root } = L;
const FIXTURE_SIZE = fs.statSync(path.join(root, 'harness/fixtures/sample-screenshot.jpg')).size;
const NOTE = 'Change the headline to "Family owned since 1998"';

async function makeEnv({ extDir, headless = true, profileDir, live = false, liveChatUrl, dwBase, instructionsUrl, reports = true }) {
  const mock = await startMock();
  const { ctx, sw, dir } = await L.launch({ profileDir, extDir, headless, direct: live });
  const base = dwBase || mock.dwUrl;
  const dev = { dwBase: base };
  // The shipped config carries the production pass key; the mock signs no passes (scenarios that test signing set
  // their own key). Without this, every mock scenario stays inactive.
  if (!live && !dwBase) dev.passPublicKeyJwk = null;
  if (!live) { dev.devTabMatches = { gemini: ['http://127.0.0.2/*'], chatgpt: ['http://127.0.0.1/*'] }; dev.devNewChatUrls = { gemini: mock.gemUrl + '/app?speed=15&tokens=14' }; }
  // Mock/tests fetch patterns from the mock host. A live run keeps the shipped
  // https://dwalliance.com/editor-ai/patterns/{site}.json unless an override is passed.
  if (instructionsUrl) dev.instructionsUrl = instructionsUrl;
  else if (!live) dev.instructionsUrl = base.replace(/\/$/, '') + '/editor-ai/patterns/{site}.json';
  await L.setDev(sw, dev);
  // SW install may have already fetched the production patterns URL (live, rev 2)
  // before setDev pointed it at the mock. Wait out that refresh, then drop the cache
  // so later scenario refreshes are not 304/unchanged against the live file.
  await sw.evaluate(async () => {
    try { if (self.__dw && self.__dw.refreshInstructions) await self.__dw.refreshInstructions('dev-repoint'); } catch (e) {}
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('instr:') || k.startsWith('instrStatus:'));
    if (keys.length) await chrome.storage.local.remove(keys);
  });
  if (!reports) await sw.evaluate(() => chrome.storage.local.set({ reportsEnabled: false }));
  const env = { mock, ctx, sw, dir, dwUrl: mock.dwUrl, gptUrl: live ? liveChatUrl : mock.gptUrl, live, extDir };
  env.close = async () => { await ctx.close().catch(() => {}); await mock.close(); };
  env.login = () => ctx.request.get(mock.dwUrl + '/__login');
  env.logout = () => ctx.request.get(mock.dwUrl + '/__logout');
  env.openGpt = async (query = '') => {
    const p = await ctx.newPage(); await p.goto(live ? liveChatUrl : mock.gptUrl + '/' + query);
    env.gptPage = p; return p;
  };
  env.openDw = async (query = '') => {
    const p = await ctx.newPage(); await p.goto(mock.dwUrl + '/' + query); env.dwPage = p; return p;
  };
  env.gptPattern = live ? 'https://chatgpt.com/*' : 'http://127.0.0.1/*';
  return env;
}

async function lastAssistantText(env) {
  // same lookup the extension does: last assistant message, then the first matching text selector inside it
  const instr = (await env.sw.evaluate(() => self.__dw.getInstructions('chatgpt'))).instr;
  const css = (l) => l.map((s) => (typeof s === 'string' ? s : s.css));
  return env.gptPage.evaluate(({ msg, txt }) => {
    for (const s of msg) { const m = document.querySelectorAll(s); if (!m.length) continue; const last = m[m.length - 1];
      for (const t of txt) { const e = last.querySelector(t); if (e) return e.innerText || e.textContent; }
      return last.innerText || last.textContent; }
    return null;
  }, { msg: css(instr.steps.assistantMessage.selectors), txt: css(instr.steps.assistantMessage.textSelectors || []) });
}

// One full request through the DW editor. Returns after done/error is visible in the panel.
async function sendAndWait(env, c, o = {}) {
  const dw = env.dwPage;
  await dw.waitForSelector('#dw-ext-root, #dw-ext-feed', { state: 'attached', timeout: 15000 });
  await L.installRecorder(dw);
  await L.submitEdit(dw, o.note || NOTE);
  const reply = dw.locator('[data-role=reply]');
  const outcome = await L.waitFor(async () => {
    const done = await reply.getAttribute('data-done', { timeout: 500 }).catch(() => null);
    if (done) return { done };
    const err = await dw.locator('[data-role=error]').last().textContent({ timeout: 300 }).catch(() => null);
    if (err) return { error: err };
    return null;
  }, o.timeout || 40000, 'reply done or error');
  return outcome;
}

const scenarios = {};

scenarios.basic = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.openGpt('?speed=25&tokens=35');
  const pr = await L.pair(env.sw, env.gptPattern);
  c.check('paired_chat_tab', pr.ok, pr.code || null);
  const dw = await env.openDw();
  await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
  const dwTab = await L.tabIdFor(env.sw, 'http://localhost/*');
  c.check('icon_green_on_editor_tab', (await L.iconLog(env.sw))[dwTab] === 'green');
  const gptTab = await L.tabIdFor(env.sw, env.gptPattern);
  c.check('icon_not_green_elsewhere', (await L.iconLog(env.sw))[gptTab] !== 'green');
  // panel docks above the editor's note box
  await dw.locator('button.fab').click();
  await dw.locator('textarea#dw-mk-note').waitFor();
  const geo = await dw.evaluate(() => {
    const p = document.getElementById('dw-ext-root').shadowRoot.querySelector('.wrap').getBoundingClientRect();
    const n = document.getElementById('dw-markup-root').shadowRoot.querySelector('.notebox').getBoundingClientRect();
    return { panelBottom: p.bottom, noteTop: n.top, panelRight: p.right, noteRight: n.right };
  });
  c.check('panel_docked_above_note_box', geo.panelBottom <= geo.noteTop + 0.5 && Math.abs(geo.panelRight - geo.noteRight) < 2, geo);
  c.check('panel_excluded_from_screenshot', await dw.evaluate(() => document.getElementById('dw-ext-root').getAttribute('data-html2canvas-ignore') === 'true'));
  await dw.reload(); // start clean for the real run (also proves re-activation after reload)
  const out = await sendAndWait(env, c);
  c.check('done_detected', out.done === 'complete', out);
  const steps = await L.panelSteps(dw);
  const ok = (n) => steps.some((s) => s.step === n && s.ok);
  c.check('prompt_found', ok('prompt'), steps.find((s) => s.step === 'prompt'));
  c.check('text_entered', ok('text'), steps.find((s) => s.step === 'text'));
  c.check('file_attached', ok('attach'), steps.find((s) => s.step === 'attach'));
  c.check('sent', ok('send'));
  c.check('stream_observed', ok('stream'));
  const snaps = await dw.evaluate(() => window.__snaps);
  c.check('relayed_live_in_several_snapshots', snaps.length >= 3 && snaps.every((s, i) => i === 0 || s.length >= snaps[i - 1].length), { snapshots: snaps.length });
  const final = await L.panelText(dw, 'reply');
  const chat = await lastAssistantText(env);
  c.check('reply_relayed_matches_chat', final && chat && final.replace(/\s+/g, ' ').trim() === chat.replace(/\s+/g, ' ').trim().slice(0, final.length) && final.length > 20, { relayedChars: final && final.length });
  const files = await dw.locator('[data-role=files] > *').allTextContents();
  c.check('files_and_links_relayed', files.length === 3 && /result\.html/.test(files[0]) && /notes\.txt/.test(files[1]) && /docs/.test(files[2]), files);
  const hrefs = await dw.locator('[data-role=files] a').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
  c.check('only_https_anchors_rendered', hrefs.every((h) => /^https:/.test(h)) && hrefs.length === 2, hrefs);
  const rec = await env.gptPage.evaluate(() => window.__received);
  c.check('chat_received_prompt_and_screenshot', rec.length === 1 && /Family owned since 1998/.test(rec[0].text) && rec[0].files.length === 1 && rec[0].files[0].size === FIXTURE_SIZE && rec[0].files[0].name === 'markup.jpg', rec[0] && { chars: rec[0].text.length, files: rec[0].files });
  const st = await L.mockApi(env.dwUrl, '/__state');
  c.check('dw_server_still_got_its_own_markup_post', st.markup.length === 1 && st.markup[0].hasHeader);
  c.check('no_error_reports_on_success', st.reports.length === 0, st.reports);
  return c.steps;
};

scenarios['paste-fallback'] = async (env) => {
  const c = new L.Checks();
  await env.login(); await env.openGpt('?speed=10&tokens=12&fileinput=0'); await L.pair(env.sw, env.gptPattern);
  await env.openDw();
  const out = await sendAndWait(env, c);
  c.check('done', out.done === 'complete', out);
  const att = (await L.panelSteps(env.dwPage)).find((s) => s.step === 'attach');
  c.check('attached_via_paste_fallback', att && att.ok && /paste/.test(att.text), att);
  const rec = await env.gptPage.evaluate(() => window.__received);
  c.check('chat_got_file', rec.length === 1 && rec[0].files.length === 1);
  return c.steps;
};

scenarios['no-session'] = async (env) => {
  const c = new L.Checks();
  await env.openGpt('?speed=10'); await L.pair(env.sw, env.gptPattern);
  // 1. anonymous visitor on a normal page: the extension adds no requests at all
  let dw = await env.openDw();
  await L.sleep(1500);
  let st = await L.mockApi(env.dwUrl, '/__state');
  c.check('anonymous_visit_no_whoami_or_pass_from_extension', st.whoamiCalls === 1 && st.passCalls === 0, { whoami: st.whoamiCalls, pass: st.passCalls });
  c.check('anonymous_no_panel', (await dw.locator('#dw-ext-root').count()) === 0);
  // 2. #suggest-edit but not signed in: whoami says no -> no pass requested
  await L.mockApi(env.dwUrl, '/__reset');
  await dw.goto(env.dwUrl + '/#suggest-edit'); await dw.reload(); await L.sleep(1500);
  st = await L.mockApi(env.dwUrl, '/__state');
  c.check('not_signed_in_no_pass_requested', st.passCalls === 0 && st.whoamiCalls >= 2, { whoami: st.whoamiCalls, pass: st.passCalls });
  const dwTab = await L.tabIdFor(env.sw, 'http://localhost/*');
  c.check('icon_stays_grey', (await L.iconLog(env.sw))[dwTab] !== 'green');
  // 3. signed in as editor but the server refuses a pass: inactive, and a submit relays nothing
  await env.login();
  await L.mockApi(env.dwUrl, '/__set', { passBehavior: 'deny' });
  await dw.goto(env.dwUrl + '/'); await dw.reload();
  await dw.locator('button.fab').click(); await dw.locator('textarea#dw-mk-note').fill(NOTE); await dw.locator('button[data-act=send]').click();
  await L.sleep(2000);
  c.check('pass_denied_no_panel', (await dw.locator('#dw-ext-root').count()) === 0);
  c.check('pass_denied_icon_grey', (await L.iconLog(env.sw))[await L.tabIdFor(env.sw, 'http://localhost/*')] !== 'green');
  c.check('pass_denied_chat_tab_untouched', (await env.gptPage.evaluate(() => window.__received)).length === 0 && (await env.gptPage.locator('#prompt-textarea').textContent()).trim() === '');
  st = await L.mockApi(env.dwUrl, '/__state');
  c.check('pass_denied_dw_post_still_worked', st.markup.length === 1);
  // 4. pass for another site / already expired
  for (const b of ['wrong_site', 'expired']) {
    await L.mockApi(env.dwUrl, '/__set', { passBehavior: b });
    await dw.goto(env.dwUrl + '/'); await dw.reload(); await L.sleep(1200);
    c.check(`pass_${b}_refused`, (await dw.locator('#dw-ext-root').count()) === 0 && (await env.gptPage.evaluate(() => window.__received)).length === 0);
  }
  return c.steps;
};

scenarios['signed-pass'] = async (env) => {
  const c = new L.Checks();
  const crypto = require('crypto');
  const jwk = env.mock.state.passKeys.publicKey.export({ format: 'jwk' });
  await L.setDev(env.sw, { dwBase: env.dwUrl, instructionsUrl: env.dwUrl + '/editor-ai/patterns/{site}.json', passPublicKeyJwk: jwk });
  await env.login(); await env.openGpt('?speed=5&tokens=10'); await L.pair(env.sw, env.gptPattern);
  await L.mockApi(env.dwUrl, '/__set', { signPass: false });
  await env.openDw(); await L.sleep(1500);
  c.check('unsigned_pass_refused_when_key_configured', (await env.dwPage.locator('#dw-ext-root').count()) === 0);
  await L.mockApi(env.dwUrl, '/__set', { signPass: true });
  await env.dwPage.reload();
  const out = await sendAndWait(env, c);
  c.check('signed_pass_accepted_and_relay_works', out.done === 'complete', out);
  return c.steps;
};

scenarios['native-hook'] = async (env) => {
  const c = new L.Checks();
  await env.login(); await env.openGpt('?speed=10&tokens=15'); await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw('?hook=1');
  const out = await sendAndWait(env, c);
  c.check('done', out.done === 'complete', out);
  c.check('page_hook_used_no_fetch_tap', await dw.evaluate(() => window.__dwExtTap === undefined));
  const ev = await dw.evaluate(() => window.__dwEvents.map((e) => e.type));
  c.check('page_received_ready_step_chunk_done', ['dw-ext-ready', 'dw-ext-step', 'dw-ext-chunk', 'dw-ext-done'].every((t) => ev.includes(t)), [...new Set(ev)]);
  const done = await dw.evaluate(() => window.__dwEvents.find((e) => e.type === 'dw-ext-done'));
  c.check('done_event_has_text_and_files', done && done.status === 'complete' && /^OK\./.test(done.text) && done.files.length === 3);
  const rec = await env.gptPage.evaluate(() => window.__received);
  c.check('relayed_once_not_twice', rec.length === 1, rec.length);
  // page renders its own panel -> extension injects none; mock streaming shows steps and incremental text
  await env.openGpt('?speed=50&tokens=40');
  await L.pair(env.sw, env.gptPattern);
  const dw2 = await env.ctx.newPage(); await dw2.goto(env.dwUrl + '/?hook=1&panel=1'); env.dwPage = dw2; await L.sleep(1500);
  c.check('own_panel_flag_suppresses_fallback_panel', (await dw2.locator('#dw-ext-root').count()) === 0);
  await L.submitEdit(dw2, NOTE);
  await dw2.waitForSelector('#dw-ext-feed', { state: 'attached', timeout: 15000 });
  await L.installRecorder(dw2);
  await L.waitFor(async () => (await dw2.evaluate(() => (window.__snaps || []).length)) >= 2, 20000, 'native feed incremental text');
  const snaps = await dw2.evaluate(() => window.__snaps);
  c.check('native_feed_streams_incremental_text', Array.isArray(snaps) && snaps.length >= 2 && snaps[0].length < snaps[snaps.length - 1].length, { n: snaps && snaps.length, first: snaps && snaps[0] && snaps[0].length, last: snaps && snaps[snaps.length - 1] && snaps[snaps.length - 1].length });
  const steps = await L.panelSteps(dw2);
  const stepText = steps.map((s) => s.text).join(' | ');
  c.check('native_feed_shows_sent_and_reading_steps', /Screenshot sent/.test(stepText) && /ChatGPT is reading/.test(stepText), stepText);
  const hasThumb = await dw2.evaluate(() => {
    const r = document.getElementById('dw-ext-feed') && document.getElementById('dw-ext-feed').shadowRoot;
    const img = r && r.querySelector('[data-role=feed-thumb]');
    return !!(img && img.getAttribute('src'));
  });
  c.check('native_feed_shows_screenshot_thumb', hasThumb);
  const shotDir = require('path').join(__dirname, '../shots');
  require('fs').mkdirSync(shotDir, { recursive: true });
  await L.panelShot(dw2, require('path').join(shotDir, 'mock-feed-mid.png'));
  c.info('screenshot_mock_feed_mid', true, require('path').join(shotDir, 'mock-feed-mid.png'));
  await L.waitFor(async () => {
    const d = await dw2.evaluate(() => {
      const r = document.getElementById('dw-ext-feed') && document.getElementById('dw-ext-feed').shadowRoot;
      const n = r && (r.querySelector('[data-role=reply]') || r.querySelector('[data-role=dw-ext-feed]'));
      return n && n.getAttribute('data-done');
    });
    return d === 'complete' || d === 'stopped';
  }, 20000, 'native feed done');
  await L.panelShot(dw2, require('path').join(shotDir, 'mock-feed-done.png'));
  c.info('screenshot_mock_feed_done', true, require('path').join(shotDir, 'mock-feed-done.png'));
  const reply = await L.panelText(dw2, 'reply');
  c.check('native_feed_shows_reply', !!(reply && reply.length > 8), reply && reply.slice(0, 80));
  await dw2.evaluate(() => window.postMessage({ source: 'dw-edit', type: 'dw-ext-control', action: 'pause' }, location.origin));
  await L.sleep(500);
  c.check('page_can_send_control_events', (await L.swState(env.sw)).paused === true);
  await dw2.evaluate(() => window.postMessage({ source: 'dw-edit', type: 'dw-ext-control', action: 'resume' }, location.origin));
  return c.steps;
};

scenarios.controls = async (env) => {
  const c = new L.Checks();
  await env.login(); await env.openGpt('?speed=40&tokens=60'); await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw();
  await dw.waitForSelector('#dw-ext-root', { state: 'attached' });
  await L.installRecorder(dw);
  await L.submitEdit(dw, NOTE);
  await L.waitFor(async () => (await dw.evaluate(() => window.__snaps.length)) >= 2, 20000, 'streaming');
  // ---- pause
  await dw.locator('button[data-act=pause]').click();
  await L.waitFor(async () => (await L.swState(env.sw)).paused, 5000, 'paused');
  await L.sleep(500);
  const t1 = await L.panelText(dw, 'reply');
  const gptLen1 = await env.gptPage.evaluate(() => document.querySelector('.markdown p').textContent.length);
  await L.sleep(1000);
  const t2 = await L.panelText(dw, 'reply');
  const gptLen2 = await env.gptPage.evaluate(() => document.querySelector('.markdown p').textContent.length);
  c.check('pause_holds_relay_while_chat_keeps_streaming', t1 === t2 && gptLen2 > gptLen1 && gptLen2 > t2.length - 5, { relayed: t2.length, chat: gptLen2 });
  c.check('pause_button_became_resume', (await dw.locator('button[data-act=pause]').textContent()) === 'Resume');
  // submit while paused: queued, nothing sent
  await dw.locator('button.fab').click(); await dw.locator('textarea#dw-mk-note').fill('second request while paused'); await dw.locator('button[data-act=send]').click();
  await L.waitFor(async () => (await dw.locator('[data-role=note]').allTextContents()).some((t) => /Paused\. This will be sent/.test(t)), 8000, 'queued note');
  c.check('submit_while_paused_sends_nothing_new', (await env.gptPage.evaluate(() => window.__received)).length === 1);
  // ---- resume: first reply catches up to done; queued request goes out afterwards
  await dw.locator('button[data-act=pause]').click(); // now "Resume"
  await L.waitFor(async () => (await env.gptPage.evaluate(() => window.__received)).length === 2, 60000, 'queued request sent after resume');
  c.check('resume_flushes_and_sends_queued_request', true);
  await L.waitFor(async () => (await dw.locator('[data-role=reply]').last().getAttribute('data-done').catch(() => null)), 60000, 'second reply done');
  const rec = await env.gptPage.evaluate(() => window.__received);
  c.check('queued_request_text_correct', /second request while paused/.test(rec[1].text));
  // ---- stop
  await env.gptPage.goto(env.gptUrl + '/?speed=40&tokens=400'); await L.pair(env.sw, env.gptPattern);
  await dw.locator('button.fab').click(); await dw.locator('textarea#dw-mk-note').fill('long answer please'); await dw.locator('button[data-act=send]').click();
  await L.waitFor(async () => {
    if (!(await env.gptPage.evaluate(() => window.__received.length === 1))) return false;     // the long request reached the (reloaded) chat page
    const t = await dw.locator('[data-role=reply]').last().textContent({ timeout: 500 }).catch(() => '');
    return /long|Received/.test(t) && t.length > 40;
  }, 30000, 'long stream started');
  await dw.locator('button[data-act=stop]').click();
  await L.waitFor(async () => (await dw.locator('[data-role=reply]').last().getAttribute('data-done').catch(() => null)) === 'stopped', 15000, 'stopped');
  const chatTxt = await env.gptPage.evaluate(() => document.querySelector('.markdown p').textContent);
  c.check('stop_clicked_chat_stop_button', !/word399/.test(chatTxt) && (await env.gptPage.locator("[data-testid='stop-button']").count()) === 0, { chatChars: chatTxt.length });
  c.check('stopped_status_shown', (await dw.locator('[data-role=note]').allTextContents()).some((t) => /Stopped/.test(t)));
  // ---- unpair
  await dw.locator('button[data-act=unpair]').click();
  await L.waitFor(async () => !(await L.swState(env.sw)).pair, 5000, 'unpaired');
  const before = (await env.gptPage.evaluate(() => window.__received)).length;
  await dw.locator('button.fab').click(); await dw.locator('textarea#dw-mk-note').fill('after unpair'); await dw.locator('button[data-act=send]').click();
  await L.waitFor(async () => (await dw.locator('[data-role=error]').allTextContents()).some((t) => /no ChatGPT tab is paired/.test(t)), 10000, 'not paired error');
  c.check('unpair_stops_relay_and_nothing_sent', (await env.gptPage.evaluate(() => window.__received)).length === before);
  const ttl = await dw.locator('[data-role=title]').textContent();
  c.check('panel_shows_no_tab_paired', /no tab paired|waiting for editor pass/.test(ttl), ttl);
  return c.steps;
};

scenarios['ui-change-recovery'] = async (env) => {
  const c = new L.Checks();
  const bundled = JSON.parse(fs.readFileSync(path.join(env.extDir, 'instructions/chatgpt.json'), 'utf8'));
  await env.login(); await env.openGpt('?v=2&speed=8&tokens=14'); await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw();
  // run 1: the chat site "redesigned" (v2); bundled instructions cannot find the reply
  const out1 = await sendAndWait(env, c);
  c.check('redesign_breaks_bundled_instructions_visibly', !!out1.error && /no_reply|Relay problem/.test(out1.error), out1);
  const st1 = await L.mockApi(env.dwUrl, '/__state');
  const rep = st1.reports.find((r) => r.errorCode === 'no_reply');
  const extVer = JSON.parse(fs.readFileSync(path.join(env.extDir, 'manifest.json'), 'utf8')).version;
  c.check('anonymous_report_sent', !!rep && rep.site === 'chatgpt' && rep.step === 'stream' && rep.extVersion === extVer && rep.instructionsVersion === bundled.version && Number.isInteger(rep.ts), rep);
  c.check('report_has_only_the_six_fields_and_no_content', st1.reports.every((r) => Object.keys(r).sort().join() === 'errorCode,extVersion,instructionsVersion,site,step,ts') && !JSON.stringify(st1.reports).includes('Family owned') && !JSON.stringify(st1.reports).includes('localhost'), st1.reports.length);
  // publish fixed instructions on the server: NO extension change, just the JSON
  const fixed = JSON.parse(JSON.stringify(bundled));
  fixed.revision = bundled.revision + 1; fixed.version = '2026.11.22-2'; fixed.verified = false;
  fixed.steps.assistantMessage.selectors.unshift("[data-role='assistant']"); fixed.steps.assistantMessage.textSelectors.unshift('.prose');
  // 1) a tampered file is refused
  const sealed = L.seal(fixed); sealed.steps.send.timeoutMs = 99999; // hash no longer matches
  await L.mockApi(env.dwUrl, '/__set', { instructions: sealed });
  let r = await L.refreshInstr(env.sw);
  c.check('tampered_file_rejected_hash_mismatch', r.chatgpt.status === 'rejected' && r.chatgpt.code === 'hash_mismatch', r.chatgpt);
  // 2) a file that fails the schema is refused
  const broken = JSON.parse(JSON.stringify(fixed)); delete broken.steps.send;
  await L.mockApi(env.dwUrl, '/__set', { instructions: broken });
  r = await L.refreshInstr(env.sw);
  c.check('schema_invalid_file_rejected', r.chatgpt.status === 'rejected' && r.chatgpt.code === 'schema_invalid', r.chatgpt);
  // 3) a file needing a newer extension is refused
  const tooNew = JSON.parse(JSON.stringify(fixed)); tooNew.minExtVersion = '9.0.0';
  await L.mockApi(env.dwUrl, '/__set', { instructions: tooNew });
  r = await L.refreshInstr(env.sw);
  c.check('min_version_file_rejected', r.chatgpt.status === 'rejected' && r.chatgpt.code === 'min_version', r.chatgpt);
  c.check('still_on_bundled_after_rejections', (await env.sw.evaluate(() => self.__dw.getInstructions('chatgpt'))).source === 'bundled');
  // 4) the good, sealed file is accepted
  await L.mockApi(env.dwUrl, '/__set', { instructions: L.seal(fixed) });
  r = await L.refreshInstr(env.sw);
  c.check('good_sealed_file_accepted', r.chatgpt.status === 'updated' && r.chatgpt.revision === bundled.revision + 1, r.chatgpt);
  await env.gptPage.reload();
  await L.pair(env.sw, env.gptPattern);
  await dw.reload();
  const out2 = await sendAndWait(env, c);
  c.check('relay_works_after_update_without_new_extension', out2.done === 'complete', out2);
  const instrStep = (await L.panelSteps(dw)).find((s) => s.step === 'instructions');
  c.check('run_used_remote_instructions', instrStep && /remote/.test(instrStep.text), instrStep);
  const st2 = await L.mockApi(env.dwUrl, '/__state');
  const codes = st2.reports.map((r) => r.step + ':' + r.errorCode);
  c.check('rejections_were_reported', ['instructions:instructions_hash_mismatch', 'instructions:instructions_schema_invalid', 'instructions:instructions_min_version'].every((x) => codes.includes(x)), codes);
  // 5) remote file breaks the prompt step on a healthy page: before anything is sent, the extension retries with the bundled copy
  await env.gptPage.goto(env.gptUrl + '/?speed=8&tokens=10'); await L.pair(env.sw, env.gptPattern);
  const bad = JSON.parse(JSON.stringify(bundled)); bad.revision = bundled.revision + 2; bad.version = '2026.11.23-1';
  bad.steps.prompt.selectors = ['#definitely-not-there']; bad.steps.prompt.timeoutMs = 1000; bad.steps.prompt.selectors.push('.also-missing');
  await L.mockApi(env.dwUrl, '/__set', { instructions: L.seal(bad) });
  r = await L.refreshInstr(env.sw);
  c.check('bad_but_valid_remote_accepted', r.chatgpt.status === 'updated' && r.chatgpt.revision === bundled.revision + 2, r.chatgpt);
  await dw.reload();
  const out3 = await sendAndWait(env, c);
  c.check('auto_retry_with_bundled_instructions_succeeds', out3.done === 'complete', out3);
  const steps3 = await L.panelSteps(dw);
  c.check('retry_visible_in_log', steps3.some((s) => s.step === 'retry_bundled'), steps3.map((s) => s.step));
  const rec = await env.gptPage.evaluate(() => window.__received);
  c.check('sent_exactly_once_despite_retry', rec.length === 1, rec.length);
  const st3 = await L.mockApi(env.dwUrl, '/__state');
  c.check('prompt_failure_reported', st3.reports.some((r) => r.step === 'prompt' && r.errorCode === 'selector_not_found' && r.instructionsVersion === '2026.11.23-1'));
  return c.steps;
};

scenarios.popup = async (env) => {
  const c = new L.Checks();
  await env.openGpt('?speed=5');
  const gptTab = await L.tabIdFor(env.sw, env.gptPattern);
  const id = new URL(env.sw.url()).host;
  const pop = await env.ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup/popup.html?targetTab=${gptTab}`);
  await L.waitFor(async () => (await pop.locator('#ver').textContent()).startsWith('v'), 5000, 'popup state');
  c.check('popup_shows_not_paired', /No chat tab paired/.test(await pop.locator('#pair-status').textContent()));
  c.check('pair_enabled_on_chat_tab', await pop.locator('#pair').isEnabled());
  await pop.locator('#pair').click();
  await L.waitFor(async () => /Paired with/.test(await pop.locator('#pair-status').textContent()), 5000, 'paired text');
  c.check('pair_this_tab_works', (await L.swState(env.sw)).pair.tabId === gptTab);
  c.check('badge_on_paired_tab', (await env.sw.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), gptTab)) === 'AI');
  { const t = await pop.locator('#instr').textContent(); const gl = (t.match(/chatgpt:[^\n]*/) || [''])[0]; c.check('instructions_listed_as_verified_bundled', /chatgpt: .*bundled/.test(gl) && !/\[unverified\]/.test(gl) && /gemini: .*bundled.*\[unverified\]/.test(t), t); }
  await pop.locator('#unpair').click();
  await L.waitFor(async () => /No chat tab paired/.test(await pop.locator('#pair-status').textContent()), 5000, 'unpaired text');
  c.check('unpair_works', (await L.swState(env.sw)).pair === null);
  await pop.locator('#reports').uncheck();
  await L.sleep(300);
  c.check('reports_opt_out_persisted', (await env.sw.evaluate(() => chrome.storage.local.get('reportsEnabled'))).reportsEnabled === false);
  // pairing a tab that is not a supported chat site is refused
  const other = await env.ctx.newPage(); await other.goto(env.dwUrl + '/');
  const refused = await env.sw.evaluate(async () => { const t = (await chrome.tabs.query({ url: 'http://localhost/*' }))[0]; return self.__dw.pairTab(t.id); });
  c.check('pairing_non_chat_tab_refused', refused.ok === false && refused.code === 'unsupported_site', refused);
  return c.steps;
};

scenarios['tab-lifecycle'] = async (env) => {
  const c = new L.Checks();
  await env.login(); await env.openGpt('?speed=5'); await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw(); await dw.waitForSelector('#dw-ext-root', { state: 'attached' });
  const dwTab = await L.tabIdFor(env.sw, 'http://localhost/*');
  c.check('active_before', (await L.iconLog(env.sw))[dwTab] === 'green');
  await env.gptPage.close(); await L.sleep(500);
  c.check('closing_paired_tab_unpairs', (await L.swState(env.sw)).pair === null);
  await dw.waitForSelector('#dw-ext-root [data-act=unpair]:disabled', { state: 'attached', timeout: 5000 }).then(() => c.check('panel_reflects_unpaired', true), () => c.check('panel_reflects_unpaired', false));
  await env.logout();
  await dw.goto('about:blank'); await L.sleep(500);
  c.check('navigating_away_turns_icon_grey', (await L.iconLog(env.sw))[dwTab] === 'grey');
  return c.steps;
};


scenarios['ext-status'] = async (env) => {
  const c = new L.Checks();
  const read = (page) => page.evaluate(() => {
    const h = document.getElementById('dw-markup-root');
    const b = h && h.shadowRoot && h.shadowRoot.querySelector('[data-role=ext-status]');
    if (!b) return null;
    const a = b.querySelector('a');
    return { state: b.getAttribute('data-state'), text: b.querySelector('[data-role=ext-status-text]').textContent, href: a ? a.getAttribute('href') : null, on: b.classList.contains('on') };
  });

  // (a) Suggest an edit open, no extension loaded (separate process: a second
  // chromium.launch in this Playwright process can hang indefinitely).
  process.stderr.write('ext-status: launching bare browser for missing-extension state\n');
  const { execFile } = require('child_process');
  const raw = await new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(__dirname, 'bare-status.js'), env.dwUrl + '/?hook=1&extstatus=1#suggest-edit'], { timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(String(stderr));
      if (err) return reject(new Error('bare-status: ' + err.message));
      resolve(stdout);
    });
  });
  const a = JSON.parse(raw);
  c.check('status_missing_extension', !!(a && a.state === 'missing' && a.text.indexOf('AI/SI Editor extension not installed') === 0 && a.href === 'https://dwalliance.com/editor-ai/index.html#install' && !a.on), a);

  process.stderr.write('ext-status: missing-extension check done\n');
  // (b) extension present, site has not confirmed an editor
  process.stderr.write('ext-status: unconfirmed-editor state\n');
  const pB = await env.ctx.newPage();
  await pB.goto(env.dwUrl + '/?hook=1&extstatus=1#suggest-edit');
  await pB.locator('#dw-markup-root').waitFor({ state: 'attached', timeout: 10000 });
  await L.waitFor(async () => { const s = await read(pB); return s && s.state === 'unconfirmed'; }, 8000, 'unconfirmed status');
  const b = await read(pB);
  c.check('status_installed_unconfirmed_editor', !!(b && b.state === 'unconfirmed' && new RegExp('Installed v' + EXT_VER.replace(/\./g, '\\.')).test(b.text) && /Enable on this site/.test(b.text) && /Sign in as an editor/.test(b.text)), b);
  await pB.close();

  process.stderr.write('ext-status: unconfirmed check done\n');
  // (c) signed in as editor, not paired
  process.stderr.write('ext-status: unpaired state\n');
  await env.login();
  const dw = await env.openDw('?hook=1#suggest-edit');
  await dw.locator('#dw-markup-root').waitFor({ state: 'attached', timeout: 10000 });
  await L.waitFor(async () => { const s = await read(dw); return s && s.state === 'unpaired'; }, 8000, 'unpaired status');
  const mid = await read(dw);
  c.check('status_installed_not_paired', !!(mid && mid.state === 'unpaired' && mid.text === 'Installed v' + EXT_VER + ', not paired: open chatgpt.com and click Pair this tab'), mid);

  process.stderr.write('ext-status: unpaired check done\n');
  // (d) pairing updates the line live; unpairing too
  process.stderr.write('ext-status: pairing\n');
  await env.openGpt('?speed=5');
  const pr = await L.pair(env.sw, env.gptPattern);
  c.check('paired_for_status', pr && pr.ok, pr);
  await L.waitFor(async () => { const s = await read(dw); return s && s.state === 'paired'; }, 8000, 'paired status');
  const d = await read(dw);
  c.check('status_paired_with_chatgpt', !!(d && d.state === 'paired' && d.on && d.text === 'Paired with ChatGPT (v' + EXT_VER + ')'), d);

  process.stderr.write('ext-status: unpairing via panel\n');
  await dw.locator('#dw-ext-root [data-act=unpair]').click();
  await L.waitFor(async () => { const s = await read(dw); return s && s.state === 'unpaired'; }, 8000, 'unpaired after unpair');
  const u = await read(dw);
  c.check('status_updates_live_on_unpair', !!(u && u.state === 'unpaired' && u.text === 'Installed v' + EXT_VER + ', not paired: open chatgpt.com and click Pair this tab'), u);

  const leaked = await dw.evaluate(() => (window.__dwEvents || []).some((m) => m && (m.pairedTitle || m.title || (typeof m.text === 'string' && m.type === 'dw-ext-status'))));
  c.check('status_messages_have_no_tab_title_or_chat_text', leaked === false, leaked);
  return c.steps;
};


// v0.1.6: Gemini. gemini.google.com is served from mock/gemini.html by a Playwright route (no network, real hostname,
// so the real manifest match, provider registry and tab open/reuse logic are exercised). Live selectors are unverified.
const GEM_TABS = 'http://127.0.0.2/*';
scenarios['gemini-autoopen'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  const sp = await env.sw.evaluate(() => self.__dw.setProvider('gemini'));
  c.check('provider_set_to_gemini', sp.ok && sp.provider === 'gemini', sp);
  const dw = await env.openDw();
  await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
  const tabsBefore = (await env.sw.evaluate((p) => chrome.tabs.query({ url: p }), GEM_TABS)).length;
  c.check('no_gemini_tab_yet', tabsBefore === 0, tabsBefore);
  const out = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done_detected', out.done === 'complete', out);
  const gTabs = await env.sw.evaluate((p) => chrome.tabs.query({ url: p }), GEM_TABS);
  c.check('opened_one_gemini_tab_in_background', gTabs.length === 1 && gTabs[0].active === false, gTabs.map((t) => ({ active: t.active })));
  const st = await L.swState(env.sw);
  c.check('paired_with_gemini', st.pair && st.pair.siteId === 'gemini' && st.provider === 'gemini', st.pair && st.pair.siteId);
  const steps = await L.panelSteps(dw);
  c.check('steps_ok', ['newChat', 'prompt', 'text', 'attach', 'send', 'stream'].every((n) => steps.some((s) => s.step === n && s.ok)), steps);
  const final = await L.panelText(dw, 'reply');
  c.check('reply_relayed', /Gemini got your request/.test(final || ''), final && final.slice(0, 80));
  const gp = env.ctx.pages().find((p) => p.url().startsWith(env.mock.gemUrl));
  const rec = gp ? await gp.evaluate(() => ({ received: window.__received, forbidden: window.__forbidden, menu: window.__menuOpened, chooser: window.__chooserCalls || 0 })) : null;
  c.check('gemini_received_prompt_and_screenshot', rec && rec.received.length === 1 && /Family owned since 1998/.test(rec.received[0].text) && rec.received[0].files[0].name === 'markup.jpg', rec && { n: rec.received.length, files: rec.received[0] && rec.received[0].files.map((f) => f.name) });
  c.check('upload_files_item_answered_by_page_hook_in_real_chrome', rec && rec.chooser === 1 && rec.received[0].files.length >= 1, rec && { chooser: rec.chooser });
  c.check('used_plus_menu_never_forbidden_buttons', rec && rec.menu >= 1 && rec.forbidden.length === 0, rec && { menu: rec.menu, forbidden: rec.forbidden });
  const title = await dw.evaluate(() => document.getElementById('dw-ext-root').shadowRoot.querySelector('[data-role=title]').textContent);
  c.check('panel_names_gemini', /Gemini/.test(title), title);
  // second request: the same tab is reused and a New chat is started
  await dw.reload();
  const out2 = await sendAndWait(env, c, { timeout: 60000 });
  c.check('second_done', out2.done === 'complete', out2);
  const gTabs2 = await env.sw.evaluate((p) => chrome.tabs.query({ url: p }), GEM_TABS);
  c.check('reused_same_tab', gTabs2.length === 1 && gTabs2[0].id === gTabs[0].id);
  const rec2 = gp ? await gp.evaluate(() => ({ n: window.__received.length, newChat: window.__newChat, turns: document.querySelectorAll('model-response').length, forbidden: window.__forbidden })) : null;
  c.check('new_chat_clicked_for_second_request', rec2 && rec2.newChat === 1 && rec2.turns === 1 && rec2.forbidden.length === 0, rec2);
  return c.steps;
};
scenarios['provider-switch'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.openGpt('?speed=10&tokens=12'); await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw();
  // the editor panel's picker switches to Gemini (remembered in storage)
  await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
  await dw.evaluate(() => { const s = document.getElementById('dw-ext-root').shadowRoot.querySelector('[data-role=provider]'); s.value = 'gemini'; s.dispatchEvent(new Event('change')); });
  await L.sleep(300);
  const stored = await env.sw.evaluate(() => chrome.storage.local.get('provider'));
  c.check('picker_saved_gemini', stored.provider === 'gemini', stored);
  const out = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done', out.done === 'complete', out);
  const st = await L.swState(env.sw);
  c.check('moved_pair_to_gemini', st.pair && st.pair.siteId === 'gemini');
  const gptRec = await env.gptPage.evaluate(() => window.__received.length);
  c.check('chatgpt_tab_not_used', gptRec === 0, gptRec);
  // and back to ChatGPT: the open ChatGPT tab is reused
  await env.sw.evaluate(() => self.__dw.setProvider('chatgpt'));
  await dw.reload();
  const out2 = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done_chatgpt', out2.done === 'complete', out2);
  c.check('chatgpt_tab_reused', (await env.gptPage.evaluate(() => window.__received.length)) === 1);
  return c.steps;
};

// v0.1.7: diagnostics snapshot (page protocol + popup), relay log, injection into an already-open editor tab.
scenarios.diagnostics = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.openGpt('?speed=25&tokens=20');
  await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw();
  await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
  await dw.evaluate(() => { window.__diag = null; window.addEventListener('message', (e) => { if (e.source === window && e.data && e.data.source === 'dw-ext' && e.data.type === 'dw-ext-diag-result') window.__diag = e.data; }); });
  await dw.evaluate(() => window.postMessage({ v: 1, source: 'dw-edit', type: 'dw-ext-diag' }, location.origin));
  await L.waitFor(async () => !!(await dw.evaluate(() => window.__diag)), 8000, 'diag result');
  const d = await dw.evaluate(() => window.__diag);
  c.check('diag_page_protocol_returns_snapshot', !!(d && d.ok && d.ext && d.ext.extVersion && Array.isArray(d.ext.log) && Array.isArray(d.page) && d.active === true), d && Object.keys(d));
  // a send leaves a trail in the SW ring buffer and the page ring
  await sendAndWait(env, c, { note: 'SECRET-NOTE-TEXT-123' });
  await L.sleep(500);
  const snap = await env.sw.evaluate(() => self.__dw.diagSnapshot());
  const evs = snap.log.map((x) => x.ev);
  c.check('sw_log_records_handshake_to_done', ['submit_in', 'dispatch', 'gpt', 'submit_out'].every((e) => evs.includes(e)), evs.slice(-25));
  c.check('snapshot_has_last_step_and_provider', !!(snap.lastStep && snap.provider), { lastStep: snap.lastStep, provider: snap.provider });
  const all = JSON.stringify(snap) + JSON.stringify(await dw.evaluate(() => sessionStorage.getItem('dwx_relaylog')));
  c.check('snapshots_never_contain_note_text', !/SECRET-NOTE-TEXT-123/.test(all));
  // popup button path
  const id = new URL(env.sw.url()).host;
  const pop = await env.ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  const r = await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'popup:diag' }));
  c.check('popup_diag_ok_for_extension_page', !!(r && r.ok && r.diag && r.diag.extVersion));
  // injection into an already-open editor tab is idempotent (one panel, no duplicate listeners)
  await env.sw.evaluate(() => self.__dw.injectIntoOpenDwTabs('test'));
  await L.sleep(800);
  const n = await dw.evaluate(() => document.querySelectorAll('#dw-ext-root').length);
  const snap2 = await env.sw.evaluate(() => self.__dw.diagSnapshot());
  c.check('inject_into_open_tab_logged_and_idempotent', n === 1 && snap2.log.some((x) => x.ev === 'inject_dw'), { n, evs: snap2.log.map((x) => x.ev).slice(-6) });
  return c.steps;
};


// v0.1.8: redacted AI-page structure snapshot (upload if an editor tab is open, otherwise download).
scenarios.snapshot = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.openGpt('?speed=25&tokens=20');
  await env.gptPage.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'secret-line';
    p.textContent = 'SECRET-CHAT-LINE-XYZ';
    document.body.appendChild(p);
    const i = document.createElement('input');
    i.value = 'secret-input-value';
    document.body.appendChild(i);
  });
  await L.pair(env.sw, env.gptPattern);
  const dw = await env.openDw();
  await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
  const r = await env.sw.evaluate(() => self.__dw.handleSnapshot('test'));
  c.check('snapshot_returns_short_id', !!(r && r.ok && r.id && /^s[0-9a-z]{6,12}$/.test(r.id)), r && { ok: r.ok, via: r.via, id: r.id, code: r.code });
  c.check('snapshot_uploaded_to_editor_endpoint', !!(r && r.via === 'upload'), r && r.via);
  const st = await (await env.ctx.request.get(env.dwUrl + '/__state')).json();
  const snap = (st.snapshots || []).find((x) => x.id === (r && r.id));
  c.check('mock_stored_snapshot_without_chat_text', !!(snap && snap.hasSecret === false && snap.hasQuery === false && snap.selectorCount >= 40), snap || st.snapshots);
  const id = new URL(env.sw.url()).host;
  const pop = await env.ctx.newPage();
  await pop.goto(`chrome-extension://${id}/popup/popup.html`);
  c.check('popup_has_send_page_snapshot', await pop.locator('#snap').count() === 1);
  return c.steps;
};

module.exports = { scenarios, makeEnv, sendAndWait, lastAssistantText, NOTE };

// ---- live: real chatgpt.com in a persistent test profile (user signed in once, never automated) ----
scenarios.live = async (env) => {
  const c = new L.Checks();
  await env.login();
  const gpt = await env.openGpt();
  await gpt.waitForLoadState('domcontentloaded');
  const instr = (await env.sw.evaluate(() => self.__dw.getInstructions('chatgpt')));
  c.info('instructions_in_use', true, { source: instr.source, version: instr.instr.version, revision: instr.instr.revision, verified: !!instr.instr.verified });
  const sels = (step) => instr.instr.steps[step].selectors.map((s) => (typeof s === 'string' ? s : s.css));
  const promptSels = sels('prompt'), outSels = (instr.instr.steps.loggedOut || { selectors: [] }).selectors.filter((s) => typeof s === 'string' || !s.textMatches).map((s) => (typeof s === 'string' ? s : s.css)); // entries with textMatches cannot be evaluated by this plain querySelector probe
  const state = await gpt.waitForFunction(({ p, o }) => (p.some((s) => { try { return document.querySelector(s); } catch (e) { return null; } }) ? 'ready' : (o.some((s) => { try { return document.querySelector(s); } catch (e) { return null; } }) ? 'logged_out' : null)), { p: promptSels, o: outSels }, { timeout: 45000 }).then((h) => h.jsonValue()).catch(() => 'unknown');
  if (!c.check('chatgpt_profile_signed_in_and_composer_visible', state === 'ready', state === 'logged_out' ? 'profile is not signed in: run `npm run login` once' : state)) return c.steps;
  const pr = await L.pair(env.sw, env.gptPattern);
  c.check('paired_chat_tab', pr.ok, pr.code || null);
  const dw = await env.openDw();
  const note = 'AUTOMATED HEALTH CHECK from the DW extension test harness. Reply with the single word OK and nothing else. Ignore the screenshot.';
  const out = await sendAndWait(env, c, { note, timeout: 180000 });
  const steps = await L.panelSteps(dw);
  const ok = (n) => steps.some((s) => s.step === n && s.ok);
  c.check('prompt_found', ok('prompt'), steps.find((s) => s.step === 'prompt'));
  c.check('text_entered', ok('text'), steps.find((s) => s.step === 'text'));
  c.check('file_attached', ok('attach'), steps.find((s) => s.step === 'attach'));
  c.check('sent', ok('send'));
  c.check('stream_observed', ok('stream'));
  c.check('done_detected', out.done === 'complete', out);
  const snaps = await dw.evaluate(() => window.__snaps);
  c.check('reply_relayed_at_least_once', snaps.length >= 1, { snapshots: snaps.length });
  c.info('stream_in_several_snapshots', snaps.length >= 2, { snapshots: snaps.length });
  const final = await L.panelText(dw, 'reply');
  const chat = await lastAssistantText(env);
  c.check('reply_relayed_matches_chat', !!final && !!chat && chat.replace(/\s+/g, ' ').trim().startsWith(final.replace(/\s+/g, ' ').trim()), { relayed: final, chat: chat && chat.slice(0, 80) });
  c.check('reply_contains_expected_word', /\bOK\b/.test(final || ''), final && final.slice(0, 80));
  return c.steps;
};


// v0.1.10: a Gemini reply that is HTML written into ordinary paragraphs is shown as ONE collapsed code block (no raw
// source paragraphs); a real code-block reply is collapsed too.
for (const mode of ['rawdoc', 'rawfrag']) {
  scenarios['gemini-reply-' + mode] = async (env) => {
    const c = new L.Checks();
    await env.login();
    await env.sw.evaluate(async (u) => { const d = (await chrome.storage.local.get('dev')).dev || {}; d.devNewChatUrls = { gemini: u }; await chrome.storage.local.set({ dev: d }); }, env.mock.gemUrl + '/app?speed=15&tokens=14&reply=' + mode);
    await env.sw.evaluate(() => self.__dw.setProvider('gemini'));
    const dw = await env.openDw();
    await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
    const out = await sendAndWait(env, c, { timeout: 60000 });
    c.check('done_detected', out.done === 'complete', out);
    const r = await dw.evaluate(() => {
      const root = document.getElementById('dw-ext-root').shadowRoot, rep = root.querySelector('[data-role=reply]');
      const d = rep.querySelector('details.md-code');
      const paras = Array.from(rep.querySelectorAll('p')).map((p) => p.textContent);
      return { details: rep.querySelectorAll('details.md-code').length, open: d && d.open, summary: d && d.querySelector('summary').textContent, codeHasHtml: d && /<h2 id="install">/.test(d.querySelector('pre').textContent), rawParas: paras.filter((t) => /^<(?:p|div|h\d|!doctype|html|body)/i.test(t)).length, tail: paras[paras.length - 1] };
    });
    c.check('one_collapsed_code_block_with_the_html', r.details === 1 && r.open === false && r.codeHasHtml && /^HTML · \d+ lines/.test(r.summary), r);
    c.check('no_raw_html_paragraphs_and_prose_kept', r.rawParas === 0 && r.tail === 'That is all.', r);
    return c.steps;
  };
}

// v0.1.10: the production home page had a stray unterminated script that swallowed the editor loader, so the editor never
// mounted and only the extension panel showed. mock/home-prod.html is that page as production served it.
scenarios['home-editor-fallback'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  const p = await env.ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
  await p.goto(env.dwUrl + '/home-prod.html');
  await p.waitForFunction(() => !!document.getElementById('dw-markup-root'), null, { timeout: 15000 }).catch(() => {});
  const r = await p.evaluate(() => {
    const mk = document.getElementById('dw-markup-root'), fab = mk && mk.shadowRoot && mk.shadowRoot.querySelector('.fab');
    if (fab) fab.click();
    return { mk: !!mk, fab: !!fab, fallbackTag: !!document.querySelector('script[data-dw-ext-fallback]') };
  });
  c.check('page_still_has_its_own_loader_error', errs.some((e) => /SyntaxError/.test(e)), errs);
  c.check('editor_mounted_by_extension_fallback', r.mk && r.fab && r.fallbackTag, r);
  await L.sleep(1500);
  const o = await p.evaluate(() => { const sr = document.getElementById('dw-markup-root').shadowRoot, ta = sr.querySelector('textarea'); const b = ta && ta.getBoundingClientRect(); return { ta: !!ta, w: b && Math.round(b.width), h: b && Math.round(b.height) }; });
  c.check('note_textarea_visible_after_opening', o.ta && o.w > 100 && o.h > 30, o);
  await p.close();
  return c.steps;
};

module.exports.scenarios = scenarios;
