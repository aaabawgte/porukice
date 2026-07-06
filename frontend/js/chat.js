const messagesEl = document.querySelector('[data-messages]');
const form = document.querySelector('[data-message-form]');
const input = document.querySelector('[data-message-input]');
const logoutButton = document.querySelector('[data-logout]');
const statusEl = document.querySelector('[data-status]');

let currentUser = null;
let refreshTimer = null;
let lastRenderedMessageSignature = '';
let isSending = false;

const REACTIONS = ['❤️', '🥺', '😂', '💋', '😡'];

init();

async function init() {
  if (!window.PorukiceAuth.isLoggedIn()) {
    window.location.href = '../index.html';
    return;
  }

  logoutButton.addEventListener('click', () => window.PorukiceAuth.logout());
  form.addEventListener('submit', onSubmit);
  messagesEl.innerHTML = '<div class="empty">Učitavam porukice...</div>';

  try {
    const me = await window.PorukiceApi.me();
    currentUser = me.user;
    setStatus(`Prijavljen/a kao ${currentUser.display_name}`);
    await loadMessages();
    refreshTimer = setInterval(loadMessages, 2500);
  } catch (error) {
    window.PorukiceAuth.clearToken();
    window.location.href = '../index.html';
  }
}

async function onSubmit(event) {
  event.preventDefault();

  if (isSending) return;

  const body = input.value.trim();
  if (!body) return;

  const submitButton = form.querySelector('button[type="submit"]');
  const previousButtonText = submitButton ? submitButton.textContent : '';

  isSending = true;
  input.disabled = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = '...';
  }

  input.value = '';

  try {
    await window.PorukiceApi.sendMessage(body);
    lastRenderedMessageSignature = '';
    await loadMessages({ forceScroll: true });
    setStatus(`Prijavljen/a kao ${currentUser.display_name}`);
  } catch (error) {
    input.value = body;
    setStatus(error.message || 'Poruka nije poslana. Internet se pravi mrtav.');
  } finally {
    isSending = false;
    input.disabled = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = previousButtonText;
    }
    input.focus();
  }
}

async function loadMessages(options = {}) {
  try {
    const shouldStickToBottom = options.forceScroll || isNearBottom();
    const result = await window.PorukiceApi.getMessages();
    const messages = result.messages || [];
    const messageSignature = getMessageSignature(messages);

    if (messageSignature === lastRenderedMessageSignature) {
      return;
    }

    lastRenderedMessageSignature = messageSignature;
    renderMessages(messages, { shouldScroll: shouldStickToBottom });
  } catch (error) {
    setStatus(error.message || 'Ne mogu učitati poruke. Nešto se pravi pametno.');
  }
}

function renderMessages(messages, options = {}) {
  messagesEl.innerHTML = '';

  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty">Još nema porukica. Napiši prvu, nemoj bit panj.</div>';
    return;
  }

  for (const message of messages) {
    const isMine = currentUser && message.sender_id === currentUser.id;
    const bubble = document.createElement('div');
    bubble.className = `message ${isMine ? 'mine' : 'theirs'}`;

    const name = document.createElement('div');
    name.className = 'message-name';
    name.textContent = message.sender_display_name || message.sender_username;

    const body = document.createElement('div');
    body.className = 'message-body';
    body.textContent = message.body;

    const reactions = createReactions(message);

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = getMessageMeta(message, isMine);

    bubble.append(name, body, reactions, time);
    messagesEl.appendChild(bubble);
  }

  if (options.shouldScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function isNearBottom() {
  const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  return distanceFromBottom < 120;
}

function createReactions(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'message-reactions';

  for (const reaction of REACTIONS) {
    const existingReaction = (message.reactions || []).find((item) => item.reaction === reaction);
    const reactedByMe = Boolean(existingReaction?.mine);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `reaction-button ${reactedByMe ? 'active' : ''}`;
    button.textContent = reaction;
    button.title = existingReaction
      ? `Reakcija: ${existingReaction.user_display_name || 'netko'}`
      : `Reagiraj ${reaction}`;

    button.addEventListener('click', async () => {
      await onReactionClick(message.id, reactedByMe ? '' : reaction);
    });

    wrapper.appendChild(button);
  }

  return wrapper;
}

async function onReactionClick(messageId, reaction) {
  try {
    await window.PorukiceApi.reactToMessage(messageId, reaction);
    lastRenderedMessageSignature = '';
    await loadMessages({ forceScroll: false });
  } catch (error) {
    setStatus(error.message || 'Reakcija nije prošla. Jebiga, probaj opet.');
  }
}

function getMessageMeta(message, isMine) {
  const time = formatTime(message.created_at);

  if (!isMine) {
    return time;
  }

  return `${time} · ${message.is_read ? 'pročitano' : 'poslano'}`;
}

function getMessageSignature(messages) {
  return messages.map((message) => {
    const reactions = (message.reactions || [])
      .map((reaction) => `${reaction.user_id}:${reaction.reaction}`)
      .sort()
      .join('|');

    return `${message.id}:${message.is_read ? 1 : 0}:${message.read_at || ''}:${reactions}`;
  }).join(',');
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('hr-HR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function setStatus(text) {
  statusEl.textContent = text;
}
