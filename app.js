// ═══════════════════════════════════════════════
//  DataGate — app.js  (frontend)
// ═══════════════════════════════════════════════

// ── API helper ────────────────────────────────
const api = {
  async req(method, url, body) {
    const opts = { method, headers: {} };
    if (body instanceof FormData) {
      opts.body = body;
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  },
  get:    (url)        => api.req('GET', url),
  post:   (url, body)  => api.req('POST', url, body),
  put:    (url, body)  => api.req('PUT', url, body),
  delete: (url)        => api.req('DELETE', url),
};

// ── State ─────────────────────────────────────
const S = {
  user: null,
  sheetData: null,       // { sheetName, columns, rows }
  permissions: {},       // { username: { columns, filters, territories } }
  territories: [],       // all territory objects
  settings: {},          // { territoryColumn }
  tempFilters: [],
  userPage: 0,
};
const PAGE_SIZE = 50;

// ════════════════════════════════════════════════
//  BOOT — check if already logged in
// ════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const { user } = await api.get('/api/auth/me');
    S.user = user;
    await bootApp();
  } catch {
    showScreen('loginScreen');
  }
});

// ════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════
async function doLogin() {
  const u = $('loginUser').value.trim();
  const p = $('loginPass').value;
  try {
    const { user } = await api.post('/api/auth/login', { username: u, password: p });
    S.user = user;
    $('loginError').style.display = 'none';
    await bootApp();
  } catch {
    $('loginError').style.display = 'block';
  }
}

async function doLogout() {
  await api.post('/api/auth/logout');
  S.user = null;
  S.sheetData = null;
  showScreen('loginScreen');
  $('loginUser').value = '';
  $('loginPass').value = '';
}

function quickLogin(u, p) {
  $('loginUser').value = u;
  $('loginPass').value = p;
  doLogin();
}

$('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

// ════════════════════════════════════════════════
//  BOOT APP
// ════════════════════════════════════════════════
async function bootApp() {
  showScreen('appScreen');
  $('headerUsername').textContent = S.user.displayName;
  $('headerRole').textContent = S.user.role;
  $('headerRole').className = 'role-chip' + (S.user.role === 'admin' ? '' : ' user');

  // Load shared data
  const [terrRes, settRes] = await Promise.all([
    api.get('/api/territories'),
    api.get('/api/settings'),
  ]);
  S.territories = terrRes.territories;
  S.settings = settRes;

  if (S.user.role === 'admin') {
    $('adminTabs').style.display = 'flex';
    $('userTabs').style.display = 'none';
    // Load admin-only data
    const [sheetRes, permsRes] = await Promise.all([
      api.get('/api/sheet'),
      api.get('/api/permissions'),
    ]);
    S.sheetData = sheetRes.data;
    S.permissions = permsRes.permissions;
    switchToPanel('upload');
    refreshAdminUploadPanel();
  } else {
    $('adminTabs').style.display = 'none';
    $('userTabs').style.display = 'flex';
    switchToPanel('mydata');
    await loadUserData();
  }
}

// ════════════════════════════════════════════════
//  TABS
// ════════════════════════════════════════════════
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  switchToPanel(name);
}

function switchToPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const p = $('panel-' + name);
  if (p) p.classList.add('active');

  if (name === 'upload')      refreshAdminUploadPanel();
  if (name === 'users')       renderUsersTable();
  if (name === 'territories') renderTerrPanel();
  if (name === 'permissions') renderPermPanel();
  if (name === 'preview')     refreshPreviewPanel();
}

// ════════════════════════════════════════════════
//  ADMIN: UPLOAD
// ════════════════════════════════════════════════
function refreshAdminUploadPanel() {
  if (S.sheetData) {
    $('fileStatus').style.display = 'flex';
    $('fileName').textContent = S.sheetData.sheetName || 'Uploaded sheet';
    $('fileMeta').textContent = `${S.sheetData.rows.length} rows · ${S.sheetData.columns.length} cols`;
    $('previewCard').style.display = 'block';
    $('previewCount').textContent = `${S.sheetData.rows.length} rows · ${S.sheetData.columns.length} cols`;
    renderPreviewTable();
  } else {
    $('fileStatus').style.display = 'none';
    $('previewCard').style.display = 'none';
    $('sheetsCard').style.display = 'none';
  }
}

