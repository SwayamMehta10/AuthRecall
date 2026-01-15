// Notion API integration for syncing OAuth accounts

class NotionSync {
  constructor(apiKey, databaseId) {
    this.apiKey = apiKey;
    this.databaseId = databaseId;
    this.baseUrl = 'https://api.notion.com/v1';
    this._schema = null;
  }

  /**
   * Sync all accounts to Notion database
   */
  async syncAccounts(accounts) {
    const results = {
      success: true,
      synced: 0,
      failed: 0,
      errors: []
    };

    const entries = Object.entries(accounts);
    if (entries.length === 0) {
      return { success: true, synced: 0, message: 'No accounts to sync' };
    }

    // Get database schema first
    try {
      await this.getDatabaseSchema();
    } catch (error) {
      return { success: false, error: `Cannot access database: ${error.message}` };
    }

    // Get existing pages
    let existingDomains = new Map();
    try {
      const existingPages = await this.queryDatabase();
      for (const page of existingPages) {
        const titleProp = Object.values(page.properties).find(p => p.type === 'title');
        const domain = titleProp?.title?.[0]?.text?.content;
        if (domain) {
          existingDomains.set(domain.toLowerCase(), page.id);
        }
      }
    } catch (error) {
      // Silent fail - query error
    }

    // Sync each account
    for (const [domain, account] of entries) {
      try {
        const existingPageId = existingDomains.get(domain.toLowerCase());
        
        if (existingPageId) {
          await this.updatePage(existingPageId, domain, account);
        } else {
          await this.createPage(domain, account);
        }
        
        results.synced++;
      } catch (error) {
        results.failed++;
        results.errors.push({ domain, error: error.message });
      }
    }

    if (results.failed > 0 && results.synced === 0) {
      results.success = false;
      results.error = results.errors[0]?.error || 'Failed to sync';
    }

    return results;
  }

  /**
   * Query the database for existing pages
   */
  async queryDatabase() {
    const response = await fetch(`${this.baseUrl}/databases/${this.databaseId}/query`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ page_size: 100 })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
  }

  /**
   * Create a new page in the database
   */
  async createPage(domain, account) {
    const properties = this.buildProperties(domain, account);

    const response = await fetch(`${this.baseUrl}/pages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        parent: { database_id: this.databaseId },
        properties: properties
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create page');
    }

    return await response.json();
  }

  /**
   * Update an existing page
   */
  async updatePage(pageId, domain, account) {
    const properties = this.buildProperties(domain, account);

    const response = await fetch(`${this.baseUrl}/pages/${pageId}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ properties: properties })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to update page');
    }

    return await response.json();
  }

  /**
   * Get database schema
   */
  async getDatabaseSchema() {
    if (this._schema) return this._schema;

    const response = await fetch(`${this.baseUrl}/databases/${this.databaseId}`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get database');
    }

    const data = await response.json();
    this._schema = data.properties;
    return this._schema;
  }

  /**
   * Build properties based on actual database schema - ONLY set existing properties
   */
  buildProperties(domain, account) {
    const properties = {};
    const schema = this._schema;

    if (!schema) return properties;

    for (const [propName, propConfig] of Object.entries(schema)) {
      const nameLower = propName.toLowerCase();
      const propType = propConfig.type;

      // Title property - use for domain
      if (propType === 'title') {
        properties[propName] = {
          title: [{ text: { content: domain } }]
        };
      }
      // Email type property
      else if (propType === 'email' && (nameLower.includes('email') || nameLower.includes('account') || nameLower.includes('mail'))) {
        properties[propName] = {
          email: account.email || null
        };
      }
      // Rich text for email (if not email type)
      else if (propType === 'rich_text' && (nameLower.includes('email') || nameLower.includes('account') || nameLower.includes('mail'))) {
        properties[propName] = {
          rich_text: [{ text: { content: account.email || '' } }]
        };
      }
      // Rich text for display name
      else if (propType === 'rich_text' && (nameLower.includes('name') || nameLower.includes('display'))) {
        properties[propName] = {
          rich_text: [{ text: { content: account.displayName || '' } }]
        };
      }
      // Date properties
      else if (propType === 'date' && (nameLower.includes('last') || nameLower.includes('updated') || nameLower.includes('date'))) {
        if (account.lastUsed) {
          properties[propName] = {
            date: { start: new Date(account.lastUsed).toISOString().split('T')[0] }
          };
        }
      }
      else if (propType === 'date' && (nameLower.includes('first') || nameLower.includes('created'))) {
        if (account.firstSeen) {
          properties[propName] = {
            date: { start: new Date(account.firstSeen).toISOString().split('T')[0] }
          };
        }
      }
      // URL for photo
      else if (propType === 'url' && nameLower.includes('photo')) {
        if (account.photoUrl) {
          properties[propName] = { url: account.photoUrl };
        }
      }
    }

    return properties;
  }

  /**
   * Get request headers
   */
  getHeaders() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };
  }

  /**
   * Verify connection to Notion
   */
  async verifyConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/databases/${this.databaseId}`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response.ok) {
        const error = await response.json();
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch all entries from Notion database
   * @returns {Promise<Object>} Entries in local storage format
   */
  async fetchAllEntries() {
    const entries = {};

    try {
      await this.getDatabaseSchema();
      const pages = await this.queryDatabase();

      for (const page of pages) {
        const props = page.properties;
        let domain = null;
        let email = null;
        let lastModified = null;

        // Extract data from properties
        for (const [propName, propConfig] of Object.entries(props)) {
          const nameLower = propName.toLowerCase();

          if (propConfig.type === 'title') {
            domain = propConfig.title?.[0]?.text?.content;
          } else if (propConfig.type === 'email' ||
                     (propConfig.type === 'rich_text' &&
                      (nameLower.includes('email') || nameLower.includes('account')))) {
            email = propConfig.type === 'email'
              ? propConfig.email
              : propConfig.rich_text?.[0]?.text?.content;
          } else if (propConfig.type === 'date' &&
                     (nameLower.includes('last') || nameLower.includes('modified') || nameLower.includes('updated'))) {
            const dateStr = propConfig.date?.start;
            if (dateStr) {
              lastModified = new Date(dateStr).getTime();
            }
          }
        }

        // Use Notion's last_edited_time as fallback
        if (!lastModified && page.last_edited_time) {
          lastModified = new Date(page.last_edited_time).getTime();
        }

        if (domain && email) {
          entries[domain.toLowerCase()] = {
            email: email,
            displayName: '',
            photoUrl: '',
            lastModified: lastModified || Date.now(),
            lastUsed: lastModified || Date.now()
          };
        }
      }
    } catch (error) {
      console.error('Failed to fetch from Notion:', error);
    }

    return entries;
  }

  /**
   * Archive (delete) a page by domain
   */
  async archiveByDomain(domain) {
    try {
      // First, find the page
      const existingPages = await this.queryDatabase();
      let pageId = null;
      
      for (const page of existingPages) {
        const titleProp = Object.values(page.properties).find(p => p.type === 'title');
        const pageDomain = titleProp?.title?.[0]?.text?.content;
        if (pageDomain && pageDomain.toLowerCase() === domain.toLowerCase()) {
          pageId = page.id;
          break;
        }
      }
      
      if (!pageId) {
        return { success: true, message: 'Page not found in Notion' };
      }
      
      // Archive the page
      const response = await fetch(`${this.baseUrl}/pages/${pageId}`, {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ archived: true })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to archive page');
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotionSync;
}
