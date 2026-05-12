# DataGate — Controlled Excel Access System

A web-based application to upload Excel sheets and control exactly which data each user can see, with territory-based access control.

---

## Project Structure

```
datagate/
├── server.js               ← Express backend + all API routes
├── package.json
├── db/
│   └── database.js         ← SQLite schema + query helpers
│   └── datagate.sqlite     ← Auto-created on first run (the database)
└── public/
    ├── index.html          ← Main HTML shell
    ├── css/
    │   └── styles.css      ← All styles
    └── js/
        └── app.js          ← All frontend logic + API calls
```

---

## Setup & Run

### 1. Install dependencies
```bash
cd datagate
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open in browser
```
http://localhost:3000
```

---

## Default Accounts

| Username | Password  | Role  |
|----------|-----------|-------|
| admin    | admin123  | Admin |
| alice    | pass123   | User  |
| bob      | pass123   | User  |
| carol    | pass123   | User  |

---

## Admin Workflow

1. **Upload Data** — Upload an `.xlsx`, `.xls`, or `.csv` file. Select the sheet. Data is stored in the SQLite database.

2. **Territories** — 40 Egyptian territories are pre-loaded. Add custom ones. Assign territories to each user. Map the territory column to your sheet column.

3. **Set Permissions** — Choose which columns each user can see, and add row-level filters (e.g. only rows where `Status = Active`).

4. **Manage Users** — Create/delete user accounts.

5. **Preview** — See exactly what any user will see before they log in.

---

## User Workflow

Users log in and see only:
- The columns the admin allowed
- Rows matching their territory assignments
- Rows matching any additional row filters
- A search bar and **Download Excel** button for their filtered data

---

## Database

The SQLite database (`db/datagate.sqlite`) is created automatically. It stores:
- `users` — accounts and passwords
- `sheet_data` — the uploaded Excel data (JSON)
- `permissions` — per-user column/filter/territory settings
- `territories` — the master territory list
- `settings` — global settings (e.g. territory column mapping)

To reset everything, delete `db/datagate.sqlite` and restart.

---

## Production Notes

- Change `secret` in `server.js` → `express-session` config
- Consider hashing passwords with `bcrypt`
- Use a process manager like `pm2` for production: `pm2 start server.js --name datagate`
- Put behind nginx for HTTPS
