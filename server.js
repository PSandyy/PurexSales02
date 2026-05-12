// server.js — DataGate Express Backend
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const XLSX    = require('xlsx');
const path    = require('path');
const db      = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'datagate-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// Multer for Excel uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Auth Middleware ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin only' });
  next();
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username?.trim().toLowerCase());
  if (!user || user.password !== password)
    return res.status(401).json({ error: 'Invalid credentials' });
  req.session.user = { id: user.id, username: user.username, displayName: user.display_name, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// ══════════════════════════════════════════════════════════════
//  USERS ROUTES  (admin only)
// ══════════════════════════════════════════════════════════════
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.getUsers().map(u => ({
    id: u.id, username: u.username, displayName: u.display_name,
    role: u.role, createdAt: u.created_at
  }));
  res.json({ users });
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, displayName, password } = req.body;
  if (!username || !displayName || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password min. 6 characters' });
  const existing = db.getUserByUsername(username.trim().toLowerCase());
  if (existing) return res.status(409).json({ error: 'Username already exists' });
  db.createUser(username.trim().toLowerCase(), displayName.trim(), password);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  SHEET DATA ROUTES
// ══════════════════════════════════════════════════════════════
app.post('/api/sheet/upload', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = req.body.sheetName || wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows.length) return res.status(400).json({ error: 'Sheet is empty' });
    const columns = Object.keys(rows[0]);
    db.saveSheetData(sheetName, columns, rows);
    res.json({ ok: true, sheetName, columns, rowCount: rows.length, sheets: wb.SheetNames });
  } catch (e) {
    res.status(500).json({ error: 'Failed to parse file: ' + e.message });
  }
});

app.post('/api/sheet/select', requireAdmin, upload.single('file'), (req, res) => {
  // Re-parse with a different sheet selection
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  res.json({ sheets: wb.SheetNames });
});

app.get('/api/sheet', requireAuth, (req, res) => {
  const data = db.getSheetData();
  if (!data) return res.json({ data: null });
  // For regular users, return only their allowed data
  if (req.session.user.role !== 'admin') {
    const filtered = getFilteredData(req.session.user.id, data);
    return res.json({ data: { ...data, rows: filtered.rows, columns: filtered.cols } });
  }
  res.json({ data });
});

app.delete('/api/sheet', requireAdmin, (req, res) => {
  db.clearSheetData();
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  PERMISSIONS ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/permissions', requireAdmin, (req, res) => {
  const users = db.getUsers().filter(u => u.role !== 'admin');
  const result = {};
  for (const u of users) {
    const p = db.getPermissions(u.id);
    result[u.username] = p ? {
      columns: JSON.parse(p.columns || '[]'),
      filters: JSON.parse(p.filters || '[]'),
      territories: JSON.parse(p.territories || '[]'),
    } : null;
  }
  res.json({ permissions: result });
});

app.get('/api/permissions/:username', requireAdmin, (req, res) => {
  const user = db.getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const p = db.getPermissions(user.id);
  res.json({ permissions: p ? {
    columns: JSON.parse(p.columns || '[]'),
    filters: JSON.parse(p.filters || '[]'),
    territories: JSON.parse(p.territories || '[]'),
  } : null });
});

app.put('/api/permissions/:username', requireAdmin, (req, res) => {
  const user = db.getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { columns = [], filters = [], territories = [] } = req.body;
  db.upsertPermissions(user.id, columns, filters, territories);
  res.json({ ok: true });
});

app.delete('/api/permissions/:username', requireAdmin, (req, res) => {
  const user = db.getUserByUsername(req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.deletePermissions(user.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  TERRITORIES ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/territories', requireAuth, (req, res) => {
  res.json({ territories: db.getTerritories() });
});

app.post('/api/territories', requireAdmin, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  db.addTerritory(name.trim());
  res.json({ ok: true });
});

app.delete('/api/territories/:name', requireAdmin, (req, res) => {
  db.deleteTerritory(decodeURIComponent(req.params.name));
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  SETTINGS ROUTES
// ══════════════════════════════════════════════════════════════
app.get('/api/settings', requireAuth, (req, res) => {
  const terrCol = db.getSetting('territory_column');
  res.json({ territoryColumn: terrCol || null });
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const { territoryColumn } = req.body;
  db.setSetting('territory_column', territoryColumn || '');
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════
//  USER DATA — filtered view
// ══════════════════════════════════════════════════════════════
app.get('/api/mydata', requireAuth, (req, res) => {
  const sheetData = db.getSheetData();
  if (!sheetData) return res.json({ data: null });
  const filtered = getFilteredData(req.session.user.id, sheetData);
  res.json({ data: filtered, sheetName: sheetData.sheetName });
});

// ── Helper: apply permissions filter ──────────────────────────
function getFilteredData(userId, sheetData) {
  const p = db.getPermissions(userId);
  if (!p) return { rows: [], cols: [] };

  let rows = [...sheetData.rows];
  let cols = [...sheetData.columns];

  const permCols = JSON.parse(p.columns || '[]');
  const filters  = JSON.parse(p.filters  || '[]');
  const terrs    = JSON.parse(p.territories || '[]');

  if (permCols.length) cols = permCols;

  if (filters.length) {
    rows = rows.filter(row => filters.every(f => String(row[f.col] ?? '').trim() === f.val.trim()));
  }

  const terrCol = db.getSetting('territory_column');
  if (terrCol && terrs.length) {
    rows = rows.filter(row => terrs.includes(String(row[terrCol] ?? '').trim()));
  }

  return { rows, cols };
}

// ── Serve index.html for all non-API routes ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════╗`);
  console.log(`  ║   DataGate running on :${PORT}      ║`);
  console.log(`  ║   http://localhost:${PORT}           ║`);
  console.log(`  ╚══════════════════════════════════╝\n`);
});
