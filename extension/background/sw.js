/* DW Chat Integration service worker (MV3).
 * Thin router: pairs one AI chat tab, checks the editor pass, loads/validates the site instructions, hands a job to the
 * chat tab's content script and relays its events back to the DW tab. No chat-site selectors live here. */
importScripts('../lib/util.js', '../lib/providers/registry.js', '../lib/providers/chatgpt.js', '../lib/providers/gemini.js', '../lib/pagefiles.js', '../lib/schema.js', '../lib/instructions.js', '../lib/pass.js', '../lib/report.js', '../lib/status.js');

const EXT_VERSION = chrome.runtime.getManifest().version;
const GREY = { 16: 'icons/grey-16.png', 32: 'icons/grey-32.png', 48: 'icons/grey-48.png', 128: 'icons/grey-128.png' };
const GREEN = { 16: 'icons/green-16.png', 32: 'icons/green-32.png', 48: 'icons/green-48.png', 128: 'icons/green-128.png' };
const GPT_FILES = ['lib/util.js', 'lib/interpreter.js', 'lib/done.js', 'lib/assets.js', 'lib/runner.js', 'lib/snapshot.js', 'content/chatgpt.js'];
const DW_FILES = ['lib/util.js', 'lib/providers/registry.js', 'lib/providers/chatgpt.js', 'lib/providers/gemini.js', 'lib/status.js', 'lib/md.js', 'lib/pagefiles.js', 'lib/chime.js', 'content/panel.js', 'content/dw.js'];
const ses = chrome.storage.session, loc = chrome.storage.local;

// ---------- static data ----------
let _static;
function loadStatic() {
  if (!_static) {
    _static = (async () => {
      const get = async (p) => (await fetch(chrome.runtime.getURL(p))).json();
      const provs = DWX.providers.all();
      const [config, schema, ...instrs] = await Promise.all([get('config.json'), get('schema/site-instructions.schema.json'), ...provs.map((p) => get(p.instructions))]);
      const bundled = {}; provs.forEach((p, i) => { bundled[p.id] = instrs[i]; });
      return { config, schema, bundled };
    })();
  }
  return _static;
}
async function getConfig() {
  const { config } = await loadStatic();
  if (!config.allowDevOverride) return config;
  const { dev } = await loc.get('dev');
  return Object.assign({}, config, dev || {});
}
const store = {
  get: async (k) => (await loc.get(k))[k],
  set: async (k, v) => { await loc.set({ [k]: v }); }
};

// ---------- session state (survives service-worker restarts, cleared when the browser closes) ----------
const S = { pair: null, tabs: {}, jobs: {}, paused: false, activeJobId: null, userUnpaired: false, stopGen: 0, conv: null };
const payloads = {}; // jobId -> {prompt, file} kept in memory only until the prompt is sent
const iconLog = {};  // tabId -> 'green'|'grey' (debug/test visibility)
const lastByTab = {}; // v0.1.11: last job result per DW tab, so a refresh can restore the chat
const LAST_TTL = 30 * 60 * 1000;
const ready = (async () => {
  const d = await ses.get(['pair', 'tabs', 'jobs', 'paused', 'activeJobId', 'userUnpaired', 'lastByTab', 'conv']);
  S.conv = d.conv || null;
  S.userUnpaired = !!d.userUnpaired;
  S.pair = d.pair || null; S.tabs = d.tabs || {}; S.jobs = d.jobs || {}; S.paused = !!d.paused; S.activeJobId = d.activeJobId || null;
  if (d.lastByTab && typeof d.lastByTab === 'object') Object.assign(lastByTab, d.lastByTab);
})();
const persist = () => ses.set({ pair: S.pair, tabs: S.tabs, jobs: S.jobs, paused: S.paused, activeJobId: S.activeJobId, userUnpaired: S.userUnpaired, conv: S.conv });
function lastOf(tabId) {
  const r = lastByTab[tabId];
  if (!r || Date.now() - (r.t || 0) > LAST_TTL) { delete lastByTab[tabId]; return null; }
  return r;
}
function putLast(tabId, patch) {
  if (!tabId) return;
  lastByTab[tabId] = Object.assign({}, lastByTab[tabId] || {}, patch, { t: Date.now(), dwTabId: tabId });
  ses.set({ lastByTab }).catch(() => {});
}
function publicLast(rec) {
  if (!rec) return null;
  const running = !!(rec.jobId && S.activeJobId && S.jobs[S.activeJobId] && S.jobs[S.activeJobId].id === rec.jobId);
  return {
    jobId: rec.jobId, pageUrl: rec.pageUrl || '', path: rec.pagePath || '',
    status: rec.status || '', state: rec.status === 'complete' ? 'done' : rec.status,
    text: rec.text || '', files: rec.files || [], blocks: rec.blocks || [], steps: rec.steps || [],
    note: rec.note || '', ai: rec.provider || rec.ai || '', error: rec.error || null, running: running, conversation: !!rec.convUrl
  };
}
function samePage(rec, path, pageUrl) {
  if (!rec) return false;
  if (rec.pagePath && path) {
    if (rec.pagePath === path) return true;
    const a = rec.pagePath.endsWith('/index.html') ? rec.pagePath.slice(0, -10) : rec.pagePath;
    const b = path.endsWith('/index.html') ? path.slice(0, -10) : path;
    return a === b;
  }
  if (rec.pageUrl && pageUrl) {
    try { return new URL(rec.pageUrl).pathname === new URL(pageUrl).pathname; } catch (e) { return rec.pageUrl.split('#')[0] === pageUrl.split('#')[0]; }
  }
  return true;
}

