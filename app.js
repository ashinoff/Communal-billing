// ---- Simple state & GitHub API helpers ----
const S = {
  owner: localStorage.getItem('owner') || '',
  repo: localStorage.getItem('repo') || '',
  branch: localStorage.getItem('branch') || 'main',
  datadir: localStorage.getItem('datadir') || 'data',
  token: localStorage.getItem('token') || '',
};

function setStatus(msg) {
  document.getElementById('settingsStatus').textContent = msg;
}

function initSettingsForm() {
  owner.value = S.owner;
  repo.value = S.repo;
  branch.value = S.branch;
  datadir.value = S.datadir;
  token.value = S.token;
  document.getElementById('saveSettings').onclick = () => {
    S.owner = owner.value.trim();
    S.repo = repo.value.trim();
    S.branch = branch.value.trim();
    S.datadir = datadir.value.trim();
    S.token = token.value.trim();
    localStorage.setItem('owner', S.owner);
    localStorage.setItem('repo', S.repo);
    localStorage.setItem('branch', S.branch);
    localStorage.setItem('datadir', S.datadir);
    localStorage.setItem('token', S.token);
    setStatus('Saved');
    reloadAll();
  };
}

function apiBase(path) {
  return `https://api.github.com/repos/${S.owner}/${S.repo}/contents/${path}?ref=${S.branch}`;
}

