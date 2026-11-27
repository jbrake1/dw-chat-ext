/* DW Chat Integration: conversation URL helper (v0.1.15).
 * Turns a pasted AI chat link into a canonical conversation address (origin + path only: no query, no hash).
 * Read-only: used to open or focus an existing chat. Never identifies share, settings, search or "new chat" URLs.
 */
(function (root) {
  'use strict';
  var DWX = root.DWX = root.DWX || {};

  // provider id -> { hosts, path }. path is matched against the pathname (no trailing slash).
  // Capture group 1 is the conversation id. Share/search/settings/new-chat paths are omitted on purpose.
  var RULES = {
    gemini: {
      hosts: ['gemini.google.com'],
      // /app/<id> or /u/0/app/<id> (Google account-scoped). Not bare /app.
      path: /^\/(?:u\/\d+\/)?app\/([A-Za-z0-9_-]{6,})$/
    },
    chatgpt: {
      hosts: ['chatgpt.com'],
      // /c/<id> or a GPT link /g/g-.../c/<id>
      path: /^\/(?:g\/g-[A-Za-z0-9_-]+\/)?c\/([A-Za-z0-9_-]{8,})$/
    },
    claude: {
      hosts: ['claude.ai'],
      path: /^\/chat\/([A-Za-z0-9_-]{8,})$/
    },
    grok: {
      hosts: ['grok.com'],
      path: /^\/(?:chat|c)\/([A-Za-z0-9_-]{6,})$/
    }
  };

  function hostOf(u) {
    var h = String((u && u.hostname) || '').toLowerCase();
    return h.indexOf('www.') === 0 ? h.slice(4) : h;
  }

  function providerOfHost(host) {
    var h = String(host || '').toLowerCase();
    if (h.indexOf('www.') === 0) h = h.slice(4);
    var ids = Object.keys(RULES);
    for (var i = 0; i < ids.length; i++) if (RULES[ids[i]].hosts.indexOf(h) >= 0) return ids[i];
    return null;
  }

  // {ok:true, provider, url, id} or {ok:false, code:'bad_url'|'not_conversation'}
  function canonicalizeChatUrl(input, opts) {
    var raw = String(input || '').trim();
    if (!raw) return { ok: false, code: 'bad_url' };
    var u;
    try { u = new URL(raw); } catch (e) { return { ok: false, code: 'bad_url' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, code: 'bad_url' };
    var aliases = (opts && opts.aliases) || {};
    var h = hostOf(u);
    var provider = providerOfHost(u.hostname) || aliases[h] || aliases[u.hostname];
    if (!provider || !RULES[provider]) return { ok: false, code: 'not_conversation' };
    var path = u.pathname.replace(/\/+$/, '') || '/';
    // Reject share / search / settings / auth paths even if they somehow matched.
    if (/\/(share|search|settings|auth|login|signup|explore|library|projects?)(\/|$)/i.test(path)) {
      return { ok: false, code: 'not_conversation' };
    }
    var m = RULES[provider].path.exec(path);
    if (!m) return { ok: false, code: 'not_conversation' };
    return { ok: true, provider: provider, url: u.origin + path, id: m[1] };
  }

  function isChatUrl(input, opts) { return !!canonicalizeChatUrl(input, opts).ok; }

  DWX.canonicalizeChatUrl = canonicalizeChatUrl;
  DWX.providerOfHost = DWX.providerOfHost || providerOfHost;
  DWX.isChatUrl = isChatUrl;
  DWX.CHAT_URL_RULES = RULES;

  if (typeof module === 'object' && module.exports) {
    module.exports = { canonicalizeChatUrl: canonicalizeChatUrl, providerOfHost: providerOfHost, isChatUrl: isChatUrl, RULES: RULES };
  }
})(typeof self !== 'undefined' ? self : globalThis);
