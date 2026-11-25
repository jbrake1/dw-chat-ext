/* DW Chat Integration: page source files sent with a Suggest an edit request (v0.1.3).
 * The DW editor page (markup.js) downloads the page's own HTML, same-origin CSS/JS and relevant images and posts
 * them with dw-ext-submit. Everything from the page is untrusted: this file keeps only allowlisted types, safe
 * names and paths, and enforces count and size caps before anything is handed to the chat tab. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.DWX = root.DWX || {}; Object.assign(root.DWX, api); }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  var LIMITS = { maxFiles: 10, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 6 * 1024 * 1024, maxSkipped: 20 };
  // extension -> mime. The mime sent to the chat is always taken from this table, never from the page.
  var TYPES = {
    html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain'                     // v0.1.5: files the user attaches in the editor
  };
  var NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
  var PATH = /^\/[A-Za-z0-9._~\/%-]{0,299}$/;
  var REASONS = ['too_large', 'limit', 'third_party', 'fetch_failed', 'type', 'duplicate', 'off'];
  function extOf(name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function safePath(p) {
    p = String(p || '');
    if (!PATH.test(p) || /(^|\/)\.\.?(\/|$)/.test(p) || p.indexOf('//') >= 0) return null;
    return p;
  }
  function b64Bytes(b64) {
    var n = b64.length; if (!n) return 0;
    var pad = b64.charAt(n - 1) === '=' ? (b64.charAt(n - 2) === '=' ? 2 : 1) : 0;
    return Math.floor(n * 3 / 4) - pad;
  }
  function uniqueName(name, used) {
    if (!used[name]) { used[name] = 1; return name; }
    var dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (var i = 2; i < 100; i++) { var n = base + '-' + i + ext; if (!used[n]) { used[n] = 1; return n; } }
    return null;
  }
  // files: [{name, path, mime, size, dataUrl, attached?}] from the page. reserved: names already used (the screenshot).
  // v0.1.5: attached:true marks a file the user attached in the editor; its path is where it should go on the site
  // ('' = just show it to the AI). Attached files are listed first by the editor, so they count first against the caps.
  // Returns { files: [{name, path, type, size, dataUrl, attached}], skipped: [{path, reason}] }.
  function sanitizePageFiles(files, skippedIn, opts) {
    var L = Object.assign({}, LIMITS, (opts && opts.limits) || {});
    var used = {}; ((opts && opts.reserved) || []).forEach(function (n) { used[n] = 1; });
    var out = [], skipped = [], total = 0, seen = {};
    function skip(path, reason) { if (skipped.length < L.maxSkipped) skipped.push({ path: String(safePath(path) || '(unnamed)').slice(0, 300), reason: reason }); }
    (Array.isArray(files) ? files : []).slice(0, 50).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var att = f.attached === true;
      var path = att && f.path === '' ? '' : safePath(f.path);
      var name = typeof f.name === 'string' && NAME.test(f.name) ? f.name : null;
      if (path === null || !name) return skip(f.path, 'type');
      var ext = extOf(name), type = TYPES[ext];
      if (!type) return skip(path || name, 'type');
      if (path && TYPES[extOf(path.split('/').pop())] !== type) return skip(path, 'type');   // an upload keeps its type
      if (path && seen[path]) return skip(path, 'duplicate');
      var m = typeof f.dataUrl === 'string' ? /^data:([A-Za-z0-9.+\/-]{1,80})(?:;charset=[A-Za-z0-9_-]{1,20})?;base64,([A-Za-z0-9+\/]*={0,2})$/.exec(f.dataUrl) : null;
      if (!m) return skip(path || name, 'type');
      var size = b64Bytes(m[2]);
      if (size > L.maxFileBytes) return skip(path || name, 'too_large');
      if (out.length >= L.maxFiles || total + size > L.maxTotalBytes) return skip(path || name, 'limit');
      var uname = uniqueName(name, used);
      if (!uname) return skip(path || name, 'duplicate');
      if (path) seen[path] = 1; total += size;
      out.push({ name: uname, path: path, type: type, size: size, dataUrl: 'data:' + type + ';base64,' + m[2], attached: att });
    });
    (Array.isArray(skippedIn) ? skippedIn : []).forEach(function (s) {
      if (s && typeof s === 'object' && REASONS.indexOf(s.reason) >= 0) skip(s.path, s.reason);
    });
    return { files: out, skipped: skipped, totalBytes: total };
  }
  function kb(n) { return n < 1024 ? n + ' B' : (Math.round(n / 102.4) / 10) + ' KB'; }
  var WHY = { too_large: 'too large', limit: 'over the file limit', third_party: 'not on this site', fetch_failed: 'could not be downloaded', type: 'unsupported type', duplicate: 'duplicate', off: 'not sent' };
  // Text appended to the prompt. Lists every attached file and what the AI should send back.
  function filesPrompt(files, skipped, shotName) {
    if (!files.length && !(skipped && skipped.length)) return '';
    var lines = ['', 'Attached files:'];
    if (shotName) lines.push('- ' + shotName + ': the screenshot with my markup');
    var mine = files.filter(function (f) { return f.attached; }), page = files.filter(function (f) { return !f.attached; });
    files.forEach(function (f) {
      var meta = ' (' + f.type + ', ' + kb(f.size) + ')';
      if (!f.attached) lines.push('- ' + f.name + ': current source of ' + f.path + meta);
      else if (f.path) lines.push('- ' + f.name + ': a file I am adding, to be put on the site at ' + f.path + meta);
      else lines.push('- ' + f.name + ': a file I uploaded for you to look at, not for the site' + meta);
    });
    if (skipped && skipped.length) {
      lines.push('Not attached:');
      skipped.forEach(function (s) { lines.push('- ' + s.path + ' (' + (WHY[s.reason] || s.reason) + ')'); });
    }
    if (page.length) {
      lines.push('', 'The files marked "current source of" are the exact current files on the site. Edit them, not a copy of the rendered page. For every file that must change, return the COMPLETE updated file (not a diff or a fragment) in its own code block in your reply (a download link alone is not enough), with a line just above the block that gives its path, for example "File: ' + page[0].path + '". Keep the same file names and paths. Do not return files that do not change.');
    }
    var dest = mine.filter(function (f) { return f.path; });
    if (dest.length) {
      lines.push('', 'The files marked "a file I am adding" are mine and go on the site at the path shown. To use one exactly as it is, write a line "File: ' + dest[0].path + '" (its own path) in your reply; for a picture, PDF or other binary file that line is all that is needed, because it cannot be sent back as text. If one of my text files has to change first, return the COMPLETE updated file in a code block with that "File:" line just above it. Write "File: <path>" only for a file that really should go on the site, and use the path I gave. Where my page needs to refer to such a file, use that path.');
    }
    return lines.join('\n');
  }
  return { PAGE_FILE_LIMITS: LIMITS, PAGE_FILE_TYPES: TYPES, sanitizePageFiles: sanitizePageFiles, filesPrompt: filesPrompt };
});
