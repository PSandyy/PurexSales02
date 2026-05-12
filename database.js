'use strict';
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'datagate.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ─────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password     TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sheet_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_name  TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    rows_json    TEXT NOT NULL,
    uploaded_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    columns_json TEXT NOT NULL DEFAULT '[]',
    filters_json TEXT NOT NULL DEFAULT '[]',
    terr_json    TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS territories (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT UNIQUE NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);

// ── Seed admin + demo users ─────────────────────────────────────
const seedUser = db.prepare(
  `INSERT OR IGNORE INTO users (username, display_name, password, role) VALUES (?,?,?,?)`
);
seedUser.run('admin', 'Administrator', 'admin123', 'admin');
seedUser.run('alice', 'Alice Johnson',  'pass123',  'user');
seedUser.run('bob',   'Bob Martinez',   'pass123',  'user');
seedUser.run('carol', 'Carol White',    'pass123',  'user');

// ── Seed predefined territories ─────────────────────────────────
const PREDEFINED = [
  'Dakalia II','ASWAN','Qena II','Qena I','MAADI','CAIRO CENTER','HELIOPOLIS',
  'Dakalia I','CAIRO WEST','HARAM & FAISAL','CAIRO EAST I','MOHANDISIN','IMBABA',
  'GIZA','Assuit','FAYOUM','BANI SUEF','port saied & DOMIAT','Alex West','Ismalia',
  'kafr El sheikh','Behera I','SOHAG','CAIRO EAST II','NASR CITY','ELTAGAMOA',
  'Suez & Sinai','El Menia','HELWAN','Behera II','Kaliobia','Menofia','Alex center',
  'ALEX EAST','Gharbia I','Sharkia I','Gharbia II','Sharkia II','6"OCTOBER','El Sheikh Zayed'
];
const seedTerr = db.prepare(`INSERT OR IGNORE INTO territories (name, is_custom) VALUES (?,0)`);
for (const t of PREDEFINED) seedTerr.run(t);

// ── Helpers ─────────────────────────────────────────────────────
module.exports = {
  // users
  getUsers:          () => db.prepare('SELECT * FROM users ORDER BY role DESC, username').all(),
  getUserById:       (id) => db.prepare('SELECT * FROM users WHERE id=?').get(id),
  getUserByUsername: (u)  => db.prepare('SELECT * FROM users WHERE username=?').get(u),
  createUser:        (username, displayName, password) =>
    db.prepare(`INSERT INTO users (username,display_name,password,role) VALUES (?,?,?,'user')`).run(username, displayName, password),
  deleteUser:        (id) => db.prepare(`DELETE FROM users WHERE id=? AND role!='admin'`).run(id),

  // sheet
  saveSheet: (sheetName, columns, rows) => {
    db.prepare('DELETE FROM sheet_data').run();
    db.prepare(`INSERT INTO sheet_data (sheet_name,columns_json,rows_json) VALUES (?,?,?)`)
      .run(sheetName, JSON.stringify(columns), JSON.stringify(rows));
  },
  getSheet: () => {
    const r = db.prepare('SELECT * FROM sheet_data ORDER BY id DESC LIMIT 1').get();
    if (!r) return null;
    return { sheetName: r.sheet_name, columns: JSON.parse(r.columns_json), rows: JSON.parse(r.rows_json), uploadedAt: r.uploaded_at };
  },
  clearSheet: () => db.prepare('DELETE FROM sheet_data').run(),

  // permissions
  getPermission:  (userId) => db.prepare('SELECT * FROM permissions WHERE user_id=?').get(userId),
  getAllPermissions: () => db.prepare('SELECT u.username, p.* FROM permissions p JOIN users u ON u.id=p.user_id').all(),
  upsertPermission: (userId, columns, filters, territories) =>
    db.prepare(`INSERT INTO permissions (user_id,columns_json,filters_json,terr_json) VALUES (?,?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET columns_json=excluded.columns_json,
                filters_json=excluded.filters_json, terr_json=excluded.terr_json`)
      .run(userId, JSON.stringify(columns), JSON.stringify(filters), JSON.stringify(territories)),
  deletePermission: (userId) => db.prepare('DELETE FROM permissions WHERE user_id=?').run(userId),

  // territories
  getTerritories: () => db.prepare('SELECT * FROM territories ORDER BY name').all(),
  addTerritory:   (name) => db.prepare(`INSERT OR IGNORE INTO territories (name,is_custom) VALUES (?,1)`).run(name),
  delTerritory:   (name) => db.prepare(`DELETE FROM territories WHERE name=? AND is_custom=1`).run(name),

  // settings
  getSetting: (key) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : ''; },
  setSetting: (key, val) => db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, val),
};
