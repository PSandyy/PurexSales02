'use strict';

// ─── API wrapper ───────────────────────────────────────────────
const api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res  = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get:    (url)       => api.req('GET',    url),
  post:   (url, body) => api.req('POST',   url, body),
  put:    (url, body) => api.req('PUT',    url, body),
  del:    (url)       => api.req('DELETE', url),
};

// ─── App state ─────────────────────────────────────────────────
const S = {
  user:        null,
  sheet:       null,   // { sheetName, columns, rows }
  perms:       {},     // { username: { columns, filters, territories } }
  allUsers:    [],
  territories: [],
  terrCol:     null,
  tempFilters: [],
  userPage:    0,
};
const PAGE = 50;

// ─── Tiny helpers ──────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const on = (id, ev, fn) => $(id).addEventListener(ev, fn);

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `show toast-${type}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = ''; }, 3200);
}

function showScreen(id) {
  ['loginScreen','appScreen'].forEach(s => {
    const el = $(s);
    el.style.display = 'none';
    el.classList.remove('active');
  });
  const el = $(id);
  el.style.display = 'flex';
  el.classList.add('active');
}

function buildTable(tbl, rows, cols) {
  if (!rows.length) {
    tbl.innerHTML = `<tbody><tr><td colspan="99" style="text-align:center;padding:36px;color:var(--muted)">No data to display</td></tr></tbody>`;
    return;
  }
  tbl.innerHTML =
    `<thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ══════════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  bindAll();          // attach every event listener
  autoLogin();        // check existing session
});

async function autoLogin() {
  try {
    const { user } = await api.get('/api/auth/me');
    S.user = user;
    await bootApp();
  } catch {
    showScreen('loginScreen');
  }
}