// ---------- relay log (v0.1.7) ----------
// A small ring buffer kept in storage.local (survives a service-worker restart, a page reload and a closed editor) so a
// stall or a teardown right after Send can be diagnosed. Only step names, codes, provider ids and timings go in: never
// prompts, notes, replies, screenshots, page URLs or tab titles.
const DLOG_MAX = 200;
let dlog = [];
const dlogReady = loc.get('dlog').then((d) => { if (Array.isArray(d.dlog)) dlog = d.dlog.slice(-DLOG_MAX); }).catch(() => {});
function dl(ev, data) {
  try {
    const e = { t: Date.now(), ev: String(ev).replace(/[^a-z0-9_:.-]/gi, '_').slice(0, 40) };
    if (data && typeof data === 'object') {
      Object.keys(data).slice(0, 8).forEach((k) => {
        const v = data[k];
        e[String(k).slice(0, 16)] = (v == null || typeof v === 'number' || typeof v === 'boolean') ? v : String(v).slice(0, 80);
      });
    }
    dlog.push(e);
    if (dlog.length > DLOG_MAX) dlog.splice(0, dlog.length - DLOG_MAX);
    loc.set({ dlog }).catch(() => {});
  } catch (e) { /* logging never breaks the relay */ }
}
function lastLog(pred) { for (let i = dlog.length - 1; i >= 0; i--) if (pred(dlog[i])) return dlog[i]; return null; }
async function diagSnapshot() {
  await dlogReady;
  const job = S.activeJobId && S.jobs[S.activeJobId];
  const cfg = await getConfig();
  const instr = {};
  for (const siteId of [...new Set(Object.values(cfg.aiSites))]) {
    const g = await getInstructions(siteId).catch(() => null);
    const st = (await loc.get('instrStatus:' + siteId))['instrStatus:' + siteId] || null;
    instr[siteId] = g ? { source: g.source, version: g.instr.version, revision: g.instr.revision, verified: !!g.instr.verified, lastCheck: st ? (st.status + (st.code ? ' ' + st.code : '')) : null } : null;
  }
  const step = lastLog((e) => e.ev === 'gpt' && e.kind === 'step');
  const err = lastLog((e) => /^(gpt_error|reject|submit_exc|timeout|dispatch_fail|inject|sw_error)$/.test(e.ev) && (e.ev !== 'inject' || e.ok === false) && (e.ev !== 'reject' || e.code));
  return {
    now: Date.now(), extVersion: EXT_VERSION, provider: S.provider, paired: !!S.pair, pairSite: S.pair ? S.pair.siteId : null,
    paused: S.paused, userUnpaired: S.userUnpaired, stopGen: S.stopGen, editorTabs: Object.keys(S.tabs).length,
    busy: !!S.activeJobId, activeJob: job ? { id: job.id, site: job.siteId, instr: job.instrSource + ' ' + job.instrVersion, ageMs: Date.now() - job.startedAt } : null,
    lastStep: step ? { step: step.step, ok: step.ok, at: step.t } : null,
    lastError: err ? Object.assign({}, err) : null,
    instructions: instr, log: dlog.slice(-120)
  };
}

// ---------- helpers ----------
const reporter = new DWX.Reporter({
  fetch: (...a) => fetch(...a),
  url: '',
  enabled: async () => (await loc.get('reportsEnabled')).reportsEnabled !== false,
  store
});
async function report(siteId, step, code, instrVersion) {
  const cfg = await getConfig();
  reporter.url = cfg.dwBase + cfg.reportPath;
  await reporter.report({ site: siteId, step, extVersion: EXT_VERSION, instructionsVersion: instrVersion || 'unknown', errorCode: code });
}

async function extraHosts() { return (await loc.get('extraHosts')).extraHosts || []; }
async function isDwHost(host) {
  const cfg = await getConfig();
  return cfg.dwHosts.includes(host) || (await extraHosts()).includes(host);
}
function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ''; } }

async function setIcon(tabId, on) {
  iconLog[tabId] = on ? 'green' : 'grey';
  try {
    await chrome.action.setIcon({ tabId, path: on ? GREEN : GREY });
    await chrome.action.setTitle({ tabId, title: on ? 'DW Chat Integration: active on this site' : 'DW Chat Integration (off on this page)' });
  } catch (e) { /* tab gone */ }
}
async function setPairBadge(tabId, on) {
  try {
    await chrome.action.setBadgeText({ tabId, text: on ? 'AI' : '' });
    if (on) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#1f4d2b' });
  } catch (e) {}
}
function tell(tabId, msg) { return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => null); }
function withTimeout(promise, ms, code) {
  let t;
  const p = Promise.resolve(promise);
  const to = new Promise((_, rej) => { t = setTimeout(() => { dl('timeout', { code, ms }); rej(Object.assign(new Error(code), { code })); }, ms); });
  return Promise.race([p, to]).finally(() => clearTimeout(t));
}

function publicState(tabId) {
  const t = S.tabs[tabId];
  return {
    active: !!(t && t.validUntilMs > Date.now()),
    paired: !!S.pair, pairedTitle: S.pair ? S.pair.title : '', paused: S.paused,
    busy: !!S.activeJobId, site: S.pair ? S.pair.siteId : null, provider: S.provider
  };
}

