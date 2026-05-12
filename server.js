'use strict';
const express  = require('express');
const session  = require('express-session');
const multer   = require('multer');
const XLSX     = require('xlsx');
const path     = require('path');
const db       = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'datagate-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ── Auth guards ─────────────────────────────────────────────────
const requireAuth  = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Not authenticated' });
const requireAdmin = (req, res, next) => (req.session.user?.role === 'admin') ? next() : res.status(403).json({ error: 'Admin only' });

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const username = (req.body.username || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = db.getUserByUsername(username);
  if (!user || user.password !== password)
    return res.status(401).json({ error: 'Invalid username or password' });
  req.session.user = { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: req.session.user });
});

// ══════════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════════
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.getUsers().map(u => ({
    id: u.id, username: u.username, displayName: u.display_name, role: u.role, createdAt: u.created_at
  }));
  res.json({ users });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !displayName || !password) return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const u = (username || '').trim().toLowerCase();
  if (db.getUserByUsername(u)) return res.status(409).json({ error: 'Username already exists' });
  db.createUser(u, displayName.trim(), password);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  SHEET DATA
// ══════════════════════════════════════════════════════════════
app.post('/api/sheet/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = req.body.sheetName || wb.SheetNames[0];
    if (!wb.Sheets[sheetName]) return res.status(400).json({ error: 'Sheet not found in file' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'Sheet is empty' });
    const columns = Object.keys(rows[0]);
    db.saveSheet(sheetName, columns, rows);
    res.json({ ok: true, sheetName, columns, rowCount: rows.length, sheets: wb.SheetNames });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse file: ' + e.message });
  }
});

app.get('/api/sheet', requireAdmin, (req, res) => {
  const data = db.getSheet();
  res.json({ data: data || null });
});

app.delete('/api/sheet', requireAdmin, (req, res) => {
  db.clearSheet();
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  PERMISSIONS
// ══════════════════════════════════════════════════════════════
app.get('/api/permissions', requireAdmin, (req, res) => {
  const users = db.getUsers().filter(u => u.role !== 'admin');
  const result = {};
  for (const u of users) {
    const p = db.getPermission(u.id);
    result[u.username] = p ? {
      columns:     JSON.parse(p.columns_json),
      filters:     JSON.parse(p.filters_json),
      territories: JSON.parse(p.terr_json),
    } : null;
  }
  res.json({ permissions: result });
});

app.put('/api/permissions/:username', requireAdmin, (req, res) => {
  const user = db.getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { columns = [], filters = [], territories = [] } = req.body;
  db.upsertPermission(user.id, columns, filters, territories);
  res.json({ ok: true });
});

app.delete('/api/permissions/:username', requireAdmin, (req, res) => {
  const user = db.getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.deletePermission(user.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  TERRITORIES
// ══════════════════════════════════════════════════════════════
app.get('/api/territories', requireAuth, (req, res) => {
  res.json({ territories: db.getTerritories() });
});

app.post('/api/territories', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.addTerritory(name);
  res.json({ ok: true });
});

app.delete('/api/territories/:name', requireAdmin, (req, res) => {
  db.delTerritory(decodeURIComponent(req.params.name));
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════
app.get('/api/settings', requireAuth, (req, res) => {
  res.json({ territoryColumn: db.getSetting('territory_column') || null });
});

app.put('/api/settings', requireAdmin, (req, res) => {
  db.setSetting('territory_column', req.body.territoryColumn || '');
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  USER'S FILTERED DATA
// ══════════════════════════════════════════════════════════════
app.get('/api/mydata', requireAuth, (req, res) => {
  const sheet = db.getSheet();
  if (!sheet) return res.json({ data: null });

  const p = db.getPermission(req.session.user.id);
  if (!p) return res.json({ data: null });

  let rows = [...sheet.rows];
  let cols = [...sheet.columns];

  const permCols = JSON.parse(p.columns_json || '[]');
  const filters  = JSON.parse(p.filters_json  || '[]');
  const terrs    = JSON.parse(p.terr_json      || '[]');
  const terrCol  = db.getSetting('territory_column');

  if (permCols.length) cols = permCols;

  if (filters.length)
    rows = rows.filter(row => filters.every(f => String(row[f.col] ?? '').trim() === f.val.trim()));

  if (terrCol && terrs.length)
    rows = rows.filter(row => terrs.includes(String(row[terrCol] ?? '').trim()));

  res.json({ data: { rows, cols } });
});

// ── SPA fallback ────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ───────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  DataGate running at http://localhost:${PORT}\n`);
});
