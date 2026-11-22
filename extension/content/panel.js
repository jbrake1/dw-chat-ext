/* DW Chat Integration: reply panel. Lives in its own shadow root (host #dw-ext-root, excluded from the editor's
 * screenshot). It docks above the editor's note box (#dw-markup-root > .notebox > textarea) when that exists and
 * floats bottom-right otherwise. Everything is rendered with textContent (no HTML from the chat is ever injected). */
(function () {
  'use strict';
  window.DWX = window.DWX || {};
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}',
    '.wrap{position:fixed;z-index:2147483647;width:340px;max-width:calc(100vw - 32px);background:#fff;color:#1d2a20;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);font-size:13px;display:flex;flex-direction:column;overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:6px;padding:7px 9px;background:#1f4d2b;color:#fff}',
    '.dot{width:9px;height:9px;border-radius:50%;background:#9aa;flex:none}.dot.on{background:#5fe08a}.dot.paused{background:#f5c542}.dot.err{background:#ff6b5b}',
    '.title{font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hd button{border:0;border-radius:6px;padding:3px 8px;font-size:12px;cursor:pointer;background:rgba(255,255,255,.18);color:#fff}',
    '.hd button:hover:not(:disabled){background:rgba(255,255,255,.32)}.hd button:disabled{opacity:.4;cursor:default}',
    '.opt{display:flex;align-items:center;gap:6px;padding:5px 9px;border-bottom:1px solid #e6ebe4;color:#4a5a4d;font-size:12px}',
    '.scroll{overflow:auto;max-height:min(34vh,300px);padding:8px 9px;display:flex;flex-direction:column;gap:7px}',
    '.me{align-self:flex-end;background:#eef2ec;border-radius:8px;padding:5px 8px;max-width:92%;white-space:pre-wrap;word-break:break-word}',
    '.reply{background:#f6f8f5;border-radius:8px;padding:6px 8px;white-space:pre-wrap;word-break:break-word}',
    '.reply.live::after{content:" \\258B";color:#1f4d2b}',
    '.files{display:flex;flex-direction:column;gap:3px}.files a,.files button{font-size:12px;text-align:left;color:#0b57d0;background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}',
    '.note{color:#6a786d;font-size:12px}.error{color:#b3261e;font-size:12px}',
    '.log{color:#6a786d;font-size:11px;line-height:1.4}',
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
    var wrap = el(doc, 'div', { class: 'wrap', role: 'region', 'aria-label': 'ChatGPT relay' });
    var hd = el(doc, 'div', { class: 'hd' });
    var dot = el(doc, 'span', { class: 'dot', 'data-role': 'dot' });
    var title = el(doc, 'span', { class: 'title', 'data-role': 'title' }, 'ChatGPT relay');
    var bStop = el(doc, 'button', { type: 'button', 'data-act': 'stop', title: 'Stop ChatGPT (clicks its Stop button)' }, 'Stop');
    var bPause = el(doc, 'button', { type: 'button', 'data-act': 'pause', title: 'Hold the relay; nothing new is sent until you resume' }, 'Pause');
    var bUnpair = el(doc, 'button', { type: 'button', 'data-act': 'unpair', title: 'Forget the paired ChatGPT tab' }, 'Unpair');
    var bMin = el(doc, 'button', { type: 'button', 'data-act': 'min', title: 'Collapse' }, '\u2212');
    [dot, title, bStop, bPause, bUnpair, bMin].forEach(function (n) { hd.appendChild(n); });
    var opt = el(doc, 'label', { class: 'opt' });
    var chk = el(doc, 'input', { type: 'checkbox', 'data-role': 'relay-toggle' });
    chk.checked = true;
    opt.appendChild(chk); opt.appendChild(el(doc, 'span', null, 'Also send my request to ChatGPT when I press Send'));
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
      title.textContent = !s.active ? 'ChatGPT relay (waiting for editor pass)' : !s.paired ? 'ChatGPT relay: no tab paired' : ('ChatGPT relay: ' + (s.pairedTitle || 'paired tab'));
      bStop.disabled = !s.busy; bPause.disabled = !s.paired; bUnpair.disabled = !s.paired;
      bPause.textContent = s.paused ? 'Resume' : 'Pause';
      chk.disabled = !s.paired;
      if (!s.paired && !scroll.querySelector('[data-role=hint]')) {
        scroll.insertBefore(el(doc, 'div', { class: 'note', 'data-role': 'hint' }, 'To use ChatGPT here: open chatgpt.com in another tab, click the DW Chat Integration icon there, then \u201cPair this tab\u201d.'), scroll.firstChild);
      } else if (s.paired) { var hint = scroll.querySelector('[data-role=hint]'); if (hint) hint.remove(); }
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
      addUser: function (text) {
        replyEl = null; filesEl = null; logEl = null;
        scroll.appendChild(el(doc, 'div', { class: 'me', 'data-role': 'me' }, text)); stickBottom = true; autoscroll();
      },
      note: function (text) { scroll.appendChild(el(doc, 'div', { class: 'note', 'data-role': 'note' }, text)); autoscroll(); },
      step: function (name, ok, detail) {
        ensureReply();
        logEl.appendChild(el(doc, 'div', { 'data-step': name, 'data-ok': ok ? '1' : '0' }, (ok ? '\u2713 ' : '\u2717 ') + name + (detail ? ' ' + detail : '')));
        autoscroll();
      },
      setReply: function (text, files) {
        ensureReply();
        replyEl.textContent = text;
        filesEl.textContent = '';
        (files || []).forEach(function (f) {
          if (!f.needsTab && /^https:/i.test(f.url)) {
            var a = el(doc, 'a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', 'data-kind': f.kind }, '\u2B07 ' + f.name);
            filesEl.appendChild(a);
          } else if (f.kind === 'link' && /^https:/i.test(f.url)) {
            filesEl.appendChild(el(doc, 'a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', 'data-kind': 'link' }, '\u2197 ' + f.name));
          } else {
            var b = el(doc, 'button', { type: 'button', 'data-kind': f.kind, 'data-id': f.id }, '\u2B07 ' + f.name + ' (open in ChatGPT tab)');
            b.addEventListener('click', function () { h.onOpenFile(f.id); });
            filesEl.appendChild(b);
          }
        });
        autoscroll();
      },
      done: function (status) { ensureReply(); replyEl.classList.remove('live'); replyEl.setAttribute('data-done', status); if (status === 'stopped') this.note('Stopped.'); },
      error: function (msg) { scroll.appendChild(el(doc, 'div', { class: 'error', 'data-role': 'error' }, msg)); if (replyEl) replyEl.classList.remove('live'); autoscroll(); },
      place: place,
      destroy: function () { if (mo) mo.disconnect(); if (markupMo) markupMo.disconnect(); if (ro) ro.disconnect(); window.removeEventListener('resize', place); host.remove(); }
    };
  };
})();
