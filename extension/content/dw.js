/* DW Chat Integration: DW-site content script. INACTIVE by default.
 * It does nothing (no network, no panel) on a page unless the page looks like an editor session
 * (dw_ed / dw_mk hint cookie, #suggest-edit in the URL, or the editor's #dw-markup-root appears). Then it asks the
 * site (same origin, cookies included) /_dw/whoami and POST /_dw/ext/pass. Only with a valid pass does it turn on:
 * panel, green icon, and relaying of submits to the paired chat tab. See SERVER_CONTRACT.md for the page protocol.
 */
(function () {
  'use strict';
  if (window.__dwExt) return;
  window.__dwExt = true;
  var EXT_VERSION = chrome.runtime.getManifest().version;
  var S = { active: false, relay: true, state: { active: false, paired: false, paused: false, busy: false }, nativeHook: false,
            nativePanel: false, wantEvents: false, panel: null, lastGesture: 0, jobId: null, pending: null, renewTimer: null, activating: false, activateP: null, cfg: {} };

  function send(msg) { return chrome.runtime.sendMessage(msg).catch(function () { return { ok: false, code: 'sw_unreachable' }; }); }
  function toPage(type, extra) { window.postMessage(Object.assign({ source: 'dw-ext', type: type, v: 1 }, extra || {}), location.origin); }
  function emitStatus() {
    return send({ type: 'dw:pageStatus' }).then(function (r) {
      var st = DWX.pageStatus({
        extVersion: EXT_VERSION,
        paired: !!(r && r.paired),
        ai: r && r.ai,
        revision: r && r.revision,
        editor: S.active
      });
      toPage('dw-ext-status', st);
      return st;
    });
  }
  function replyStatus() {
    if (S.activateP) return S.activateP.then(function () { return emitStatus(); }, function () { return emitStatus(); });
    return emitStatus();
  }

  // ---------- gate ----------
  function candidate() {
    return /(?:^|;\s*)(?:dw_ed|dw_mk)=/.test(document.cookie) || location.hash === '#suggest-edit' || !!document.getElementById('dw-markup-root');
  }
  function maybeActivate() { if (!S.active && !S.activating && candidate()) return activate(); }

  // ---------- pass ----------
  async function fetchPass() {
    try {
      var w = await fetch('/_dw/whoami', { credentials: 'include', cache: 'no-store' });
      var wj = w.ok ? await w.json() : null;
      if (!wj || wj.edit !== true) return null;
      var receivedAt;
      var r = await fetch('/_dw/ext/pass', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'X-DW-Ext': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ extVersion: EXT_VERSION }) });
      receivedAt = Date.now();
      if (!r.ok) return null;
      var pj = await r.json();
      return pj && pj.ok ? { pass: pj, receivedAt: receivedAt } : null;
    } catch (e) { return null; }
  }

  async function activate() {
    if (S.activateP) return S.activateP;
    S.activating = true;
    S.activateP = (async function () {
    try {
      var p = await fetchPass();
      if (!p) return deactivate();
      var r = await send({ type: 'dw:activate', pass: p.pass, receivedAt: p.receivedAt });
      if (!r || !r.ok) return deactivate();
      S.active = true; S.state = r.state; S.cfg = r.cfg || S.cfg;
      mountPanel();
      applyState();
      scheduleRenew(p);
      toPage('dw-ext-ready', { paired: !!S.state.paired });
      emitStatus();
      // Give a page that implements the hook time to answer with dw-ext-hello; only then fall back to the fetch tap.
      if (!S.tapTimer) S.tapTimer = setTimeout(function () {
        if (S.active && !S.nativeHook && !S.tapRequested) { S.tapRequested = true; send({ type: 'dw:injectTap' }); }
      }, 500);
    } finally { S.activating = false; S.activateP = null; }
    })();
    return S.activateP;
  }
  function scheduleRenew(p) {
    if (S.renewTimer) clearTimeout(S.renewTimer);
    var ttlMs = (p.pass.exp - p.pass.now) * 1000;
    S.renewTimer = setTimeout(function () { S.renewTimer = null; if (S.active) activate(); }, Math.max(15000, ttlMs * 0.6));
  }
  function deactivate() {
    var was = S.active;
    S.active = false; S.pending = null;
    if (S.renewTimer) { clearTimeout(S.renewTimer); S.renewTimer = null; }
    if (S.panel) { S.panel.destroy(); S.panel = null; }
    if (was) { send({ type: 'dw:deactivate' }); toPage('dw-ext-inactive'); }
    emitStatus();
  }

  // ---------- panel ----------
  function mountPanel() {
    if (S.panel || S.nativePanel) return;
    S.panel = DWX.createPanel(document, {
      onStop: function () { send({ type: 'dw:control', action: 'stop' }); },
      onPause: function () { send({ type: 'dw:control', action: 'pause' }); },
      onResume: function () { send({ type: 'dw:control', action: 'resume' }); },
      onUnpair: function () { send({ type: 'dw:control', action: 'unpair' }); },
      onOpenFile: function (id) { send({ type: 'dw:control', action: 'openFile', id: id }); },
      onToggle: function (on) { S.relay = !!on; chrome.storage.local.set({ relayEnabled: !!on }); }
    });
    chrome.storage.local.get('relayEnabled').then(function (d) { S.relay = d.relayEnabled !== false; if (S.panel) S.panel.setRelayChecked(S.relay); });
  }
  function applyState() {
    if (S.panel) S.panel.setState(Object.assign({}, S.state, { active: S.active }));
    emitStatus();
    if (S.active && S.pending && !S.state.paused && S.state.paired && !S.state.busy) { var j = S.pending; S.pending = null; submitJob(j); }
  }

  // ---------- submit ----------
  var DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;
  function buildPrompt(d) {
    var t = (S.cfg.promptTemplate || '{note}');
    return t.replace('{host}', location.hostname).replace('{pageUrl}', String(d.pageUrl || location.href)).replace('{note}', String(d.note || '(no note)'));
  }
  function onSubmitEvent(d, via) {
    if (!S.active || !S.relay) return;                       // inactive or user switched the relay off: do nothing
    if (via === 'tap' && S.nativeHook) return;               // page has its own hook; ignore the tap
    if (Date.now() - S.lastGesture > 120000) return;         // must follow a real click/keypress by the user (no scripted sends)
    var note = String(d.note || '').slice(0, 5000);
    var shot = typeof d.screenshot === 'string' && DATA_URL.test(d.screenshot) && d.screenshot.length < 20 * 1024 * 1024 ? d.screenshot : null;
    var mime = shot ? DATA_URL.exec(shot)[1] : null;
    var job = { prompt: buildPrompt({ note: note, pageUrl: d.pageUrl }), file: shot ? { name: 'markup.' + (mime === 'jpeg' ? 'jpg' : mime), type: 'image/' + mime, dataUrl: shot } : null, note: note, hadShot: !!shot };
    submitJob(job);
  }
  function queue(job) { S.pending = job; if (S.panel) S.panel.note('Paused. This will be sent to ChatGPT when you press Resume.'); }
  async function submitJob(job) {
    if (S.state.paused) return queue(job);                   // nothing new is sent while paused
    if (S.panel) S.panel.addUser((job.note || '(no note)').slice(0, 300), job.file && job.file.dataUrl);
    var p = await fetchPass();                               // fresh pass for every send
    if (!p) { if (S.panel) S.panel.error('Not sent: the site did not confirm you are an editor.'); return deactivate(); }
    var r = await send({ type: 'dw:submit', pass: p.pass, receivedAt: p.receivedAt, job: { prompt: job.prompt, file: job.file } });
    if (r && r.ok) { S.jobId = r.jobId; return; }
    var code = (r && r.code) || 'unknown';
    if (code === 'paused') return queue(job);
    var msg = { not_paired: 'Not sent: no ChatGPT tab is paired.', busy: 'Not sent: ChatGPT is still answering the previous request.', chat_tab_unreachable: 'Not sent: could not reach the ChatGPT tab.' }[code] || ('Not sent (' + code + ').');
    if (S.panel) S.panel.error(msg);
    if (S.wantEvents) toPage('dw-ext-error', { code: code, step: 'submit' });
  }

  // ---------- events from the service worker ----------
  function files2(fs) { return (fs || []).map(function (f) { return { name: f.name, url: f.url, kind: f.kind, needsTab: !!f.needsTab }; }); }
  chrome.runtime.onMessage.addListener(function (msg, sender) {
    if (sender.id !== chrome.runtime.id || !msg) return;
    if (msg.type === 'sw:state') { S.state = msg.state; applyState(); return; }
    if (msg.type !== 'sw:event') return;
    var e = msg.event || {};
    var P = S.panel;
    if (e.kind === 'step') {
      if (P) P.step(e.step, e.ok !== false, e.detail && (e.detail.strategy || e.detail.source || (e.detail.selectorIndex != null ? '#' + e.detail.selectorIndex : '')) );
      if (S.wantEvents) toPage('dw-ext-step', { step: e.step, ok: e.ok !== false });
    } else if (e.kind === 'chunk') {
      if (P) P.setReply(e.text, e.files);
      if (S.wantEvents) toPage('dw-ext-chunk', { jobId: msg.jobId, seq: e.seq, text: e.text, files: files2(e.files) });
    } else if (e.kind === 'done') {
      if (P) P.done(e.status);
      if (S.wantEvents) toPage('dw-ext-done', { jobId: msg.jobId, status: e.status, text: e.text, files: files2(e.files) });
    } else if (e.kind === 'error') {
      var text = { not_logged_in: 'ChatGPT tab is not signed in.', no_stream: 'ChatGPT did not start answering.', done_timeout: 'ChatGPT took too long.', rate_limited: 'ChatGPT says the rate limit was hit.' }[e.code];
      if (P) P.error((text || ('Relay problem at step \u201c' + e.step + '\u201d: ' + e.code + '.')) + (e.sent ? '' : ' Nothing was sent.'));
      if (S.wantEvents) toPage('dw-ext-error', { jobId: msg.jobId, code: e.code, step: e.step });
    } else if (e.kind === 'status' && P) { P.note(e.state === 'paused' ? 'Paused.' : 'Resumed.'); }
  });

  // ---------- page protocol ----------
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || ev.origin !== location.origin) return;
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.source === 'dw-edit') {
      if (d.type === 'dw-ext-hello') {
        S.nativeHook = true; S.nativePanel = d.panel === true; S.wantEvents = d.wantEvents !== false;
        if (S.nativePanel && S.panel) { S.panel.destroy(); S.panel = null; }
        // Do not send dw-ext-ready here: a page that answers ready with hello would loop.
        // activate() already posts ready once; this hello is answered with status only.
        if (!S.active && candidate()) maybeActivate();
        replyStatus();
      } else if (d.type === 'dw-ext-status') {
        if (!S.active && candidate()) maybeActivate();
        replyStatus();
      } else if (d.type === 'dw-ext-submit') onSubmitEvent(d, 'native');
      else if (d.type === 'dw-ext-control' && S.active && ['stop', 'pause', 'resume'].indexOf(d.action) >= 0) send({ type: 'dw:control', action: d.action });
    } else if (d.source === 'dw-edit-tap' && d.type === 'dw-ext-submit') onSubmitEvent(d, 'tap');
  });
  ['pointerdown', 'keydown'].forEach(function (t) { document.addEventListener(t, function (e) { if (e.isTrusted) S.lastGesture = Date.now(); }, true); });

  // ---------- start ----------
  window.addEventListener('hashchange', maybeActivate);
  new MutationObserver(function () { maybeActivate(); }).observe(document.documentElement, { childList: true });
  maybeActivate();
})();