// Drag & drop
const uploadZone = $('uploadZone');
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });

// Preview only — show sheets before saving
let _pendingFile = null;
async function handleFile(file) {
  if (!file) return;
  _pendingFile = file;

  // Show spinner
  $('uploadZone').innerHTML = `<div class="loading"><div class="spinner"></div> Reading file…</div>`;

  // Use SheetJS client-side to preview sheets, then POST full file
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      // Show sheet selector
      const grid = $('sheetsGrid');
      grid.innerHTML = '';
      wb.SheetNames.forEach((name, i) => {
        const chip = document.createElement('div');
        chip.className = 'sheet-chip' + (i === 0 ? ' selected' : '');
        chip.textContent = name;
        chip.dataset.sheet = name;
        chip.onclick = () => { document.querySelectorAll('.sheet-chip').forEach(c => c.classList.remove('selected')); chip.classList.add('selected'); };
        grid.appendChild(chip);
      });
      $('sheetsCard').style.display = 'block';
      $('confirmSheetBtn').style.display = 'inline-flex';
      // Restore upload zone
      $('uploadZone').innerHTML = `<div class="upload-icon">📊</div><div class="upload-text"><strong>${file.name}</strong></div><div class="upload-text" style="margin-top:6px; font-size:11px">Select a sheet below and click Confirm</div>`;
    } catch(err) {
      toast('Error reading file: ' + err.message, 'err');
      resetUploadZone();
    }
  };
  reader.readAsBinaryString(file);
}

async function confirmSheetUpload() {
  const selected = document.querySelector('.sheet-chip.selected');
  if (!selected || !_pendingFile) return;
  const sheetName = selected.dataset.sheet;

  const fd = new FormData();
  fd.append('file', _pendingFile);
  fd.append('sheetName', sheetName);

  $('confirmSheetBtn').disabled = true;
  $('confirmSheetBtn').textContent = 'Uploading…';

  try {
    const res = await api.req('POST', '/api/sheet/upload', fd);
    // Reload sheet data
    const sheetRes = await api.get('/api/sheet');
    S.sheetData = sheetRes.data;
    refreshAdminUploadPanel();
    $('sheetsCard').style.display = 'none';
    $('confirmSheetBtn').style.display = 'none';
    _pendingFile = null;
    resetUploadZone();
    toast('Sheet uploaded & saved!', 'ok');
  } catch(err) {
    toast('Upload failed: ' + err.message, 'err');
  } finally {
    $('confirmSheetBtn').disabled = false;
    $('confirmSheetBtn').textContent = 'Confirm Sheet →';
  }
}

function resetUploadZone() {
  $('uploadZone').innerHTML = `
    <div class="upload-icon">📊</div>
    <div class="upload-text"><strong>Click to upload</strong> or drag & drop</div>
    <div class="upload-text" style="margin-top:6px; font-size:11px;">.xlsx · .xls · .csv supported</div>
    <button class="btn" style="margin-top:16px; pointer-events:none">Browse File</button>`;
}

async function clearFile() {
  if (!confirm('Remove the uploaded sheet? Users will lose access to the data.')) return;
  await api.delete('/api/sheet');
  S.sheetData = null;
  _pendingFile = null;
  $('fileInput').value = '';
  $('sheetsCard').style.display = 'none';
  $('confirmSheetBtn').style.display = 'none';
  resetUploadZone();
  refreshAdminUploadPanel();
  toast('Sheet removed', 'ok');
}

