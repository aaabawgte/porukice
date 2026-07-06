window.PorukiceAuth = {
  tokenKey: 'porukice_token',

  getToken() {
    return localStorage.getItem(this.tokenKey);
  },

  setToken(token) {
    localStorage.setItem(this.tokenKey, token);
  },

  clearToken() {
    localStorage.removeItem(this.tokenKey);
  },

  isLoggedIn() {
    return Boolean(this.getToken());
  },

  async login(username, password) {
    const result = await window.PorukiceApi.login(username, password);
    this.setToken(result.token);
    return result;
  },

  async register(username, password, displayName) {
    const result = await window.PorukiceApi.register(username, password, displayName);
    this.setToken(result.token);
    return result;
  },

  logout() {
    this.clearToken();
    window.location.href = '../index.html';
  }
};
