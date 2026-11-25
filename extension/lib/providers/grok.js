/* Provider adapter: xAI Grok (grok.com). Data only; selectors are in instructions/grok.json (v0.1.13).
 * The relay starts a New chat (flow "newChat"), attaches files through the page's own file input (or the attach menu via the page hook,
 * then drop or paste, then the files as text in the message), and never touches the model picker, SuperGrok/Upgrade, private chat or voice (guard.neverClick). */
(function (root) {
  'use strict';
  var R = (typeof module === 'object' && module.exports) ? require('./registry.js') : root.DWX.providers;
  var p = R.register({
    id: 'grok',
    label: 'Grok',
    hosts: ['grok.com'],
    tabMatches: ['https://grok.com/*'],
    newChatUrl: 'https://grok.com/',
    instructions: 'instructions/grok.json',
    signInUrl: 'https://grok.com/',
    messages: {
      not_logged_in: 'Grok is not signed in (uploads need an account). Sign in at grok.com in Chrome, then try again.',
      usage_limit: 'Grok says a usage limit was reached. Try again after it resets, untick "Include page files", or switch the AI.',
      attach_not_confirmed: 'Grok did not accept the screenshot or page files. Untick "Include page files" and try again, or press Send page snapshot / Copy diagnostics so it can be fixed.'
    }
  });
  if (typeof module === 'object' && module.exports) module.exports = p;
})(typeof self !== 'undefined' ? self : globalThis);
