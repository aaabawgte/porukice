const form = document.querySelector('[data-auth-form]');
const toggleButton = document.querySelector('[data-toggle-mode]');
const title = document.querySelector('[data-auth-title]');
const submitButton = document.querySelector('[data-submit]');
const message = document.querySelector('[data-message]');

let mode = 'login';

if (window.PorukiceAuth.isLoggedIn()) {
  window.location.href = 'frontend/chat.html';
}

toggleButton.addEventListener('click', () => {
  mode = mode === 'login' ? 'register' : 'login';
  updateMode();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  const formData = new FormData(form);
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');

  try {
    submitButton.disabled = true;
    submitButton.textContent = mode === 'login' ? 'Ulazim...' : 'Radim račun...';

    if (mode === 'login') {
      await window.PorukiceAuth.login(username, password);
    } else {
      await window.PorukiceAuth.register(username, password, username);
    }

    window.location.href = 'frontend/chat.html';
  } catch (error) {
    setMessage(error.message || 'Nešto je puklo');
  } finally {
    submitButton.disabled = false;
    updateMode();
  }
});

function updateMode() {
  const isLogin = mode === 'login';
  title.textContent = isLogin ? 'Uđi u Porukice' : 'Napravi račun';
  submitButton.textContent = isLogin ? 'Uđi' : 'Napravi račun';
  toggleButton.textContent = isLogin ? 'Nemaš račun? Registriraj se' : 'Imaš račun? Uđi';
}

function setMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

updateMode();