// ---------- AI provider (v0.1.6) ----------
// The editor picks ChatGPT or Gemini (remembered in storage.local "provider"). On Send, the job goes to a tab of that
// provider: the paired tab if it is one, else an open tab of that site (reused, same window first), else a new tab
// opened in the background at the provider's new-chat URL. That tab becomes the paired tab.
S.provider = DWX.providers.DEFAULT_ID;
const providerReady = loc.get('provider').then((d) => { if (DWX.providers.valid(d.provider)) S.provider = d.provider; });
async function setProvider(id) {
  if (!DWX.providers.valid(id)) return { ok: false, code: 'bad_provider' };
  S.provider = id; S.userUnpaired = false; await loc.set({ provider: id });
  await broadcast();
  return { ok: true, provider: id };
}
function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); resolve(ok); };
    const on = (id, info) => { if (id === tabId && info.status === 'complete') finish(true); };
    const t = setTimeout(() => finish(false), timeoutMs);
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then((tab) => { if (tab && tab.status === 'complete') finish(true); }, () => finish(false));
  });
}
async function ensureProviderTab(providerId, dwTabId) {
  const P = DWX.providers.get(providerId);
  if (!P) return { ok: false, code: 'bad_provider' };
  const cfg = await getConfig();
  const hosts = Object.keys(cfg.aiSites).filter((h) => cfg.aiSites[h] === providerId);
  if (S.pair && S.pair.siteId === providerId) {
    const tab = await chrome.tabs.get(S.pair.tabId).catch(() => null);
    if (tab && hosts.includes(hostOf(tab.url))) { dl('tab', { provider: providerId, how: 'paired', tab: tab.id }); return { ok: true, tabId: tab.id, how: 'paired' }; }
    dl('tab_stale', { provider: providerId, gone: !tab });
  }
  const dwTab = await chrome.tabs.get(dwTabId).catch(() => null);
  // devTabMatches / devNewChatUrls exist only in the test build (config.allowDevOverride), for the mock sites.
  const matches = P.tabMatches.concat(((cfg.devTabMatches || {})[providerId]) || []);
  const open = (await chrome.tabs.query({ url: matches }).catch(() => [])).filter((t) => hosts.includes(hostOf(t.url)));
  open.sort((a, b) => ((dwTab && b.windowId === dwTab.windowId) - (dwTab && a.windowId === dwTab.windowId)) || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  let tabId = open[0] && open[0].id, how = 'reused';
  if (tabId == null) {
    const opts = { url: ((cfg.devNewChatUrls || {})[providerId]) || P.newChatUrl, active: false };
    if (dwTab) { opts.windowId = dwTab.windowId; opts.index = dwTab.index + 1; }
    let created = null;
    try { created = await withTimeout(chrome.tabs.create(opts), 10000, 'tab_open_failed'); }
    catch (e) { created = null; }
    if (!created) { dl('tab_open_failed', { provider: providerId }); return { ok: false, code: 'tab_open_failed' }; }
    tabId = created.id; how = 'opened';
    const loaded = await waitTabComplete(tabId, 30000);
    dl('tab_loaded', { provider: providerId, ok: loaded });
  }
  const r = await pairTab(tabId);
  dl('tab', { provider: providerId, how, tab: tabId, paired: r.ok, code: r.code });
  if (!r.ok) return { ok: false, code: r.code === 'unsupported_site' ? 'tab_open_failed' : r.code };
  return { ok: true, tabId, how };
}
async function broadcast() {
  for (const id of Object.keys(S.tabs)) await tell(Number(id), { type: 'sw:state', state: publicState(Number(id)) });
}

// ---------- instructions ----------
async function getInstructions(siteId, forceBundled) {
  const st = await loadStatic();
  const bundled = st.bundled[siteId];
  if (!bundled) return null;
  if (forceBundled) return { instr: bundled, source: 'bundled' };
  const cached = await store.get('instr:' + siteId);
  return DWX.choose(cached, bundled, EXT_VERSION);
}
async function refreshInstructions(reason) {
  const st = await loadStatic(); const cfg = await getConfig();
  const out = {};
  for (const siteId of [...new Set(Object.values(cfg.aiSites))]) {
    const r = await DWX.refresh({
      fetch: (...a) => fetch(...a), url: DWX.instructionFileUrl(cfg, siteId),
      store, bundled: st.bundled[siteId], schema: st.schema, extVersion: EXT_VERSION, now: () => Date.now(),
      subtle: crypto.subtle, publicKeyJwk: cfg.instructionsPublicKeyJwk, siteId
    });
    out[siteId] = r;
    await loc.set({ ['instrStatus:' + siteId]: Object.assign({ at: Date.now(), reason }, r) });
    if (r.status === 'rejected' || (r.status === 'failed' && r.code !== 'fetch_failed' && r.code !== 'http_404')) {
      await report(siteId, 'instructions', r.code === 'fetch_failed' ? 'instructions_fetch_failed' : ('instructions_' + r.code));
    }
  }
  return out;
}

// ---------- pairing ----------
// v0.1.12: follow-ups continue the SAME AI conversation. S.conv = {siteId, url} is the conversation's own address
// (saved when a reply finishes, kept in session storage so it survives a page refresh and a service-worker restart).
function convKey(url) { try { const u = new URL(url); return u.origin + u.pathname.replace(/\/+$/, ''); } catch (e) { return ''; } }
function isConvUrl(url, P) {
  try { const u = new URL(url), n = new URL(P.newChatUrl); const a = u.pathname.replace(/\/+$/, ''), b = n.pathname.replace(/\/+$/, ''); return a !== b && a.length > 1; } catch (e) { return false; }
}
async function rememberConversation(job) {
  try {
    const tb = await chrome.tabs.get(job.gptTabId).catch(() => null);
    const P = DWX.providers.get(job.siteId);
    if (tb && tb.url && P && isConvUrl(tb.url, P)) { S.conv = { siteId: job.siteId, url: tb.url, t: Date.now() }; putLast(job.dwTabId, { convUrl: tb.url }); await persist(); dl('conv_saved', { provider: job.siteId }); }
  } catch (e) {}
}
// The AI tab for a follow-up: the paired tab if it still shows the conversation; the conversation's address in that tab
// if it moved; the conversation's address in a new tab if the tab is gone. No conversation to go back to: no_conversation.
async function ensureConversationTab(providerId, dwTabId) {
  const P = DWX.providers.get(providerId);
  if (!P) return { ok: false, code: 'bad_provider' };
  const cfg = await getConfig();
  const hosts = Object.keys(cfg.aiSites).filter((h) => cfg.aiSites[h] === providerId);
  const conv = S.conv && S.conv.siteId === providerId ? S.conv.url : '';
  let tab = (S.pair && S.pair.siteId === providerId) ? await chrome.tabs.get(S.pair.tabId).catch(() => null) : null;
  if (tab && !hosts.includes(hostOf(tab.url))) tab = null;
  if (tab) {
    if (conv && convKey(tab.url) !== convKey(conv)) {
      try { await withTimeout(chrome.tabs.update(tab.id, { url: conv }), 10000, 'tab_open_failed'); } catch (e) { return { ok: false, code: 'tab_open_failed' }; }
      const loaded = await waitTabComplete(tab.id, 30000);
      dl('conv_back', { provider: providerId, ok: loaded });
      return { ok: true, tabId: tab.id, how: 'conversation' };
    }
    dl('tab', { provider: providerId, how: 'followup', tab: tab.id });
    return { ok: true, tabId: tab.id, how: 'paired' };
  }
  if (!conv) return { ok: false, code: 'no_conversation' };
  const dwTab = await chrome.tabs.get(dwTabId).catch(() => null);
  const opts = { url: conv, active: false };
  if (dwTab) { opts.windowId = dwTab.windowId; opts.index = dwTab.index + 1; }
  let created = null;
  try { created = await withTimeout(chrome.tabs.create(opts), 10000, 'tab_open_failed'); } catch (e) { created = null; }
  if (!created) return { ok: false, code: 'tab_open_failed' };
  const loaded = await waitTabComplete(created.id, 30000);
  dl('conv_reopened', { provider: providerId, ok: loaded });
  const r = await pairTab(created.id);
  if (!r.ok) return { ok: false, code: r.code || 'tab_open_failed' };
  return { ok: true, tabId: created.id, how: 'reopened' };
}
async function pairTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return { ok: false, code: 'no_tab' };
  const cfg = await getConfig();
  const host = hostOf(tab.url);
  const siteId = cfg.aiSites[host];
  if (!siteId) return { ok: false, code: 'unsupported_site' };
  if (S.pair && S.pair.tabId !== tabId) await setPairBadge(S.pair.tabId, false);
  S.userUnpaired = false;
  S.pair = { tabId, windowId: tab.windowId, siteId, host, title: (tab.title || host).slice(0, 80), pairedAt: Date.now() };
  await persist();
  await ensureGptInjected(tabId); // if this fails, dispatch will report chat_tab_unreachable
  await setPairBadge(tabId, true);
  await broadcast();
  return { ok: true, pair: S.pair };
}
async function unpair() {
  S.userUnpaired = true; // an explicit Unpair stops the relay: no tab is opened or reused until the user pairs or picks an AI again
  if (S.activeJobId) await abortJob(S.activeJobId, 'unpaired');
  if (S.pair) await setPairBadge(S.pair.tabId, false);
  S.pair = null; S.paused = false; await persist();
  await broadcast();
  return { ok: true };
}
async function ensureGptInjected(tabId) {
  try {
    const alive = await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'gpt:ping' }).catch(() => null), 4000, 'ping_timeout');
    if (alive && alive.ok) { dl('inject', { tab: tabId, ok: true, how: 'already' }); return { ok: true }; }
  } catch (e) { /* ping timed out or failed; try injecting */ }
  try {
    await withTimeout(chrome.scripting.executeScript({ target: { tabId }, files: GPT_FILES }), 8000, 'inject_timeout');
    dl('inject', { tab: tabId, ok: true, how: 'injected' });
    return { ok: true };
  } catch (e) {
    dl('inject', { tab: tabId, ok: false, code: (e && e.code) || 'exec_failed', msg: e && e.message });
    return { ok: false, code: 'chat_tab_unreachable' };
  }
}