// ══════════════════════════════════════════════════════════════
//  BIND ALL EVENT LISTENERS
// ══════════════════════════════════════════════════════════════
function bindAll() {

  // ── Login ──
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.querySelectorAll('.demo-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      $('loginUser').value = pill.dataset.u;
      $('loginPass').value = pill.dataset.p;
      doLogin();
    });
  });

  // ── Logout ──
  $('logoutBtn').addEventListener('click', doLogout);

  // ── Tab bar ──
  document.querySelectorAll('.tab[data-panel]').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab));
  });

  // ── Upload ──
  const zone = $('uploadZone');
  zone.addEventListener('click', () => $('fileInput').click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  $('fileInput').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  $('confirmSheetBtn').addEventListener('click', confirmSheetUpload);
  $('clearFileBtn').addEventListener('click', clearFile);

  // ── Users ──
  $('addUserBtn').addEventListener('click', () => {
    $('newUsername').value = '';
    $('newDisplayName').value = '';
    $('newPassword').value = '';
    $('addUserModal').classList.add('open');
  });
  $('modalClose').addEventListener('click',     () => $('addUserModal').classList.remove('open'));
  $('modalCancelBtn').addEventListener('click', () => $('addUserModal').classList.remove('open'));
  $('modalSaveBtn').addEventListener('click',   saveNewUser);
  $('addUserModal').addEventListener('click', e => { if (e.target === $('addUserModal')) $('addUserModal').classList.remove('open'); });

  // ── Territories ──
  $('addTerrBtn').addEventListener('click', addCustomTerritory);
  $('newTerrInput').addEventListener('keydown', e => { if (e.key === 'Enter') addCustomTerritory(); });
  $('masterTerrSearch').addEventListener('input', renderMasterTerrList);
  $('terrUserSel').addEventListener('change', loadTerrUserEditor);
  $('terrSearch').addEventListener('input', renderTerrGrid);
  $('terrAllBtn').addEventListener('click',  () => toggleAllTerr(true));
  $('terrNoneBtn').addEventListener('click', () => toggleAllTerr(false));
  $('terrClearUserBtn').addEventListener('click', () => toggleAllTerr(false));
  $('terrSaveBtn').addEventListener('click', saveUserTerritories);
  $('terrColSetBtn').addEventListener('click', saveTerrCol);
  $('terrColClearBtn').addEventListener('click', clearTerrCol);

  // ── Permissions ──
  $('permUserSel').addEventListener('change', loadPermEditor);
  $('colAllBtn').addEventListener('click',    () => toggleAllCols(true));
  $('colNoneBtn').addEventListener('click',   () => toggleAllCols(false));
  $('addFilterBtn').addEventListener('click', addFilter);
  $('filterVal').addEventListener('keydown',  e => { if (e.key === 'Enter') addFilter(); });
  $('savePermsBtn').addEventListener('click', savePerms);
  $('resetPermsBtn').addEventListener('click', resetPerms);

  // ── Preview ──
  $('previewUserSel').addEventListener('change', renderPreview);

  // ── My Data ──
  $('mySearch').addEventListener('input', renderMyTable);
  $('downloadBtn').addEventListener('click', downloadExcel);
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
async function doLogin() {
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value;
  const errEl = $('loginError');
  errEl.style.display = 'none';
  try {
    const { user } = await api.post('/api/auth/login', { username: u, password: p });
    S.user = user;
    await bootApp();
  } catch (e) {
    errEl.textContent = e.message || 'Invalid credentials';
    errEl.style.display = 'block';
  }
}

async function doLogout() {
  await api.post('/api/auth/logout').catch(() => {});
  S.user = null;
  S.sheet = null;
  S.perms = {};
  showScreen('loginScreen');
  $('loginUser').value = '';
  $('loginPass').value = '';
}

// ══════════════════════════════════════════════════════════════
//  BOOT APP
// ══════════════════════════════════════════════════════════════
async function bootApp() {
  showScreen('appScreen');
  $('hUser').textContent = S.user.displayName;
  $('hRole').textContent = S.user.role;
  $('hRole').className   = 'role-chip' + (S.user.role === 'admin' ? '' : ' user');

  // Fetch shared data
  const [terrRes, setRes] = await Promise.all([
    api.get('/api/territories'),
    api.get('/api/settings'),
  ]);
  S.territories = terrRes.territories;
  S.terrCol     = setRes.territoryColumn || null;

  if (S.user.role === 'admin') {
    $('adminTabs').style.display = 'flex';
    $('userTabs').style.display  = 'none';
    const [sheetRes, permsRes] = await Promise.all([
      api.get('/api/sheet'),
      api.get('/api/permissions'),
    ]);
    S.sheet = sheetRes.data;
    S.perms = permsRes.permissions;
    await loadAllUsers();
    activatePanel('upload');
    refreshUploadPanel();
  } else {
    $('adminTabs').style.display = 'none';
    $('userTabs').style.display  = 'flex';
    activatePanel('mydata');
    await loadMyData();
  }
}

// ── Tab switching ───────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const name = tab.dataset.panel;
  activatePanel(name);
}

function activatePanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const p = $('panel-' + name);
  if (p) p.classList.add('active');

  if (name === 'upload')      refreshUploadPanel();
  if (name === 'users')       renderUsersPanel();
  if (name === 'territories') renderTerrPanel();
  if (name === 'permissions') renderPermPanel();
  if (name === 'preview')     refreshPreviewPanel();
}

// ══════════════════════════════════════════════════════════════
//  USERS
// ══════════════════════════════════════════════════════════════
async function loadAllUsers() {
  const res = await api.get('/api/users');
  S.allUsers = res.users;
  fillUserDropdowns();
}

function fillUserDropdowns() {
  const opts = '<option value="">— Choose a user —</option>' +
    S.allUsers.filter(u => u.role !== 'admin')
      .map(u => `<option value="${esc(u.username)}">${esc(u.displayName)} (${esc(u.username)})</option>`)
      .join('');
  ['permUserSel','previewUserSel','terrUserSel'].forEach(id => { if ($(id)) $(id).innerHTML = opts; });
}

