// db/database.js — SQLite schema + helper queries
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'datagate.sqlite');
const db = new Database(DB_PATH);

// ── Enable WAL for better concurrency ──────────────────────────
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password  TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sheet_data (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_name TEXT NOT NULL,
    columns    TEXT NOT NULL,   -- JSON array of column names
    rows       TEXT NOT NULL,   -- JSON array of row objects
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    columns  TEXT DEFAULT '[]',    -- JSON array
    filters  TEXT DEFAULT '[]',    -- JSON array [{col, val}]
    territories TEXT DEFAULT '[]', -- JSON array of territory names
    UNIQUE(user_id)
  );

  CREATE TABLE IF NOT EXISTS territories (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT UNIQUE NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// ── Seed default admin if not exists ───────────────────────────
const adminExists = db.prepare("SELECT id FROM users WHERE username='admin'").get();
if (!adminExists) {
  db.prepare(`INSERT INTO users (username, display_name, password, role)
              VALUES ('admin','Administrator','admin123','admin')`).run();
  // demo users
  const demoUsers = [
    ['alice','Alice Johnson','pass123'],
    ['bob','Bob Martinez','pass123'],
    ['carol','Carol White','pass123'],
  ];
  const ins = db.prepare(`INSERT OR IGNORE INTO users (username, display_name, password, role) VALUES (?,?,?,'user')`);
  for (const [u,d,p] of demoUsers) ins.run(u,d,p);
}

// ── Seed predefined territories ─────────────────────────────────
const PREDEFINED = [
  "Dakalia II","ASWAN","Qena II","Qena I","MAADI","CAIRO CENTER","HELIOPOLIS",
  "Dakalia I","CAIRO WEST","HARAM & FAISAL","CAIRO EAST I","MOHANDISIN","IMBABA",
  "GIZA","Assuit","FAYOUM","BANI SUEF","port saied & DOMIAT","Alex West","Ismalia",
  "kafr El sheikh","Behera I","SOHAG","CAIRO EAST II","NASR CITY","ELTAGAMOA",
  "Suez & Sinai","El Menia","HELWAN","Behera II","Kaliobia","Menofia","Alex center",
  "ALEX EAST","Gharbia I","Sharkia I","Gharbia II","Sharkia II","6\"OCTOBER","El Sheikh Zayed"
];
const insTerr = db.prepare(`INSERT OR IGNORE INTO territories (name, is_custom) VALUES (?, 0)`);
for (const t of PREDEFINED) insTerr.run(t);

// ── Query helpers ───────────────────────────────────────────────
module.exports = {
  db,

  // Users
  getUsers: () => db.prepare('SELECT * FROM users ORDER BY role DESC, username').all(),
  getUserByUsername: (u) => db.prepare('SELECT * FROM users WHERE username=?').get(u),
  createUser: (username, displayName, password) =>
    db.prepare(`INSERT INTO users (username, display_name, password, role) VALUES (?,?,?,'user')`).run(username, displayName, password),
  deleteUser: (id) => db.prepare('DELETE FROM users WHERE id=? AND role != "admin"').run(id),

  // Sheet data — only keep ONE active sheet
  saveSheetData: (sheetName, columns, rows) => {
    db.prepare('DELETE FROM sheet_data').run();
    db.prepare(`INSERT INTO sheet_data (sheet_name, columns, rows) VALUES (?,?,?)`)
      .run(sheetName, JSON.stringify(columns), JSON.stringify(rows));
  },
  getSheetData: () => {
    const row = db.prepare('SELECT * FROM sheet_data ORDER BY id DESC LIMIT 1').get();
    if (!row) return null;
    return { sheetName: row.sheet_name, columns: JSON.parse(row.columns), rows: JSON.parse(row.rows), uploadedAt: row.uploaded_at };
  },
  clearSheetData: () => db.prepare('DELETE FROM sheet_data').run(),

  // Permissions
  getPermissions: (userId) => db.prepare('SELECT * FROM permissions WHERE user_id=?').get(userId),
  upsertPermissions: (userId, columns, filters, territories) => {
    db.prepare(`INSERT INTO permissions (user_id, columns, filters, territories)
                VALUES (?,?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET
                  columns=excluded.columns,
                  filters=excluded.filters,
                  territories=excluded.territories`)
      .run(userId, JSON.stringify(columns), JSON.stringify(filters), JSON.stringify(territories));
  },
  deletePermissions: (userId) => db.prepare('DELETE FROM permissions WHERE user_id=?').run(userId),

  // Territories
  getTerritories: () => db.prepare('SELECT * FROM territories ORDER BY name').all(),
  addTerritory: (name) => db.prepare(`INSERT OR IGNORE INTO territories (name, is_custom) VALUES (?, 1)`).run(name),
  deleteTerritory: (name) => db.prepare('DELETE FROM territories WHERE name=? AND is_custom=1').run(name),

  // Settings (territory column mapping etc.)
  getSetting: (key) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : null; },
  setSetting: (key, value) => db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value),
};