// ---------- pass ----------
async function checkPass(sender, pass, receivedAt) {
  const cfg = await getConfig();
  const host = hostOf(sender.url);
  if (!sender.tab || sender.frameId !== 0 || !(await isDwHost(host))) return { ok: false, code: 'bad_sender' };
  const v = await DWX.verifyPass(pass, { host, receivedAt, nowMs: Date.now(), subtle: crypto.subtle, publicKeyJwk: cfg.passPublicKeyJwk });
  return v;
}
async function activateTab(sender, msg) {
  const v = await checkPass(sender, msg.pass, msg.receivedAt);
  const tabId = sender.tab && sender.tab.id;
  if (!v.ok) { if (tabId != null) await deactivateTab(tabId); return { ok: false, code: v.code }; }
  const prev = S.tabs[tabId];
  if (prev && prev.sub !== v.sub) { // different person in the same tab: drop everything for the old one
    if (S.activeJobId && S.jobs[S.activeJobId] && S.jobs[S.activeJobId].dwTabId === tabId) await abortJob(S.activeJobId, 'subject_changed');
  }
  S.tabs[tabId] = { host: hostOf(sender.url), sub: v.sub, validUntilMs: v.validUntilMs };
  await persist();
  await setIcon(tabId, true);
  chrome.alarms.create('pass:' + tabId, { when: v.validUntilMs + 500 });
  return { ok: true, state: publicState(tabId), cfg: { promptTemplate: (await getConfig()).promptTemplate } };
}
async function deactivateTab(tabId) {
  if (S.tabs[tabId]) { delete S.tabs[tabId]; await persist(); }
  await setIcon(tabId, false);
  chrome.alarms.clear('pass:' + tabId);
  for (const j of Object.values(S.jobs)) if (j.dwTabId === tabId) await abortJob(j.id, 'tab_inactive');
}