function renderUsersPanel() {
  const all   = S.allUsers;
  const users = all.filter(u => u.role !== 'admin');
  const admins= all.filter(u => u.role === 'admin');

  $('userStats').innerHTML = `
    <div class="stat-box"><div class="stat-lbl">Total Users</div><div class="stat-val">${all.length}</div></div>
    <div class="stat-box"><div class="stat-lbl">Regular Users</div><div class="stat-val">${users.length}</div></div>
    <div class="stat-box"><div class="stat-lbl">Admins</div><div class="stat-val">${admins.length}</div></div>
    <div class="stat-box"><div class="stat-lbl">With Permissions</div><div class="stat-val">${Object.values(S.perms).filter(Boolean).length}</div></div>
  `;

  $('usersTbody').innerHTML = all.map(u => {
    const p = S.perms[u.username];
    return `<tr>
      <td><code>${esc(u.username)}</code></td>
      <td>${esc(u.displayName)}</td>
      <td><span class="role-chip ${u.role === 'admin' ? '' : 'user'}">${u.role}</span></td>
      <td>${p?.columns?.length ? `<span class="badge-ok">✓ ${p.columns.length} cols</span>` : '<span class="badge-no">none</span>'}</td>
      <td>${p?.territories?.length ? `<span class="badge-ok">✓ ${p.territories.length}</span>` : '<span style="color:var(--muted);font-size:11px">none</span>'}</td>
      <td>${p?.filters?.length ? `<span class="badge-ok">✓ ${p.filters.length}</span>` : '<span style="color:var(--muted);font-size:11px">—</span>'}</td>
      <td class="row" style="gap:6px">
        ${u.role !== 'admin' ? `<button class="btn btn-sm" onclick="goToPerms('${esc(u.username)}')">Permissions</button>` : ''}
        ${u.username !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id},'${esc(u.username)}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

async function saveNewUser() {
  const username    = $('newUsername').value.trim().toLowerCase();
  const displayName = $('newDisplayName').value.trim();
  const password    = $('newPassword').value;
  try {
    await api.post('/api/users', { username, displayName, password });
    $('addUserModal').classList.remove('open');
    await loadAllUsers();
    const permsRes = await api.get('/api/permissions');
    S.perms = permsRes.permissions;
    renderUsersPanel();
    toast(`User "${displayName}" created`, 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This also removes their permissions.`)) return;
  await api.del(`/api/users/${id}`);
  delete S.perms[username];
  await loadAllUsers();
  renderUsersPanel();
  toast('User deleted', 'ok');
}

function goToPerms(username) {
  // Switch to permissions tab and pre-select user
  document.querySelectorAll('#adminTabs .tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector('#adminTabs .tab[data-panel="permissions"]');
  if (tab) tab.classList.add('active');
  activatePanel('permissions');
  $('permUserSel').value = username;
  loadPermEditor();
}

// ══════════════════════════════════════════════════════════════
//  UPLOAD
// ══════════════════════════════════════════════════════════════
function refreshUploadPanel() {
  if (S.sheet) {
    $('fileStatus').style.display = 'flex';
    $('fileName').textContent = S.sheet.sheetName;
    $('fileMeta').textContent = `${S.sheet.rows.length} rows · ${S.sheet.columns.length} columns`;
    $('previewCard').style.display = 'block';
    $('previewCount').textContent  = `${S.sheet.rows.length} rows · ${S.sheet.columns.length} cols`;
    buildTable($('previewTable'), S.sheet.rows.slice(0, 20), S.sheet.columns);
  } else {
    $('fileStatus').style.display  = 'none';
    $('previewCard').style.display = 'none';
    $('sheetsCard').style.display  = 'none';
  }
}

let _pendingFile = null;

function handleFile(file) {
  _pendingFile = file;
  $('uploadZone').innerHTML = `<div class="loading"><div class="spin"></div> Reading file…</div>`;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const grid = $('sheetsGrid');
      grid.innerHTML = '';
      wb.SheetNames.forEach((name, i) => {
        const chip = document.createElement('div');
        chip.className   = 'sheet-chip' + (i === 0 ? ' active' : '');
        chip.textContent = name;
        chip.dataset.sheet = name;
        chip.addEventListener('click', () => {
          document.querySelectorAll('.sheet-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
        });
        grid.appendChild(chip);
      });
      $('sheetsCard').style.display = 'block';
      $('uploadZone').innerHTML = `
        <div class="upload-icon">📊</div>
        <div class="upload-text"><strong>${esc(file.name)}</strong></div>
        <div class="upload-text" style="margin-top:6px;font-size:11px">Select a sheet below, then click Confirm</div>`;
    } catch (err) {
      toast('Error reading file: ' + err.message, 'err');
      resetUploadZone();
    }
  };
  reader.readAsBinaryString(file);
}

