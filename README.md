# DataGate — Controlled Excel Access

## Setup

```bash
# 1. Install dependencies (requires Node.js 16+)
npm install

# 2. Start the server
npm start

# 3. Open browser
http://localhost:3000
```

## Project Structure

```
datagate/
├── server.js            ← Express backend + all API routes
├── package.json
├── db/
│   └── database.js      ← SQLite schema, queries, seed data
│   └── datagate.sqlite  ← Auto-created on first run
└── public/
    ├── index.html       ← Single page app shell
    ├── css/styles.css   ← All styles
    └── js/app.js        ← All frontend logic
```

## Default Accounts

| Username | Password  | Role  |
|----------|-----------|-------|
| admin    | admin123  | Admin |
| alice    | pass123   | User  |
| bob      | pass123   | User  |
| carol    | pass123   | User  |

## Admin Workflow

1. **Territories** — 40 Egyptian territories pre-loaded. Assign them to each user before uploading any data.
2. **Upload Data** — Upload .xlsx / .xls / .csv. Select the sheet. Saved to the database.
3. **Territories → Map Column** — After uploading, link the territory column in your sheet.
4. **Permissions** — Set column access and row filters per user.
5. **Preview** — See exactly what each user sees.

## Notes

- The SQLite database (`db/datagate.sqlite`) is created automatically on first run.
- To reset all data, delete `db/datagate.sqlite` and restart.
- For production: change the session secret in `server.js`, add bcrypt for passwords, and use HTTPS.