async function ghGet(path) {
  const r = await fetch(apiBase(path), {
    headers: { 'Authorization': `token ${S.token}`, 'Accept': 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return await r.json();
}

async function ghPut(path, contentBytes, message) {
  const meta = await ghGet(path).catch(() => null);
  const sha = meta?.sha;
  const body = {
    message,
    content: btoa(String.fromCharCode(...new Uint8Array(contentBytes))),
    branch: S.branch,
    ...(sha ? { sha } : {}),
  };
  const r = await fetch(`https://api.github.com/repos/${S.owner}/${S.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Authorization': `token ${S.token}`, 'Accept': 'application/vnd.github+json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`PUT ${path}: ${r.status} ${t}`);
  }
  return await r.json();
}

async function loadCSV(name) {
  const meta = await ghGet(`${S.datadir}/${name}.csv`);
  const content = atob(meta.content.replace(/\n/g, ''));
  const rows = content.trim() ? content.split(/\r?\n/) : [];
  const headers = rows[0]?.split(',') || [];
  const data = rows.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] ?? '');
    return obj;
  });
  return { headers, data, sha: meta.sha };
}

function toCSV(headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach(r => {
    lines.push(headers.map(h => String(r[h] ?? '')).join(','));
  });
  return new TextEncoder().encode(lines.join('\n'));
}

function nextId(rows) {
  if (!rows.length) return 1;
  return 1 + Math.max(...rows.map(r => parseInt(r.id || '0', 10)));
}

function yymm(y, m) {
  const mm = String(m).padStart(2, '0');
  return `${y}-${mm}-01`;
}

// ---- UI helpers ----
function table(containerId, headers, rows) {
  const wrap = document.getElementById(containerId);
  const t = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  t.appendChild(thead);
  const tb = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    headers.forEach(h => {
      const td = document.createElement('td');
      td.textContent = r[h] ?? '';
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  wrap.innerHTML = '';
  wrap.appendChild(t);
}

// ---- Global datasets ----
let apartments, services, tariffs, meters, readings, adjustments;

// ---- Load all ----
async function reloadAll() {
  try {
    [apartments, services, tariffs, meters, readings, adjustments] = await Promise.all([
      loadCSV('apartments'),
      loadCSV('services'),
      loadCSV('tariffs'),
      loadCSV('meters'),
      loadCSV('readings'),
      loadCSV('adjustments'),
    ]);
    renderDicts();
    renderAdj();
  } catch (e) {
    console.error(e);
  }
}

// ---- Dicts page ----
function renderDicts() {
  // Apartments
  table('aptTable', apartments.headers, apartments.data);
  document.getElementById('addApartment').onclick = async () => {
    const name = document.getElementById('aptName').value.trim();
    const notes = document.getElementById('aptNotes').value.trim();
    if (!name) return;
    const row = { id: String(nextId(apartments.data)), name, notes };
    const newRows = [...apartments.data, row];
    await ghPut(`${S.datadir}/apartments.csv`, toCSV(apartments.headers, newRows), `Add apartment ${name}`);
    await reloadAll();
  };

  // Services
  table('srvTable', services.headers, services.data);
  document.getElementById('addService').onclick = async () => {
    const code = document.getElementById('srvCode').value.trim();
    const name = document.getElementById('srvName').value.trim();
    const unit = document.getElementById('srvUnit').value.trim();
    if (!code || !name || !unit) return;
    const row = { id: String(nextId(services.data)), code, name, unit };
    const newRows = [...services.data, row];
    await ghPut(`${S.datadir}/services.csv`, toCSV(services.headers, newRows), `Add service ${name}`);
    await reloadAll();
  };

  // Tariffs
  const tarSelect = document.getElementById('tarService');
  tarSelect.innerHTML = services.data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('tarHasEnd').onchange = (e) => {
    document.getElementById('tarEnd').disabled = !e.target.checked;
  };
  table('tarTable', tariffs.headers, tariffs.data);
  document.getElementById('addTariff').onclick = async () => {
    const sid = document.getElementById('tarService').value;
    const price = document.getElementById('tarPrice').value;
    const start = document.getElementById('tarStart').value;
    const hasEnd = document.getElementById('tarHasEnd').checked;
    const end = document.getElementById('tarEnd').value;
    if (!sid || !price || !start) return;
    const row = { id: String(nextId(tariffs.data)), service_id: sid, price: String(price), start_date: start, end_date: hasEnd ? end : '' };
    const newRows = [...tariffs.data, row];
    await ghPut(`${S.datadir}/tariffs.csv`, toCSV(tariffs.headers, newRows), `Add tariff service=${sid} start=${start}`);
    await reloadAll();
  };

  // Meters
  const apSel = document.getElementById('mtrApartment');
  const svSel = document.getElementById('mtrService');
  apSel.innerHTML = apartments.data.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  svSel.innerHTML = services.data.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  table('mtrTable', meters.headers, meters.data);
  document.getElementById('addMeter').onclick = async () => {
    const aid = apSel.value, sid = svSel.value;
    const serial = document.getElementById('mtrSerial').value.trim();
    const shared = document.getElementById('mtrShared').checked ? 'true' : 'false';
    if (!aid || !sid) return;
    const row = { id: String(nextId(meters.data)), apartment_id: aid, service_id: sid, serial, is_shared: shared };
    const newRows = [...meters.data, row];
    await ghPut(`${S.datadir}/meters.csv`, toCSV(meters.headers, newRows), `Add meter apt=${aid} svc=${sid}`);
    await reloadAll();
  };
}

// ---- Readings page ----
document.getElementById('reloadMeters').onclick = renderReadings;
async function renderReadings() {
  const y = parseInt(document.getElementById('rYear').value, 10);
  const m = parseInt(document.getElementById('rMonth').value, 10);
  const per = yymm(y, m);
  const list = document.getElementById('readingsList');
  list.innerHTML = '';

  // join meters + apt + svc
  const aptById = Object.fromEntries(apartments.data.map(a => [a.id, a]));
  const svcById = Object.fromEntries(services.data.map(s => [s.id, s]));
  for (const meter of meters.data) {
    const key = `${meter.id}_${per}`;
    const wrap = document.createElement('div');
    wrap.className = 'form-row';
    const prev = readings.data.filter(r => r.meter_id === meter.id && r.period < per).sort((a,b)=>a.period.localeCompare(b.period)).pop();
    const prevInfo = prev ? `${prev.value} на ${prev.period}` : 'нет';
    wrap.innerHTML = `
      <strong>${aptById[meter.apartment_id]?.name || '??'}</strong>
      — ${svcById[meter.service_id]?.name || '??'}
      (сч: ${meter.serial || '—'}) | Предыдущее: ${prevInfo}
      <input id="val_${key}" type="number" step="0.01" placeholder="Показание на ${per}"/>
      <button id="save_${key}">Сохранить</button>
    `;
    list.appendChild(wrap);
    document.getElementById(`save_${key}`).onclick = async () => {
      const val = document.getElementById(`val_${key}`).value;
      const exists = readings.data.find(r => r.meter_id === meter.id && r.period === per);
      let newRows;
      if (exists) {
        newRows = readings.data.map(r => r === exists ? { ...r, value: String(val) } : r);
      } else {
        const newRow = { id: String(nextId(readings.data)), meter_id: meter.id, period: per, value: String(val) };
        newRows = [...readings.data, newRow];
      }
      await ghPut(`${S.datadir}/readings.csv`, toCSV(readings.headers, newRows), `Upsert reading meter=${meter.id} @ ${per}`);
      await reloadAll();
      renderReadings();
    };
  }
}

// ---- Adjustments page ----
function renderAdj() {
  const sel = document.getElementById('adjApartment');
  sel.innerHTML = apartments.data.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  document.getElementById('addAdj').onclick = async () => {
    const aid = sel.value;
    const y = parseInt(document.getElementById('adjYear').value, 10);
    const m = parseInt(document.getElementById('adjMonth').value, 10);
    const per = yymm(y, m);
    const amount = document.getElementById('adjAmount').value;
    const comment = document.getElementById('adjComment').value;
    const newRow = { id: String(nextId(adjustments.data)), apartment_id: aid, period: per, amount: String(amount), comment };
    const newRows = [...adjustments.data, newRow];
    await ghPut(`${S.datadir}/adjustments.csv`, toCSV(adjustments.headers, newRows), `Add adjustment apt=${aid} @ ${per}`);
    await reloadAll();
    renderAdjTable();
  };
  renderAdjTable();
}

function renderAdjTable() {
  const y = parseInt(document.getElementById('adjYear').value, 10);
  const m = parseInt(document.getElementById('adjMonth').value, 10);
  const per = yymm(y, m);
  const rows = adjustments.data.filter(a => a.period === per);
  table('adjTable', adjustments.headers, rows);
}

// ---- Reports page ----
document.getElementById('calcReport').onclick = renderReport;
document.getElementById('downloadCSV').onclick = downloadReportCSV;

function tariffFor(service_id, period) {
  const x = tariffs.data.filter(t => t.service_id === String(service_id) && t.start_date <= period)
                        .sort((a,b)=> b.start_date.localeCompare(a.start_date));
  for (const t of x) {
    if (!t.end_date || t.end_date >= period) return parseFloat(t.price || '0');
  }
  return 0;
}

let currentBills = [];

function renderReport() {
  const y = parseInt(document.getElementById('repYear').value, 10);
  const m = parseInt(document.getElementById('repMonth').value, 10);
  const per = yymm(y, m);

  // Build cur readings and previous
  const cur = readings.data.filter(r => r.period === per);
  const prevPer = (m === 1) ? `${y-1}-12-01` : `${y}-${String(m-1).padStart(2,'0')}-01`;
  const prev = readings.data.filter(r => r.period === prevPer).reduce((acc, r) => (acc[`${r.meter_id}`]=r, acc), {});

  // maps
  const aptById = Object.fromEntries(apartments.data.map(a => [a.id, a]));
  const svcById = Object.fromEntries(services.data.map(s => [s.id, s]));
  const mById = Object.fromEntries(meters.data.map(m => [m.id, m]));

  // details
  const detailRows = cur.map(r => {
    const meter = mById[r.meter_id];
    const prevVal = prev[r.meter_id]?.value ? parseFloat(prev[r.meter_id].value) : 0;
    const cons = Math.max(0, parseFloat(r.value) - prevVal);
    const price = tariffFor(meter.service_id, per);
    const charge = +(cons * price).toFixed(2);
    return {
      apartment_id: meter.apartment_id,
      apartment_name: aptById[meter.apartment_id]?.name || '',
      service_name: svcById[meter.service_id]?.name || '',
      unit: svcById[meter.service_id]?.unit || '',
      value: parseFloat(r.value) || 0,
      prev_value: prevVal,
      consumption: cons,
      price,
      charge
    };
  });

  // bills
  const byApt = {};
  for (const d of detailRows) {
    byApt[d.apartment_id] = (byApt[d.apartment_id] || 0) + d.charge;
  }
  const adjRows = adjustments.data.filter(a => a.period === per)
                     .reduce((acc, a) => (acc[a.apartment_id] = (acc[a.apartment_id]||0) + parseFloat(a.amount || '0'), acc), {});

  const bills = Object.entries(byApt).map(([aid, total]) => {
    const adj = adjRows[aid] || 0;
    return { apartment_id: aid, apartment_name: aptById[aid]?.name || '', services_total: +(+total).toFixed(2), adjustments: +adj.toFixed(2), total: +(total + adj).toFixed(2) };
  });
  currentBills = bills;

  // Render
  const sumHeaders = ["apartment_name","services_total","adjustments","total"];
  table('reportSummary', sumHeaders, bills);

  const detHeaders = ["apartment_name","service_name","unit","value","prev_value","consumption","price","charge"];
  table('reportDetail', detHeaders, detailRows);
}

function downloadReportCSV() {
  if (!currentBills.length) { alert('Сначала рассчитайте отчёт'); return; }
  const headers = ["apartment_id","apartment_name","services_total","adjustments","total"];
  const csv = [headers.join(',')].concat(currentBills.map(r => headers.map(h => r[h]).join(','))).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bills.csv';
  a.click();
}

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(s => s.hidden = true);
    document.getElementById(btn.dataset.tab).hidden = false;
  });
});

// ---- Boot ----
initSettingsForm();
reloadAll();