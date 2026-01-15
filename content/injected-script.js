// SignPost: Universal Email Scanner
// Catches emails from user profile/auth endpoints only

(function() {
  'use strict';
  
  // Universal scanner running

  const foundEmails = new Set();
  
  // Emails to ignore (system/company emails)
  const IGNORED_EMAIL_PATTERNS = [
    /^noreply@/i, /^no-reply@/i, /^support@/i, /^admin@/i, /^info@/i,
    /^help@/i, /^contact@/i, /^feedback@/i, /^notifications?@/i,
    /^alerts?@/i, /^newsletter@/i, /^team@/i, /^hello@/i, /^sales@/i,
    /^billing@/i, /^privacy@/i, /^security@/i, /^abuse@/i,
    /^webmaster@/i, /^postmaster@/i, /^mailer-daemon@/i, /^donotreply@/i,
    /@example\./i, /@test\./i, /@localhost/i,
    // Ignore emails from the site's own domain (company emails)
    /@udemy\.com$/i, /@leetcode\.com$/i, /@amplitude\.com$/i,
    /@google\.com$/i, /@sentry\.io$/i, /@datadog\.com$/i,
  ];

  // URLs that indicate user profile/auth data (ONLY scan these)
  const USER_ENDPOINT_PATTERNS = [
    /\/me\b/i,
    /\/user/i,
    /\/profile/i,
    /\/account/i,
    /\/auth/i,
    /\/session/i,
    /\/login/i,
    /\/signin/i,
    /\/oauth/i,
    /identitytoolkit/i,
    /securetoken/i,
    /\/contexts\/me/i,
  ];

  // URLs to IGNORE (analytics, tracking, SDKs)
  const IGNORE_URL_PATTERNS = [
    /amplitude/i,
    /sentry/i,
    /datadog/i,
    /analytics/i,
    /tracking/i,
    /googletagmanager/i,
    /gtag/i,
    /hotjar/i,
    /mixpanel/i,
    /segment/i,
    /fullstory/i,
    /logrocket/i,
    /bugsnag/i,
    /rollbar/i,
    /newrelic/i,
    /sdk.*config/i,
  ];

  const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  function shouldIgnoreEmail(email) {
    return IGNORED_EMAIL_PATTERNS.some(pattern => pattern.test(email));
  }

  function isUserEndpoint(url) {
    if (!url) return false;
    // First, check if URL should be ignored
    if (IGNORE_URL_PATTERNS.some(pattern => pattern.test(url))) {
      return false;
    }
    // Then check if it matches user endpoint patterns
    return USER_ENDPOINT_PATTERNS.some(pattern => pattern.test(url));
  }

  function extractEmails(data) {
    if (!data) return [];
    const jsonString = typeof data === 'string' ? data : JSON.stringify(data);
    const matches = jsonString.match(EMAIL_REGEX) || [];
    return matches.filter(email => {
      const normalized = email.toLowerCase();
      return !shouldIgnoreEmail(normalized) && !foundEmails.has(normalized);
    });
  }

  function reportEmail(email, source) {
    const normalized = email.toLowerCase();
    if (foundEmails.has(normalized)) return;
    foundEmails.add(normalized);
    
    // Found user email - dispatch event
    window.dispatchEvent(new CustomEvent('signpost-oauth-data', {
      detail: { url: source, data: { email: email } }
    }));
  }

  function decodeJWT(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = parts[1];
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(decoded);
    } catch (e) {
      return null;
    }
  }

  function processResponse(data, url) {
    // Only process user-related endpoints
    if (!isUserEndpoint(url)) return;
    
    try {
      const emails = extractEmails(data);
      if (emails.length > 0) {
        reportEmail(emails[0], url);
      }
    } catch (e) {}
  }

  // ============================================
  // INTERCEPT FETCH REQUESTS
  // ============================================
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      const clonedResponse = response.clone();
      const contentType = clonedResponse.headers.get('content-type') || '';
      if (contentType.includes('json') && isUserEndpoint(url)) {
        const data = await clonedResponse.json();
        processResponse(data, url);
      }
    } catch (e) {}
    return response;
  };

  // ============================================
  // INTERCEPT XHR REQUESTS
  // ============================================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._signpost_url = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', async function() {
      const url = this._signpost_url || '';
      if (!isUserEndpoint(url)) return;
      
      try {
        const contentType = this.getResponseHeader('content-type') || '';
        if (!contentType.includes('json')) return;
        
        let data;
        if (this.responseType === 'blob') {
          data = JSON.parse(await this.response.text());
        } else if (this.responseType === 'arraybuffer') {
          data = JSON.parse(new TextDecoder().decode(this.response));
        } else if (this.responseType === '' || this.responseType === 'text') {
          data = JSON.parse(this.responseText);
        } else if (this.responseType === 'json') {
          data = this.response;
        }
        if (data) processResponse(data, url);
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };

  // ============================================
  // INTERCEPT POSTMESSAGE (Google OAuth)
  // ============================================
  window.addEventListener('message', function(event) {
    try {
      const data = event.data;
      if (!data) return;
      
      let credential = null;
      
      if (typeof data === 'string') {
        try {
          const parsed = JSON.parse(data);
          credential = parsed.credential || parsed.id_token || parsed.access_token;
        } catch (e) {
          if (data.split('.').length === 3) credential = data;
        }
      } else if (typeof data === 'object') {
        credential = data.credential || data.id_token || data.access_token;
        if (!credential && data.response) {
          credential = data.response.credential || data.response.id_token;
        }
      }
      
      if (credential && typeof credential === 'string') {
        const decoded = decodeJWT(credential);
        if (decoded?.email && !shouldIgnoreEmail(decoded.email)) {
          // Intercepted Google OAuth credential
          reportEmail(decoded.email, 'google-oauth');
        }
      }
    } catch (e) {}
  }, true);

  // ============================================
  // PATCH GOOGLE SIGN-IN SDK
  // ============================================
  function patchGoogleSignIn() {
    if (window.google?.accounts?.id?.initialize) {
      const originalInit = window.google.accounts.id.initialize;
      window.google.accounts.id.initialize = function(config) {
        const originalCallback = config.callback;
        config.callback = function(response) {
          if (response?.credential) {
            const decoded = decodeJWT(response.credential);
            if (decoded?.email && !shouldIgnoreEmail(decoded.email)) {
              reportEmail(decoded.email, 'google-signin');
            }
          }
          if (originalCallback) return originalCallback(response);
        };
        return originalInit.call(this, config);
      };
    }
  }

  // ============================================
  // SCAN STORAGE FOR USER DATA
  // ============================================
  function scanStorage() {
    // Only look for JWTs (which contain user data)
    const checkValue = (value, source) => {
      if (!value || typeof value !== 'string') return;
      
      // JWT tokens
      if (value.split('.').length === 3) {
        const decoded = decodeJWT(value);
        if (decoded?.email && !shouldIgnoreEmail(decoded.email)) {
          reportEmail(decoded.email, source);
        }
      }
    };

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // Only check keys that look like auth/user data
        if (/user|auth|token|session|account/i.test(key)) {
          checkValue(localStorage.getItem(key), 'localStorage');
        }
      }
    } catch (e) {}

    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (/user|auth|token|session|account/i.test(key)) {
          checkValue(sessionStorage.getItem(key), 'sessionStorage');
        }
      }
    } catch (e) {}
  }

  // ============================================
  // INITIALIZATION
  // ============================================
  setTimeout(scanStorage, 2000);
  setTimeout(scanStorage, 5000);
  
  patchGoogleSignIn();
  setTimeout(patchGoogleSignIn, 2000);
  
  const observer = new MutationObserver(() => {
    if (window.google?.accounts?.id) patchGoogleSignIn();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Scanner installed
})();