function renderPreviewTable() {
  if (!S.sheetData) return;
  const rows = S.sheetData.rows.slice(0, 20);
  const cols = S.sheetData.columns;
  $('previewTable').innerHTML = `<thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

// ════════════════════════════════════════════════
//  ADMIN: USERS
// ════════════════════════════════════════════════
function renderUsersTable() {
  const users = Object.entries(S.permissions);
  const allUsers = S._allUsers || [];

  // Fetch users list if we don't have it
  api.get('/api/users').then(res => {
    S._allUsers = res.users;
    _renderUsersTable(res.users);
  });
}

function _renderUsersTable(users) {
  const nonAdmin = users.filter(u => u.role !== 'admin');
  const admins   = users.filter(u => u.role === 'admin');

  $('userStats').innerHTML = `
    <div class="stat-box"><div class="stat-label">Total Users</div><div class="stat-value">${users.length}</div></div>
    <div class="stat-box"><div class="stat-label">Regular Users</div><div class="stat-value">${nonAdmin.length}</div></div>
    <div class="stat-box"><div class="stat-label">Admins</div><div class="stat-value">${admins.length}</div></div>
    <div class="stat-box"><div class="stat-label">With Permissions</div><div class="stat-value">${Object.values(S.permissions).filter(Boolean).length}</div></div>
  `;

  $('usersTableBody').innerHTML = users.map(u => {
    const p = S.permissions[u.username];
    const colCount = p?.columns?.length || 0;
    const filterCount = p?.filters?.length || 0;
    const terrCount = p?.territories?.length || 0;
    return `<tr>
      <td><code>${esc(u.username)}</code></td>
      <td>${esc(u.displayName)}</td>
      <td><span class="${u.role === 'admin' ? 'role-chip' : 'role-chip user'}">${u.role}</span></td>
      <td>${colCount > 0 ? `<span class="access-badge">✓ ${colCount} cols</span>` : '<span class="no-access-badge">none set</span>'}</td>
      <td>${terrCount > 0 ? `<span class="access-badge">✓ ${terrCount} terr.</span>` : '<span style="color:var(--muted);font-size:11px">none set</span>'}</td>
      <td>${filterCount > 0 ? `<span class="access-badge">✓ ${filterCount} filter${filterCount > 1 ? 's' : ''}</span>` : '<span style="color:var(--muted);font-size:11px">all rows</span>'}</td>
      <td style="display:flex;gap:8px">
        ${u.role !== 'admin' ? `<button class="btn sm" onclick="editUserPerms('${esc(u.username)}')">Permissions</button>` : ''}
        ${u.username !== 'admin' ? `<button class="btn danger sm" onclick="deleteUser(${u.id},'${esc(u.username)}')">Delete</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

function openAddUserModal() {
  $('newUsername').value = '';
  $('newDisplayName').value = '';
  $('newPassword').value = '';
  openModal('addUserModal');
}

async function addUser() {
  const u = $('newUsername').value.trim().toLowerCase();
  const d = $('newDisplayName').value.trim();
  const p = $('newPassword').value;
  try {
    await api.post('/api/users', { username: u, displayName: d, password: p });
    closeModal('addUserModal');
    toast(`User "${d}" created`, 'ok');
    // Refresh permissions list
    const permsRes = await api.get('/api/permissions');
    S.permissions = permsRes.permissions;
    renderUsersTable();
    refreshAllDropdowns();
  } catch(err) {
    toast(err.message, 'err');
  }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This also removes their permissions.`)) return;
  await api.delete(`/api/users/${id}`);
  delete S.permissions[username];
  toast('User deleted', 'ok');
  renderUsersTable();
  refreshAllDropdowns();
}

// ════════════════════════════════════════════════
//  ADMIN: PERMISSIONS
// ════════════════════════════════════════════════
function renderPermPanel() {
  const hasData = !!S.sheetData;
  $('permNoData').style.display = hasData ? 'none' : 'block';
  $('permContent').style.display = hasData ? 'block' : 'none';
  refreshAllDropdowns();
}

function refreshAllDropdowns() {
  api.get('/api/users').then(res => {
    S._allUsers = res.users;
    const users = res.users.filter(u => u.role !== 'admin');
    const opts = '<option value="">— Choose a user —</option>' +
      users.map(u => `<option value="${u.username}">${esc(u.displayName)} (${u.username})</option>`).join('');
    ['permUserSelect','previewUserSelect','terrUserSelect'].forEach(id => {
      if ($(id)) $(id).innerHTML = opts;
    });
  });
}

