// Background service worker for SignPost - Universal Email Scanner
importScripts('../utils/storage.js', '../utils/notion-sync.js');

const storage = new StorageManager();

// ============================================
// MESSAGE HANDLERS
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle email detected by universal scanner
  if (message.type === 'EMAIL_DETECTED') {
    handleEmailDetected(message.email, sender.tab);
    sendResponse({ success: true });
  }
  // Handle OAuth account selected on accounts.google.com
  else if (message.type === 'OAUTH_ACCOUNT_SELECTED') {
    handleOAuthAccountSelected(message.email, message.domain);
    sendResponse({ success: true });
  }
  // Handle legacy OAuth data format (for backwards compatibility)
  else if (message.type === 'OAUTH_DATA_CAPTURED') {
    handleOAuthData(message.data, sender.tab);
    sendResponse({ success: true });
  }
  // Get account for domain (used by popup)
  else if (message.type === 'GET_ACCOUNT_FOR_DOMAIN') {
    handleGetAccount(message.domain, sendResponse);
    return true;
  }
  // Update badge for tab
  else if (message.type === 'UPDATE_BADGE') {
    if (sender.tab?.id) {
      updateBadgeForTab(sender.tab.id, message.domain).catch(() => {});
    }
    sendResponse({ success: true });
  }
  // Sync to Notion
  else if (message.type === 'SYNC_TO_NOTION') {
    handleNotionSync(message.apiKey, message.databaseId, sendResponse);
    return true;
  }
  // Delete from Notion
  else if (message.type === 'DELETE_FROM_NOTION') {
    handleNotionDelete(message.domain, sendResponse);
    return true;
  }
  // Bidirectional sync with Notion
  else if (message.type === 'BIDIRECTIONAL_SYNC') {
    handleBidirectionalSync(sendResponse);
    return true;
  }
});

// ============================================
// EMAIL DETECTION HANDLER (New Universal Approach)
// ============================================
async function handleEmailDetected(email, tab) {
  try {
    if (!email || !tab?.url) return;
    
    const domain = new URL(tab.url).hostname;
    
    // Validate domain - reject invalid entries
    if (!isValidDomain(domain)) {
      return;
    }
    
    // Save to storage
    await storage.save(domain, {
      email: email,
      displayName: '',
      photoUrl: ''
    });
    
    // Update badge
    if (tab.id) {
      updateBadgeForTab(tab.id, domain).catch(() => {});
    }
    
    // Show notification
    chrome.notifications.create(`signpost-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'SignPost: Account Tracked',
      message: `${email} → ${domain}`
    }).catch(() => {});
    
    // Auto-sync to Notion if enabled (debounced)
    debouncedNotionSync(domain);
    
  } catch (error) {
    // Silent fail
  }
}

// ============================================
// OAUTH ACCOUNT SELECTED (from accounts.google.com)
// ============================================
async function handleOAuthAccountSelected(email, domain) {
  try {
    if (!email || !domain) return;
    
    // Validate domain
    if (!isValidDomain(domain)) {
      return;
    }
    
    // Save to storage
    await storage.save(domain, {
      email: email,
      displayName: '',
      photoUrl: ''
    });
    
    // Show notification
    chrome.notifications.create(`signpost-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon48.png'),
      title: 'SignPost: OAuth Account Tracked',
      message: `${email} → ${domain}`
    }).catch(() => {});
    
    // Auto-sync to Notion if enabled (debounced)
    debouncedNotionSync(domain);
    
  } catch (error) {
    // Silent fail
  }
}