async function confirmSheetUpload() {
  const chip = document.querySelector('.sheet-chip.active');
  if (!chip || !_pendingFile) return;
  const btn = $('confirmSheetBtn');
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const fd = new FormData();
    fd.append('file', _pendingFile);
    fd.append('sheetName', chip.dataset.sheet);
    await api.req('POST', '/api/sheet/upload', fd);
    const res = await api.get('/api/sheet');
    S.sheet = res.data;
    _pendingFile = null;
    resetUploadZone();
    $('sheetsCard').style.display = 'none';
    refreshUploadPanel();
    toast('Sheet uploaded and saved!', 'ok');
  } catch (e) {
    toast('Upload failed: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm Sheet →';
  }
}

async function clearFile() {
  if (!confirm('Remove the uploaded sheet? Users will lose access to the data.')) return;
  await api.del('/api/sheet');
  S.sheet = null;
  _pendingFile = null;
  $('fileInput').value = '';
  $('sheetsCard').style.display = 'none';
  resetUploadZone();
  refreshUploadPanel();
  toast('Sheet removed', 'ok');
}

function resetUploadZone() {
  $('uploadZone').innerHTML = `
    <div class="upload-icon">📊</div>
    <div class="upload-text"><strong>Click to upload</strong> or drag & drop</div>
    <div class="upload-text" style="margin-top:6px;font-size:11px">.xlsx · .xls · .csv</div>
    <button class="btn" style="margin-top:14px;pointer-events:none">Browse File</button>`;
}

// ══════════════════════════════════════════════════════════════
//  TERRITORIES
// ══════════════════════════════════════════════════════════════
function renderTerrPanel() {
  renderMasterTerrList();
  fillUserDropdowns();
  renderTerrOverview();

  const hasSheet = !!S.sheet;
  $('terrNoSheet').style.display  = hasSheet ? 'none'  : 'block';
  $('terrColBlock').style.display = hasSheet ? 'block' : 'none';
  if (hasSheet) {
    $('terrColSel').innerHTML = '<option value="">— Select column —</option>' +
      S.sheet.columns.map(c => `<option value="${esc(c)}" ${c === S.terrCol ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('terrColStatus').style.display = S.terrCol ? 'block' : 'none';
    if (S.terrCol) $('terrColBadge').textContent = S.terrCol;
  }
}

function renderMasterTerrList() {
  const q = ($('masterTerrSearch').value || '').toLowerCase();
  const list = S.territories.filter(t => !q || t.name.toLowerCase().includes(q));
  $('terrCount').textContent = S.territories.length + ' territories';
  $('masterTerrList').innerHTML = list.map(t => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid rgba(42,42,58,.4)">
      <span style="font-size:12px">${esc(t.name)}</span>
      <div class="row" style="gap:6px">
        ${t.is_custom
          ? `<span class="tag tag-p" style="font-size:9px">custom</span>
             <span style="cursor:pointer;color:var(--danger);font-size:13px" data-del-terr="${esc(t.name)}">✕</span>`
          : `<span class="tag" style="font-size:9px;background:rgba(0,212,170,.07);color:var(--muted);border:1px solid var(--border)">built-in</span>`}
      </div>
    </div>`).join('') || '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">No results</div>';

  // Bind delete buttons
  $('masterTerrList').querySelectorAll('[data-del-terr]').forEach(el => {
    el.addEventListener('click', () => removeCustomTerritory(el.dataset.delTerr));
  });
}

async function addCustomTerritory() {
  const val = $('newTerrInput').value.trim();
  if (!val) { toast('Enter a territory name', 'err'); return; }
  if (S.territories.some(t => t.name.toLowerCase() === val.toLowerCase())) { toast('Already exists', 'err'); return; }
  await api.post('/api/territories', { name: val });
  $('newTerrInput').value = '';
  const res = await api.get('/api/territories');
  S.territories = res.territories;
  renderMasterTerrList();
  renderTerrGrid();
  toast(`"${val}" added`, 'ok');
}

async function removeCustomTerritory(name) {
  await api.del('/api/territories/' + encodeURIComponent(name));
  const res = await api.get('/api/territories');
  S.territories = res.territories;
  renderMasterTerrList();
  renderTerrGrid();
  toast(`"${name}" removed`, 'ok');
}

async function saveTerrCol() {
  const col = $('terrColSel').value;
  if (!col) { toast('Select a column', 'err'); return; }
  await api.put('/api/settings', { territoryColumn: col });
  S.terrCol = col;
  $('terrColStatus').style.display = 'block';
  $('terrColBadge').textContent = col;
  toast(`Territory column set to "${col}"`, 'ok');
}

async function clearTerrCol() {
  await api.put('/api/settings', { territoryColumn: '' });
  S.terrCol = null;
  $('terrColSel').value = '';
  $('terrColStatus').style.display = 'none';
  toast('Mapping cleared', 'ok');
}

function loadTerrUserEditor() {
  const username = $('terrUserSel').value;
  if (!username) { $('terrUserEditor').style.display = 'none'; return; }
  const user = S.allUsers.find(u => u.username === username);
  $('terrEditorName').textContent = user?.displayName || username;
  $('terrUserEditor').style.display = 'block';
  $('terrSearch').value = '';
  renderTerrGrid();
}

function renderTerrGrid() {
  const username = $('terrUserSel').value;
  if (!username) return;
  const assigned = S.perms[username]?.territories || [];
  const q = ($('terrSearch').value || '').toLowerCase();
  const list = S.territories.filter(t => !q || t.name.toLowerCase().includes(q));

  $('terrGrid').innerHTML = list.map(t => {
    const on = assigned.includes(t.name);
    return `<label class="col-chip ${on ? 'on' : ''}">
      <input type="checkbox" value="${esc(t.name)}" ${on ? 'checked' : ''}
        onchange="this.closest('label').classList.toggle('on',this.checked);updateTerrCount()">
      ${esc(t.name)}
    </label>`;
  }).join('') || '<span style="color:var(--muted);font-size:11px">No territories match</span>';

  updateTerrCount();
}

function updateTerrCount() {
  const n = $('terrGrid').querySelectorAll('input:checked').length;
  $('terrSelCount').textContent = n + ' selected';
}

function toggleAllTerr(v) {
  $('terrGrid').querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = v;
    cb.closest('label').classList.toggle('on', v);
  });
  updateTerrCount();
}