// ---------- jobs ----------
function newId() { return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function handleSubmit(sender, msg) {
  await dlogReady;
  const j0 = (msg && msg.job) || {};
  dl('submit_in', { provider: j0.provider, files: Array.isArray(j0.files) ? j0.files.length : 0, shot: !!j0.file });
  let r;
  try { r = await handleSubmit0(sender, msg); }
  catch (e) { dl('submit_exc', { msg: e && e.message }); throw e; }
  dl('submit_out', { ok: !!(r && r.ok), code: r && r.code, how: r && r.tab, job: r && r.jobId });
  if (r && !r.ok) dl('reject', { code: r.code });
  return r;
}
async function handleSubmit0(sender, msg) {
  const v = await checkPass(sender, msg.pass, msg.receivedAt);
  const tabId = sender.tab && sender.tab.id;
  if (!v.ok) return { ok: false, code: 'no_valid_pass:' + v.code };
  const t = S.tabs[tabId];
  if (!t || t.sub !== v.sub) return { ok: false, code: 'not_active' }; // must have activated with the same person first
  t.validUntilMs = v.validUntilMs; await setIcon(tabId, true);
  if (S.paused) return { ok: false, code: 'paused' };
  if (S.activeJobId) return { ok: false, code: 'busy' };
  const j = msg.job || {};
  // v0.1.6: which AI. The editor's choice in this request, else the remembered choice.
  await providerReady;
  if (j.provider != null && !DWX.providers.valid(j.provider)) return { ok: false, code: 'bad_provider' };
  const providerId = j.provider || S.provider;
  if (j.provider && j.provider !== S.provider) { S.provider = j.provider; await loc.set({ provider: j.provider }); }
  if (!S.pair && S.userUnpaired && !j.provider) return { ok: false, code: 'not_paired', provider: providerId };
  const myGen = S.stopGen;
  // Tell the editor immediately, before any tab wait, so the feed does not sit on "Collecting page files".
  await tell(tabId, { type: 'sw:event', event: { kind: 'step', step: 'open_tab', ok: true, detail: { provider: providerId } } });
  const follow = j.followUp === true;
  const pt = follow ? await ensureConversationTab(providerId, tabId) : await ensureProviderTab(providerId, tabId);
  if (S.stopGen !== myGen) return { ok: false, code: 'stopped', provider: providerId };
  if (!pt.ok) return { ok: false, code: pt.code || 'not_paired', provider: providerId };
  if (typeof j.prompt !== 'string' || !j.prompt || j.prompt.length > 20000) return { ok: false, code: 'bad_job' };
  if (j.file && (typeof j.file.dataUrl !== 'string' || j.file.dataUrl.length > 25 * 1024 * 1024)) return { ok: false, code: 'bad_job' };
  // Page source files (v0.1.3): re-checked here with the same allowlist and caps the content script used.
  let pageFiles = [];
  if (j.files != null) {
    if (!Array.isArray(j.files) || j.files.length > DWX.PAGE_FILE_LIMITS.maxFiles) return { ok: false, code: 'bad_job' };
    const chk = DWX.sanitizePageFiles(j.files, [], { reserved: j.file ? [j.file.name] : [] });
    if (chk.files.length !== j.files.length) return { ok: false, code: 'bad_job' };
    pageFiles = chk.files.map((f) => ({ name: f.name, type: f.type, dataUrl: f.dataUrl }));
  }
  // v0.1.11: shrink large images for the AI tab (originals stay on the editor for publish). Best-effort.
  try {
    if (j.file && DWX.shrinkImagesForAi) j.file = (await DWX.shrinkImagesForAi([j.file]))[0];
    if (pageFiles.length && DWX.shrinkImagesForAi) pageFiles = await DWX.shrinkImagesForAi(pageFiles);
  } catch (e) {}
  const id = newId();
  if (!follow) S.conv = null;                                                   // a new request starts a new chat; its address is saved when it finishes
  S.jobs[id] = { id, followUp: follow, dwTabId: tabId, gptTabId: S.pair.tabId, siteId: S.pair.siteId, sub: v.sub, retried: false, startedAt: Date.now(), pageUrl: j.pageUrl || '', pagePath: j.pagePath || '' };
  putLast(tabId, { jobId: id, pageUrl: j.pageUrl || '', pagePath: j.pagePath || '', provider: providerId, status: 'sending', text: '', files: [], blocks: [], steps: [], note: typeof j.note === 'string' ? j.note.slice(0, 5000) : '' });
  S.activeJobId = id;
  payloads[id] = { prompt: j.prompt, file: j.file || null, files: pageFiles, followUp: follow };
  await persist();
  await broadcast();
  if (S.stopGen !== myGen) { await finishJob(id); return { ok: false, code: 'stopped', provider: providerId }; }
  const r = await dispatch(id, false);
  if (S.stopGen !== myGen) return { ok: false, code: 'stopped', provider: providerId };
  if (!r.ok) return r;
  return { ok: true, jobId: id, provider: providerId, tab: pt.how };
}

async function dispatch(jobId, forceBundled) {
  const job = S.jobs[jobId];
  const inst = await getInstructions(job.siteId, forceBundled);
  if (!inst) { dl('dispatch_fail', { job: jobId, code: 'no_instructions', site: job.siteId }); await finishJob(jobId); return { ok: false, code: 'no_instructions' }; }
  job.instrSource = inst.source; job.instrVersion = inst.instr.version;
  dl('dispatch', { job: jobId, site: job.siteId, src: inst.source, ver: inst.instr.version, bundled: !!forceBundled });
  await persist();
  try {
    const inj = await ensureGptInjected(job.gptTabId);
    if (!inj || !inj.ok) throw new Error('inject_failed');
    const r = await withTimeout(chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:run', jobId, instr: inst.instr, job: payloads[jobId] }), 8000, 'no_ack');
    if (!r || !r.ok) throw new Error('no ack');
  } catch (e) {
    dl('dispatch_fail', { job: jobId, code: 'chat_tab_unreachable', msg: e && e.message });
    await report(job.siteId, 'tab', 'chat_tab_unreachable', inst.instr.version);
    await tell(job.dwTabId, { type: 'sw:event', jobId, event: { kind: 'error', step: 'tab', code: 'chat_tab_unreachable', sent: false, fatal: true } });
    await finishJob(jobId);
    return { ok: false, code: 'chat_tab_unreachable' };
  }
  await tell(job.dwTabId, { type: 'sw:event', jobId, event: { kind: 'step', step: 'instructions', ok: true, detail: { source: inst.source, version: inst.instr.version, revision: inst.instr.revision, verified: !!inst.instr.verified } } });
  return { ok: true };
}

async function finishJob(jobId) {
  delete payloads[jobId]; delete S.jobs[jobId];
  if (S.activeJobId === jobId) S.activeJobId = null;
  await persist();
  await broadcast();
}
async function abortJob(jobId, why) {
  const job = S.jobs[jobId];
  if (!job) return;
  await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId, action: 'abort' }).catch(() => null);
  await tell(job.dwTabId, { type: 'sw:event', jobId, event: { kind: 'error', step: 'run', code: why, sent: true, fatal: true, aborted: true } });
  await finishJob(jobId);
}

async function onGptEvent(sender, msg) {
  const job = S.jobs[msg.jobId];
  if (!job || !S.pair || !sender.tab || sender.tab.id !== job.gptTabId) return { ok: false };
  const evt = msg.event || {};
  if (evt.kind === 'error') dl('gpt_error', { job: job.id, step: evt.step, code: evt.code, sent: evt.sent, trace: evt.trace });
  else if (evt.kind === 'step') dl('gpt', { kind: 'step', step: evt.step, ok: evt.ok !== false, job: job.id });
  else if (evt.kind === 'done') dl('gpt', { kind: 'done', status: evt.status, job: job.id });
  else if (evt.kind === 'chunk' && evt.seq === 1) dl('gpt', { kind: 'chunk1', job: job.id });
  if (evt.kind === 'error') {
    await report(job.siteId, evt.step || 'unknown', evt.code || 'unknown', job.instrVersion);
    if (!evt.sent && job.instrSource === 'remote' && !job.retried && payloads[job.id]) {
      job.retried = true; await persist();
      await tell(job.dwTabId, { type: 'sw:event', jobId: job.id, event: { kind: 'step', step: 'retry_bundled', ok: true, detail: { after: evt.step + ':' + evt.code } } });
      const r = await dispatch(job.id, true);
      if (r.ok) return { ok: true };
    }
    await tell(job.dwTabId, { type: 'sw:event', jobId: job.id, event: evt });
    if (evt.fatal) await finishJob(job.id);
    return { ok: true };
  }
  if (evt.kind === 'step' && evt.step === 'send') delete payloads[job.id];
  if (evt.kind === 'chunk') putLast(job.dwTabId, { jobId: job.id, pageUrl: job.pageUrl, pagePath: job.pagePath, status: 'streaming', text: evt.text || '', files: evt.files || [] });
  if (evt.kind === 'done') await rememberConversation(job);
  if (evt.kind === 'done') putLast(job.dwTabId, { jobId: job.id, pageUrl: job.pageUrl, pagePath: job.pagePath, status: evt.status === 'stopped' ? 'stopped' : 'complete', text: evt.text || '', files: evt.files || [], blocks: evt.blocks || [] });
  if (evt.kind === 'step') {
    const rec = lastOf(job.dwTabId) || {};
    putLast(job.dwTabId, { jobId: job.id, pageUrl: job.pageUrl, pagePath: job.pagePath, steps: (rec.steps || []).concat({ name: evt.step, ok: evt.ok !== false }).slice(-40) });
  }
  if (evt.kind === 'error') putLast(job.dwTabId, { jobId: job.id, pageUrl: job.pageUrl, pagePath: job.pagePath, status: 'error', error: { code: evt.code, step: evt.step }, text: evt.text || (lastOf(job.dwTabId) || {}).text || '' });
  await tell(job.dwTabId, { type: 'sw:event', jobId: job.id, event: evt });
  if (evt.kind === 'done') await finishJob(job.id); // lastByTab is kept so a refresh can restore the chat
  return { ok: true };
}

