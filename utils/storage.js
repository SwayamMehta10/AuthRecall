// Storage utility for managing OAuth account data

class StorageManager {
  constructor() {
    this.STORAGE_KEY = 'oauth_accounts';
  }

  /**
   * Get all stored OAuth accounts
   * @returns {Promise<Object>} Object with domain as keys
   */
  async getAll() {
    const result = await chrome.storage.local.get(this.STORAGE_KEY);
    return result[this.STORAGE_KEY] || {};
  }

  /**
   * Get OAuth account for a specific domain
   * @param {string} domain - The domain to look up
   * @returns {Promise<Object|null>} Account data or null
   */
  async getByDomain(domain) {
    const all = await this.getAll();
    return all[domain] || null;
  }

  /**
   * Store OAuth account data for a domain
   * @param {string} domain - The domain
   * @param {Object} accountData - Account information
   * @param {string} accountData.email - Email address
   * @param {string} accountData.displayName - Display name
   * @param {string} accountData.photoUrl - Photo URL
   */
  async save(domain, accountData) {
    const all = await this.getAll();
    
    all[domain] = {
      email: accountData.email,
      displayName: accountData.displayName || '',
      photoUrl: accountData.photoUrl || '',
      lastUsed: Date.now(),
      lastModified: Date.now(),
      firstSeen: all[domain]?.firstSeen || Date.now()
    };

    await chrome.storage.local.set({ [this.STORAGE_KEY]: all });
    
    // Notify that data has changed
    chrome.runtime.sendMessage({
      type: 'ACCOUNT_SAVED',
      domain,
      accountData: all[domain]
    }).catch(() => {
      // Ignore errors if no listeners
    });

    return all[domain];
  }

  /**
   * Delete account data for a specific domain
   * @param {string} domain - The domain to delete
   */
  async delete(domain) {
    const all = await this.getAll();
    delete all[domain];
    await chrome.storage.local.set({ [this.STORAGE_KEY]: all });
  }

  /**
   * Clear all stored data
   */
  async clear() {
    await chrome.storage.local.remove(this.STORAGE_KEY);
  }

  /**
   * Export all data
   * @returns {Promise<Object>} All data as object
   */
  async exportData() {
    const accounts = await this.getAll();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accounts
    };
  }

  /**
   * Import data
   * @param {Object} data - Data object to import
   */
  async importData(data) {
    // Handle both formats: { accounts: {...} } and raw {...}
    const accounts = data.accounts || data;
    const existing = await this.getAll();

    // Merge with existing (imported data takes priority)
    const merged = { ...existing, ...accounts };
    await chrome.storage.local.set({ [this.STORAGE_KEY]: merged });
  }

  /**
   * Merge remote accounts with local using timestamp-based conflict resolution
   * @param {Object} remoteAccounts - Accounts from remote source (Notion)
   * @returns {Promise<Object>} Merged accounts
   */
  async mergeWithConflictResolution(remoteAccounts) {
    const local = await this.getAll();
    const merged = { ...local };

    for (const [domain, remoteAccount] of Object.entries(remoteAccounts)) {
      const localAccount = local[domain];

      if (!localAccount) {
        // New from remote - add it
        merged[domain] = remoteAccount;
      } else {
        // Conflict - most recent timestamp wins
        const localTime = localAccount.lastModified || localAccount.lastUsed || 0;
        const remoteTime = remoteAccount.lastModified || remoteAccount.lastUsed || 0;

        if (remoteTime > localTime) {
          merged[domain] = remoteAccount;
        }
        // If local is newer, keep local (already in merged)
      }
    }

    await chrome.storage.local.set({ [this.STORAGE_KEY]: merged });
    return merged;
  }

  /**
   * Get statistics about stored accounts
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    const all = await this.getAll();
    const domains = Object.keys(all);
    const uniqueEmails = new Set(domains.map(d => all[d].email));
    
    return {
      totalDomains: domains.length,
      uniqueAccounts: uniqueEmails.size,
      domains: domains
    };
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
}