async function saveUserTerritories() {
  const username = $('terrUserSel').value;
  if (!username) return;
  const territories = [...$('terrGrid').querySelectorAll('input:checked')].map(cb => cb.value);
  const existing = S.perms[username] || { columns: S.sheet?.columns || [], filters: [] };
  await api.put(`/api/permissions/${username}`, { ...existing, territories });
  S.perms[username] = { ...existing, territories };
  renderTerrOverview();
  renderUsersPanel();
  toast(`Saved ${territories.length} territories for ${username}`, 'ok');
}

function renderTerrOverview() {
  const users = S.allUsers.filter(u => u.role !== 'admin');
  $('terrOvCount').textContent = users.length + ' users';
  $('terrOvBody').innerHTML = users.map(u => {
    const terrs = S.perms[u.username]?.territories || [];
    const chips = terrs.length
      ? terrs.slice(0,5).map(t => `<span class="tag tag-g" style="margin:2px">${esc(t)}</span>`).join('')
        + (terrs.length > 5 ? `<span class="tag tag-p" style="margin:2px">+${terrs.length-5}</span>` : '')
      : '<span class="badge-no">none assigned</span>';
    return `<tr>
      <td><strong>${esc(u.displayName)}</strong><br><span style="color:var(--muted);font-size:10px">${esc(u.username)}</span></td>
      <td style="max-width:400px;white-space:normal">${chips}</td>
      <td><span class="tag tag-p">${terrs.length}</span></td>
      <td><button class="btn btn-sm" onclick="quickEditTerr('${esc(u.username)}')">Edit</button></td>
    </tr>`;
  }).join('');
}

