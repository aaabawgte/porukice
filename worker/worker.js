const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_USERS = 2;
const ALLOWED_REACTIONS = ['❤️', '🥺', '😂', '💋', '😡'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({ ok: true, app: 'porukice-api' }, env);
      }

      if (path === '/api/auth/register' && request.method === 'POST') {
        return register(request, env);
      }

      if (path === '/api/auth/login' && request.method === 'POST') {
        return login(request, env);
      }

      if (path === '/api/auth/me' && request.method === 'GET') {
        const user = await requireAuth(request, env);
        return json({ user }, env);
      }

      if (path === '/api/messages' && request.method === 'GET') {
        const user = await requireAuth(request, env);
        return getMessages(env, user);
      }

      if (path === '/api/messages' && request.method === 'POST') {
        const user = await requireAuth(request, env);
        return sendMessage(request, env, user);
      }

      const reactionMatch = path.match(/^\/api\/messages\/(\d+)\/react$/);
      if (reactionMatch && request.method === 'POST') {
        const user = await requireAuth(request, env);
        return reactToMessage(request, env, user, Number(reactionMatch[1]));
      }

      return json({ error: 'Ruta ne postoji' }, env, 404);
    } catch (error) {
      const status = error.status || 500;
      return json({ error: error.message || 'Server greška' }, env, status);
    }
  }
};

async function register(request, env) {
  const body = await readJson(request);
  const username = clean(body.username).toLowerCase();
  const displayName = clean(body.displayName || body.display_name || body.username);
  const password = String(body.password || '');

  if (!username || username.length < 3) {
    throw httpError('Username mora imati barem 3 znaka', 400);
  }

  if (!displayName || displayName.length < 2) {
    throw httpError('Ime za prikaz mora imati barem 2 znaka', 400);
  }

  if (!password || password.length < 6) {
    throw httpError('Lozinka mora imati barem 6 znakova', 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (existing) {
    throw httpError('Taj username već postoji', 409);
  }

  const userCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM users')
    .first();

  if ((userCount?.count || 0) >= MAX_USERS) {
    throw httpError('Registracija je zaključana. Porukice su samo za vas dvoje.', 403);
  }

  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);

  const result = await env.DB.prepare(
    `INSERT INTO users (username, display_name, password_hash, password_salt)
     VALUES (?, ?, ?, ?)`
  ).bind(username, displayName, passwordHash, salt).run();

  const user = {
    id: result.meta.last_row_id,
    username,
    display_name: displayName
  };

  const token = await signJwt(user, env.JWT_SECRET, TOKEN_TTL_SECONDS);

  return json({ token, user }, env, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const username = clean(body.username).toLowerCase();
  const password = String(body.password || '');

  if (!username || !password) {
    throw httpError('Upiši username i lozinku', 400);
  }

  const row = await env.DB.prepare(
    `SELECT id, username, display_name, password_hash, password_salt
     FROM users
     WHERE username = ?`
  ).bind(username).first();

  if (!row) {
    throw httpError('Krivi username ili lozinka', 401);
  }

  const attemptedHash = await hashPassword(password, row.password_salt);

  if (attemptedHash !== row.password_hash) {
    throw httpError('Krivi username ili lozinka', 401);
  }

  const user = {
    id: row.id,
    username: row.username,
    display_name: row.display_name
  };

  const token = await signJwt(user, env.JWT_SECRET, TOKEN_TTL_SECONDS);

  return json({ token, user }, env);
}

async function getMessages(env, user) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO message_reads (message_id, user_id)
     SELECT id, ?
     FROM messages
     WHERE sender_id != ?`
  ).bind(user.id, user.id).run();

  const result = await env.DB.prepare(
    `SELECT
       messages.id,
       messages.body,
       messages.created_at,
       users.id AS sender_id,
       users.username AS sender_username,
       users.display_name AS sender_display_name
     FROM messages
     JOIN users ON users.id = messages.sender_id
     ORDER BY messages.created_at ASC, messages.id ASC
     LIMIT 200`
  ).all();

  const messages = result.results || [];

  if (!messages.length) {
    return json({ messages: [] }, env);
  }

  const ids = messages.map((message) => message.id);
  const placeholders = ids.map(() => '?').join(',');

  const reactionsResult = await env.DB.prepare(
    `SELECT
       message_reactions.message_id,
       message_reactions.user_id,
       message_reactions.reaction,
       users.display_name AS user_display_name
     FROM message_reactions
     JOIN users ON users.id = message_reactions.user_id
     WHERE message_reactions.message_id IN (${placeholders})`
  ).bind(...ids).all();

  const readsResult = await env.DB.prepare(
    `SELECT
       message_reads.message_id,
       message_reads.user_id,
       message_reads.read_at
     FROM message_reads
     WHERE message_reads.message_id IN (${placeholders})`
  ).bind(...ids).all();

  const reactionsByMessage = new Map();
  for (const reaction of reactionsResult.results || []) {
    const list = reactionsByMessage.get(reaction.message_id) || [];
    list.push({
      user_id: reaction.user_id,
      user_display_name: reaction.user_display_name,
      reaction: reaction.reaction,
      mine: reaction.user_id === user.id
    });
    reactionsByMessage.set(reaction.message_id, list);
  }

  const readsByMessage = new Map();
  for (const read of readsResult.results || []) {
    const list = readsByMessage.get(read.message_id) || [];
    list.push(read);
    readsByMessage.set(read.message_id, list);
  }

  const enrichedMessages = messages.map((message) => {
    const reads = readsByMessage.get(message.id) || [];
    const otherRead = reads.find((read) => read.user_id !== message.sender_id);

    return {
      ...message,
      reactions: reactionsByMessage.get(message.id) || [],
      is_read: Boolean(otherRead),
      read_at: otherRead?.read_at || null
    };
  });

  return json({ messages: enrichedMessages }, env);
}

async function sendMessage(request, env, user) {
  const body = await readJson(request);
  const messageBody = clean(body.body);

  if (!messageBody) {
    throw httpError('Poruka ne može biti prazna', 400);
  }

  if (messageBody.length > 1000) {
    throw httpError('Poruka je preduga', 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO messages (sender_id, body) VALUES (?, ?)`
  ).bind(user.id, messageBody).run();

  const message = await env.DB.prepare(
    `SELECT
       messages.id,
       messages.body,
       messages.created_at,
       users.id AS sender_id,
       users.username AS sender_username,
       users.display_name AS sender_display_name
     FROM messages
     JOIN users ON users.id = messages.sender_id
     WHERE messages.id = ?`
  ).bind(result.meta.last_row_id).first();

  return json({ message }, env, 201);
}

