// Content script for SignPost Universal Email Scanner
(function() {
  'use strict';

  // Inject universal scanner into MAIN world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content/injected-script.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  // Listen for email data from the injected script
  window.addEventListener('signpost-oauth-data', function(event) {
    const email = event.detail?.data?.email;
    
    if (email) {
      // Send to background script
      chrome.runtime.sendMessage({
        type: 'EMAIL_DETECTED',
        email: email,
        source: event.detail.url
      }).catch(() => {
        // Silent fail
      });
    }
  });

  // Request badge update for current domain
  function updateBadge() {
    try {
      const domain = window.location.hostname;
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE',
        domain: domain
      }).catch(() => {
        // Ignore errors
      });
    } catch (error) {
      // Ignore
    }
  }

  // Update badge when page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateBadge);
  } else {
    updateBadge();
  }
})();
