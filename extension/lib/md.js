/* Safe markdown-ish renderer: never assigns untrusted HTML. Only https: links become anchors. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  function el(doc, tag, attrs, text) {
    var e = doc.createElement(tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function inline(doc, parent, s) {
    var re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\))/g;
    var last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) parent.appendChild(doc.createTextNode(s.slice(last, m.index)));
      var tok = m[0];
      if (tok.charAt(0) === '`') parent.appendChild(el(doc, 'code', null, tok.slice(1, -1)));
      else if (tok.slice(0, 2) === '**') parent.appendChild(el(doc, 'strong', null, tok.slice(2, -2)));
      else if (tok.charAt(0) === '*') parent.appendChild(el(doc, 'em', null, tok.slice(1, -1)));
      else {
        var a = el(doc, 'a', { href: m[3], target: '_blank', rel: 'noopener noreferrer' }, m[2]);
        parent.appendChild(a);
      }
      last = m.index + tok.length;
    }
    if (last < s.length) parent.appendChild(doc.createTextNode(s.slice(last)));
  }

  function renderMd(doc, text, into) {
    into.textContent = '';
    var src = String(text || '').replace(/\r\n/g, '\n');
    var chunks = src.split(/```/);
    for (var i = 0; i < chunks.length; i++) {
      if (i % 2 === 1) {
        var body = chunks[i];
        var nl = body.indexOf('\n');
        var lang = '';
        if (nl >= 0) { lang = body.slice(0, nl).trim(); body = body.slice(nl + 1); }
        if (body.slice(-1) === '\n') body = body.slice(0, -1);
        var pre = el(doc, 'pre', { class: 'md-pre' });
        var code = el(doc, 'code', lang ? { 'data-lang': lang } : null, body);
        pre.appendChild(code);
        into.appendChild(pre);
        continue;
      }
      var lines = chunks[i].split('\n'), para = [];
      function flushP() {
        if (!para.length) return;
        var p = el(doc, 'p');
        inline(doc, p, para.join(' '));
        into.appendChild(p);
        para = [];
      }
      var list = null;
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        var hm = /^(#{1,3})\s+(.+)$/.exec(line);
        var ul = /^[-*]\s+(.+)$/.exec(line);
        var ol = /^(\d+)\.\s+(.+)$/.exec(line);
        if (hm) {
          if (list) { into.appendChild(list); list = null; }
          flushP();
          var h = el(doc, 'h' + hm[1].length);
          inline(doc, h, hm[2]);
          into.appendChild(h);
        } else if (ul || ol) {
          flushP();
          var tag = ul ? 'ul' : 'ol';
          if (!list || list.tagName.toLowerCase() !== tag) {
            if (list) into.appendChild(list);
            list = el(doc, tag);
          }
          var item = el(doc, 'li');
          inline(doc, item, (ul || ol)[ul ? 1 : 2]);
          list.appendChild(item);
        } else if (line.trim() === '') {
          if (list) { into.appendChild(list); list = null; }
          flushP();
        } else {
          if (list) { into.appendChild(list); list = null; }
          para.push(line);
        }
      }
      if (list) into.appendChild(list);
      flushP();
    }
    return into;
  }
  return { renderMd: renderMd };
});