async function requireAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    throw httpError('Nisi prijavljen', 401);
  }

  const payload = await verifyJwt(token, env.JWT_SECRET);

  if (!payload || !payload.id) {
    throw httpError('Neispravan token', 401);
  }

  const user = await env.DB.prepare(
    `SELECT id, username, display_name FROM users WHERE id = ?`
  ).bind(payload.id).first();

  if (!user) {
    throw httpError('Korisnik ne postoji', 401);
  }

  return user;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError('Neispravan JSON', 400);
  }
}

function clean(value) {
  return String(value || '').trim();
}

function httpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function json(data, env, status = 200) {
  return corsResponse(JSON.stringify(data), status, env, {
    'Content-Type': 'application/json; charset=utf-8'
  });
}

function corsResponse(body, status, env, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...extraHeaders
    }
  });
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return arrayBufferToBase64(hash);
}

async function signJwt(user, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    iat: now,
    exp: now + ttlSeconds
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signature = await hmacSha256(unsigned, secret || 'dev-secret');

  return `${unsigned}.${signature}`;
}

async function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const expected = await hmacSha256(unsigned, secret || 'dev-secret');

  if (signature !== expected) return null;

  const payload = JSON.parse(base64UrlDecode(encodedPayload));

  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    return null;
  }

  return payload;
}

async function hmacSha256(input, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(input)
  );

  return base64UrlFromArrayBuffer(signature);
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  return base64UrlFromArrayBuffer(bytes.buffer);
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlFromArrayBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function reactToMessage(request, env, user, messageId) {
  if (!messageId) {
    throw httpError('Neispravna poruka', 400);
  }

  const body = await readJson(request);
  const reaction = clean(body.reaction);

  const message = await env.DB.prepare(
    `SELECT id FROM messages WHERE id = ?`
  ).bind(messageId).first();

  if (!message) {
    throw httpError('Poruka ne postoji', 404);
  }

  if (!reaction) {
    await env.DB.prepare(
      `DELETE FROM message_reactions
       WHERE message_id = ? AND user_id = ?`
    ).bind(messageId, user.id).run();

    return json({ ok: true, reaction: null }, env);
  }

  if (!ALLOWED_REACTIONS.includes(reaction)) {
    throw httpError('Ta reakcija nije dopuštena', 400);
  }

  await env.DB.prepare(
    `INSERT INTO message_reactions (message_id, user_id, reaction)
     VALUES (?, ?, ?)
     ON CONFLICT(message_id, user_id)
     DO UPDATE SET reaction = excluded.reaction, created_at = CURRENT_TIMESTAMP`
  ).bind(messageId, user.id, reaction).run();

  return json({ ok: true, reaction }, env);
}