// SignPost Popup Script

const storage = new StorageManager();

// DOM Elements
const elements = {
  currentSiteInfo: document.getElementById('current-site-info'),
  badgeSitesCount: document.getElementById('badge-sites-count'),
  badgeAccountsCount: document.getElementById('badge-accounts-count'),
  
  toggleManualEntry: document.getElementById('toggle-manual-entry'),
  manualEntryForm: document.getElementById('manual-entry-form'),
  manualDomain: document.getElementById('manual-domain'),
  manualEmail: document.getElementById('manual-email'),
  saveManualEntry: document.getElementById('save-manual-entry'),
  
  toggleAllEntries: document.getElementById('toggle-all-entries'),
  entriesPanel: document.getElementById('entries-panel'),
  searchInput: document.getElementById('search-input'),
  sitesList: document.getElementById('sites-list'),
  
  exportBtn: document.getElementById('export-btn'),
  importBtn: document.getElementById('import-btn'),
  importFileInput: document.getElementById('import-file-input'),
  clearAllBtn: document.getElementById('clear-all-btn'),
  
  toggleSettings: document.getElementById('toggle-settings'),
  settingsPanel: document.getElementById('settings-panel'),
  notionEnabled: document.getElementById('notion-enabled'),
  notionConfig: document.getElementById('notion-config'),
  notionApiKey: document.getElementById('notion-api-key'),
  notionDatabaseId: document.getElementById('notion-database-id'),
  syncNowContainer: document.getElementById('sync-now-container'),
  syncNowBtn: document.getElementById('sync-now-btn'),
};

let allAccounts = {};

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadCurrentSite();
  await loadAllAccounts();
  await loadSettings();
  setupEventListeners();
}

// Load current tab info
async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      elements.currentSiteInfo.innerHTML = '<span class="not-tracked">No site detected</span>';
      return;
    }

    const url = new URL(tab.url);
    const domain = url.hostname;
    
    elements.manualDomain.value = domain;
    
    const account = await storage.getByDomain(domain);
    
    if (account?.email) {
      const letter = account.email.charAt(0).toUpperCase();
      const fallbackBg = getColorForEmail(account.email);
      elements.currentSiteInfo.innerHTML = `
        <div class="avatar" data-fallback-bg="${fallbackBg}" data-fallback-letter="${letter}">
          <img class="avatar-favicon" src="${getFaviconUrl(domain)}" width="20" height="20" loading="lazy"
               onerror="this.style.display='none';this.parentElement.innerHTML='<span class=\\'avatar-letter\\'>${letter}</span>';this.parentElement.style.background='${fallbackBg}';">
        </div>
        <div class="details">
          <div class="domain copiable" title="Click to copy">${domain}${copyIconSvg}</div>
          <div class="email copiable" title="Click to copy">${account.email}${copyIconSvg}</div>
        </div>
      `;
      // Add copy handlers
      const domainEl = elements.currentSiteInfo.querySelector('.domain');
      const emailEl = elements.currentSiteInfo.querySelector('.email');
      domainEl?.addEventListener('click', () => copyToClipboard(domain, domainEl));
      emailEl?.addEventListener('click', () => copyToClipboard(account.email, emailEl));
    } else {
      elements.currentSiteInfo.innerHTML = `
        <div class="details">
          <div class="domain">${domain}</div>
          <div class="not-tracked">Not tracked yet</div>
        </div>
      `;
    }
  } catch (error) {
    elements.currentSiteInfo.innerHTML = '<span class="not-tracked">Error loading site</span>';
  }
}

// Load all accounts
async function loadAllAccounts() {
  try {
    allAccounts = await storage.getAll();
    updateStats();
    renderSitesList();
  } catch (error) {
    // Silent fail - accounts list may be empty
  }
}

// Update statistics
function updateStats() {
  const domains = Object.keys(allAccounts);
  const uniqueEmails = new Set(
    Object.values(allAccounts).map(a => a.email?.toLowerCase()).filter(Boolean)
  );

  // Update badge counts
  elements.badgeSitesCount.textContent = domains.length;
  elements.badgeAccountsCount.textContent = uniqueEmails.size;
}