async function control(sender, msg) {
  const tabId = sender.tab && sender.tab.id;
  const host = hostOf(sender.url);
  if (!sender.tab || sender.frameId !== 0 || !(await isDwHost(host)) || !S.tabs[tabId]) return { ok: false, code: 'not_active' };
  const job = S.activeJobId && S.jobs[S.activeJobId];
  dl('control', { action: msg.action, job: job ? job.id : null });
  switch (msg.action) {
    case 'stop':
      S.stopGen++;
      if (job) {
        await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId: job.id, action: 'stop' }).catch(() => null);
        await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId: job.id, action: 'abort' }).catch(() => null);
        await tell(job.dwTabId, { type: 'sw:event', jobId: job.id, event: { kind: 'done', status: 'stopped', text: '', files: [] } });
        await finishJob(job.id);
      } else if (tabId != null) {
        await tell(tabId, { type: 'sw:event', event: { kind: 'done', status: 'stopped', text: '', files: [] } });
      }
      return { ok: true };
    case 'pause':
      S.paused = true; await persist();
      if (job) await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId: job.id, action: 'pause' }).catch(() => null);
      await broadcast(); return { ok: true };
    case 'resume':
      S.paused = false; await persist();
      if (job) await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId: job.id, action: 'resume' }).catch(() => null);
      await broadcast(); return { ok: true };
    case 'unpair': return unpair();
    case 'openFile':
      if (!job) return { ok: false, code: 'no_job' };
      await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId: job.id, action: 'openFile', id: String(msg.id) }).catch(() => null);
      return { ok: true };
    default: return { ok: false, code: 'bad_action' };
  }
}

// ---------- extra DW hosts (user-approved optional host permission) ----------
async function registerExtraHost(host) {
  const id = 'dw-extra-' + host;
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] }).catch(() => []);
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([{ id, matches: ['https://' + host + '/*'], js: DW_FILES, runAt: 'document_idle', persistAcrossSessions: true }]);
}
async function syncExtraHosts() {
  for (const h of await extraHosts()) {
    const has = await chrome.permissions.contains({ origins: ['https://' + h + '/*'] });
    if (has) await registerExtraHost(h).catch(() => {});
  }
}


// ---------- AI-page structure snapshot (v0.1.8) ----------
// Read-only. Never starts, stops or changes a relay job. The redacted DOM is not written to the relay log.
async function findAiTab() {
  const cfg = await getConfig();
  if (S.pair) {
    const t = await chrome.tabs.get(S.pair.tabId).catch(() => null);
    if (t && t.url && cfg.aiSites[hostOf(t.url)]) return { tab: t, siteId: cfg.aiSites[hostOf(t.url)] };
  }
  const id = S.provider || DWX.providers.DEFAULT_ID;
  const p = DWX.providers.get(id);
  const matches = (p && p.hosts ? p.hosts : []).map((h) => 'https://' + h + '/*');
  const extras = Object.keys(cfg.aiSites || {}).filter((h) => cfg.aiSites[h] === id).map((h) => (h === 'localhost' || /^[0-9.]+$/.test(h) ? 'http://' + h + '/*' : 'https://' + h + '/*'));
  const tabs = (await chrome.tabs.query({ url: matches.concat(extras).length ? matches.concat(extras) : undefined }).catch(() => [])).filter((t) => cfg.aiSites[hostOf(t.url)] === id);
  const tab = tabs[0];
  return tab ? { tab, siteId: id } : null;
}
async function findEditorTab() {
  const now = Date.now();
  const active = Object.entries(S.tabs).filter(([, t]) => t && t.validUntilMs > now).map(([id]) => Number(id));
  for (const id of active.reverse()) {
    const t = await chrome.tabs.get(id).catch(() => null);
    if (t && t.id) return t;
  }
  const cfg = await getConfig();
  const hosts = cfg.dwHosts.concat(await extraHosts());
  const pats = hosts.map((h) => (h === 'localhost' || /^[0-9.]+$/.test(h) ? 'http://' + h + '/*' : 'https://' + h + '/*'));
  const tabs = await chrome.tabs.query({ url: pats }).catch(() => []);
  return tabs[0] || null;
}
async function handleSnapshot(from) {
  const found = await findAiTab();
  if (!found) return { ok: false, code: 'no_ai_tab' };
  const inj = await ensureGptInjected(found.tab.id);
  if (!inj || !inj.ok) return { ok: false, code: (inj && inj.code) || 'inject_failed' };
  const inst = await getInstructions(found.siteId).catch(() => null);
  if (!inst || !inst.instr) return { ok: false, code: 'no_instructions' };
  let cap;
  try {
    cap = await withTimeout(chrome.tabs.sendMessage(found.tab.id, { type: 'gpt:snapshot', instr: inst.instr }, { frameId: 0 }), 15000, 'snapshot_timeout');
  } catch (e) { return { ok: false, code: (e && e.code) || 'snapshot_timeout' }; }
  if (!cap || !cap.ok || typeof cap.dom !== 'string') return { ok: false, code: (cap && cap.code) || 'capture_failed' };
  const body = {
    provider: found.siteId,
    extVersion: EXT_VERSION,
    instructions: { version: inst.instr.version, revision: inst.instr.revision, verified: !!inst.instr.verified, source: inst.source },
    host: cap.host,
    selectors: cap.selectors,
    dom: cap.dom,
    stats: cap.stats
  };
  const editor = await findEditorTab();
  if (editor) {
    try {
      const up = await withTimeout(chrome.tabs.sendMessage(editor.id, { type: 'sw:uploadSnap', body: body }, { frameId: 0 }), 20000, 'upload_timeout');
      if (up && up.ok && up.id) { dl('snapshot', { via: 'upload', id: up.id, provider: found.siteId, from: from }); return { ok: true, via: 'upload', id: up.id }; }
    } catch (e) { /* fall back to download */ }
  }
  const id = 's' + Math.random().toString(36).slice(2, 10);
  const json = JSON.stringify(Object.assign({ id: id, t: Date.now(), via: 'download' }, body));
  dl('snapshot', { via: 'download', id: id, provider: found.siteId, from: from, bytes: json.length });
  return { ok: true, via: 'download', id: id, filename: 'dw-snap-' + id + '.json', json: json };
}

