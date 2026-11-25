/* DW Chat Integration: reply panel. Lives in its own shadow root (host #dw-ext-root, excluded from the editor's
 * screenshot). It docks above the editor's note box (#dw-markup-root > .notebox > textarea) when that exists and
 * floats bottom-right otherwise. Reply text is rendered through DWX.renderMd (no raw HTML from the chat is ever assigned). Tab titles are never shown. */
(function () {
  'use strict';
  window.DWX = window.DWX || {};
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
    '.wrap{position:fixed;z-index:2147483647;width:360px;max-width:calc(100vw - 24px);background:#1b1d21;color:#e8eaed;border:1px solid #2d3138;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.45);font-size:13px;line-height:1.45;display:flex;flex-direction:column;overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:6px;padding:7px 8px;background:#14161a;border-bottom:1px solid #2d3138;color:#e8eaed}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#6b7280;flex:none}.dot.on{background:#34d399}.dot.paused{background:#fbbf24}.dot.err{background:#f87171}',
    '.spin{width:10px;height:10px;border:2px solid #3f4550;border-top-color:#93c5fd;border-radius:50%;flex:none;animation:dwxspin .7s linear infinite}.spin.off{visibility:hidden}',
    '@keyframes dwxspin{to{transform:rotate(360deg)}}',
    '.title{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}',
    '.hd button{border:0;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;background:#2a2f36;color:#e8eaed}',
    '.hd button:hover:not(:disabled){background:#3a404a}.hd button:disabled{opacity:.4;cursor:default}',
    '.opt{display:flex;align-items:center;gap:6px;padding:5px 9px;border-bottom:1px solid #2d3138;color:#9aa3ad;font-size:11px}',
    '.scroll{overflow:auto;max-height:min(42vh,360px);padding:8px 9px;display:flex;flex-direction:column;gap:8px}',
    '.me{align-self:stretch;background:#252830;border:1px solid #333844;border-radius:8px;padding:7px 8px;display:flex;gap:8px;align-items:flex-start}',
    '.me .thumb{width:56px;height:56px;object-fit:cover;border-radius:6px;background:#111;flex:none;border:1px solid #3a3f48}',
    '.me .txt{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;color:#d5d9e0;font-size:12px}',
    '.reply{background:#22252b;border:1px solid #333844;border-radius:8px;padding:8px 9px;word-break:break-word;color:#e8eaed}',
    '.reply.live::after{content:" \\258B";color:#93c5fd}',
    '.reply p{margin:0 0 6px}.reply p:last-child{margin:0}',
    '.reply h1,.reply h2,.reply h3{margin:0 0 6px;font-size:13px}',
    '.reply details.md-code{margin:6px 0;border:1px solid #333844;border-radius:6px;background:#111318}.reply details.md-code>summary{cursor:pointer;padding:5px 8px;font-size:12px;color:#9aa3ad}.reply details.md-code>pre{margin:0;max-height:320px}',
    '.reply pre{margin:6px 0;padding:8px;background:#111318;border-radius:6px;overflow:auto;font-size:12px}',
    '.reply code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}',
    '.reply a{color:#93c5fd}',
    '.files{display:flex;flex-direction:column;gap:3px}.files a,.files button{font-size:12px;text-align:left;color:#93c5fd;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}',
    '.note{color:#9aa3ad;font-size:12px}.error{color:#f87171;font-size:12px}',
    '.log{color:#9aa3ad;font-size:11px;line-height:1.45}',
    '.log .step{display:flex;align-items:center;gap:6px}',
    '.hide{display:none}'
  ].join('');

  function el(doc, tag, attrs, text) {
    var e = doc.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  DWX.createPanel = function (doc, h) {
    var host = el(doc, 'div', { id: 'dw-ext-root', 'data-html2canvas-ignore': 'true' });
    var root = host.attachShadow({ mode: 'open' });
    // Constructable stylesheet: not subject to a page's style-src CSP. Falls back to a <style> element.
    try { var sheet = new CSSStyleSheet(); sheet.replaceSync(CSS); root.adoptedStyleSheets = [sheet]; }
    catch (e) { root.appendChild(el(doc, 'style', null, CSS)); }
    var P = window.DWX && DWX.providers;
    function L(id) { return P ? P.label(id) : 'ChatGPT'; }
    var wrap = el(doc, 'div', { class: 'wrap', role: 'region', 'aria-label': 'AI relay' });
    var hd = el(doc, 'div', { class: 'hd' });
    var dot = el(doc, 'span', { class: 'dot', 'data-role': 'dot' });
    var title = el(doc, 'span', { class: 'title', 'data-role': 'title' }, 'AI relay');
    var spin = el(doc, 'span', { class: 'spin off', 'data-role': 'spin', 'aria-hidden': 'true' });
    // v0.1.6: which AI gets the request (remembered by the extension).
    var pick = el(doc, 'select', { 'data-role': 'provider', 'aria-label': 'AI', title: 'Which AI gets your request' });
    (P ? P.all() : [{ id: 'chatgpt', label: 'ChatGPT' }]).forEach(function (p) { var o = el(doc, 'option', { value: p.id }, p.label); pick.appendChild(o); });
    var bStop = el(doc, 'button', { type: 'button', 'data-act': 'stop', title: 'Stop the AI (clicks its Stop button)' }, 'Stop');
    var bPause = el(doc, 'button', { type: 'button', 'data-act': 'pause', title: 'Hold the relay; nothing new is sent until you resume' }, 'Pause');
    var bUnpair = el(doc, 'button', { type: 'button', 'data-act': 'unpair', title: 'Forget the paired AI tab' }, 'Unpair');
    var bMin = el(doc, 'button', { type: 'button', 'data-act': 'min', title: 'Collapse' }, '\u2212');
    [dot, title, pick, spin, bStop, bPause, bUnpair, bMin].forEach(function (n) { hd.appendChild(n); });
    var opt = el(doc, 'label', { class: 'opt' });
    var chk = el(doc, 'input', { type: 'checkbox', 'data-role': 'relay-toggle' });
    chk.checked = true;
    opt.appendChild(chk); var optText = el(doc, 'span', { 'data-role': 'relay-text' }, 'Also send my request to the AI when I press Send');
    opt.appendChild(optText);
    var scroll = el(doc, 'div', { class: 'scroll', 'data-role': 'scroll', role: 'log', 'aria-live': 'polite' });
    var body = el(doc, 'div', { 'data-role': 'body' });
    body.appendChild(opt); body.appendChild(scroll);
    wrap.appendChild(hd); wrap.appendChild(body);
    root.appendChild(wrap);

    var replyEl = null, filesEl = null, logEl = null, state = { paired: false, paused: false, busy: false, active: false };
    var stickBottom = true;
    scroll.addEventListener('scroll', function () { stickBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 12; });
    function autoscroll() { if (stickBottom) scroll.scrollTop = scroll.scrollHeight; }

    bStop.addEventListener('click', function () { h.onStop(); });
    bPause.addEventListener('click', function () { state.paused ? h.onResume() : h.onPause(); });
    bUnpair.addEventListener('click', function () { h.onUnpair(); });
    bMin.addEventListener('click', function () { var hidden = body.classList.toggle('hide'); bMin.textContent = hidden ? '+' : '\u2212'; place(); });
    chk.addEventListener('change', function () { h.onToggle(chk.checked); });
    pick.addEventListener('change', function () { if (h.onProvider) h.onProvider(pick.value); });

    // ---- docking above the editor's note box ----
    var notebox = null, ro = null, mo = null, markupMo = null;
    function findNotebox() {
      var m = doc.getElementById('dw-markup-root');
      return m && m.shadowRoot ? m.shadowRoot.querySelector('.notebox') : null;
    }
    function place() {
      var nb = findNotebox();
      if (nb !== notebox) {
        if (ro) { ro.disconnect(); ro = null; }
        notebox = nb;
        if (nb && window.ResizeObserver) { ro = new ResizeObserver(place); ro.observe(nb); }
      }
      var right = 16, bottom = 16, width = 340;
      if (nb) {
        var r = nb.getBoundingClientRect();
        if (r.width > 0) { right = Math.max(8, window.innerWidth - r.right); bottom = Math.max(8, window.innerHeight - r.top + 8); width = r.width; }
      }
      if (!nb || !(nb.getBoundingClientRect().width > 0)) {
        // editor closed: sit above its "Suggest an edit" button instead of covering it
        var m = doc.getElementById('dw-markup-root'), fab = m && m.shadowRoot ? m.shadowRoot.querySelector('.fab') : null;
        var fr = fab ? fab.getBoundingClientRect() : null;
        if (fr && fr.width > 0 && fr.height > 0) bottom = Math.max(8, window.innerHeight - fr.top + 8);
      }
      wrap.style.right = right + 'px'; wrap.style.bottom = bottom + 'px'; wrap.style.width = Math.min(Math.max(width, 300), window.innerWidth - 16) + 'px';
      wrap.style.maxHeight = Math.max(120, window.innerHeight - bottom - 8) + 'px';
    }
    function watchEditor() {
      var m = doc.getElementById('dw-markup-root');
      if (m && m.shadowRoot && !markupMo) {
        markupMo = new MutationObserver(place); markupMo.observe(m.shadowRoot, { childList: true, subtree: true });
      }
    }
    mo = new MutationObserver(function () { watchEditor(); place(); });
    mo.observe(doc.documentElement, { childList: true });
    window.addEventListener('resize', place);
    watchEditor();
    doc.documentElement.appendChild(host);
    place();

    function render() {
      var s = state;
      dot.className = 'dot' + (s.paused ? ' paused' : (s.active && s.paired ? ' on' : ''));
      var want = s.provider || 'chatgpt', name = L(want);
      if (pick.value !== want) pick.value = want;
      pick.disabled = !!s.busy;
      optText.textContent = 'Also send my request to ' + name + ' when I press Send';
      var pairedHere = s.paired && (!s.site || s.site === want);
      title.textContent = s.busy ? 'Sending to ' + name + '\u2026'
        : !s.active ? name + ' relay (waiting for editor pass)'
        : pairedHere ? 'Paired with ' + name
        : !s.paired ? name + ' relay: no tab paired'
        : name + ' relay';
      bStop.disabled = !s.busy; bPause.disabled = !s.paired; bUnpair.disabled = !s.paired;
      bPause.textContent = s.paused ? 'Resume' : 'Pause';
      chk.disabled = !s.active;
      var hint = scroll.querySelector('[data-role=hint]');
      if (!pairedHere) {
        var ht = 'On Send, an open ' + name + ' tab is reused, or a new one opens in the background. Sign in to ' + name + ' in Chrome first.';
        if (!hint) scroll.insertBefore(el(doc, 'div', { class: 'note', 'data-role': 'hint' }, ht), scroll.firstChild);
        else hint.textContent = ht;
      } else if (hint) hint.remove();
    }
    render();

    function ensureReply() {
      if (!replyEl) {
        replyEl = el(doc, 'div', { class: 'reply live', 'data-role': 'reply' });
        filesEl = el(doc, 'div', { class: 'files', 'data-role': 'files' });
        logEl = el(doc, 'div', { class: 'log', 'data-role': 'log' });
        scroll.appendChild(logEl); scroll.appendChild(replyEl); scroll.appendChild(filesEl);
      }
    }

    return {
      host: host, root: root,
      setState: function (st) { state = Object.assign(state, st); render(); },
      setRelayChecked: function (on) { chk.checked = !!on; },
      addUser: function (text, shot) {
        replyEl = null; filesEl = null; logEl = null;
        // v0.1.11: keep earlier turns (including a restored reply). Mark them done / not live so they are not taken for this send.
        Array.prototype.forEach.call(scroll.querySelectorAll('[data-role=reply]'), function (n) {
          n.classList.remove('live');
          if (!n.getAttribute('data-done')) n.setAttribute('data-done', 'complete');
        });
        var row = el(doc, 'div', { class: 'me', 'data-role': 'me' });
        if (typeof shot === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(shot)) {
          var img = el(doc, 'img', { class: 'thumb', 'data-role': 'thumb', alt: 'Screenshot sent' });
          img.src = shot;
          row.appendChild(img);
        }
        row.appendChild(el(doc, 'div', { class: 'txt', 'data-role': 'me-text' }, text));
        scroll.appendChild(row); stickBottom = true; autoscroll();
      },
      note: function (text) { scroll.appendChild(el(doc, 'div', { class: 'note', 'data-role': 'note' }, text)); autoscroll(); },
      step: function (name, ok, detail, pageFiles) {
        ensureReply();
        var nameAi = L(state.provider || 'chatgpt');
        var labels = { instructions: 'Getting ready', open_tab: 'Opening ' + nameAi, newChat: 'New chat', prompt: 'Opening ' + nameAi, text: 'Writing your note', attach: 'Screenshot sent', send: 'Screenshot sent', stream: nameAi + ' is reading\u2026', stop: 'Stopped', retry_bundled: 'Trying the bundled instructions', attach_inline: nameAi + ' did not take the upload, so the files went in the message as text (no screenshot)' };
        var label = labels[name] || name;
        if ((name === 'send' || name === 'attach') && ok) {
          var haveShot = logEl.querySelector('[data-step=send],[data-step=attach]');
          logEl.appendChild(el(doc, 'div', { class: haveShot ? 'step hide' : 'step', 'data-step': name, 'data-ok': '1' }, (pageFiles > 0 ? '\u2713 Uploaded screenshot + ' + pageFiles + (pageFiles === 1 ? ' file' : ' files') : '\u2713 Screenshot sent') + (detail ? ' ' + detail : '')));
          if (!logEl.querySelector('[data-role=reading]')) logEl.appendChild(el(doc, 'div', { class: 'step', 'data-step': 'stream', 'data-ok': '0', 'data-role': 'reading' }, nameAi + ' is reading\u2026'));
          spin.classList.remove('off');
          autoscroll();
          return;
        }
        if (name === 'stream') {
          spin.classList.remove('off');
          if (!logEl.querySelector('[data-step=stream],[data-role=reading]')) logEl.appendChild(el(doc, 'div', { class: 'step', 'data-step': 'stream', 'data-ok': '0', 'data-role': 'reading' }, nameAi + ' is reading\u2026'));
          else if (!logEl.querySelector('[data-step=stream]')) logEl.appendChild(el(doc, 'div', { class: 'step hide', 'data-step': 'stream', 'data-ok': '1', 'aria-hidden': 'true' }, ''));
          autoscroll();
          return;
        }
        logEl.appendChild(el(doc, 'div', { class: 'step', 'data-step': name, 'data-ok': ok ? '1' : '0' }, (ok ? '\u2713 ' : '\u2717 ') + label + (detail && name !== 'attach' && name !== 'send' ? ' ' + detail : '')));
        autoscroll();
      },
      setReply: function (text, files) {
        ensureReply();
        var reading = logEl && logEl.querySelector('[data-role=reading]');
        if (reading) { reading.setAttribute('data-ok', '1'); reading.textContent = '\u2713 ' + L(state.provider || 'chatgpt') + ' is reading\u2026'; }
        spin.classList.remove('off');
        if (window.DWX && typeof DWX.renderMd === 'function') DWX.renderMd(doc, text, replyEl);
        else replyEl.textContent = text;
        filesEl.textContent = '';
        (files || []).forEach(function (f) {
          if (!f.needsTab && /^https:/i.test(f.url)) {
            var a = el(doc, 'a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', 'data-kind': f.kind }, '\u2B07 ' + f.name);
            filesEl.appendChild(a);
          } else if (f.kind === 'link' && /^https:/i.test(f.url)) {
            filesEl.appendChild(el(doc, 'a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', 'data-kind': 'link' }, '\u2197 ' + f.name));
          } else {
            var b = el(doc, 'button', { type: 'button', 'data-kind': f.kind, 'data-id': f.id }, '\u2B07 ' + f.name + ' (open in ' + L(state.provider || 'chatgpt') + ' tab)');
            b.addEventListener('click', function () { h.onOpenFile(f.id); });
            filesEl.appendChild(b);
          }
        });
        autoscroll();
      },
      done: function (status) { ensureReply(); replyEl.classList.remove('live'); replyEl.setAttribute('data-done', status); spin.classList.add('off'); if (status === 'stopped') this.note('Stopped.'); },
      error: function (msg) {
        scroll.appendChild(el(doc, 'div', { class: 'error', 'data-role': 'error' }, msg));
        if (replyEl) replyEl.classList.remove('live'); spin.classList.add('off'); dot.classList.add('err');
        if (h.onSnapshot && !scroll.querySelector('[data-act=snapshot]')) {
          var row = el(doc, 'div', { class: 'note', 'data-role': 'snap-row' });
          var b = el(doc, 'button', { type: 'button', 'data-act': 'snapshot' }, 'Send page snapshot');
          var st = el(doc, 'span', { 'data-role': 'snap-status' }, '');
          b.addEventListener('click', function () {
            st.textContent = ' Capturing…';
            Promise.resolve(h.onSnapshot()).then(function (r) {
              st.textContent = !r || !r.ok ? (' Could not capture' + (r && r.code ? ' (' + r.code + ').' : '.')) : (r.via === 'upload' ? (' Sent. Snapshot id: ' + r.id) : (' Downloaded. Snapshot id: ' + r.id));
              if (r && r.ok && r.via === 'download' && r.json) {
                var a = doc.createElement('a'); a.href = URL.createObjectURL(new Blob([r.json], { type: 'application/json' })); a.download = r.filename || ('dw-snap-' + r.id + '.json'); doc.documentElement.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
              }
            }).catch(function () { st.textContent = ' Could not capture.'; });
          });
          row.appendChild(b); row.appendChild(st); scroll.appendChild(row);
        }
        autoscroll();
      },
      place: place,
      destroy: function () { if (mo) mo.disconnect(); if (markupMo) markupMo.disconnect(); if (ro) ro.disconnect(); window.removeEventListener('resize', place); host.remove(); }
    };
  };
})();
