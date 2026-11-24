/* DW Chat Integration service worker (MV3).
 * Thin router: pairs one AI chat tab, checks the editor pass, loads/validates the site instructions, hands a job to the
 * chat tab's content script and relays its events back to the DW tab. No chat-site selectors live here. */
importScripts('../lib/util.js', '../lib/pagefiles.js', '../lib/schema.js', '../lib/instructions.js', '../lib/pass.js', '../lib/report.js', '../lib/status.js');

const EXT_VERSION = chrome.runtime.getManifest().version;
const GREY = { 16: 'icons/grey-16.png', 32: 'icons/grey-32.png', 48: 'icons/grey-48.png', 128: 'icons/grey-128.png' };
const GREEN = { 16: 'icons/green-16.png', 32: 'icons/green-32.png', 48: 'icons/green-48.png', 128: 'icons/green-128.png' };
const GPT_FILES = ['lib/util.js', 'lib/interpreter.js', 'lib/done.js', 'lib/runner.js', 'content/chatgpt.js'];
const DW_FILES = ['lib/util.js', 'lib/status.js', 'lib/md.js', 'lib/pagefiles.js', 'content/panel.js', 'content/dw.js'];
const ses = chrome.storage.session, loc = chrome.storage.local;

// ---------- static data ----------
let _static;
function loadStatic() {
  if (!_static) {
    _static = (async () => {
      const get = async (p) => (await fetch(chrome.runtime.getURL(p))).json();
      const [config, schema, chatgpt] = await Promise.all([get('config.json'), get('schema/site-instructions.schema.json'), get('instructions/chatgpt.json')]);
      return { config, schema, bundled: { chatgpt } };
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
const S = { pair: null, tabs: {}, jobs: {}, paused: false, activeJobId: null };
const payloads = {}; // jobId -> {prompt, file} kept in memory only until the prompt is sent
const iconLog = {};  // tabId -> 'green'|'grey' (debug/test visibility)
const ready = (async () => {
  const d = await ses.get(['pair', 'tabs', 'jobs', 'paused', 'activeJobId']);
  S.pair = d.pair || null; S.tabs = d.tabs || {}; S.jobs = d.jobs || {}; S.paused = !!d.paused; S.activeJobId = d.activeJobId || null;
})();
const persist = () => ses.set({ pair: S.pair, tabs: S.tabs, jobs: S.jobs, paused: S.paused, activeJobId: S.activeJobId });

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

function publicState(tabId) {
  const t = S.tabs[tabId];
  return {
    active: !!(t && t.validUntilMs > Date.now()),
    paired: !!S.pair, pairedTitle: S.pair ? S.pair.title : '', paused: S.paused,
    busy: !!S.activeJobId, site: S.pair ? S.pair.siteId : null
  };
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
async function pairTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url) return { ok: false, code: 'no_tab' };
  const cfg = await getConfig();
  const host = hostOf(tab.url);
  const siteId = cfg.aiSites[host];
  if (!siteId) return { ok: false, code: 'unsupported_site' };
  if (S.pair && S.pair.tabId !== tabId) await setPairBadge(S.pair.tabId, false);
  S.pair = { tabId, windowId: tab.windowId, siteId, host, title: (tab.title || host).slice(0, 80), pairedAt: Date.now() };
  await persist();
  await ensureGptInjected(tabId);
  await setPairBadge(tabId, true);
  await broadcast();
  return { ok: true, pair: S.pair };
}
async function unpair() {
  if (S.activeJobId) await abortJob(S.activeJobId, 'unpaired');
  if (S.pair) await setPairBadge(S.pair.tabId, false);
  S.pair = null; S.paused = false; await persist();
  await broadcast();
  return { ok: true };
}
async function ensureGptInjected(tabId) {
  const alive = await chrome.tabs.sendMessage(tabId, { type: 'gpt:ping' }).catch(() => null);
  if (alive && alive.ok) return;
  await chrome.scripting.executeScript({ target: { tabId }, files: GPT_FILES });
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
  const v = await checkPass(sender, msg.pass, msg.receivedAt);
  const tabId = sender.tab && sender.tab.id;
  if (!v.ok) return { ok: false, code: 'no_valid_pass:' + v.code };
  const t = S.tabs[tabId];
  if (!t || t.sub !== v.sub) return { ok: false, code: 'not_active' }; // must have activated with the same person first
  t.validUntilMs = v.validUntilMs; await setIcon(tabId, true);
  if (!S.pair) return { ok: false, code: 'not_paired' };
  const tab = await chrome.tabs.get(S.pair.tabId).catch(() => null);
  if (!tab) { await unpair(); return { ok: false, code: 'not_paired' }; }
  if (S.paused) return { ok: false, code: 'paused' };
  if (S.activeJobId) return { ok: false, code: 'busy' };
  const j = msg.job || {};
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
  const id = newId();
  S.jobs[id] = { id, dwTabId: tabId, gptTabId: S.pair.tabId, siteId: S.pair.siteId, sub: v.sub, retried: false, startedAt: Date.now() };
  S.activeJobId = id;
  payloads[id] = { prompt: j.prompt, file: j.file || null, files: pageFiles };
  await persist();
  await broadcast();
  const r = await dispatch(id, false);
  if (!r.ok) return r;
  return { ok: true, jobId: id };
}

async function dispatch(jobId, forceBundled) {
  const job = S.jobs[jobId];
  const inst = await getInstructions(job.siteId, forceBundled);
  if (!inst) { await finishJob(jobId); return { ok: false, code: 'no_instructions' }; }
  job.instrSource = inst.source; job.instrVersion = inst.instr.version;
  await persist();
  try {
    await ensureGptInjected(job.gptTabId);
    const r = await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:run', jobId, instr: inst.instr, job: payloads[jobId] });
    if (!r || !r.ok) throw new Error('no ack');
  } catch (e) {
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
  await tell(job.dwTabId, { type: 'sw:event', jobId: job.id, event: evt });
  if (evt.kind === 'done') await finishJob(job.id);
  return { ok: true };
}

async function control(sender, msg) {
  const tabId = sender.tab && sender.tab.id;
  const host = hostOf(sender.url);
  if (!sender.tab || sender.frameId !== 0 || !(await isDwHost(host)) || !S.tabs[tabId]) return { ok: false, code: 'not_active' };
  const job = S.activeJobId && S.jobs[S.activeJobId];
  switch (msg.action) {
    case 'stop':
      if (!job) return { ok: false, code: 'no_job' };
      await chrome.tabs.sendMessage(job.gptTabId, { type: 'gpt:control', jobId: job.id, action: 'stop' }).catch(() => null);
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

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    const fromExt = sender.url && sender.url.startsWith(chrome.runtime.getURL(''));
    switch (msg && msg.type) {
      case 'dw:activate': return activateTab(sender, msg);
      case 'dw:injectTap': {
        const tid = sender.tab && sender.tab.id;
        if (!S.tabs[tid] || sender.frameId !== 0) return { ok: false };
        try { await chrome.scripting.executeScript({ target: { tabId: tid }, files: ['content/dw-tap.js'], world: 'MAIN' }); } catch (e) { return { ok: false }; }
        return { ok: true };
      }
      case 'dw:deactivate': if (sender.tab) await deactivateTab(sender.tab.id); return { ok: true };
      case 'dw:submit': return handleSubmit(sender, msg);
      case 'dw:control': return control(sender, msg);
      case 'dw:state': return { ok: true, state: publicState(sender.tab && sender.tab.id) };
      case 'dw:pageStatus': {
        const siteId = S.pair && S.pair.siteId;
        const ai = (typeof siteId === 'string' && DWX.AI_ALLOWLIST[siteId]) ? siteId : null;
        let revision = null;
        if (ai) {
          const inst = await getInstructions(ai);
          if (inst && inst.instr && typeof inst.instr.revision === 'number') revision = inst.instr.revision;
        }
        return { ok: true, extVersion: EXT_VERSION, paired: !!S.pair, ai: ai, revision: revision };
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
  })().then(sendResponse, (e) => sendResponse({ ok: false, code: 'sw_error', message: String(e && e.message) }));
  return true;
});

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
self.__dw = { iconLog, state: () => JSON.parse(JSON.stringify(S)), refreshInstructions, pairTab, unpair, getInstructions, getConfig };