// ============================================
// LEGACY OAUTH HANDLER (Backwards Compatibility)
// ============================================
async function handleOAuthData(oauthData, tab) {
  try {
    if (!tab?.url) return;
    
    const domain = new URL(tab.url).hostname;
    let email, displayName, photoUrl;
    
    // Firebase Auth format
    if (oauthData?.users?.[0]) {
      const user = oauthData.users[0];
      email = user.email;
      displayName = user.displayName;
      photoUrl = user.photoUrl;
    }
    // Direct email format
    else if (oauthData?.email) {
      email = oauthData.email;
      displayName = oauthData.name || oauthData.displayName || '';
      photoUrl = oauthData.picture || oauthData.photoUrl || '';
    }
    
    if (email) {
      await storage.save(domain, { email, displayName, photoUrl });
      
      if (tab.id) {
        updateBadgeForTab(tab.id, domain).catch(() => {});
      }
      
      chrome.notifications.create(`signpost-${Date.now()}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title: 'SignPost: Account Tracked',
        message: `${email} → ${domain}`
      }).catch(() => {});
    }
  } catch (error) {
    // Silent fail
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
async function handleGetAccount(domain, sendResponse) {
  try {
    const account = await storage.getByDomain(domain);
    sendResponse({ success: true, account });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleNotionSync(apiKey, databaseId, sendResponse) {
  try {
    const notionSync = new NotionSync(apiKey, databaseId);
    const isConnected = await notionSync.verifyConnection();
    
    if (!isConnected) {
      sendResponse({ success: false, error: 'Unable to connect to Notion' });
      return;
    }
    
    const accounts = await storage.getAll();
    const result = await notionSync.syncAccounts(accounts);
    sendResponse(result);
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Auto-sync single entry to Notion
// Track pending syncs to debounce
const pendingSyncs = new Map();

// Debounced Notion sync to prevent duplicates
function debouncedNotionSync(domain) {
  // Cancel any pending sync for this domain
  if (pendingSyncs.has(domain)) {
    clearTimeout(pendingSyncs.get(domain));
  }

  // Schedule new sync after 2 seconds
  const timeoutId = setTimeout(() => {
    pendingSyncs.delete(domain);
    autoSyncToNotion(domain);
  }, 2000);

  pendingSyncs.set(domain, timeoutId);
}

async function autoSyncToNotion(domain) {
  try {
    const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);

    // Auto-sync when Notion is enabled (no separate toggle)
    if (!config.notionEnabled || !config.notionApiKey || !config.notionDatabaseId) {
      return;
    }

    const notionSync = new NotionSync(config.notionApiKey, config.notionDatabaseId);
    const account = await storage.getByDomain(domain);

    if (account) {
      await notionSync.syncAccounts({ [domain]: account });
    }
  } catch (error) {
    // Silent fail
  }
}

// Delete entry from Notion
async function handleNotionDelete(domain, sendResponse) {
  try {
    const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);

    if (!config.notionEnabled || !config.notionApiKey || !config.notionDatabaseId) {
      sendResponse?.({ success: true, message: 'Notion sync not configured' });
      return;
    }

    const notionSync = new NotionSync(config.notionApiKey, config.notionDatabaseId);
    const result = await notionSync.archiveByDomain(domain);
    sendResponse?.(result);
  } catch (error) {
    sendResponse?.({ success: false, error: error.message });
  }
}

// Update badge for a tab
async function updateBadgeForTab(tabId, domain) {
  try {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    
    const account = await storage.getByDomain(domain);
    
    if (account?.email) {
      const letter = account.email.charAt(0).toUpperCase();
      const color = generateColorFromString(account.email);
      
      await chrome.action.setBadgeText({ text: letter, tabId }).catch(() => {});
      await chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
      await chrome.action.setTitle({ title: `SignPost: ${account.email}`, tabId }).catch(() => {});
    } else {
      await chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
      await chrome.action.setTitle({ title: 'SignPost', tabId }).catch(() => {});
    }
  } catch (error) {
    // Silently ignore
  }
}

// Generate consistent color from string
function generateColorFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// Validate domain - reject invalid/meaningless domains
function isValidDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  
  // Must have at least one dot (e.g., example.com)
  if (!domain.includes('.')) return false;
  
  // Reject common invalid values
  const invalidDomains = [
    'https',
    'http',
    'localhost',
    'undefined',
    'null',
    'unknown',
    'fetch',
    'xhr',
    ''
  ];
  
  if (invalidDomains.includes(domain.toLowerCase())) return false;
  
  // Must be at least 4 chars (e.g., a.co)
  if (domain.length < 4) return false;
  
  return true;
}

// ============================================
// TAB EVENT LISTENERS
// ============================================
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      const domain = new URL(tab.url).hostname;
      updateBadgeForTab(tabId, domain).catch(() => {});
    } catch (e) {}
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId).catch(() => null);
    if (tab?.url) {
      const domain = new URL(tab.url).hostname;
      updateBadgeForTab(activeInfo.tabId, domain).catch(() => {});
    }
  } catch (e) {}
});

// ============================================
// BIDIRECTIONAL SYNC
// ============================================
async function handleBidirectionalSync(sendResponse) {
  try {
    const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);

    if (!config.notionEnabled || !config.notionApiKey || !config.notionDatabaseId) {
      sendResponse?.({ success: false, error: 'Notion not configured' });
      return;
    }

    const notionSync = new NotionSync(config.notionApiKey, config.notionDatabaseId);

    // Step 1: Fetch all entries from Notion
    const remoteEntries = await notionSync.fetchAllEntries();

    // Step 2: Merge with local using timestamp-based conflict resolution
    const mergedAccounts = await storage.mergeWithConflictResolution(remoteEntries);

    // Step 3: Push merged data back to Notion
    const result = await notionSync.syncAccounts(mergedAccounts);

    sendResponse?.({
      success: true,
      synced: result.synced,
      fetched: Object.keys(remoteEntries).length
    });
  } catch (error) {
    sendResponse?.({ success: false, error: error.message });
  }
}

// ============================================
// PERIODIC SYNC WITH ALARMS
// ============================================
// Create periodic sync alarm (every 60 minutes)
chrome.alarms.create('bidirectional-sync', { periodInMinutes: 60 });

// Handle alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bidirectional-sync') {
    handleBidirectionalSync();
  }
});

// Service worker initialized
