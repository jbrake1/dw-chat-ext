/* DW Chat Integration: AI provider adapters (v0.1.6).
 * A provider adapter is plain data about one chat site. It holds NO page selectors: those stay in the site
 * instructions JSON (instructions/<id>.json), which the generic interpreter runs and which can be updated remotely.
 *
 * Adapter interface:
 *   id               short id, also the instructions file name and the siteId used everywhere else ('chatgpt', 'gemini')
 *   label            name shown to the editor ('ChatGPT', 'Gemini')
 *   hosts            hostnames the chat runs on (pairing, host checks)
 *   tabMatches       chrome.tabs.query url patterns used to find an open tab to reuse
 *   newChatUrl       URL opened when no tab is open yet (always a fresh, empty conversation)
 *   instructions     bundled instructions file, relative to the extension root
 *   signInUrl        where the editor signs in (shown in messages only; the extension never signs in)
 *   messages         editor-facing text per relay error code (falls back to DEFAULT_MESSAGES)
 */
(function (root) {
  'use strict';
  var DWX = root.DWX = root.DWX || {};
  var list = DWX.__providers = DWX.__providers || {};
  var ORDER = ['chatgpt', 'gemini'];
  var DEFAULT_ID = 'chatgpt';
  var DEFAULT_MESSAGES = {
    not_logged_in: '{label} is not signed in. Sign in to {label} in that tab, then try again.',
    usage_limit: '{label} says its usage limit was reached. Try again later, or switch the AI to another provider.',
    rate_limited: '{label} says the rate limit was hit. Wait a moment, then try again.',
    no_stream: '{label} did not start answering.',
    done_timeout: '{label} took too long.',
    blocked_click: 'Stopped for safety: the next button on the {label} page was not one the extension is allowed to press.',
    not_paired: 'Not sent: no {label} tab is paired.',
    busy: 'Not sent: {label} is still answering the previous request.',
    chat_tab_unreachable: 'Not sent: could not reach the {label} tab.',
    tab_open_failed: 'Not sent: could not open a {label} tab.'
  };
  function register(p) {
    if (!p || !/^[a-z0-9_-]{1,32}$/.test(p.id)) throw new Error('bad provider');
    list[p.id] = Object.freeze(p);
    return p;
  }
  function get(id) { return (typeof id === 'string' && Object.prototype.hasOwnProperty.call(list, id)) ? list[id] : null; }
  function ids() { return ORDER.filter(function (k) { return list[k]; }).concat(Object.keys(list).filter(function (k) { return ORDER.indexOf(k) < 0; })); }
  function all() { return ids().map(get); }
  function forHost(host) { var r = null; all().some(function (p) { if (p.hosts.indexOf(host) >= 0) { r = p; return true; } return false; }); return r; }
  function valid(id) { return !!get(id); }
  function label(id) { var p = get(id); return p ? p.label : 'the AI'; }
  function message(id, code) {
    var p = get(id);
    var t = (p && p.messages && p.messages[code]) || DEFAULT_MESSAGES[code];
    return t ? t.replace(/\{label\}/g, label(id)) : null;
  }
  DWX.providers = { register: register, get: get, ids: ids, all: all, forHost: forHost, valid: valid, label: label, message: message, DEFAULT_ID: DEFAULT_ID, DEFAULT_MESSAGES: DEFAULT_MESSAGES };
  if (typeof module === 'object' && module.exports) module.exports = DWX.providers;
})(typeof self !== 'undefined' ? self : globalThis);
