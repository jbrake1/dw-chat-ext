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
  if (!live) { dev.devTabMatches = { gemini: ['http://127.0.0.2/*'], chatgpt: ['http://127.0.0.1/*'], grok: ['http://127.0.0.3/*'], claude: ['http://127.0.0.4/*'] }; dev.devNewChatUrls = { gemini: mock.gemUrl + '/app?speed=15&tokens=14', grok: mock.grokUrl + '/?speed=15&tokens=14', claude: mock.claudeUrl + '/new?speed=15&tokens=14' }; }
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
  await dw.waitForSelector('#dw-ext-root, #dw-ext-feed, #dw-markup-root', { state: 'attached', timeout: 15000 });
  await L.installRecorder(dw);
  // v0.1.11: after a reload the restored reply already has data-done=complete; mark it so a new job (even with the same text) is not mistaken for that restore.
  await dw.evaluate(() => {
    const roots = [document.getElementById('dw-ext-feed'), document.getElementById('dw-ext-root')].map((h) => h && h.shadowRoot).filter(Boolean);
    roots.forEach((root) => { root.querySelectorAll('[data-role=reply]').forEach((r) => r.setAttribute('data-e2e-before', '1')); });
  });
  await L.submitEdit(dw, o.note || NOTE);
  const outcome = await L.waitFor(async () => {
    const cur = await dw.evaluate(() => {
      const roots = [document.getElementById('dw-ext-feed'), document.getElementById('dw-ext-root')].map((h) => h && h.shadowRoot).filter(Boolean);
      for (const root of roots) {
        const err = root.querySelector('[data-role=error]');
        if (err && (err.textContent || '').trim() && !root.querySelector('[data-role=reply][data-e2e-before]')) return { error: err.textContent };
        const r = root.querySelector('[data-role=reply][data-done]:not([data-e2e-before])');
        if (r) return { done: r.getAttribute('data-done') };
      }
      return null;
    });
    if (!cur) return null;
    if (cur.error) return { error: cur.error };
    if (cur.done) return { done: cur.done };
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


// v0.1.11: a reload of the DW page must remount the chat (sessionStorage and/or the extension's last job result).
// Uses /editor.html so the real markup.js feed is on the page (the mock at / does not persist a feed).
scenarios['feed-survives-reload'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.sw.evaluate(async (u) => { const d = (await chrome.storage.local.get('dev')).dev || {}; d.devNewChatUrls = { gemini: u }; await chrome.storage.local.set({ dev: d }); }, env.mock.gemUrl + '/app?speed=15&tokens=14&reply=rawdoc');
  await env.sw.evaluate(() => self.__dw.setProvider('gemini'));
  const dw = await env.ctx.newPage();
  await dw.goto(env.dwUrl + '/editor.html');
  env.dwPage = dw;
  await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
  const out = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done_detected', out.done === 'complete', out);
  const before = await dw.evaluate(() => {
    const feed = document.getElementById('dw-ext-feed');
    const root = feed && feed.shadowRoot;
    const rep = root && root.querySelector('[data-role=reply]');
    return { has: !!rep, done: rep && rep.getAttribute('data-done'), text: rep && (rep.getAttribute('data-plain') || rep.textContent) || '', details: root ? root.querySelectorAll('details.code, details.md-code').length : 0 };
  });
  c.check('reply_visible_before_reload', before.has && before.done === 'complete' && /That is all/.test(before.text), before);
  await dw.reload();
  await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
  const after = await L.waitFor(async () => {
    const x = await dw.evaluate(() => {
      const feed = document.getElementById('dw-ext-feed');
      const root = feed && feed.shadowRoot;
      const rep = root && root.querySelector('[data-role=reply]');
      const note = root && root.querySelector('[data-role=feed-note]');
      return { has: !!rep, done: rep && rep.getAttribute('data-done'), text: rep && (rep.getAttribute('data-plain') || rep.textContent) || '', note: note && note.textContent, details: root ? root.querySelectorAll('details.code, details.md-code').length : 0 };
    });
    return x && x.has && /That is all/.test(x.text) ? x : null;
  }, 20000, 'restored feed reply');
  c.check('reply_restored_after_reload', after && after.has && /That is all/.test(after.text) && after.details >= 1, after);
  // sessionStorage cleared: the extension still has the last result (or can peek the AI tab)
  await dw.evaluate(() => { Object.keys(sessionStorage).forEach((k) => { if (k.indexOf('dw_ext_feed') === 0) sessionStorage.removeItem(k); }); });
  await dw.reload();
  await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
  const again = await L.waitFor(async () => {
    const x = await dw.evaluate(() => {
      const feed = document.getElementById('dw-ext-feed');
      const root = feed && feed.shadowRoot;
      const rep = root && root.querySelector('[data-role=reply]');
      return { has: !!rep, text: rep && (rep.getAttribute('data-plain') || rep.textContent) || '' };
    });
    return x && x.has && /That is all/.test(x.text) ? x : null;
  }, 20000, 'restored feed from extension');
  c.check('reply_restored_from_extension_after_storage_cleared', again && /That is all/.test(again.text), again);
  return c.steps;
};


// v0.1.12: Gemini makes the two hero pictures with code and shows them as download chips. The extension reads the
// chips (one through the page hook catching the chip's own download, one from its link), the editor stages them at
// the paths the page links, nothing is missing so Publish is on, the chime plays, and a follow-up goes into the SAME
// Gemini chat (no New chat).
scenarios['gemini-chips-followup'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.sw.evaluate(async (u) => { const d = (await chrome.storage.local.get('dev')).dev || {}; d.devNewChatUrls = { gemini: u }; await chrome.storage.local.set({ dev: d }); }, env.mock.gemUrl + '/app?speed=15&tokens=14&reply=taro&chips=1');
  await env.sw.evaluate(() => self.__dw.setProvider('gemini'));
  const dw = await env.ctx.newPage();
  await dw.goto(env.dwUrl + '/editor.html');
  env.dwPage = dw;
  await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
  const out = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done_detected', out.done === 'complete', out);
  const staged = await L.waitFor(async () => { const s = env.mock.state.staged.filter((x) => x.action === 'create'); return s.length >= 3 ? s : null; }, 30000, 'three staged files').catch(() => env.mock.state.staged);
  const byName = Object.fromEntries(staged.map((x) => [x.file_name, x]));
  c.check('page_staged', !!byName['editor.html'] && byName['editor.html'].staging === true, staged);
  c.check('webp_from_download_chip_staged_at_linked_path', !!byName['hanalei-taro-1600.webp'] && byName['hanalei-taro-1600.webp'].file_path === 'assets/img' && /^UklGR/.test(byName['hanalei-taro-1600.webp'].data || ''), byName['hanalei-taro-1600.webp']);
  c.check('jpg_from_chip_link_staged_at_linked_path', !!byName['hanalei-taro-1600.jpg'] && byName['hanalei-taro-1600.jpg'].file_path === 'assets/img' && /^\/9j\//.test(byName['hanalei-taro-1600.jpg'].data || ''), byName['hanalei-taro-1600.jpg']);
  const card = await L.waitFor(async () => {
    const x = await dw.evaluate(() => {
      const r = document.getElementById('dw-ext-actions'); const sr = r && r.shadowRoot; const pub = sr && sr.querySelector('[data-state=staged] [data-act=publish]');
      const feed = document.getElementById('dw-ext-feed'); const f = feed && feed.shadowRoot && feed.shadowRoot.querySelector('.feed');
      return pub ? { pub: pub.textContent, disabled: pub.disabled, missing: sr.querySelectorAll('[data-missing]').length, chime: f && f.getAttribute('data-chime'), assetsStep: f ? (f.textContent.match(/Got \d+ files? \w+ made[^)]*\)?/) || [''])[0] : '' } : null;
    });
    return x;
  }, 20000, 'staged card').catch(async () => { const t = await dw.evaluate(() => { const r = document.getElementById('dw-markup-root'); const f = document.getElementById('dw-ext-feed'); return { markup: r && r.shadowRoot ? r.shadowRoot.textContent.slice(-600) : null, feed: f && f.shadowRoot ? f.shadowRoot.textContent.slice(-900) : null }; }); return { timeout: true, t, staged: env.mock.state.staged }; });
  c.check('publish_enabled_nothing_missing', card && !card.disabled && card.missing === 0 && /Publish 3 files/.test(card.pub), card);
  c.check('chime_played_after_staging', card && card.chime === 'ok', card);
  c.check('feed_says_files_were_read', card && /Got 2 files Gemini made/.test(card.assetsStep || ''), card);
  const gem = env.ctx.pages().find((p) => p.url().startsWith(env.mock.gemUrl));
  const g1 = gem ? await gem.evaluate(() => ({ downloads: window.__downloads || 0, n: document.querySelectorAll('model-response').length, url: location.pathname })) : null;
  c.check('chip_download_button_clicked_once_and_caught', g1 && g1.downloads === 1, g1);
  // follow-up in the same chat
  await dw.evaluate(() => { const sr = document.getElementById('dw-ext-feed').shadowRoot; sr.querySelectorAll('[data-role=reply]').forEach((r) => r.setAttribute('data-e2e-before', '1')); const t = sr.querySelector('[data-role=followup-text]'); t.value = 'The second image did not load'; });
  await dw.locator('#dw-ext-feed').evaluate((h) => h.shadowRoot.querySelector('[data-act=followup-send]').click());
  const out2 = await L.waitFor(async () => dw.evaluate(() => { const sr = document.getElementById('dw-ext-feed').shadowRoot; const r = sr.querySelector('[data-role=reply][data-done]:not([data-e2e-before])'); const e = sr.querySelector('[data-role=error]:not([data-old])'); return r ? { done: r.getAttribute('data-done') } : e ? { error: e.textContent } : null; }), 60000, 'follow-up reply').catch((e) => ({ error: String(e) }));
  c.check('followup_reply_done', out2 && out2.done === 'complete', out2);
  const g2 = gem ? await gem.evaluate(() => ({ n: document.querySelectorAll('model-response').length, newChat: window.__newChat || 0, last: (document.querySelectorAll('user-query .query-text')[1] || {}).textContent || '' })) : null;
  c.check('followup_went_into_the_same_chat', g2 && g2.n === 2 && g2.newChat === 0 && /second image did not load/.test(g2.last), g2);
  return c.steps;
};

// v0.1.12: same reply but Gemini shows no chips: the page links two pictures that do not exist, so Publish is blocked
// and both are listed as MISSING.
scenarios['gemini-missing-blocks-publish'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.sw.evaluate(async (u) => { const d = (await chrome.storage.local.get('dev')).dev || {}; d.devNewChatUrls = { gemini: u }; await chrome.storage.local.set({ dev: d }); }, env.mock.gemUrl + '/app?speed=15&tokens=14&reply=taro');
  await env.sw.evaluate(() => self.__dw.setProvider('gemini'));
  const dw = await env.ctx.newPage();
  await dw.goto(env.dwUrl + '/editor.html');
  env.dwPage = dw;
  await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
  const out = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done_detected', out.done === 'complete', out);
  const card = await L.waitFor(async () => dw.evaluate(() => {
    const r = document.getElementById('dw-ext-actions'); const sr = r && r.shadowRoot; const pub = sr && sr.querySelector('[data-state=staged] [data-act=publish]');
    const f = document.getElementById('dw-ext-feed').shadowRoot.querySelector('.feed');
    return pub ? { pub: pub.textContent, disabled: pub.disabled, missing: [...sr.querySelectorAll('[data-missing]')].map((x) => x.textContent), recheck: !!sr.querySelector('[data-act=recheck]'), chime: f.getAttribute('data-chime') } : null;
  }), 20000, 'staged card').catch((e) => ({ error: String(e) }));
  c.check('publish_blocked', card && card.disabled === true && /blocked/i.test(card.pub || ''), card);
  c.check('both_missing_listed', card && Array.isArray(card.missing) && card.missing.length === 2 && card.missing.some((t) => /hanalei-taro-1600\.webp/.test(t)) && card.missing.some((t) => /hanalei-taro-1600\.jpg/.test(t)), card);
  c.check('check_again_offered', card && card.recheck === true, card);
  c.check('error_chime', card && card.chime === 'error', card);
  c.check('only_the_page_was_staged', env.mock.state.staged.filter((x) => x.action === 'create').length === 1, env.mock.state.staged);
  return c.steps;
};

// v0.1.13: "Add 10 min" on the Publish-blocked staged card: the server extends every staged file, the countdown
// follows, repeated presses stop at the 60-minute cap, and the longer countdown survives a reload.
scenarios['staged-extend'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await env.sw.evaluate(async (u) => { const d = (await chrome.storage.local.get('dev')).dev || {}; d.devNewChatUrls = { gemini: u }; await chrome.storage.local.set({ dev: d }); }, env.mock.gemUrl + '/app?speed=15&tokens=14&reply=taro');
  await env.sw.evaluate(() => self.__dw.setProvider('gemini'));
  const dw = await env.ctx.newPage();
  await dw.goto(env.dwUrl + '/editor.html');
  env.dwPage = dw;
  await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
  const out = await sendAndWait(env, c, { timeout: 60000 });
  c.check('done_detected', out.done === 'complete', out);
  const cardInfo = () => dw.evaluate(() => {
    const r = document.getElementById('dw-ext-actions'); const sr = r && r.shadowRoot; const box = sr && sr.querySelector('[data-state=staged]');
    if (!box) return null;
    const cd = box.querySelector('[data-role=dw-ext-countdown]'); const m = /(\d+):(\d\d)/.exec(cd ? cd.textContent : '');
    const ex = box.querySelector('[data-act=extend]');
    return { secs: m ? (+m[1]) * 60 + (+m[2]) : -1, extend: ex ? ex.textContent : null, extendDisabled: ex ? ex.disabled : null, blocked: box.getAttribute('data-blocked') === '1', text: box.textContent.slice(0, 600) };
  });
  const c0 = await L.waitFor(async () => { const x = await cardInfo(); return x && x.secs > 0 ? x : null; }, 20000, 'staged card').catch((e) => ({ error: String(e) }));
  c.check('blocked_card_has_add_10_min', !!c0 && c0.blocked === true && c0.extend === 'Add 10 min', c0);
  c.check('countdown_starts_under_10_min', !!c0 && c0.secs > 500 && c0.secs <= 600, c0 && c0.secs);
  const click = () => dw.evaluate(() => document.getElementById('dw-ext-actions').shadowRoot.querySelector('[data-state=staged] [data-act=extend]').click());
  await click();
  const c1 = await L.waitFor(async () => { const x = await cardInfo(); return x && x.secs > 1100 ? x : null; }, 10000, 'extended').catch((e) => ({ error: String(e) }));
  c.check('countdown_plus_10_min', !!c1 && c1.secs > 1100 && c1.secs <= 1200 && /Added 10 minutes/.test(c1.text), c1 && { secs: c1.secs, text: c1.text });
  const nStaged = env.mock.state.staged.filter((x) => x.action === 'create').length;
  c.check('every_staged_file_extended_on_server', (env.mock.state.extended || []).length === nStaged && nStaged >= 1, { extended: env.mock.state.extended, staged: nStaged });
  c.check('still_blocked_after_extend', !!c1 && c1.blocked === true, c1 && c1.blocked);
  for (let i = 0; i < 6; i++) { await click(); await L.waitFor(async () => { const x = await cardInfo(); return x && x.extend === 'Add 10 min' && !x.extendDisabled ? x : null; }, 10000, 'extend again'); }
  const c2 = await cardInfo();
  c.check('capped_at_60_min', !!c2 && c2.secs > 3500 && c2.secs <= 3600 && /most allowed/.test(c2.text), c2 && { secs: c2.secs, text: c2.text });
  await dw.reload();
  const c3 = await L.waitFor(async () => { const x = await cardInfo(); return x && x.secs > 0 ? x : null; }, 20000, 'card after reload').catch((e) => ({ error: String(e) }));
  c.check('longer_countdown_survives_reload', !!c3 && c3.secs > 3400, c3 && c3.secs);
  return c.steps;
};

// ---------- v0.1.13: editor sessions, several editors, overwrite guard ----------
const shadowEval = (page, fn, arg) => page.evaluate(fn, arg);
const feedInfo = (page) => page.evaluate(() => {
  const h = document.getElementById('dw-ext-feed'); const sr = h && h.shadowRoot; if (!sr) return null;
  const rs = [...sr.querySelectorAll('[data-role=reply]')]; const last = rs[rs.length - 1];
  return { replies: rs.length, done: last ? last.getAttribute('data-done') : null, text: last ? last.textContent : '', users: [...sr.querySelectorAll('[data-role=feed-user]')].map((u) => u.textContent.slice(0, 200)) };
});
const editorInfo = (page) => page.evaluate(() => {
  const h = document.getElementById('dw-markup-root'); const sr = h && h.shadowRoot; if (!sr) return null;
  const ta = sr.querySelector('textarea#dw-mk-note'); const st = sr.querySelector('[data-role=ext-status]');
  return { open: !!ta, note: ta ? ta.value : null, chips: [...sr.querySelectorAll('[data-role=att-chip]')].map((c) => c.getAttribute('data-name')), status: st ? st.getAttribute('data-state') : null, statusText: st ? st.textContent : '' };
});
const sessInfo = (page) => page.evaluate(() => {
  const sid = sessionStorage.getItem('dw_ext_sid'); const keys = [];
  for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
  const draft = sid ? JSON.parse(localStorage.getItem('dw_ext_s:' + sid + ':draft') || 'null') : null;
  return { sid, keys, draft: draft ? { note: draft.note, shapes: (draft.shapes || []).length, att: (draft.att || []).map((a) => ({ name: a.name, kept: !!a.dataUrl })), open: draft.open } : null };
});
async function openEditor(env, url) {
  const p = await env.ctx.newPage();
  await p.goto(url || env.dwUrl + '/editor.html');
  await p.waitForSelector('#dw-markup-root', { state: 'attached', timeout: 15000 });
  await L.sleep(900);
  return p;
}
async function waitReply(page, re, ms) {
  return L.waitFor(async () => { const f = await feedInfo(page); return f && f.done && (!re || re.test(f.text)) ? f : null; }, ms || 40000, 'reply').catch(async (e) => ({ error: String(e), feed: await feedInfo(page) }));
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// Close keeps the note, markup and attached file; reopening restores them; a refresh with the editor open reopens it;
// the chat survives a refresh; New session clears everything and the next Send starts a new AI chat.
scenarios['session-persist'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await setNewChatUrl(env, 'grok', env.mock.grokUrl + '/?speed=15&tokens=14&code=0');
  await env.sw.evaluate(() => self.__dw.setProvider('grok'));
  const dw = await openEditor(env); env.dwPage = dw;
  dw.on('dialog', (d) => d.accept());
  await dw.locator('button.fab').click();
  await dw.locator('textarea#dw-mk-note').fill('Keep my place TOK-A1');
  await dw.locator('input[data-role=attach-input]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  const vp = dw.viewportSize() || { width: 1200, height: 800 };
  await dw.mouse.move(vp.width * 0.3, vp.height * 0.3); await dw.mouse.down(); await dw.mouse.move(vp.width * 0.45, vp.height * 0.4, { steps: 8 }); await dw.mouse.up();
  await L.sleep(900);
  await dw.locator('button[data-act=cancel]').click();
  const closed = await editorInfo(dw);
  const s0 = await sessInfo(dw);
  c.check('closed_editor_kept_draft', !!s0.draft && s0.draft.note === 'Keep my place TOK-A1' && s0.draft.shapes >= 1 && s0.draft.att.length === 1 && s0.draft.att[0].kept && s0.draft.open === false && closed && !closed.open, { closed, s0 });
  await dw.locator('button.fab').click();
  const re1 = await L.waitFor(async () => { const e = await editorInfo(dw); return e && e.open && e.note ? e : null; }, 5000, 'reopen').catch(() => null);
  c.check('reopen_restores_note_and_file', !!re1 && re1.note === 'Keep my place TOK-A1' && re1.chips.join() === 'logo.png', re1);
  await L.sleep(700);
  await dw.reload();
  await dw.waitForSelector('#dw-markup-root', { state: 'attached', timeout: 15000 });
  const re2 = await L.waitFor(async () => { const e = await editorInfo(dw); return e && e.open && e.note ? e : null; }, 8000, 'auto reopen').catch(() => null);
  const s1 = await sessInfo(dw);
  c.check('refresh_reopens_editor_with_draft', !!re2 && re2.note === 'Keep my place TOK-A1' && re2.chips.join() === 'logo.png' && s1.sid === s0.sid && s1.draft && s1.draft.shapes >= 1, { re2, same: s1.sid === s0.sid });
  await L.sleep(1200);
  await dw.locator('button[data-act=send]').click();
  const r1 = await waitReply(dw, /TOK-A1/);
  c.check('sent_and_replied', !!r1 && r1.done === 'complete' && /TOK-A1/.test(r1.text), r1);
  const s2 = await sessInfo(dw);
  c.check('draft_cleared_after_send', !s2.draft, s2.draft);
  await dw.reload();
  await dw.waitForSelector('#dw-markup-root', { state: 'attached', timeout: 15000 });
  const r2 = await L.waitFor(async () => { const f = await feedInfo(dw); return f && f.done ? f : null; }, 8000, 'feed restored').catch(() => null);
  c.check('chat_survives_refresh', !!r2 && /TOK-A1/.test(r2.text) && r2.users.some((u) => /Keep my place/.test(u)), r2);
  await dw.evaluate(() => document.getElementById('dw-ext-feed').shadowRoot.querySelector('[data-act=close]').click());
  await dw.locator('button.fab').click();
  const r3 = await L.waitFor(async () => { const f = await feedInfo(dw); return f && f.done ? f : null; }, 5000, 'feed back on reopen').catch(() => null);
  c.check('chat_back_when_editor_reopens', !!r3 && /TOK-A1/.test(r3.text), r3);
  await dw.locator('button[data-act=cancel]').click();
  // New session
  const before = await sessInfo(dw);
  await dw.evaluate(() => document.getElementById('dw-ext-feed').shadowRoot.querySelector('[data-act=new-session]').click());
  await L.waitFor(async () => (await sessInfo(dw)).sid !== before.sid, 5000, 'new sid').catch(() => null);
  const after = await sessInfo(dw);
  c.check('new_session_clears', after.sid !== before.sid && !after.keys.some((k) => k.indexOf('dw_ext_s:' + before.sid + ':') === 0) && !(await feedInfo(dw)), { keys: after.keys.length });
  await sendAndWait(env, c, { note: 'Fresh start TOK-B2', timeout: 40000 });
  const r4 = await feedInfo(dw);
  c.check('new_session_reply', !!r4 && /TOK-B2/.test(r4.text) && !r4.users.some((u) => /Keep my place/.test(u)), r4);
  const gp = env.ctx.pages().filter((p) => p.url().startsWith(env.mock.grokUrl));
  const turns = gp.length ? await gp[0].evaluate(() => [...document.querySelectorAll('.user-turn, [data-role=user], .message-bubble')].map((n) => n.textContent.slice(0, 80))) : [];
  const g = gp.length ? await gp[0].evaluate(() => ({ received: (window.__received || []).map((r) => (/TOK-\w+/.exec(r.text) || [''])[0]), lastTok: ((/TOK-\w+/.exec(((window.__received || []).slice(-1)[0] || {}).text || '') || [''])[0]), newChat: window.__newChat || 0, path: location.pathname })) : null;
  c.check('one_grok_tab_reused', gp.length === 1, gp.map((p) => p.url()));
  c.check('next_send_started_a_new_chat', !!g && g.newChat >= 1 && g.lastTok === 'TOK-B2', { g, turns });
  return c.steps;
};

// Two editor tabs, two AI tabs: each reply goes back to the editor that asked; a third editor sees every AI tab taken
// and can open its own.
scenarios['two-editors'] = async (env) => {
  const c = new L.Checks();
  await env.login();
  await setNewChatUrl(env, 'grok', env.mock.grokUrl + '/?speed=35&tokens=40&code=0');
  await env.sw.evaluate(() => self.__dw.setProvider('grok'));
  const a = await openEditor(env), b = await openEditor(env);
  const sa = await sessInfo(a), sb = await sessInfo(b);
  c.check('each_editor_has_its_own_session', !!sa.sid && !!sb.sid && sa.sid !== sb.sid, { a: !!sa.sid, b: !!sb.sid });
  for (const [p, n] of [[a, 'First editor TOK-ONE'], [b, 'Second editor TOK-TWO']]) { await p.bringToFront(); await p.locator('button.fab').click(); await p.locator('textarea#dw-mk-note').fill(n); await p.locator('button[data-act=send]').click(); }
  const ra = await waitReply(a, /TOK-/, 60000), rb = await waitReply(b, /TOK-/, 60000);
  c.check('editor_a_got_its_own_reply', !!ra && ra.done === 'complete' && /TOK-ONE/.test(ra.text) && !/TOK-TWO/.test(ra.text), ra && ra.text && ra.text.slice(0, 80));
  c.check('editor_b_got_its_own_reply', !!rb && rb.done === 'complete' && /TOK-TWO/.test(rb.text) && !/TOK-ONE/.test(rb.text), rb && rb.text && rb.text.slice(0, 80));
  const gtabs = env.ctx.pages().filter((p) => p.url().startsWith(env.mock.grokUrl));
  const rec = [];
  for (const p of gtabs) rec.push(await p.evaluate(() => (window.__received || []).map((r) => (/TOK-\w+/.exec(r.text) || [''])[0])));
  c.check('two_ai_tabs_one_request_each', gtabs.length === 2 && rec.every((r) => r.length === 1) && rec.flat().sort().join() === 'TOK-ONE,TOK-TWO', rec);
  const st = await env.sw.evaluate(() => { const s = self.__dw.state(); return Object.values(s.sessions).filter((x) => x.pair).map((x) => x.pair.tabId); });
  c.check('two_sessions_two_pairs', st.length === 2 && st[0] !== st[1], st);
  // follow-up from A stays in A's chat
  await a.bringToFront();
  await a.evaluate(() => { const sr = document.getElementById('dw-ext-feed').shadowRoot; sr.querySelectorAll('[data-role=reply]').forEach((r) => r.setAttribute('data-e2e-before', '1')); sr.querySelector('[data-role=followup-text]').value = 'More please TOK-THREE'; });
  await a.evaluate(() => document.getElementById('dw-ext-feed').shadowRoot.querySelector('[data-act=followup-send]').click());
  const fa = await L.waitFor(async () => a.evaluate(() => { const r = document.getElementById('dw-ext-feed').shadowRoot.querySelector('[data-role=reply][data-done]:not([data-e2e-before])'); return r ? r.textContent : null; }), 40000, 'follow-up').catch(() => null);
  const rec2 = [];
  for (const p of gtabs) rec2.push(await p.evaluate(() => (window.__received || []).map((r) => (/TOK-\w+/.exec(r.text) || [''])[0])));
  c.check('followup_went_to_a_chat_only', !!fa && /TOK-THREE/.test(fa) && rec2.some((r) => r.join() === 'TOK-ONE,TOK-THREE') && rec2.some((r) => r.join() === 'TOK-TWO'), { fa: fa && fa.slice(0, 60), rec2 });
  const fb = await feedInfo(b);
  c.check('b_never_saw_a_followup', !!fb && fb.replies === 1 && !/TOK-THREE/.test(fb.text), fb && fb.replies);
  // third editor: every AI tab is taken
  const d3 = await openEditor(env);
  await d3.locator('button.fab').click();
  const e3 = await L.waitFor(async () => { const e = await editorInfo(d3); return e && e.status === 'all-taken' ? e : null; }, 8000, 'all taken').catch(async () => editorInfo(d3));
  c.check('third_editor_offered_new_ai_tab', !!e3 && e3.status === 'all-taken' && /new Grok tab/.test(e3.statusText), e3);
  await d3.locator('button[data-act=new-ai-tab]').click();
  const n3 = await L.waitFor(async () => { const n = env.ctx.pages().filter((p) => p.url().startsWith(env.mock.grokUrl)).length; return n === 3 ? n : null; }, 15000, 'third grok tab').catch(() => env.ctx.pages().filter((p) => p.url().startsWith(env.mock.grokUrl)).length);
  const e4 = await L.waitFor(async () => { const e = await editorInfo(d3); return e && e.status === 'paired' ? e : null; }, 8000, 'paired').catch(async () => editorInfo(d3));
  c.check('new_ai_tab_opened_and_paired', n3 === 3 && !!e4 && e4.status === 'paired', { n3, e4 });
  // closing A's AI tab: A's next Send re-pairs cleanly (a new tab, or a free one)
  const aPair = await env.sw.evaluate((sid) => { const x = self.__dw.state().sessions[sid]; return x && x.pair ? x.pair.tabId : null; }, sa.sid);
  for (const p of env.ctx.pages()) { if (!p.url().startsWith(env.mock.grokUrl)) continue; const id = await L.tabIdFor(env.sw, p.url()).catch(() => null); if (id === aPair) await p.close(); }
  await a.bringToFront();
  await a.evaluate(() => { const f = document.getElementById('dw-ext-feed'); const x = f && f.shadowRoot.querySelector('[data-act=close]'); if (x) x.click(); });
  const out = await sendAndWait(Object.assign({}, env, { dwPage: a }), c, { note: 'After close TOK-FOUR', timeout: 40000 });
  const fa2 = await waitReply(a, /TOK-FOUR/, 40000);
  c.check('a_repairs_after_its_ai_tab_closed', !!out && !out.error && !!fa2 && fa2.done === 'complete' && /TOK-FOUR/.test(fa2.text || ''), { out, t: fa2 && (fa2.text || '').slice(0, 60) });
  return c.steps;
};

// Someone changes the live page after the session started: Publish is held (client md5 compare on a node without
// /files md5), and with server md5 support the server refuses with md5_mismatch; both offer Reload / Overwrite anyway.
for (const mode of ['client', 'server']) {
  scenarios['overwrite-conflict-' + mode] = async (env) => {
    const c = new L.Checks();
    await env.login();
    await L.mockApi(env.dwUrl, '/__set', { md5Mode: mode === 'server', editorExtra: '' });
    await setNewChatUrl(env, 'grok', env.mock.grokUrl + '/?speed=15&tokens=14');
    await env.sw.evaluate(() => self.__dw.setProvider('grok'));
    const dw = await openEditor(env); env.dwPage = dw;
    dw.on('dialog', (d) => d.accept());
    const out = await sendAndWait(env, c, { note: 'Change the headline TOK-OW', timeout: 40000 });
    c.check('reply_done', out.done === 'complete', out);
    const card = () => dw.evaluate(() => { const r = document.getElementById('dw-ext-actions'); const sr = r && r.shadowRoot; const box = sr && sr.querySelector('[data-state=staged]'); if (!box) return null; const pub = box.querySelector('[data-act=publish]'); return { pub: pub ? pub.textContent : null, conflict: box.getAttribute('data-conflict') === '1', text: box.textContent.slice(0, 700), reload: !!box.querySelector('[data-act=reload]') }; });
    const c0 = await L.waitFor(async () => { const x = await card(); return x && /^Publish/.test(x.pub || '') ? x : null; }, 20000, 'staged card').catch(() => null);
    c.check('staged_with_publish', !!c0, c0);
    await L.sleep(500);
    await L.mockApi(env.dwUrl, '/__set', { editorExtra: '\n<!-- someone else edited this -->\n' });
    await dw.evaluate(() => document.getElementById('dw-ext-actions').shadowRoot.querySelector('[data-state=staged] [data-act=publish]').click());
    const c1 = await L.waitFor(async () => { const x = await card(); return x && x.conflict ? x : null; }, 15000, 'conflict').catch(async () => card());
    c.check('publish_held_file_changed_since_opened', !!c1 && c1.conflict && /changed on the live site since you opened it/.test(c1.text) && c1.pub === 'Overwrite anyway' && c1.reload, c1);
    const pubBefore = (env.mock.state.published || []).length;
    c.check('nothing_written', pubBefore === 0, env.mock.state.published);
    if (mode === 'server') c.check('server_refused_md5_mismatch', env.mock.state.md5Refused === 1, { refused: env.mock.state.md5Refused });
    else c.check('client_compare_no_publish_call', !env.mock.state.staged.some((x) => x.action === 'publish_staging'), env.mock.state.staged.map((x) => x.action));
    await dw.evaluate(() => document.getElementById('dw-ext-actions').shadowRoot.querySelector('[data-state=staged] [data-act=publish]').click());
    const done = await L.waitFor(async () => dw.evaluate(() => { const sr = document.getElementById('dw-ext-actions').shadowRoot; return sr.querySelector('[data-state=published]') ? sr.querySelector('[data-state=published]').textContent : null; }), 15000, 'published').catch(() => null);
    const pubs = env.mock.state.published || [];
    c.check('overwrite_anyway_publishes_without_expect', !!done && pubs.length >= 1 && pubs.every((p) => !p.expect), { done: done && done.slice(0, 80), pubs });
    return c.steps;
  };
}

// v0.1.13: Grok and Claude, same flow as Gemini, against mock pages that copy their public DOM (best effort).
const SITE_MOCK = {
  grok: { label: 'Grok', url: (env) => env.mock.grokUrl, tabs: 'http://127.0.0.3/*', home: '/', turns: "div[id^='response-'].items-start", input: 'input[type=file]' },
  claude: { label: 'Claude', url: (env) => env.mock.claudeUrl, tabs: 'http://127.0.0.4/*', home: '/new', turns: 'div[data-is-streaming]', input: 'input[data-testid=file-upload]' }
};
const setNewChatUrl = (env, site, url) => env.sw.evaluate(async ([s, u]) => { const d = (await chrome.storage.local.get('dev')).dev || {}; d.devNewChatUrls = Object.assign({}, d.devNewChatUrls, { [s]: u }); await chrome.storage.local.set({ dev: d }); }, [site, url]);
const aiPageOf = (env, site) => env.ctx.pages().find((p) => p.url().startsWith(SITE_MOCK[site].url(env)));
for (const site of ['grok', 'claude']) {
  const M = SITE_MOCK[site];
  // Opens a background tab on Send, starts a New chat, types the note, uploads the screenshot through the page's own file input,
  // relays the streamed reply with its code blocks, never clicks a forbidden button, reuses the tab (with New chat) next time,
  // and the Send page snapshot step works for the paired tab.
  scenarios[site + '-autoopen'] = async (env) => {
    const c = new L.Checks();
    await env.login();
    const sp = await env.sw.evaluate((s) => self.__dw.setProvider(s), site);
    c.check('provider_set', sp.ok && sp.provider === site, sp);
    const dw = await env.openDw();
    await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
    c.check('no_ai_tab_yet', (await env.sw.evaluate((p) => chrome.tabs.query({ url: p }), M.tabs)).length === 0);
    const out = await sendAndWait(env, c, { timeout: 60000 });
    c.check('done_detected', out.done === 'complete', out);
    const tabs = await env.sw.evaluate((p) => chrome.tabs.query({ url: p }), M.tabs);
    c.check('opened_one_tab_in_background', tabs.length === 1 && tabs[0].active === false, tabs.length);
    const st = await L.swState(env.sw);
    c.check('paired', st.pair && st.pair.siteId === site && st.provider === site, st.pair && st.pair.siteId);
    const steps = await L.panelSteps(dw);
    c.check('steps_ok', ['newChat', 'prompt', 'text', 'attach', 'send', 'stream'].every((n) => steps.some((x) => x.step === n && x.ok)), steps);
    const att = steps.find((x) => x.step === 'attach');
    c.check('attached_through_file_input', att && /fileInput/.test(att.text || ''), att);
    const final = await L.panelText(dw, 'reply');
    c.check('reply_relayed', new RegExp(M.label + ' got your request').test(final || ''), final && final.slice(0, 80));
    c.check('code_blocks_read', /```html[\s\S]*Family owned since 1998[\s\S]*```css/.test(final || '') || /Family owned since 1998/.test(final || ''), final && final.length);
    const ap = aiPageOf(env, site);
    const rec = ap ? await ap.evaluate(() => ({ received: window.__received, forbidden: window.__forbidden })) : null;
    c.check('received_prompt_and_screenshot', rec && rec.received.length === 1 && /Family owned since 1998/.test(rec.received[0].text) && rec.received[0].files[0].name === 'markup.jpg', rec && rec.received[0]);
    c.check('never_clicked_forbidden', rec && rec.forbidden.length === 0, rec && rec.forbidden);
    const title = await dw.evaluate(() => document.getElementById('dw-ext-root').shadowRoot.querySelector('[data-role=title]').textContent);
    c.check('panel_names_site', new RegExp(M.label).test(title), title);
    // Send page snapshot for the paired tab: provider and host accepted, no chat text
    const r = await env.sw.evaluate(() => self.__dw.handleSnapshot('test'));
    const ms = (await (await env.ctx.request.get(env.dwUrl + '/__state')).json()).snapshots || [];
    const snap = ms.find((x) => x.id === (r && r.id));
    c.check('snapshot_uploaded', !!(r && r.ok && snap && snap.provider === site && snap.selectorCount >= 30), { r: r && { ok: r.ok, via: r.via, code: r.code }, snap });
    // second request: same tab, New chat clicked
    await dw.reload();
    const out2 = await sendAndWait(env, c, { timeout: 60000 });
    c.check('second_done', out2.done === 'complete', out2);
    const tabs2 = await env.sw.evaluate((p) => chrome.tabs.query({ url: p }), M.tabs);
    c.check('reused_same_tab', tabs2.length === 1 && tabs2[0].id === tabs[0].id);
    const rec2 = ap ? await ap.evaluate((sel) => ({ n: window.__received.length, newChat: window.__newChat, turns: document.querySelectorAll(sel).length, forbidden: window.__forbidden }), M.turns) : null;
    c.check('new_chat_for_second_request', rec2 && rec2.n === 2 && rec2.newChat === 1 && rec2.turns === 1 && rec2.forbidden.length === 0, rec2);
    return c.steps;
  };
  // Files the AI made (chips) are staged at the linked paths, Publish is on, chime plays; a follow-up stays in the same chat.
  scenarios[site + '-chips-followup'] = async (env) => {
    const c = new L.Checks();
    await env.login();
    await setNewChatUrl(env, site, M.url(env) + M.home + '?speed=15&tokens=14&reply=taro&chips=1');
    await env.sw.evaluate((s) => self.__dw.setProvider(s), site);
    const dw = await env.ctx.newPage(); await dw.goto(env.dwUrl + '/editor.html'); env.dwPage = dw;
    await dw.waitForSelector('#dw-markup-root, #dw-ext-root', { state: 'attached', timeout: 15000 });
    const out = await sendAndWait(env, c, { timeout: 60000 });
    c.check('done_detected', out.done === 'complete', out);
    const staged = await L.waitFor(async () => { const x = env.mock.state.staged.filter((y) => y.action === 'create'); return x.length >= 3 ? x : null; }, 30000, 'three staged').catch(() => env.mock.state.staged);
    const by = Object.fromEntries(staged.map((x) => [x.file_name, x]));
    c.check('webp_from_download_button_staged', !!by['hanalei-taro-1600.webp'] && by['hanalei-taro-1600.webp'].file_path === 'assets/img' && /^UklGR/.test(by['hanalei-taro-1600.webp'].data || ''), by['hanalei-taro-1600.webp']);
    c.check('jpg_from_link_staged', !!by['hanalei-taro-1600.jpg'] && /^\/9j\//.test(by['hanalei-taro-1600.jpg'].data || ''), by['hanalei-taro-1600.jpg']);
    const card = await L.waitFor(async () => dw.evaluate(() => {
      const sr = (document.getElementById('dw-ext-actions') || {}).shadowRoot; const pub = sr && sr.querySelector('[data-state=staged] [data-act=publish]');
      const f = document.getElementById('dw-ext-feed').shadowRoot.querySelector('.feed');
      return pub ? { pub: pub.textContent, disabled: pub.disabled, missing: sr.querySelectorAll('[data-missing]').length, chime: f.getAttribute('data-chime') } : null;
    }), 20000, 'staged card').catch((e) => ({ error: String(e) }));
    c.check('publish_enabled_and_chime', card && !card.disabled && card.missing === 0 && card.chime === 'ok', card);
    const ap = aiPageOf(env, site);
    c.check('download_caught_once', ap && (await ap.evaluate(() => window.__downloads)) === 1);
    await dw.evaluate(() => { const sr = document.getElementById('dw-ext-feed').shadowRoot; sr.querySelectorAll('[data-role=reply]').forEach((r) => r.setAttribute('data-e2e-before', '1')); sr.querySelector('[data-role=followup-text]').value = 'The second image did not load'; });
    await dw.locator('#dw-ext-feed').evaluate((h) => h.shadowRoot.querySelector('[data-act=followup-send]').click());
    const out2 = await L.waitFor(async () => dw.evaluate(() => { const sr = document.getElementById('dw-ext-feed').shadowRoot; const r = sr.querySelector('[data-role=reply][data-done]:not([data-e2e-before])'); return r ? { done: r.getAttribute('data-done') } : null; }), 60000, 'follow-up').catch((e) => ({ error: String(e) }));
    c.check('followup_done', out2 && out2.done === 'complete', out2);
    const g = ap ? await ap.evaluate((sel) => ({ n: document.querySelectorAll(sel).length, newChat: window.__newChat, last: (window.__received[1] || {}).text || '' }), M.turns) : null;
    c.check('followup_same_chat', g && g.n === 2 && g.newChat === 0 && /second image did not load/.test(g.last), g);
    return c.steps;
  };
  // A usage-limit reply is reported with the site's own message, and Stop ends a long reply.
  scenarios[site + '-limit-stop'] = async (env) => {
    const c = new L.Checks();
    await env.login();
    await setNewChatUrl(env, site, M.url(env) + M.home + '?limit=1');
    await env.sw.evaluate((s) => self.__dw.setProvider(s), site);
    const dw = await env.openDw();
    await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
    const out = await sendAndWait(env, c, { timeout: 60000 });
    c.check('usage_limit_reported', (out.error && new RegExp(M.label + ' says a usage limit').test(out.error)) || out.done === 'error', out);
    // Stop: a long reply in a fresh tab
    for (const p of env.ctx.pages()) if (p.url().startsWith(M.url(env))) await p.close();
    await setNewChatUrl(env, site, M.url(env) + M.home + '?speed=40&tokens=400&code=0');
    await dw.reload();
    await dw.waitForSelector('#dw-ext-root', { state: 'attached', timeout: 15000 });
    await L.submitEdit(dw, 'long answer please');
    await L.waitFor(async () => { const t = await dw.locator('[data-role=reply]').last().textContent({ timeout: 500 }).catch(() => ''); return /word1\d/.test(t); }, 40000, 'long stream started');
    await dw.locator('button[data-act=stop]').click();
    await L.waitFor(async () => (await dw.locator('[data-role=reply]').last().getAttribute('data-done').catch(() => null)) === 'stopped', 15000, 'stopped');
    const ap = aiPageOf(env, site);
    const txt = ap ? await ap.evaluate((sel) => { const t = document.querySelectorAll(sel); return t.length ? t[t.length - 1].textContent : ''; }, M.turns) : '';
    c.check('stop_pressed_site_stop_button', !/word399/.test(txt), { chars: txt.length });
    return c.steps;
  };
}

module.exports.scenarios = scenarios;
