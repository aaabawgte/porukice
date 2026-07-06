window.PorukiceApi = {
  baseUrl: 'https://porukice-api.aaabawgte.workers.dev',

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/$/, '');
  },

  async request(path, options = {}) {
    const token = window.PorukiceAuth?.getToken?.();

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'API greška');
    }

    return data;
  },

  health() {
    return this.request('/api/health');
  },

  login(username, password) {
    return this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  register(username, password, displayName) {
    return this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName })
    });
  },

  me() {
    return this.request('/api/auth/me');
  },

  getMessages() {
    return this.request('/api/messages');
  },

  sendMessage(body) {
    return this.request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ body })
    });
  },

  reactToMessage(messageId, reaction) {
    return this.request(`/api/messages/${messageId}/react`, {
      method: 'POST',
      body: JSON.stringify({ reaction })
    });
  }
};
