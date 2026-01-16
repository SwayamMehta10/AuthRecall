// AuthRecall: Google OAuth Detector
// Runs on accounts.google.com to capture which account is used for OAuth

(function() {
  'use strict';
  
  // Only run on OAuth flows (not regular Google sign-in)
  const url = window.location.href;
  const isOAuthFlow = url.includes('/o/oauth2/') || 
                      url.includes('/signin/oauth/') ||
                      url.includes('/AccountChooser') ||
                      url.includes('client_id=') ||
                      url.includes('redirect_uri=');
  
  if (!isOAuthFlow) return;
  
  // Google OAuth flow detected
  
  // Try to get the target website from OAuth parameters
  function getTargetSite() {
    try {
      const params = new URLSearchParams(window.location.search);
      
      // Check redirect_uri first
      let redirectUri = params.get('redirect_uri');
      if (redirectUri) {
        const targetUrl = new URL(redirectUri);
        return targetUrl.hostname;
      }
      
      // Check state parameter (sometimes contains encoded redirect)
      const state = params.get('state');
      if (state) {
        try {
          const decoded = atob(state);
          const match = decoded.match(/https?:\/\/([^\/\s]+)/);
          if (match) return match[1];
        } catch (e) {}
      }
      
      // Check client_id for known patterns
      const clientId = params.get('client_id');
      if (clientId) {
        // Store client_id for later matching
        sessionStorage.setItem('authrecall_oauth_client', clientId);
      }
      
      // Check referrer
      if (document.referrer) {
        try {
          const refUrl = new URL(document.referrer);
          if (!refUrl.hostname.includes('google.com')) {
            return refUrl.hostname;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }
  
  // Find email from the page
  function findEmail() {
    // Method 1: Look for signed-in account email in the page
    const emailSelectors = [
      '[data-email]',
      '[data-identifier]', 
      '.gb_Lb', // Google account dropdown
      '.gb_ub', // Alternative account selector
      '#profileIdentifier',
      '.fCBwrf', // Account chooser email
      '.W7Aapd', // Another account email format
      'div[data-authuser] + div',
    ];
    
    for (const selector of emailSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const email = el.getAttribute('data-email') || 
                      el.getAttribute('data-identifier') || 
                      el.textContent.trim();
        if (email && email.includes('@')) {
          return email;
        }
      }
    }
    
    // Method 2: Check the page text for email patterns
    const pageText = document.body?.innerText || '';
    const emailMatch = pageText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) {
      return emailMatch[1];
    }
    
    return null;
  }
  
  // Observe for account selection
  function watchForAccountSelection() {
    const targetSite = getTargetSite();
    
    // Watch for clicks on account buttons
    document.addEventListener('click', function(e) {
      const target = e.target.closest('[data-email], [data-identifier], .fCBwrf, .W7Aapd');
      if (target) {
        const email = target.getAttribute('data-email') || 
                      target.getAttribute('data-identifier') ||
                      target.textContent.trim();
        
        if (email && email.includes('@') && targetSite) {
          // Send to background
          chrome.runtime.sendMessage({
            type: 'OAUTH_ACCOUNT_SELECTED',
            email: email,
            domain: targetSite
          }).catch(() => {});
        }
      }
    }, true);
    
    // Also check periodically for already-selected account
    const checkInterval = setInterval(() => {
      const email = findEmail();
      if (email && targetSite) {
        // Store in sessionStorage for the redirect back
        sessionStorage.setItem('authrecall_pending_email', email);
        sessionStorage.setItem('authrecall_pending_domain', targetSite);
      }
    }, 1000);
    
    // Clean up after 30 seconds
    setTimeout(() => clearInterval(checkInterval), 30000);
  }
  
  // Before unload, try to capture the selection
  window.addEventListener('beforeunload', function() {
    const email = sessionStorage.getItem('authrecall_pending_email');
    const domain = sessionStorage.getItem('authrecall_pending_domain');
    
    if (email && domain) {
      // Can't do async here, use sendMessage synchronously
      chrome.runtime.sendMessage({
        type: 'OAUTH_ACCOUNT_SELECTED',
        email: email,
        domain: domain
      }).catch(() => {});
    }
  });
  
  // Start watching
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForAccountSelection);
  } else {
    watchForAccountSelection();
  }
  
})();
