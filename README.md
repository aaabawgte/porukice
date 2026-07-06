# Porukice 💌

Mala privatna web aplikacija za dopisivanje.

## Struktura

```txt
porukice/
├── frontend/
│   ├── index.html
│   ├── chat.html
│   ├── css/style.css
│   └── js/
│       ├── api.js
│       ├── auth.js
│       ├── login.js
│       └── chat.js
└── worker/
    ├── worker.js
    ├── schema.sql
    ├── wrangler.toml
    └── package.json
```

## Worker

1. Uđi u worker folder:

```bash
cd worker
npm install
```

2. Napravi D1 bazu:

```bash
npx wrangler d1 create porukice-db
```

3. Kopiraj `database_id` u `wrangler.toml`.

4. Primijeni bazu lokalno:

```bash
npx wrangler d1 execute porukice-db --local --file=./schema.sql
```

5. Pokreni lokalno:

```bash
npx wrangler dev
```

## Frontend

U `frontend/js/api.js` promijeni `baseUrl` ako ti Worker nije na `http://127.0.0.1:8787`.

Za GitHub Pages kasnije stavi Worker URL, npr.

```js
baseUrl: 'https://porukice-api.tvoj-subdomain.workers.dev'
```