// Render sites list
function renderSitesList(filter = '') {
  const domains = Object.keys(allAccounts).sort();
  const filtered = filter
    ? domains.filter(d => 
        d.toLowerCase().includes(filter.toLowerCase()) ||
        allAccounts[d].email?.toLowerCase().includes(filter.toLowerCase())
      )
    : domains;

  if (filtered.length === 0) {
    elements.sitesList.innerHTML = '<div class="empty-state">No sites found</div>';
    return;
  }

  elements.sitesList.innerHTML = filtered.map(domain => {
    const account = allAccounts[domain];
    const letter = account.email?.charAt(0).toUpperCase() || '?';
    const color = getColorForEmail(account.email);

    return `
      <div class="site-item" data-domain="${domain}">
        <div class="avatar" data-fallback-bg="${color}" data-fallback-letter="${letter}">
          <img class="avatar-favicon" src="${getFaviconUrl(domain)}" width="14" height="14" loading="lazy"
               onerror="this.style.display='none';this.parentElement.innerHTML='<span class=\\'avatar-letter\\'>${letter}</span>';this.parentElement.style.background='${color}';">
        </div>
        <div class="details">
          <div class="domain copiable" data-copy="${domain}" title="Click to copy">${domain}${copyIconSvg}</div>
          <div class="email copiable" data-copy="${account.email || ''}" title="Click to copy">${account.email || 'Unknown'}${copyIconSvg}</div>
        </div>
        <button class="edit-btn" data-domain="${domain}" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="delete-btn" data-domain="${domain}" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Add edit handlers
  elements.sitesList.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      openEditModal(domain);
    });
  });

  // Add delete handlers
  elements.sitesList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const domain = btn.dataset.domain;
      if (confirm(`Remove ${domain}?`)) {
        await storage.delete(domain);
        await loadAllAccounts();
        await loadCurrentSite();
        showToast('Entry removed');
        deleteFromNotion(domain);
      }
    });
  });

  // Add copy handlers for domain and email
  elements.sitesList.querySelectorAll('.copiable').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = el.dataset.copy;
      if (text) {
        copyToClipboard(text, el);
      }
    });
  });
}

// Load settings
async function loadSettings() {
  const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);

  if (config.notionEnabled) {
    elements.notionEnabled.checked = true;
    elements.notionConfig.style.display = 'block';
    elements.syncNowContainer.style.display = 'block';
  }

  if (config.notionApiKey) {
    elements.notionApiKey.value = config.notionApiKey;
  }
  if (config.notionDatabaseId) {
    elements.notionDatabaseId.value = config.notionDatabaseId;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Toggle manual entry
  elements.toggleManualEntry.addEventListener('click', () => {
    const isVisible = elements.manualEntryForm.style.display !== 'none';
    elements.manualEntryForm.style.display = isVisible ? 'none' : 'block';
    elements.toggleManualEntry.classList.toggle('active', !isVisible);
  });

  // Save manual entry
  elements.saveManualEntry.addEventListener('click', async () => {
    const domain = elements.manualDomain.value.trim().toLowerCase();
    const email = elements.manualEmail.value.trim().toLowerCase();
    
    if (!domain) {
      showToast('Please enter a domain', 'error');
      return;
    }
    
    if (!email || !email.includes('@')) {
      showToast('Please enter a valid email', 'error');
      return;
    }
    
    let cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0];
    
    if (!cleanDomain.includes('.') || cleanDomain.length < 4) {
      showToast('Please enter a valid domain', 'error');
      return;
    }
    
    await storage.save(cleanDomain, {
      email: email,
      displayName: '',
      photoUrl: ''
    });
    
    showToast(`Saved: ${email} → ${cleanDomain}`, 'success');
    syncSingleEntry(cleanDomain);
    
    elements.manualEmail.value = '';
    elements.manualEntryForm.style.display = 'none';
    elements.toggleManualEntry.classList.remove('active');
    
    await loadAllAccounts();
    await loadCurrentSite();
  });

  // Toggle all entries
  elements.toggleAllEntries.addEventListener('click', () => {
    const isVisible = elements.entriesPanel.style.display !== 'none';
    elements.entriesPanel.style.display = isVisible ? 'none' : 'block';
    elements.toggleAllEntries.classList.toggle('active', !isVisible);
  });

  // Search
  elements.searchInput.addEventListener('input', (e) => {
    renderSitesList(e.target.value);
  });

  // Toggle settings
  elements.toggleSettings.addEventListener('click', () => {
    const isVisible = elements.settingsPanel.style.display !== 'none';
    elements.settingsPanel.style.display = isVisible ? 'none' : 'block';
    elements.toggleSettings.classList.toggle('active', !isVisible);
  });

  // Notion enabled toggle
  elements.notionEnabled.addEventListener('change', async () => {
    const enabled = elements.notionEnabled.checked;
    elements.notionConfig.style.display = enabled ? 'block' : 'none';
    elements.syncNowContainer.style.display = enabled ? 'block' : 'none';

    await chrome.storage.local.set({ notionEnabled: enabled });

    // When enabled with valid credentials, trigger initial sync
    if (enabled) {
      const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId']);
      if (config.notionApiKey && config.notionDatabaseId) {
        chrome.runtime.sendMessage({ type: 'BIDIRECTIONAL_SYNC' });
      }
    }
  });

  // Notion config fields
  elements.notionApiKey.addEventListener('change', saveNotionConfig);
  elements.notionDatabaseId.addEventListener('change', saveNotionConfig);

  // Sync now button
  elements.syncNowBtn.addEventListener('click', async () => {
    const apiKey = elements.notionApiKey.value.trim();
    let databaseId = elements.notionDatabaseId.value.trim();
    
    if (!apiKey || !databaseId) {
      showToast('Please enter Notion credentials', 'error');
      return;
    }
    
    // Clean database ID
    if (databaseId.includes('notion.so')) {
      const match = databaseId.match(/([a-f0-9]{32})/i);
      if (match) databaseId = match[1];
    }
    databaseId = databaseId.replace(/-/g, '');
    
    if (databaseId.length !== 32) {
      showToast('Invalid database ID', 'error');
      return;
    }
    
    elements.syncNowBtn.textContent = 'Syncing...';
    elements.syncNowBtn.disabled = true;
    
    chrome.runtime.sendMessage({
      type: 'SYNC_TO_NOTION',
      apiKey: apiKey,
      databaseId: databaseId
    }, (response) => {
      elements.syncNowBtn.textContent = 'Sync Now';
      elements.syncNowBtn.disabled = false;
      
      if (response?.success) {
        showToast(`Synced ${response.synced || 0} entries`, 'success');
      } else {
        showToast(response?.error || 'Sync failed', 'error');
      }
    });
  });

  // Export
  elements.exportBtn.addEventListener('click', async () => {
    const accounts = await storage.getAll();
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `signpost-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${Object.keys(accounts).length} entries`, 'success');
  });

  // Import
  elements.importBtn.addEventListener('click', () => {
    elements.importFileInput.click();
  });

  elements.importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      let data = JSON.parse(text);
      
      // Handle double-stringified data (fix for corrupted exports)
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
      
      // Extract accounts object
      const accounts = data.accounts || data;
      
      // Validate it's actually an object with domain keys
      if (typeof accounts !== 'object' || Array.isArray(accounts)) {
        throw new Error('Invalid data structure');
      }
      
      // Filter out invalid entries (keys should be valid domains)
      const validAccounts = {};
      for (const [key, value] of Object.entries(accounts)) {
        if (key.includes('.') && value && typeof value === 'object' && value.email) {
          validAccounts[key] = value;
        }
      }
      
      if (Object.keys(validAccounts).length === 0) {
        showToast('No valid entries found', 'error');
        return;
      }
      
      await storage.importData({ accounts: validAccounts });
      await loadAllAccounts();
      await loadCurrentSite();
      
      const count = Object.keys(validAccounts).length;
      showToast(`Imported ${count} entries`, 'success');
      
      // Auto-sync to Notion if enabled
      const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);
      if (config.notionEnabled && config.notionApiKey && config.notionDatabaseId) {
        showToast('Syncing to Notion...', 'success');
        chrome.runtime.sendMessage({
          type: 'SYNC_TO_NOTION',
          apiKey: config.notionApiKey,
          databaseId: config.notionDatabaseId
        }, (response) => {
          if (response?.success) {
            showToast(`Synced ${response.synced || count} entries to Notion`, 'success');
          }
        });
      }
    } catch (error) {
      showToast('Invalid file format', 'error');
    }
    e.target.value = '';
  });

  // Clear all
  elements.clearAllBtn.addEventListener('click', async () => {
    const count = Object.keys(allAccounts).length;
    if (count === 0) {
      showToast('No entries to clear');
      return;
    }
    
    if (!confirm(`Delete all ${count} entries? This cannot be undone.`)) {
      return;
    }
    
    try {
      // Delete from Notion in background (fire and forget)
      const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);
      if (config.notionEnabled && config.notionApiKey && config.notionDatabaseId) {
        const domains = Object.keys(allAccounts);
        domains.forEach(domain => {
          chrome.runtime.sendMessage({ type: 'DELETE_FROM_NOTION', domain }).catch(() => {});
        });
      }
      
      await storage.clear();
      await loadAllAccounts();
      await loadCurrentSite();
      showToast('All data cleared');
    } catch (error) {
      showToast('Error clearing data', 'error');
    }
  });
}

// Save Notion config
async function saveNotionConfig() {
  let databaseId = elements.notionDatabaseId.value.trim();
  
  // Clean database ID
  if (databaseId.includes('notion.so')) {
    const match = databaseId.match(/([a-f0-9]{32})/i);
    if (match) {
      databaseId = match[1];
      elements.notionDatabaseId.value = databaseId;
    }
  }
  databaseId = databaseId.replace(/-/g, '');
  
  await chrome.storage.local.set({
    notionApiKey: elements.notionApiKey.value.trim(),
    notionDatabaseId: databaseId
  });
}

// Generate color from email (Notion dark theme glass colors)
function getColorForEmail(email) {
  if (!email) return 'rgba(255, 255, 255, 0.08)';
  
  // Vibrant colors for dark theme with glass effect
  const colors = [
    'rgba(34, 197, 94, 0.2)',     // green (primary)
    'rgba(155, 154, 151, 0.2)',   // gray
    'rgba(217, 115, 13, 0.2)',    // orange
    'rgba(223, 171, 1, 0.18)',    // yellow
    'rgba(15, 123, 108, 0.2)',    // teal
    'rgba(105, 64, 165, 0.2)',    // purple
    'rgba(173, 26, 114, 0.2)',    // pink
    'rgba(224, 62, 62, 0.18)',    // red
    'rgba(100, 71, 58, 0.25)',    // brown
  ];
  
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Get favicon URL for domain using Google's favicon service
function getFaviconUrl(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

// Copy icon SVG
const copyIconSvg = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const checkIconSvg = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// Copy text to clipboard with feedback
async function copyToClipboard(text, element) {
  try {
    await navigator.clipboard.writeText(text);

    // Visual feedback on element
    if (element) {
      element.classList.add('copied');
      const icon = element.querySelector('.copy-icon');
      if (icon) {
        icon.outerHTML = checkIconSvg;
      }
      setTimeout(() => {
        element.classList.remove('copied');
        const checkIcon = element.querySelector('.copy-icon');
        if (checkIcon) {
          checkIcon.outerHTML = copyIconSvg;
        }
      }, 1500);
    }

    showToast(`Copied: ${text}`, 'success');
  } catch (error) {
    showToast('Failed to copy', 'error');
  }
}

// Show toast notification
function showToast(message, type = '') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

// Sync a single entry to Notion (auto-sync when Notion is enabled)
async function syncSingleEntry() {
  try {
    const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);

    if (!config.notionEnabled || !config.notionApiKey || !config.notionDatabaseId) {
      return;
    }

    chrome.runtime.sendMessage({
      type: 'SYNC_TO_NOTION',
      apiKey: config.notionApiKey,
      databaseId: config.notionDatabaseId
    });
  } catch (error) {
    // Silent fail
  }
}

// Delete from Notion (auto-sync when Notion is enabled)
async function deleteFromNotion(domain) {
  try {
    const config = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId', 'notionEnabled']);

    if (!config.notionEnabled || !config.notionApiKey || !config.notionDatabaseId) {
      return;
    }

    chrome.runtime.sendMessage({
      type: 'DELETE_FROM_NOTION',
      domain: domain
    });
  } catch (error) {
    // Silent fail
  }
}

// Open edit modal
function openEditModal(domain) {
  const account = allAccounts[domain];
  if (!account) return;
  
  // Create modal overlay
  const modalHTML = `
    <div class="modal-overlay" id="edit-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Edit Entry</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-row">
            <label>Domain</label>
            <input type="text" id="edit-domain" value="${domain}" disabled>
          </div>
          <div class="form-row">
            <label>Email</label>
            <input type="email" id="edit-email" value="${account.email}" placeholder="you@example.com">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-action modal-cancel">Cancel</button>
          <button class="btn btn-primary modal-save">Save</button>
        </div>
      </div>
    </div>
  `;
  
  // Remove existing modal if any
  const existingModal = document.getElementById('edit-modal');
  if (existingModal) existingModal.remove();
  
  // Add modal to body
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  
  const modal = document.getElementById('edit-modal');
  const editEmail = document.getElementById('edit-email');
  const closeBtn = modal.querySelector('.modal-close');
  const cancelBtn = modal.querySelector('.modal-cancel');
  const saveBtn = modal.querySelector('.modal-save');
  
  // Focus email input
  editEmail.focus();
  editEmail.select();
  
  // Close handlers
  const closeModal = () => modal.remove();
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  
  // Save handler
  saveBtn.addEventListener('click', async () => {
    const newEmail = editEmail.value.trim().toLowerCase();
    
    if (!newEmail || !newEmail.includes('@')) {
      showToast('Please enter a valid email', 'error');
      return;
    }
    
    // Update storage
    await storage.save(domain, {
      email: newEmail,
      displayName: account.displayName || '',
      photoUrl: account.photoUrl || ''
    });
    
    showToast('Entry updated', 'success');
    closeModal();
    
    // Reload UI
    await loadAllAccounts();
    await loadCurrentSite();
    
    // Sync to Notion if enabled
    syncSingleEntry(domain);
  });
  
  // Enter key to save
  editEmail.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });
  
  // Escape key to close
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  });
}