function quickEditTerr(username) {
  $('terrUserSel').value = username;
  loadTerrUserEditor();
  $('terrUserEditor').scrollIntoView({ behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════
//  PERMISSIONS
// ══════════════════════════════════════════════════════════════
function renderPermPanel() {
  const hasSheet = !!S.sheet;
  $('permNoSheet').style.display  = hasSheet ? 'none'  : 'block';
  $('permContent').style.display  = hasSheet ? 'block' : 'none';
  fillUserDropdowns();
}

function loadPermEditor() {
  const username = $('permUserSel').value;
  if (!username || !S.sheet) { $('permEditor').style.display = 'none'; return; }
  $('permEditor').style.display = 'block';

  const p = S.perms[username] || { columns: [...S.sheet.columns], filters: [] };
  S.tempFilters = [...(p.filters || [])];

  // Columns
  $('colGrid').innerHTML = S.sheet.columns.map(col => {
    const checked = p.columns?.length ? p.columns.includes(col) : true;
    return `<label class="col-chip ${checked ? 'on' : ''}">
      <input type="checkbox" value="${esc(col)}" ${checked ? 'checked' : ''}
        onchange="this.closest('label').classList.toggle('on',this.checked)">
      ${esc(col)}
    </label>`;
  }).join('');

  // Filter column select
  $('filterCol').innerHTML = S.sheet.columns.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  renderFilterTags();
}

function toggleAllCols(v) {
  $('colGrid').querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.checked = v;
    cb.closest('label').classList.toggle('on', v);
  });
}

function addFilter() {
  const col = $('filterCol').value;
  const val = $('filterVal').value.trim();
  if (!val) { toast('Enter a value', 'err'); return; }
  if (S.tempFilters.some(f => f.col === col && f.val === val)) { toast('Filter already exists', 'err'); return; }
  S.tempFilters.push({ col, val });
  $('filterVal').value = '';
  renderFilterTags();
}

function removeFilter(i) {
  S.tempFilters.splice(i, 1);
  renderFilterTags();
}

function renderFilterTags() {
  $('filterTags').innerHTML = S.tempFilters.map((f, i) =>
    `<div class="f-tag">${esc(f.col)} = "${esc(f.val)}" <span class="rm" onclick="removeFilter(${i})">✕</span></div>`
  ).join('') || '<span style="color:var(--muted);font-size:11px">No filters — all rows visible</span>';
}

async function savePerms() {
  const username = $('permUserSel').value;
  if (!username) return;
  const columns = [...$('colGrid').querySelectorAll('input:checked')].map(cb => cb.value);
  if (!columns.length) { toast('Select at least one column', 'err'); return; }
  const territories = S.perms[username]?.territories || [];
  await api.put(`/api/permissions/${username}`, { columns, filters: S.tempFilters, territories });
  S.perms[username] = { columns, filters: S.tempFilters, territories };
  toast(`Permissions saved for ${username}`, 'ok');
  renderUsersPanel();
}

async function resetPerms() {
  const username = $('permUserSel').value;
  if (!username) return;
  await api.del(`/api/permissions/${username}`);
  delete S.perms[username];
  loadPermEditor();
  toast('Permissions reset', 'ok');
}

// ══════════════════════════════════════════════════════════════
//  PREVIEW
// ══════════════════════════════════════════════════════════════
function refreshPreviewPanel() {
  fillUserDropdowns();
}

function renderPreview() {
  const username = $('previewUserSel').value;
  if (!username || !S.sheet) { $('previewPanel').style.display = 'none'; return; }

  const { rows, cols } = clientFilter(username);
  const user = S.allUsers.find(u => u.username === username);

  $('previewPanel').style.display = 'block';
  $('pvUserName').textContent = user?.displayName || username;
  $('pvUserMeta').textContent = `${cols.length} columns · ${rows.length} rows`;
  $('pvStats').innerHTML = `
    <div class="stat-box" style="padding:10px 14px"><div class="stat-lbl">Rows</div><div class="stat-val" style="font-size:20px">${rows.length}</div></div>
    <div class="stat-box" style="padding:10px 14px"><div class="stat-lbl">Columns</div><div class="stat-val" style="font-size:20px">${cols.length}</div></div>`;
  buildTable($('pvTable'), rows, cols);
}

function clientFilter(username) {
  if (!S.sheet) return { rows: [], cols: [] };
  const p = S.perms[username];
  if (!p) return { rows: [], cols: [] };

  let rows = [...S.sheet.rows];
  let cols = p.columns?.length ? [...p.columns] : [...S.sheet.columns];

  if (p.filters?.length)
    rows = rows.filter(row => p.filters.every(f => String(row[f.col] ?? '').trim() === f.val.trim()));

  if (S.terrCol && p.territories?.length)
    rows = rows.filter(row => p.territories.includes(String(row[S.terrCol] ?? '').trim()));

  return { rows, cols };
}

// ══════════════════════════════════════════════════════════════
//  MY DATA (user view)
// ══════════════════════════════════════════════════════════════
let _myData = null;

async function loadMyData() {
  try {
    const res = await api.get('/api/mydata');
    _myData = res.data;
  } catch {
    _myData = null;
  }

  if (!_myData || !_myData.rows.length) {
    $('myNoPerms').style.display = 'block';
    $('myContent').style.display = 'none';
    return;
  }

  $('myNoPerms').style.display = 'none';
  $('myContent').style.display = 'block';
  $('myWelcome').textContent   = `Welcome, ${S.user.displayName}`;
  $('myMeta').textContent      = `${_myData.rows.length} rows · ${_myData.cols.length} columns`;

  $('myStats').innerHTML = `
    <div class="stat-box" style="padding:12px 16px"><div class="stat-lbl">My Rows</div><div class="stat-val" style="font-size:22px">${_myData.rows.length}</div></div>
    <div class="stat-box" style="padding:12px 16px"><div class="stat-lbl">Columns</div><div class="stat-val" style="font-size:22px">${_myData.cols.length}</div></div>`;

  // Territory chips
  if (S.terrCol) {
    const terrSet = [...new Set(_myData.rows.map(r => r[S.terrCol]).filter(Boolean))];
    if (terrSet.length) {
      $('myTerrChips').style.display = 'flex';
      $('myTerrChips').innerHTML =
        `<span style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-right:8px">${esc(S.terrCol)}:</span>` +
        terrSet.map(t => `<span class="tag tag-g" style="margin:2px">${esc(t)}</span>`).join('');
    } else {
      $('myTerrChips').style.display = 'none';
    }
  } else {
    $('myTerrChips').style.display = 'none';
  }

  S.userPage = 0;
  renderMyTable();
}

function renderMyTable() {
  if (!_myData) return;
  const q = ($('mySearch').value || '').toLowerCase();
  let rows = _myData.rows;
  if (q) rows = rows.filter(r => _myData.cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)));

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  if (S.userPage >= pages) S.userPage = pages - 1;
  buildTable($('myTable'), rows.slice(S.userPage * PAGE, (S.userPage + 1) * PAGE), _myData.cols);

  const pag = $('myPagination');
  if (pages <= 1) { pag.innerHTML = `<span>${total} rows</span>`; return; }

  const btns = Array.from({ length: Math.min(pages, 10) }, (_, i) =>
    `<button class="pg-btn ${i === S.userPage ? 'on' : ''}" onclick="goPage(${i})">${i + 1}</button>`).join('');

  pag.innerHTML = `<span>${total} rows · page ${S.userPage + 1} / ${pages}</span>
    <div class="pg-btns">
      <button class="pg-btn" onclick="goPage(${S.userPage-1})" ${S.userPage===0?'disabled':''}>←</button>
      ${btns}
      <button class="pg-btn" onclick="goPage(${S.userPage+1})" ${S.userPage>=pages-1?'disabled':''}>→</button>
    </div>`;
}

function goPage(n) { S.userPage = n; renderMyTable(); }

function downloadExcel() {
  if (!_myData) return;
  const q = ($('mySearch').value || '').toLowerCase();
  let rows = _myData.rows;
  if (q) rows = rows.filter(r => _myData.cols.some(c => String(r[c] ?? '').toLowerCase().includes(q)));
  if (!rows.length) { toast('No data to download', 'err'); return; }

  const wsData = [_myData.cols, ...rows.map(r => _myData.cols.map(c => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = _myData.cols.map(col => ({
    wch: Math.min(40, Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length)))
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'My Data');
  XLSX.writeFile(wb, `${S.user.displayName.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Download started!', 'ok');
}