// ---------- messages ----------

async function peekPair(dwTabId, rec) {
  try {
    if (!S.pair || !S.pair.tabId) return null;
    const inst = await getInstructions(S.pair.siteId, false);
    if (!inst || !inst.instr) return null;
    const r = await withTimeout(chrome.tabs.sendMessage(S.pair.tabId, { type: 'gpt:peek', instr: inst.instr }), 8000, 'peek_timeout');
    if (!r || !r.ok || !(r.text || (r.blocks && r.blocks.length))) return null;
    putLast(dwTabId, Object.assign({}, rec || {}, {
      status: 'complete', text: r.text || '', files: r.files || [], blocks: r.blocks || [],
      provider: (rec && rec.provider) || S.provider, via: 'peek'
    }));
    return lastOf(dwTabId);
  } catch (e) { return rec || null; }
}

async function lastResult(sender, msg) {
  await ready;
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return { ok: false, code: 'no_tab' };
  const path = (msg && msg.path) || '';
  const pageUrl = (msg && msg.pageUrl) || '';
  let rec = lastOf(tabId);
  if (rec && (path || pageUrl) && !samePage(rec, path, pageUrl)) rec = null;
  const running = !!(rec && rec.jobId && S.activeJobId && S.jobs[S.activeJobId] && S.jobs[S.activeJobId].id === rec.jobId);
  if ((!rec || (rec.status !== 'complete' && rec.status !== 'stopped' && rec.status !== 'error')) && !running && rec && S.pair) {
    const peeked = await peekPair(tabId, rec);
    if (peeked) rec = peeked;
  }
  if (!rec) return { ok: false, code: 'no_result' };
  return { ok: true, result: publicLast(rec) };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready; await providerReady;
    const fromExt = sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
    switch (msg && msg.type) {
      case 'dw:activate': return activateTab(sender, msg);
      case 'dw:injectTap': {
        const tid = sender.tab && sender.tab.id;
        if (!S.tabs[tid] || sender.frameId !== 0) return { ok: false };
        try { await chrome.scripting.executeScript({ target: { tabId: tid }, files: ['content/dw-tap.js'], world: 'MAIN' }); } catch (e) { return { ok: false }; }
        return { ok: true };
      }
      case 'gpt:hook': {
        // v0.1.9: inject the page-world upload hook into the AI tab that asked (only a paired/known AI host, top frame).
        const tid = sender.tab && sender.tab.id;
        if (!tid || sender.frameId !== 0 || !(await getConfig()).aiSites[hostOf(sender.url)]) return { ok: false };
        try { await chrome.scripting.executeScript({ target: { tabId: tid }, files: ['content/ai-hook.js'], world: 'MAIN' }); dl('inject', { tab: tid, ok: true, how: 'hook' }); } catch (e) { dl('inject', { tab: tid, ok: false, code: 'hook_failed', msg: e && e.message }); return { ok: false }; }
        return { ok: true };
      }
      case 'dw:deactivate': if (sender.tab) await deactivateTab(sender.tab.id); return { ok: true };
      case 'dw:submit': return handleSubmit(sender, msg);
      case 'dw:log': {
        const tid = sender.tab && sender.tab.id;
        if (!sender.tab || sender.frameId !== 0 || !(await isDwHost(hostOf(sender.url)))) return { ok: false };
        await dlogReady;
        const d = (msg.data && typeof msg.data === 'object') ? msg.data : {};
        const safe = {}; Object.keys(d).slice(0, 6).forEach((k) => { safe[k] = d[k]; });
        dl('page:' + String(msg.ev || '').slice(0, 30), Object.assign({ tab: tid }, safe));
        return { ok: true };
      }
      case 'dw:diag': {
        if (!sender.tab || sender.frameId !== 0 || !(await isDwHost(hostOf(sender.url))) || !S.tabs[sender.tab.id]) return { ok: false, code: 'not_active' };
        return { ok: true, diag: await diagSnapshot() };
      }
      case 'popup:diag': if (!fromExt) return { ok: false }; return { ok: true, diag: await diagSnapshot() };
      case 'popup:snapshot': if (!fromExt) return { ok: false }; return handleSnapshot('popup');
      case 'dw:snapshot': {
        if (!sender.tab || sender.frameId !== 0 || !(await isDwHost(hostOf(sender.url)))) return { ok: false, code: 'not_active' };
        return handleSnapshot('page');
      }
      case 'dw:control': return control(sender, msg);
      case 'dw:state': return { ok: true, state: publicState(sender.tab && sender.tab.id) };
      case 'dw:setProvider': {
        const tid = sender.tab && sender.tab.id;
        if (!sender.tab || sender.frameId !== 0 || !S.tabs[tid] || !(await isDwHost(hostOf(sender.url)))) return { ok: false, code: 'not_active' };
        return setProvider(msg.provider);
      }
      case 'popup:setProvider': if (!fromExt) return { ok: false }; return setProvider(msg.provider);
      case 'dw:lastResult': return lastResult(sender, msg);
      case 'dw:pageStatus': {
        const siteId = S.pair && S.pair.siteId;
        const ai = (typeof siteId === 'string' && DWX.AI_ALLOWLIST[siteId]) ? siteId : null;
        let revision = null;
        if (ai) {
          const inst = await getInstructions(ai);
          if (inst && inst.instr && typeof inst.instr.revision === 'number') revision = inst.instr.revision;
        }
        return { ok: true, extVersion: EXT_VERSION, paired: !!S.pair, ai: ai, revision: revision, provider: S.provider };
      }
      case 'gpt:event': return onGptEvent(sender, msg);
      case 'gpt:keepalive': return { ok: true };
      case 'popup:state': {
        if (!fromExt) return { ok: false };
        const cfg = await getConfig(); const st = await loadStatic();
        const out = {};
        for (const siteId of Object.values(cfg.aiSites)) {
          const inst = await getInstructions(siteId);
          out[siteId] = { source: inst.source, version: inst.instr.version, revision: inst.instr.revision, verified: !!inst.instr.verified, status: (await loc.get('instrStatus:' + siteId))['instrStatus:' + siteId] || null };
        }
        let tab = null;
        if (msg.tabId != null) tab = await chrome.tabs.get(msg.tabId).catch(() => null);
        const host = tab && tab.url ? hostOf(tab.url) : '';
        return {
          ok: true, extVersion: EXT_VERSION, pair: S.pair, paused: S.paused, busy: !!S.activeJobId,
          tab: tab ? { id: tab.id, host, title: tab.title, canPair: !!cfg.aiSites[host], dw: await isDwHost(host), httpsOther: tab.url.startsWith('https://') && !cfg.aiSites[host] && !(await isDwHost(host)), active: publicState(tab.id).active } : null,
          provider: S.provider, providers: DWX.providers.all().map((p) => ({ id: p.id, label: p.label })),
          instructions: out, reportsEnabled: (await loc.get('reportsEnabled')).reportsEnabled !== false, extraHosts: await extraHosts(), dwHosts: cfg.dwHosts
        };
      }
      case 'popup:pair': if (!fromExt) return { ok: false }; return pairTab(msg.tabId);
      case 'popup:unpair': if (!fromExt) return { ok: false }; return unpair();
      case 'popup:refresh': if (!fromExt) return { ok: false }; return { ok: true, result: await refreshInstructions('manual') };
      case 'popup:setReports': if (!fromExt) return { ok: false }; await loc.set({ reportsEnabled: !!msg.on }); return { ok: true };
      case 'popup:addHost': {
        if (!fromExt) return { ok: false };
        if (!/^[a-z0-9.-]{3,100}$/.test(msg.host || '')) return { ok: false, code: 'bad_host' };
        const list = await extraHosts(); if (!list.includes(msg.host)) list.push(msg.host);
        await loc.set({ extraHosts: list }); await registerExtraHost(msg.host);
        return { ok: true };
      }
      default: return { ok: false, code: 'unknown_message' };
    }
  })().then(sendResponse, (e) => { dl('sw_error', { type: msg && msg.type, msg: e && e.message }); sendResponse({ ok: false, code: 'sw_error', message: String(e && e.message) }); });
  return true;
});

