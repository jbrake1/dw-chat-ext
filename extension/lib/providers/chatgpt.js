/* Provider adapter: ChatGPT (chatgpt.com). Data only; selectors are in instructions/chatgpt.json. */
(function (root) {
  'use strict';
  var R = (typeof module === 'object' && module.exports) ? require('./registry.js') : root.DWX.providers;
  var p = R.register({
    id: 'chatgpt',
    label: 'ChatGPT',
    hosts: ['chatgpt.com'],
    tabMatches: ['https://chatgpt.com/*'],
    newChatUrl: 'https://chatgpt.com/',
    instructions: 'instructions/chatgpt.json',
    signInUrl: 'https://chatgpt.com/',
    messages: {
      not_logged_in: 'ChatGPT tab is not signed in.',
      rate_limited: 'ChatGPT says the rate limit was hit.',
      usage_limit: 'ChatGPT says its limit was reached (for example "out of data analysis"). Try again after it resets, untick "Include page files", or switch the AI to Gemini.'
    }
  });
  if (typeof module === 'object' && module.exports) module.exports = p;
})(typeof self !== 'undefined' ? self : globalThis);