function loadUserPerms() {
  const username = $('permUserSelect').value;
  if (!username || !S.sheetData) { $('permEditor').style.display = 'none'; return; }
  $('permEditor').style.display = 'block';

  const perms = S.permissions[username] || { columns: [...S.sheetData.columns], filters: [] };
  S.tempFilters = [...(perms.filters || [])];

  // Columns
  $('colGrid').innerHTML = S.sheetData.columns.map(col => {
    const checked = perms.columns?.length ? perms.columns.includes(col) : true;
    return `<label class="col-chip ${checked ? 'checked' : ''}">
      <input type="checkbox" value="${esc(col)}" ${checked ? 'checked' : ''}
        onchange="this.closest('label').classList.toggle('checked', this.checked)">
      ${esc(col)}
    </label>`;
  }).join('');

  $('filterCol').innerHTML = S.sheetData.columns.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  renderFilterTags();
}

function toggleAllCols(v) {
  document.querySelectorAll('#colGrid input[type=checkbox]').forEach(cb => {
    cb.checked = v;
    cb.closest('label').classList.toggle('checked', v);
  });
}

function addFilter() {
  const col = $('filterCol').value;
  const val = $('filterVal').value.trim();
  if (!val) { toast('Enter a filter value', 'err'); return; }
  if (S.tempFilters.some(f => f.col === col && f.val === val)) { toast('Filter already added', 'err'); return; }
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
    `<div class="filter-tag">${esc(f.col)} = "${esc(f.val)}" <span class="remove" onclick="removeFilter(${i})">✕</span></div>`
  ).join('') || '<span style="color:var(--muted);font-size:11px">No filters — all rows visible</span>';
}

async function savePerms() {
  const username = $('permUserSelect').value;
  if (!username) return;
  const columns = [...document.querySelectorAll('#colGrid input:checked')].map(cb => cb.value);
  if (!columns.length) { toast('Select at least one column', 'err'); return; }

  // Preserve existing territories when saving column perms
  const existingTerrs = S.permissions[username]?.territories || [];
  await api.put(`/api/permissions/${username}`, { columns, filters: S.tempFilters, territories: existingTerrs });
  S.permissions[username] = { ...(S.permissions[username] || {}), columns, filters: S.tempFilters, territories: existingTerrs };
  toast(`Permissions saved for ${username}`, 'ok');
}

async function resetPerms() {
  const username = $('permUserSelect').value;
  if (!username) return;
  await api.delete(`/api/permissions/${username}`);
  delete S.permissions[username];
  loadUserPerms();
  toast('Permissions reset', 'ok');
}

function editUserPerms(username) {
  $('permUserSelect').value = username;
  switchToPanel('permissions');
  document.querySelectorAll('#adminTabs .tab').forEach((t, i) => t.classList.toggle('active', i === 3));
  loadUserPerms();
}