// ---------- install / update: reach tabs that were already open (v0.1.7) ----------
// Chrome does not run a newly installed or updated extension's content scripts in tabs that are already open, so an editor
// page opened before the install would never see the extension (Send would save the request and nothing would relay).
// Inject the DW-site script there now. The script is inactive until the page looks like an editor session, and it guards
// against running twice. Needs no new permission: the DW hosts are already in host_permissions.
async function injectIntoOpenDwTabs(reason) {
  let n = 0, fail = 0;
  try {
    const cfg = await getConfig();
    const hosts = [...new Set([...(cfg.dwHosts || []), ...(await extraHosts())])];
    const tabs = await chrome.tabs.query({ url: hosts.map((h) => 'https://' + h + '/*') });
    for (const t of tabs) {
      try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: DW_FILES }); n++; }
      catch (e) { fail++; dl('inject_dw_fail', { tab: t.id, msg: e && e.message }); }
    }
  } catch (e) { dl('inject_dw_exc', { msg: e && e.message }); }
  dl('inject_dw', { reason, tabs: n, failed: fail });
}
chrome.runtime.onInstalled.addListener((d) => { dl('installed', { reason: d && d.reason, ver: EXT_VERSION }); ready.then(() => injectIntoOpenDwTabs((d && d.reason) || 'installed')); });

// ---------- lifecycle ----------
async function startup(reason) {
  await ready;
  const a = await chrome.alarms.get('refresh-instructions');
  const cfg = await getConfig();
  if (!a) chrome.alarms.create('refresh-instructions', { delayInMinutes: 1, periodInMinutes: cfg.refreshMinutes });
  await syncExtraHosts();
  await refreshInstructions(reason);
}
chrome.runtime.onInstalled.addListener((d) => { startup('installed:' + d.reason); });
chrome.runtime.onStartup.addListener(() => { startup('startup'); });
chrome.alarms.onAlarm.addListener(async (al) => {
  await ready;
  if (al.name === 'refresh-instructions') return refreshInstructions('daily');
  if (al.name.startsWith('pass:')) {
    const tabId = Number(al.name.slice(5)); const t = S.tabs[tabId];
    if (t && t.validUntilMs <= Date.now()) { await setIcon(tabId, false); await tell(tabId, { type: 'sw:state', state: publicState(tabId) }); }
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (S.pair && S.pair.tabId === tabId) await unpair();
  if (S.tabs[tabId]) await deactivateTab(tabId);
});
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  await ready;
  // info.url is only present for URLs we have host permission for. A navigation to anything else shows up as
  // status 'loading' without a url, which also counts as leaving the page.
  const t = S.tabs[tabId];
  const left = info.url ? hostOf(info.url) !== (t && t.host) : info.status === 'loading';
  if (S.pair && S.pair.tabId === tabId && info.url) {
    const cfg = await getConfig();
    if (!cfg.aiSites[hostOf(info.url)]) await unpair();
  }
  if (t && left) await deactivateTab(tabId);
});

// test visibility only (config.allowDevOverride is false in the shipped build)
self.__dw = { dl, diagSnapshot, handleSnapshot, findAiTab, injectIntoOpenDwTabs, iconLog, state: () => JSON.parse(JSON.stringify(S)), refreshInstructions, pairTab, unpair, getInstructions, getConfig, setProvider, ensureProviderTab };
