const messagesEl = document.querySelector('[data-messages]');
const form = document.querySelector('[data-message-form]');
const input = document.querySelector('[data-message-input]');
const logoutButton = document.querySelector('[data-logout]');
const statusEl = document.querySelector('[data-status]');

let currentUser = null;
let refreshTimer = null;
let lastRenderedMessageSignature = '';
let isSending = false;
let notificationButton = null;
let replyTarget = null;

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
    setupNotificationButton();
    await loadMessages();
    refreshTimer = setInterval(loadMessages, 2500);
  } catch (error) {
    window.PorukiceAuth.clearToken();
    window.location.href = '../index.html';
  }
}

function setupNotificationButton() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return;
  }

  if (Notification.permission === 'granted') {
    ensurePushSubscription().catch(() => {});
    return;
  }

  if (Notification.permission === 'denied') {
    return;
  }

  notificationButton = document.createElement('button');
  notificationButton.type = 'button';
  notificationButton.className = 'notify-button';
  notificationButton.textContent = 'Uključi obavijesti 💌';
  notificationButton.addEventListener('click', enableNotifications);

  statusEl.insertAdjacentElement('afterend', notificationButton);
}

async function enableNotifications() {
  if (!notificationButton) return;

  const previousText = notificationButton.textContent;
  notificationButton.disabled = true;
  notificationButton.textContent = 'Palim obavijesti...';

  try {
    const permission = await Notification.requestPermission();

    if (permission !== 'granted') {
      notificationButton.textContent = 'Obavijesti nisu dopuštene';
      setStatus('Browser nije dopustio obavijesti. Bez dozvole nema zvonca, jebiga.');
      return;
    }

    await ensurePushSubscription();
    notificationButton.remove();
    notificationButton = null;
    setStatus(`Prijavljen/a kao ${currentUser.display_name} · obavijesti uključene`);
  } catch (error) {
    notificationButton.disabled = false;
    notificationButton.textContent = previousText;
    setStatus(error.message || 'Obavijesti nisu uključene. Nešto se pravi pametno.');
  }
}

async function ensurePushSubscription() {
  const registration = await navigator.serviceWorker.ready;
  const existingSubscription = await registration.pushManager.getSubscription();

  if (existingSubscription) {
    await window.PorukiceApi.subscribeToPush(existingSubscription);
    return existingSubscription;
  }

  const keyResult = await window.PorukiceApi.getPushPublicKey();
  const publicKey = keyResult.publicKey;

  if (!publicKey) {
    throw new Error('Fali VAPID public key');
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });

  await window.PorukiceApi.subscribeToPush(subscription);
  return subscription;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
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
    await window.PorukiceApi.sendMessage(body, replyTarget?.id || null);
    clearReply();
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

    if (message.reply_to_id) {
      body.appendChild(createReplyPreview(message));
    }

    const bodyText = document.createElement('div');
    bodyText.className = 'message-body-text';
    bodyText.textContent = message.body;
    body.appendChild(bodyText);

    const reactions = createReactions(message);

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = getMessageMeta(message, isMine);

    bubble.append(name, body, reactions, time);
    attachSwipeReply(bubble, message);
    messagesEl.appendChild(bubble);
  }

  if (options.shouldScroll) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function createReplyPreview(message) {
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'message-reply-preview';
  preview.title = 'Poruka na koju se odgovara';

  const author = document.createElement('div');
  author.className = 'message-reply-author';
  author.textContent = message.reply_sender_display_name || message.reply_sender_username || 'Poruka';

  const text = document.createElement('div');
  text.className = 'message-reply-text';
  text.textContent = message.reply_body || 'Poruka nije dostupna';

  preview.append(author, text);
  preview.addEventListener('click', () => scrollToMessage(message.reply_to_id));

  return preview;
}

function ensureReplyBar() {
  let bar = document.querySelector('.reply-bar');

  if (bar) {
    return bar;
  }

  bar = document.createElement('div');
  bar.className = 'reply-bar hidden';
  bar.innerHTML = `
    <div class="reply-bar-content">
      <div class="reply-bar-label">Odgovaraš na</div>
      <div class="reply-bar-text"></div>
    </div>
    <button class="reply-bar-close" type="button" aria-label="Makni reply">×</button>
  `;

  form.parentNode.insertBefore(bar, form);
  bar.querySelector('.reply-bar-close').addEventListener('click', clearReply);

  return bar;
}

function startReply(message) {
  replyTarget = message;

  const bar = ensureReplyBar();
  const name = message.sender_display_name || message.sender_username || 'poruku';
  const text = message.body || '';

  bar.classList.remove('hidden');
  bar.querySelector('.reply-bar-label').textContent = `Odgovaraš na ${name}`;
  bar.querySelector('.reply-bar-text').textContent = text.length > 90 ? `${text.slice(0, 90)}...` : text;

  input.focus();
}

function clearReply() {
  replyTarget = null;

  const bar = document.querySelector('.reply-bar');
  if (bar) {
    bar.classList.add('hidden');
  }
}

function attachSwipeReply(element, message) {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let swiping = false;

  element.dataset.messageId = String(message.id);

  element.addEventListener('touchstart', (event) => {
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    currentX = startX;
    swiping = true;
  }, { passive: true });

  element.addEventListener('touchmove', (event) => {
    if (!swiping) return;

    currentX = event.touches[0].clientX;
    const diffX = currentX - startX;
    const diffY = event.touches[0].clientY - startY;

    if (Math.abs(diffY) > 28 || diffX <= 0) {
      element.style.transform = '';
      element.classList.remove('swiping-reply');
      return;
    }

    if (diffX < 96) {
      element.style.transform = `translateX(${diffX}px)`;
      element.classList.add('swiping-reply');
    }
  }, { passive: true });

  element.addEventListener('touchend', () => {
    if (!swiping) return;

    const diffX = currentX - startX;
    element.style.transform = '';
    element.classList.remove('swiping-reply');

    if (diffX > 56) {
      startReply(message);
    }

    swiping = false;
  });

  element.addEventListener('dblclick', () => startReply(message));
}

function scrollToMessage(messageId) {
  const target = messagesEl.querySelector(`[data-message-id="${messageId}"]`);

  if (!target) {
    return;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('message-highlight');
  window.setTimeout(() => target.classList.remove('message-highlight'), 1200);
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

    return `${message.id}:${message.is_read ? 1 : 0}:${message.read_at || ''}:${message.reply_to_id || ''}:${message.reply_body || ''}:${reactions}`;
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