// ════════════════════════════════════════════════
//  ADMIN: TERRITORIES
// ════════════════════════════════════════════════
function renderTerrPanel() {
  renderMasterTerrList();
  refreshAllDropdowns();
  renderTerrOverview();
  // Column mapping
  const hasData = !!S.sheetData;
  $('terrNoDataInline').style.display = hasData ? 'none' : 'block';
  $('terrColMapBlock').style.display = hasData ? 'block' : 'none';
  if (hasData) {
    $('terrColSelect').innerHTML = '<option value="">— Select column —</option>' +
      S.sheetData.columns.map(c => `<option value="${esc(c)}" ${c === S.settings.territoryColumn ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('terrColStatus').style.display = S.settings.territoryColumn ? 'block' : 'none';
    if (S.settings.territoryColumn) $('terrColBadge').textContent = S.settings.territoryColumn;
  }
}

function renderMasterTerrList() {
  const search = ($('masterTerrSearch')?.value || '').toLowerCase();
  const filtered = S.territories.filter(t => !search || t.name.toLowerCase().includes(search));
  $('terrMasterCount').textContent = S.territories.length + ' territories';
  $('masterTerrList').innerHTML = filtered.map(t => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;border-bottom:1px solid rgba(42,42,58,0.4)">
      <span style="font-size:12px">${esc(t.name)}</span>
      <div style="display:flex;align-items:center;gap:6px">
        ${t.is_custom ? '<span class="tag tag-purple" style="font-size:9px">custom</span>' : '<span class="tag" style="font-size:9px;background:rgba(0,212,170,0.07);color:var(--muted);border:1px solid var(--border)">built-in</span>'}
        ${t.is_custom ? `<span style="cursor:pointer;color:var(--danger);font-size:12px" onclick="removeCustomTerritory('${encodeURIComponent(t.name)}')">✕</span>` : ''}
      </div>
    </div>`).join('') || '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">No results</div>';
}

async function addCustomTerritory() {
  const input = $('newTerrInput');
  const val = input.value.trim();
  if (!val) { toast('Enter a territory name', 'err'); return; }
  if (S.territories.some(t => t.name.toLowerCase() === val.toLowerCase())) { toast('Territory already exists', 'err'); return; }
  await api.post('/api/territories', { name: val });
  const res = await api.get('/api/territories');
  S.territories = res.territories;
  input.value = '';
  renderMasterTerrList();
  renderTerrGrid(); // refresh assign grid too
  toast(`"${val}" added`, 'ok');
}

async function removeCustomTerritory(encodedName) {
  const name = decodeURIComponent(encodedName);
  await api.delete(`/api/territories/${encodedName}`);
  const res = await api.get('/api/territories');
  S.territories = res.territories;
  renderMasterTerrList();
  renderTerrGrid();
  toast(`"${name}" removed`, 'ok');
}

async function saveTerrCol() {
  const col = $('terrColSelect').value;
  if (!col) { toast('Select a column first', 'err'); return; }
  await api.put('/api/settings', { territoryColumn: col });
  S.settings.territoryColumn = col;
  $('terrColStatus').style.display = 'block';
  $('terrColBadge').textContent = col;
  toast(`Territory column set to "${col}"`, 'ok');
}

async function clearTerrCol() {
  await api.put('/api/settings', { territoryColumn: '' });
  S.settings.territoryColumn = null;
  $('terrColSelect').value = '';
  $('terrColStatus').style.display = 'none';
  toast('Territory column cleared', 'ok');
}

function loadUserTerritories() {
  const username = $('terrUserSelect').value;
  if (!username) { $('terrUserEditor').style.display = 'none'; return; }
  $('terrUserEditor').style.display = 'block';
  const user = (S._allUsers || []).find(u => u.username === username);
  $('terrEditorUsername').textContent = user?.displayName || username;
  $('terrSearch').value = '';
  renderTerrGrid();
}

function renderTerrGrid() {
  const username = $('terrUserSelect').value;
  if (!username) return;
  const assigned = S.permissions[username]?.territories || [];
  const search = ($('terrSearch')?.value || '').toLowerCase();
  const filtered = S.territories.filter(t => !search || t.name.toLowerCase().includes(search));

  $('terrGrid').innerHTML = filtered.map(t => {
    const checked = assigned.includes(t.name);
    return `<label class="col-chip ${checked ? 'checked' : ''}">
      <input type="checkbox" value="${esc(t.name)}" ${checked ? 'checked' : ''}
        onchange="this.closest('label').classList.toggle('checked',this.checked);updateTerrCount()">
      ${esc(t.name)}
    </label>`;
  }).join('') || '<span style="color:var(--muted);font-size:11px">No territories match</span>';

  updateTerrCount();
}

function updateTerrCount() {
  const n = document.querySelectorAll('#terrGrid input:checked').length;
  $('terrSelCount').textContent = n + ' selected';
}

function toggleAllTerr(v) {
  document.querySelectorAll('#terrGrid input[type=checkbox]').forEach(cb => {
    cb.checked = v;
    cb.closest('label').classList.toggle('checked', v);
  });
  updateTerrCount();
}

function clearUserTerr() { toggleAllTerr(false); }

async function saveUserTerritories() {
  const username = $('terrUserSelect').value;
  if (!username) return;
  const territories = [...document.querySelectorAll('#terrGrid input:checked')].map(cb => cb.value);
  const existing = S.permissions[username] || { columns: S.sheetData?.columns || [], filters: [] };
  await api.put(`/api/permissions/${username}`, { ...existing, territories });
  S.permissions[username] = { ...existing, territories };
  renderTerrOverview();
  if (S._allUsers) _renderUsersTable(S._allUsers);
  toast(`Saved ${territories.length} territories for ${username}`, 'ok');
}

function renderTerrOverview() {
  api.get('/api/users').then(res => {
    const users = res.users.filter(u => u.role !== 'admin');
    $('terrOverviewCount').textContent = users.length + ' users';
    $('terrOverviewBody').innerHTML = users.map(u => {
      const terrs = S.permissions[u.username]?.territories || [];
      const preview = terrs.length
        ? terrs.slice(0,5).map(t => `<span class="tag tag-green" style="margin:2px">${esc(t)}</span>`).join('')
          + (terrs.length > 5 ? `<span class="tag tag-purple" style="margin:2px">+${terrs.length-5} more</span>` : '')
        : '<span class="no-access-badge">none assigned</span>';
      return `<tr>
        <td><strong>${esc(u.displayName)}</strong><br><span style="color:var(--muted);font-size:10px">${esc(u.username)}</span></td>
        <td style="max-width:420px;white-space:normal">${preview}</td>
        <td><span class="tag tag-purple">${terrs.length}</span></td>
        <td><button class="btn sm" onclick="quickTerrEdit('${u.username}')">Edit</button></td>
      </tr>`;
    }).join('');
  });
}

function quickTerrEdit(username) {
  $('terrUserSelect').value = username;
  loadUserTerritories();
  $('terrUserEditor').scrollIntoView({ behavior: 'smooth' });
}

// ════════════════════════════════════════════════
//  ADMIN: PREVIEW
// ════════════════════════════════════════════════
function refreshPreviewPanel() { refreshAllDropdowns(); }

async function renderPreview() {
  const username = $('previewUserSelect').value;
  const panel = $('previewPanel');
  if (!username || !S.sheetData) { panel.style.display = 'none'; return; }

  const { rows, cols } = clientFilter(username);
  const user = (S._allUsers || []).find(u => u.username === username);

  panel.style.display = 'block';
  $('previewUserName').textContent = user?.displayName || username;
  $('previewUserMeta').textContent = `${cols.length} columns · ${rows.length} rows`;
  $('previewStats').innerHTML = `
    <div class="stat-box" style="padding:12px 16px"><div class="stat-label">Rows</div><div class="stat-value" style="font-size:22px">${rows.length}</div></div>
    <div class="stat-box" style="padding:12px 16px"><div class="stat-label">Columns</div><div class="stat-value" style="font-size:22px">${cols.length}</div></div>
  `;
  buildTable($('adminPreviewTable'), rows, cols);
}

// ════════════════════════════════════════════════
//  CLIENT-SIDE FILTER (for admin preview)
// ════════════════════════════════════════════════
function clientFilter(username) {
  if (!S.sheetData) return { rows: [], cols: [] };
  const p = S.permissions[username];
  if (!p) return { rows: [], cols: [] };

  let rows = [...S.sheetData.rows];
  let cols = p.columns?.length ? [...p.columns] : [...S.sheetData.columns];

  if (p.filters?.length)
    rows = rows.filter(row => p.filters.every(f => String(row[f.col] ?? '').trim() === f.val.trim()));

  const terrCol = S.settings.territoryColumn;
  if (terrCol && p.territories?.length)
    rows = rows.filter(row => p.territories.includes(String(row[terrCol] ?? '').trim()));

  return { rows, cols };
}

// ════════════════════════════════════════════════
//  USER: MY DATA
// ════════════════════════════════════════════════
let _userData = null;

async function loadUserData() {
  const res = await api.get('/api/mydata');
  _userData = res.data;

  if (!_userData || !_userData.rows.length) {
    $('userNoPerms').style.display = 'block';
    $('userDataContent').style.display = 'none';
    return;
  }

  $('userNoPerms').style.display = 'none';
  $('userDataContent').style.display = 'block';
  $('userWelcome').textContent = `Welcome, ${S.user.displayName}`;

  // Territory chips
  const terrs = _userData.assignedTerritories || [];
  const terrChips = $('userTerrChips');
  if (S.settings.territoryColumn && _userData.rows.length) {
    // derive from data
    const terrSet = new Set(_userData.rows.map(r => r[S.settings.territoryColumn]).filter(Boolean));
    if (terrSet.size) {
      terrChips.style.display = 'flex';
      terrChips.innerHTML = `<span style="font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;margin-right:8px">${S.settings.territoryColumn}:</span>`
        + [...terrSet].map(t => `<span class="tag tag-green" style="margin:2px">${esc(t)}</span>`).join('');
    } else {
      terrChips.style.display = 'none';
    }
  } else {
    terrChips.style.display = 'none';
  }

  $('userDataMeta').textContent = `${_userData.rows.length} rows · ${_userData.cols.length} columns`;
  $('userStatsStrip').innerHTML = `
    <div class="stat-box" style="padding:12px 16px"><div class="stat-label">My Rows</div><div class="stat-value" style="font-size:22px">${_userData.rows.length}</div></div>
    <div class="stat-box" style="padding:12px 16px"><div class="stat-label">Columns</div><div class="stat-value" style="font-size:22px">${_userData.cols.length}</div></div>
  `;

  S.userPage = 0;
  renderUserTable();
}

function renderUserTable() {
  if (!_userData) return;
  const search = ($('userSearch')?.value || '').toLowerCase();
  let rows = _userData.rows;
  if (search) rows = rows.filter(r => _userData.cols.some(c => String(r[c] ?? '').toLowerCase().includes(search)));

  const total = rows.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  if (S.userPage >= pages) S.userPage = Math.max(0, pages - 1);
  const slice = rows.slice(S.userPage * PAGE_SIZE, (S.userPage + 1) * PAGE_SIZE);

  buildTable($('userDataTable'), slice, _userData.cols);

  const pag = $('userPagination');
  if (pages <= 1) { pag.innerHTML = `<span>${total} rows</span>`; return; }
  const btns = Array.from({ length: Math.min(pages, 10) }, (_, i) =>
    `<button class="page-btn ${i === S.userPage ? 'active' : ''}" onclick="goPage(${i})">${i + 1}</button>`
  ).join('');
  pag.innerHTML = `<span>${total} rows · page ${S.userPage + 1}/${pages}</span>
    <div class="page-btns">
      <button class="page-btn" onclick="goPage(${S.userPage - 1})" ${S.userPage === 0 ? 'disabled' : ''}>←</button>
      ${btns}
      <button class="page-btn" onclick="goPage(${S.userPage + 1})" ${S.userPage >= pages - 1 ? 'disabled' : ''}>→</button>
    </div>`;
}

function goPage(n) { S.userPage = n; renderUserTable(); }

function downloadUserExcel() {
  if (!_userData) return;
  const search = ($('userSearch')?.value || '').toLowerCase();
  let rows = _userData.rows;
  if (search) rows = rows.filter(r => _userData.cols.some(c => String(r[c] ?? '').toLowerCase().includes(search)));
  if (!rows.length) { toast('No data to download', 'err'); return; }

  const wsData = [_userData.cols, ...rows.map(r => _userData.cols.map(c => r[c] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = _userData.cols.map((col) => ({ wch: Math.min(40, Math.max(col.length, ...rows.map(r => String(r[col] ?? '').length))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'My Data');
  XLSX.writeFile(wb, `${S.user.displayName.replace(/\s+/g,'_')}_data_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Download started!', 'ok');
}

// ════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════
function buildTable(tbl, rows, cols) {
  if (!rows.length) { tbl.innerHTML = `<tbody><tr><td colspan="99" style="text-align:center;padding:40px;color:var(--muted)">No data to display</td></tr></tbody>`; return; }
  tbl.innerHTML = `<thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.style.display = 'none'; });
  const el = $(id);
  el.style.display = 'flex';
  el.classList.add('active');
}

function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

function toast(msg, type = 'ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(t._to);
  t._to = setTimeout(() => t.className = '', 3200);
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function $(id) { return document.getElementById(id); }

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});
