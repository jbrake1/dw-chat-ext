/* DW Chat Integration: chat-tab content script (generic).
 * Receives {instr, job} from the service worker and hands them to the interpreter/runner. It knows nothing about
 * the chat site's DOM; all of that is in `instr` (the site instructions JSON). */
(function () {
  'use strict';
  if (window.__dwGpt) return;
  window.__dwGpt = true;
  var current = null; // {jobId, ctl, keepalive}

  function send(msg) { try { return chrome.runtime.sendMessage(msg).catch(function () {}); } catch (e) { return null; } }
  function clear() { if (current && current.keepalive) clearInterval(current.keepalive); current = null; }

  function start(msg) {
    var jobId = msg.jobId;
    var instr = msg.instr;
    function emit(evt) {
      send({ type: 'gpt:event', jobId: jobId, event: evt });
      if (evt.kind === 'done' || (evt.kind === 'error' && evt.fatal)) clear();
    }
    if (!instr.match.hosts.some(function (h) { return location.hostname === h; })) {
      emit({ kind: 'error', step: 'run', code: 'host_mismatch', sent: false, fatal: true });
      return;
    }
    // v0.1.9: the page-world upload hook (content/ai-hook.js) may need injecting into a tab that was already open.
    var ctl = DWX.runJob(window, instr, msg.job, { emit: emit, ensureHook: function () { return chrome.runtime.sendMessage({ type: 'gpt:hook' }).catch(function () { return null; }); } });
    // Keeps the MV3 service worker from idling out while the reply is slow to start. Not DOM polling.
    current = { jobId: jobId, ctl: ctl, keepalive: setInterval(function () { send({ type: 'gpt:keepalive' }); }, 20000) };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (sender.id !== chrome.runtime.id) return;
    switch (msg && msg.type) {
      case 'gpt:ping': sendResponse({ ok: true }); break;
      case 'gpt:run':
        if (current) { sendResponse({ ok: false, code: 'busy' }); break; }
        start(msg); sendResponse({ ok: true }); break;
      case 'gpt:snapshot':
        // Read-only: never starts, stops or changes a job. Structure and selector counts only.
        try { sendResponse(DWX.pageSnapshot(window, msg.instr || {})); }
        catch (e) { sendResponse({ ok: false, code: 'snapshot_failed' }); }
        break;
      case 'gpt:peek':
        // v0.1.11: re-read the last assistant reply (and its code blocks) after the DW page was reloaded.
        // Read-only: never starts, stops or changes a job, and never sends anything in the composer.
        try {
          var instr = msg.instr || {};
          var n = (DWX.countMessages && DWX.countMessages(document, instr)) || 0;
          var baseline = Math.max(0, n - 1);
          var st = DWX.readState(window, document, instr, baseline, null);
          var blocks = DWX.readBlocks(window, document, instr, baseline) || [];
          sendResponse({ ok: !!(st && (st.text || (blocks && blocks.length))), text: (st && st.text) || '', files: (st && st.files) || [], blocks: blocks });
        } catch (e) { sendResponse({ ok: false, code: 'peek_failed' }); }
        break;
      case 'gpt:control':
        if (!current || current.jobId !== msg.jobId) { sendResponse({ ok: false }); break; }
        if (msg.action === 'stop') current.ctl.stop();
        else if (msg.action === 'pause') current.ctl.pause();
        else if (msg.action === 'resume') current.ctl.resume();
        else if (msg.action === 'openFile') current.ctl.openFile(msg.id);
        else if (msg.action === 'abort') { current.ctl.abort(); clear(); }
        sendResponse({ ok: true }); break;
    }
  });
})();
