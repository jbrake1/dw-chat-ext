/* Provider adapter: Anthropic Claude (claude.ai). Data only; selectors are in instructions/claude.json (v0.1.13).
 * The relay starts a New chat (flow "newChat"), attaches files through the page's own file input (or the "+" menu via the page hook,
 * then drop or paste, then the files as text in the message), and never touches the model picker, plans/upgrade, styles, projects or incognito (guard.neverClick). */
(function (root) {
  'use strict';
  var R = (typeof module === 'object' && module.exports) ? require('./registry.js') : root.DWX.providers;
  var p = R.register({
    id: 'claude',
    label: 'Claude',
    hosts: ['claude.ai'],
    tabMatches: ['https://claude.ai/*'],
    newChatUrl: 'https://claude.ai/new',
    instructions: 'instructions/claude.json',
    signInUrl: 'https://claude.ai/login',
    messages: {
      not_logged_in: 'Claude is not signed in. Sign in at claude.ai in Chrome, then try again.',
      usage_limit: 'Claude says a usage limit was reached. Try again after it resets, untick "Include page files", or switch the AI.',
      attach_not_confirmed: 'Claude did not accept the screenshot or page files. Untick "Include page files" and try again, or press Send page snapshot / Copy diagnostics so it can be fixed.'
    }
  });
  if (typeof module === 'object' && module.exports) module.exports = p;
})(typeof self !== 'undefined' ? self : globalThis);
