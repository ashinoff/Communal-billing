// ========== Глобальное хранилище ==========
const DATA = {
  apartments: [],
  services: [],
  tariffs: [],
  readings: [],
  charges: [],
  heating: [],
  overrides: [], // Переопределенные значения для фиксированных услуг
  settings: { owner: '', repo: '', branch: 'main', datadir: 'data', token: '' },
  calculated: false
};

// ========== Инициализация ==========
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  
  // Установить текущий месяц и год
  const now = new Date();
  document.getElementById('receiptYear').value = now.getFullYear();
  document.getElementById('receiptMonth').value = now.getMonth() + 1;
  
  if (DATA.settings.token) {
    loadAllData();
  }
});

// ========== Вкладки ==========
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(tab).classList.add('active');
      
      if (tab === 'tariffs') displayTariffs();
    });
  });
}

// ========== Настройки ==========
function loadSettings() {
  const saved = localStorage.getItem('communalSettings');
  if (saved) {
    Object.assign(DATA.settings, JSON.parse(saved));
    document.getElementById('owner').value = DATA.settings.owner;
    document.getElementById('repo').value = DATA.settings.repo;
    document.getElementById('branch').value = DATA.settings.branch;
    document.getElementById('datadir').value = DATA.settings.datadir;
    document.getElementById('token').value = DATA.settings.token;
  }
}

function saveSettings() {
  DATA.settings.owner = document.getElementById('owner').value.trim();
  DATA.settings.repo = document.getElementById('repo').value.trim();
  DATA.settings.branch = document.getElementById('branch').value.trim() || 'main';
  DATA.settings.datadir = document.getElementById('datadir').value.trim() || 'data';
  DATA.settings.token = document.getElementById('token').value.trim();
  
  if (!DATA.settings.owner || !DATA.settings.repo || !DATA.settings.token) {
    showStatus('Заполните все поля', 'error');
    return;
  }
  
  localStorage.setItem('communalSettings', JSON.stringify(DATA.settings));
  showStatus('Настройки сохранены, загрузка данных...', 'success');
  loadAllData();
}

function clearSettings() {
  if (confirm('Очистить все настройки?')) {
    localStorage.removeItem('communalSettings');
    DATA.settings = { owner: '', repo: '', branch: 'main', datadir: 'data', token: '' };
    document.getElementById('owner').value = '';
    document.getElementById('repo').value = '';
    document.getElementById('branch').value = 'main';
    document.getElementById('datadir').value = 'data';
    document.getElementById('token').value = '';
    showStatus('Настройки очищены', 'success');
  }
}

function showStatus(msg, type) {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = `status ${type}`;
  status.style.display = 'block';
  setTimeout(() => status.style.display = 'none', 5000);
}

function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

// ========== GitHub API ==========
async function githubAPI(path, method = 'GET', body = null) {
  const { owner, repo, branch, token } = DATA.settings;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  
  const options = {
    method,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  };
  
  if (body) options.body = JSON.stringify(body);
  
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function readCSV(filename) {
  try {
    const { datadir } = DATA.settings;
    const data = await githubAPI(`${datadir}/${filename}`);
    
    const base64 = data.content.replace(/\n/g, '');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const csv = new TextDecoder('utf-8').decode(bytes);
    
    return parseCSV(csv);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return [];
  }
}

async function writeCSV(filename, data) {
  const { datadir, branch } = DATA.settings;
  const path = `${datadir}/${filename}`;
  
  let sha;
  try {
    const file = await githubAPI(path);
    sha = file.sha;
  } catch (e) {
    sha = null;
  }
  
  const csv = serializeCSV(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(csv);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const content = btoa(binary);
  
  await githubAPI(path, 'PUT', {
    message: `Update ${filename}`,
    content,
    sha,
    branch
  });
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',');
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const obj = {};
    
    headers.forEach((h, idx) => {
      let val = values[idx]?.trim() || '';
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (val && !isNaN(val)) val = parseFloat(val);
      obj[h] = val;
    });
    
    data.push(obj);
  }
  
  return data;
}

function serializeCSV(data) {
  if (!data.length) return '';
  const headers = Object.keys(data[0]);
  const lines = [headers.join(',')];
  
  data.forEach(row => {
    const values = headers.map(h => row[h] ?? '');
    lines.push(values.join(','));
  });
  
  return lines.join('\n');
}

// ========== Загрузка данных ==========
async function loadAllData() {
  showLoader(true);
  
  try {
    DATA.apartments = await readCSV('apartments.csv');
    DATA.services = await readCSV('services.csv');
    DATA.tariffs = await readCSV('tariffs.csv');
    DATA.readings = await readCSV('readings.csv');
    DATA.charges = await readCSV('charges.csv');
    DATA.heating = await readCSV('heating.csv');
    DATA.overrides = await readCSV('overrides.csv');
    
    if (DATA.apartments.length === 0) {
      showStatus('Файл apartments.csv пустой', 'error');
      return;
    }
    
    populateDropdowns();
    showStatus(`Загружено: ${DATA.apartments.length} квартир, ${DATA.readings.length} показаний`, 'success');
  } catch (error) {
    showStatus(`Ошибка: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

function populateDropdowns() {
  ['apartment', 'historyApartment', 'correctionApartment', 'receiptApartment'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Выберите квартиру...</option>';
    DATA.apartments.forEach(apt => {
      sel.innerHTML += `<option value="${apt.id}">${apt.name}</option>`;
    });
  });
  
  const srvSel = document.getElementById('tariffService');
  srvSel.innerHTML = '<option value="">Выберите услугу...</option>';
  DATA.services.forEach(srv => {
    srvSel.innerHTML += `<option value="${srv.id}">${srv.name}</option>`;
  });
  
  document.getElementById('apartment').onchange = (e) => {
    if (e.target.value) showInputForm(parseInt(e.target.value));
  };
}

// ========== Ввод показаний ==========
function showInputForm(aptId) {
  const apt = DATA.apartments.find(a => a.id === aptId);
  if (!apt) return;
  
  document.getElementById('calcPanel').style.display = 'block';
  
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('currentPeriod').textContent = period;
  
  renderInputTable(aptId, period, apt.type);
  DATA.calculated = false;
  document.getElementById('saveBtn').disabled = true;
}

function renderInputTable(aptId, period, aptType) {
  const tbody = document.getElementById('inputTableBody');
  let html = '';
  
  DATA.services.forEach(srv => {
    const tariff = getTariff(srv.id, aptType);
    
    if (srv.calc_type === 'meter') {
      const prev = getReading(aptId, srv.id, getPrevPeriod(period)) || 0;
      const curr = getReading(aptId, srv.id, period);
      
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td><span class="badge badge-primary">${tariff} ₽</span></td>
        <td><input type="text" value="${prev}" disabled></td>
        <td><input type="number" step="0.01" value="${curr !== null ? curr : ''}" 
            data-service="${srv.id}" class="reading-input" placeholder="0"></td>
        <td class="amount" data-result="${srv.id}">—</td>
      </tr>`;
      
    } else if (srv.calc_type === 'calculated') {
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td><span class="badge badge-primary">${tariff} ₽</span></td>
        <td colspan="2" style="text-align:center; color: var(--text-muted);">Автоматически</td>
        <td class="amount" data-result="${srv.id}">—</td>
      </tr>`;
      
    } else if (srv.calc_type === 'checkbox') {
      const enabled = getHeating(aptId, period);
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td><span class="badge badge-primary">${tariff} ₽</span></td>
        <td colspan="2" style="text-align:center;">
          <input type="checkbox" ${enabled ? 'checked' : ''} 
            data-service="${srv.id}" class="heating-checkbox">
        </td>
        <td class="amount" data-result="${srv.id}">—</td>
      </tr>`;
      
    } else if (srv.calc_type === 'fixed') {
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td><span class="badge badge-primary">${tariff} ₽</span></td>
        <td colspan="2" style="text-align:center; color: var(--text-muted);">Фиксированная</td>
        <td class="amount" data-result="${srv.id}">${tariff.toFixed(2)} ₽</td>
      </tr>`;
    }
  });
  
  // Доп начисления
  const charge = getCharge(aptId, period);
  html += `<tr class="charge-row">
    <td><strong>Доп. начисления</strong></td>
    <td>—</td>
    <td colspan="2">
      <input type="text" placeholder="Комментарий" value="${charge?.comment || ''}" 
        id="chargeComment" style="width:100%">
    </td>
    <td><input type="number" step="0.01" value="${charge?.amount || ''}" 
        id="chargeAmount" placeholder="0" style="width:100%"></td>
  </tr>`;
  
  tbody.innerHTML = html;
}

function calculateData() {
  const aptId = parseInt(document.getElementById('apartment').value);
  const apt = DATA.apartments.find(a => a.id === aptId);
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  let grandTotal = 0;
  
  DATA.services.forEach(srv => {
    const tariff = getTariff(srv.id, apt.type);
    let amount = 0;
    
    if (srv.calc_type === 'meter') {
      const input = document.querySelector(`input[data-service="${srv.id}"]`);
      const curr = parseFloat(input.value) || 0;
      const prev = getReading(aptId, srv.id, getPrevPeriod(period)) || 0;
      const volume = curr - prev;
      amount = volume * tariff;
      
    } else if (srv.calc_type === 'calculated') {
      if (srv.id === 2) {
        const elecInput = document.querySelector('input[data-service="1"]');
        const elecCurr = parseFloat(elecInput.value) || 0;
        const elecPrev = getReading(aptId, 1, getPrevPeriod(period)) || 0;
        amount = (elecCurr - elecPrev) * 0.1 * tariff;
      } else if (srv.id === 5) {
        const hvInput = document.querySelector('input[data-service="3"]');
        const gvInput = document.querySelector('input[data-service="4"]');
        const hvCurr = parseFloat(hvInput.value) || 0;
        const gvCurr = parseFloat(gvInput.value) || 0;
        const hvPrev = getReading(aptId, 3, getPrevPeriod(period)) || 0;
        const gvPrev = getReading(aptId, 4, getPrevPeriod(period)) || 0;
        const volume = (hvCurr - hvPrev) + (gvCurr - gvPrev);
        amount = volume * tariff;
      }
      
    } else if (srv.calc_type === 'checkbox') {
      const cb = document.querySelector('.heating-checkbox');
      amount = cb.checked ? tariff : 0;
      
    } else if (srv.calc_type === 'fixed') {
      const override = getOverride(aptId, srv.id, period);
      amount = override !== null ? override : tariff;
    }
    
    const cell = document.querySelector(`td[data-result="${srv.id}"]`);
    if (cell) cell.textContent = amount.toFixed(2) + ' ₽';
    grandTotal += amount;
  });
  
  // Доп начисления
  const chargeAmt = parseFloat(document.getElementById('chargeAmount').value) || 0;
  grandTotal += chargeAmt;
  
  DATA.calculated = true;
  document.getElementById('saveBtn').disabled = false;
  
  // Обновить итоги
  renderTotals(aptId, apt.type);
  renderHistory3Months(aptId, apt.type);
}

async function saveData() {
  if (!DATA.calculated) {
    alert('Сначала нажмите "Рассчитать"');
    return;
  }
  
  const aptId = parseInt(document.getElementById('apartment').value);
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  showLoader(true);
  
  try {
    // Показания
    document.querySelectorAll('.reading-input').forEach(input => {
      const srvId = parseInt(input.dataset.service);
      const value = parseFloat(input.value);
      
      if (!isNaN(value)) {
        let reading = DATA.readings.find(r => 
          r.apartment_id === aptId && r.service_id === srvId && r.period === period
        );
        
        if (reading) {
          reading.value = value;
        } else {
          DATA.readings.push({
            id: Math.max(0, ...DATA.readings.map(r => r.id)) + 1,
            apartment_id: aptId,
            service_id: srvId,
            period,
            value
          });
        }
      }
    });
    
    // Отопление
    const heatingCb = document.querySelector('.heating-checkbox');
    if (heatingCb) {
      let heating = DATA.heating.find(h => 
        h.apartment_id === aptId && h.period === period
      );
      
      if (heating) {
        heating.enabled = heatingCb.checked;
      } else {
        DATA.heating.push({
          id: Math.max(0, ...DATA.heating.map(h => h.id)) + 1,
          apartment_id: aptId,
          period,
          enabled: heatingCb.checked
        });
      }
    }
    
    // Доп начисления
    const chargeAmt = parseFloat(document.getElementById('chargeAmount').value);
    const chargeComment = document.getElementById('chargeComment').value.trim();
    
    if (chargeAmt && chargeComment) {
      let charge = DATA.charges.find(c => 
        c.apartment_id === aptId && c.period === period
      );
      
      if (charge) {
        charge.amount = chargeAmt;
        charge.comment = chargeComment;
      } else {
        DATA.charges.push({
          id: Math.max(0, ...DATA.charges.map(c => c.id)) + 1,
          apartment_id: aptId,
          period,
          amount: chargeAmt,
          comment: chargeComment
        });
      }
    }
    
    await writeCSV('readings.csv', DATA.readings);
    await writeCSV('heating.csv', DATA.heating);
    await writeCSV('charges.csv', DATA.charges);
    
    showStatus('Данные сохранены', 'success');
    DATA.calculated = false;
    document.getElementById('saveBtn').disabled = true;
    
  } catch (error) {
    showStatus(`Ошибка: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

// ========== Итоги за 3 месяца ==========
function renderTotals(aptId, aptType) {
  const now = new Date();
  const periods = [];
  
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  
  let html = '<table><thead><tr><th>Услуга</th>';
  periods.forEach(p => html += `<th>${p}</th>`);
  html += '</tr></thead><tbody>';
  
  const totals = periods.map(() => 0);
  
  DATA.services.forEach(srv => {
    html += `<tr><td><strong>${srv.name}</strong></td>`;
    const tariff = getTariff(srv.id, aptType);
    
    periods.forEach((period, idx) => {
      let amount = 0;
      
      if (srv.calc_type === 'meter') {
        const prev = getReading(aptId, srv.id, getPrevPeriod(period));
        const curr = getReading(aptId, srv.id, period);
        const vol = curr && prev ? curr - prev : 0;
        amount = vol * tariff;
      } else if (srv.calc_type === 'calculated') {
        if (srv.id === 2) {
          const ePrev = getReading(aptId, 1, getPrevPeriod(period));
          const eCurr = getReading(aptId, 1, period);
          const vol = eCurr && ePrev ? (eCurr - ePrev) * 0.1 : 0;
          amount = vol * tariff;
        } else if (srv.id === 5) {
          const hvPrev = getReading(aptId, 3, getPrevPeriod(period));
          const hvCurr = getReading(aptId, 3, period);
          const gvPrev = getReading(aptId, 4, getPrevPeriod(period));
          const gvCurr = getReading(aptId, 4, period);
          const vol = (hvCurr && hvPrev ? hvCurr - hvPrev : 0) + 
                      (gvCurr && gvPrev ? gvCurr - gvPrev : 0);
          amount = vol * tariff;
        }
      } else if (srv.calc_type === 'checkbox') {
        amount = getHeating(aptId, period) ? tariff : 0;
      } else if (srv.calc_type === 'fixed') {
        const override = getOverride(aptId, srv.id, period);
        amount = override !== null ? override : tariff;
      }
      
      totals[idx] += amount;
      html += `<td>${amount.toFixed(2)} ₽</td>`;
    });
    
    html += '</tr>';
  });
  
  // Доп начисления
  html += `<tr class="charge-row"><td><strong>Доп. начисления</strong></td>`;
  periods.forEach((period, idx) => {
    const charge = getCharge(aptId, period);
    const amt = charge?.amount || 0;
    totals[idx] += amt;
    html += `<td>${amt.toFixed(2)} ₽</td>`;
  });
  html += '</tr>';
  
  // Итого
  html += `<tr class="total-row"><td><strong>ИТОГО:</strong></td>`;
  totals.forEach(t => html += `<td><strong>${t.toFixed(2)} ₽</strong></td>`);
  html += '</tr></tbody></table>';
  
  document.getElementById('totalsTable').innerHTML = html;
}

// ========== История на 12 месяцев ==========
function showHistoryFull() {
  const aptId = parseInt(document.getElementById('historyApartment').value);
  const year = parseInt(document.getElementById('historyYear').value);
  const viewMode = document.getElementById('historyViewMode').value;
  
  if (!aptId) {
    alert('Выберите квартиру');
    return;
  }
  
  document.getElementById('historyPanel').style.display = 'block';
  document.getElementById('historyPeriodTitle').textContent = year;
  
  const apt = DATA.apartments.find(a => a.id === aptId);
  const periods = [];
  const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  
  for (let m = 1; m <= 12; m++) {
    periods.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  
  let html = '<table><thead><tr><th style="text-align:left;">Услуга</th>';
  monthNames.forEach(month => {
    html += `<th>${month}</th>`;
  });
  html += '<th>Итого</th></tr></thead><tbody>';
  
  const chartData = periods.map(() => 0);
  
  DATA.services.forEach(srv => {
    html += `<tr><td><strong>${srv.name}</strong></td>`;
    const tariff = getTariff(srv.id, apt.type);
    let rowTotal = 0;
    
    periods.forEach((period, idx) => {
      let displayValue = '—';
      let amount = 0;
      
      if (srv.calc_type === 'meter') {
        const prev = getReading(aptId, srv.id, getPrevPeriod(period));
        const curr = getReading(aptId, srv.id, period);
        const vol = curr && prev ? curr - prev : 0;
        amount = vol * tariff;
        
        if (viewMode === 'readings') {
          displayValue = curr !== null ? curr.toString() : '—';
        } else if (viewMode === 'volumes') {
          displayValue = vol > 0 ? vol.toFixed(2) : '—';
        } else {
          displayValue = amount > 0 ? amount.toFixed(2) : '—';
        }
        
      } else if (srv.calc_type === 'calculated') {
        if (srv.id === 2) {
          const ePrev = getReading(aptId, 1, getPrevPeriod(period));
          const eCurr = getReading(aptId, 1, period);
          const vol = eCurr && ePrev ? (eCurr - ePrev) * 0.1 : 0;
          amount = vol * tariff;
        } else if (srv.id === 5) {
          const hvPrev = getReading(aptId, 3, getPrevPeriod(period));
          const hvCurr = getReading(aptId, 3, period);
          const gvPrev = getReading(aptId, 4, getPrevPeriod(period));
          const gvCurr = getReading(aptId, 4, period);
          const vol = (hvCurr && hvPrev ? hvCurr - hvPrev : 0) + 
                      (gvCurr && gvPrev ? gvCurr - gvPrev : 0);
          amount = vol * tariff;
        }
        
        if (viewMode === 'volumes') {
          const vol = amount / tariff;
          displayValue = vol > 0 ? vol.toFixed(2) : '—';
        } else if (viewMode !== 'readings') {
          displayValue = amount > 0 ? amount.toFixed(2) : '—';
        }
        
      } else if (srv.calc_type === 'checkbox') {
        const enabled = getHeating(aptId, period);
        amount = enabled ? tariff : 0;
        
        if (viewMode === 'readings') {
          displayValue = enabled ? '✓' : '—';
        } else if (viewMode !== 'volumes') {
          displayValue = amount > 0 ? amount.toFixed(2) : '—';
        }
        
      } else if (srv.calc_type === 'fixed') {
        const override = getOverride(aptId, srv.id, period);
        amount = override !== null ? override : tariff;
        if (viewMode !== 'readings' && viewMode !== 'volumes') {
          displayValue = amount.toFixed(2);
        }
      }
      
      chartData[idx] += amount;
      rowTotal += amount;
      html += `<td>${displayValue}</td>`;
    });
    
    if (viewMode === 'amounts') {
      html += `<td><strong>${rowTotal.toFixed(2)} ₽</strong></td>`;
    } else {
      html += `<td>—</td>`;
    }
    html += '</tr>';
  });
  
  // Доп начисления
  if (viewMode === 'amounts') {
    html += `<tr class="charge-row"><td><strong>Доп. начисления</strong></td>`;
    let chargeTotal = 0;
    periods.forEach((period, idx) => {
      const charge = getCharge(aptId, period);
      const amt = charge?.amount || 0;
      chartData[idx] += amt;
      chargeTotal += amt;
      html += `<td>${amt > 0 ? amt.toFixed(2) : '—'}</td>`;
    });
    html += `<td><strong>${chargeTotal.toFixed(2)} ₽</strong></td></tr>`;
    
    // Итого
    html += `<tr class="total-row"><td><strong>ИТОГО:</strong></td>`;
    let grandTotal = 0;
    chartData.forEach(t => {
      grandTotal += t;
      html += `<td><strong>${t.toFixed(2)} ₽</strong></td>`;
    });
    html += `<td><strong>${grandTotal.toFixed(2)} ₽</strong></td></tr>`;
  }
  
  html += '</tbody></table>';
  
  document.getElementById('consumptionTable').innerHTML = html;
}

function exportToExcel() {
  alert('Экспорт в Excel будет реализован в следующей версии');
}

// ========== Корректировка данных ==========
function showCorrectionForm() {
  const aptId = parseInt(document.getElementById('correctionApartment').value);
  const year = parseInt(document.getElementById('correctionYear').value);
  
  if (!aptId) {
    alert('Выберите квартиру');
    return;
  }
  
  document.getElementById('correctionPanel').style.display = 'block';
  document.getElementById('correctionPeriodTitle').textContent = year;
  
  const apt = DATA.apartments.find(a => a.id === aptId);
  const periods = [];
  const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  
  for (let m = 1; m <= 12; m++) {
    periods.push(`${year}-${String(m).padStart(2, '0')}`);
  }
  
  let html = '<table><thead><tr><th style="text-align:left;">Услуга</th>';
  monthNames.forEach(month => html += `<th>${month}</th>`);
  html += '</tr></thead><tbody>';
  
  // 1. Услуги со счётчиками (электричество, вода)
  const meterServices = DATA.services.filter(s => s.calc_type === 'meter');
  
  meterServices.forEach(srv => {
    html += `<tr><td><strong>${srv.name}</strong></td>`;
    
    periods.forEach(period => {
      const curr = getReading(aptId, srv.id, period);
      html += `<td>
        <input type="number" step="0.01" value="${curr !== null ? curr : ''}" 
          data-apt="${aptId}" data-service="${srv.id}" data-period="${period}"
          class="correction-input" placeholder="—" style="width:70px;">
      </td>`;
    });
    
    html += '</tr>';
  });
  
  // 2. Отопление (чекбокс)
  const heatingSrv = DATA.services.find(s => s.id === 6);
  if (heatingSrv) {
    html += `<tr><td><strong>${heatingSrv.name}</strong></td>`;
    
    periods.forEach(period => {
      const enabled = getHeating(aptId, period);
      html += `<td style="text-align:center;">
        <input type="checkbox" ${enabled ? 'checked' : ''}
          data-apt="${aptId}" data-period="${period}"
          class="heating-correction-input">
      </td>`;
    });
    
    html += '</tr>';
  }
  
  // 3. Фиксированные услуги (содержание, мусор, интернет)
  const fixedServices = DATA.services.filter(s => s.calc_type === 'fixed');
  
  fixedServices.forEach(srv => {
    const defaultTariff = getTariff(srv.id, apt.type);
    html += `<tr><td><strong>${srv.name}</strong> <span style="color:var(--text-muted); font-size:11px;">(${defaultTariff}₽)</span></td>`;
    
    periods.forEach(period => {
      const override = getOverride(aptId, srv.id, period);
      const value = override !== null ? override : defaultTariff;
      
      html += `<td>
        <input type="number" step="0.01" value="${value}" 
          data-apt="${aptId}" data-service="${srv.id}" data-period="${period}"
          class="fixed-correction-input" placeholder="${defaultTariff}" style="width:70px;">
      </td>`;
    });
    
    html += '</tr>';
  });
  
  // 4. Доп начисления
  html += `<tr class="charge-row"><td><strong>Доп. начисления (₽)</strong></td>`;
  periods.forEach(period => {
    const charge = getCharge(aptId, period);
    html += `<td>
      <input type="number" step="0.01" value="${charge?.amount || ''}"
        data-apt="${aptId}" data-period="${period}"
        class="charge-correction-input" placeholder="—" style="width:70px;">
    </td>`;
  });
  html += '</tr>';
  
  // 5. Комментарии к доп начислениям
  html += `<tr class="charge-row"><td><strong>Комментарий</strong></td>`;
  periods.forEach(period => {
    const charge = getCharge(aptId, period);
    html += `<td>
      <input type="text" value="${charge?.comment || ''}"
        data-apt="${aptId}" data-period="${period}"
        class="comment-correction-input" placeholder="—" style="width:70px; font-size:11px;">
    </td>`;
  });
  html += '</tr>';
  
  html += '</tbody></table>';
  document.getElementById('correctionTable').innerHTML = html;
}

async function saveCorrectionData() {
  showLoader(true);
  
  try {
    // 1. Сохранить показания счётчиков
    const readingInputs = document.querySelectorAll('.correction-input');
    readingInputs.forEach(input => {
      const aptId = parseInt(input.dataset.apt);
      const srvId = parseInt(input.dataset.service);
      const period = input.dataset.period;
      const value = parseFloat(input.value);
      
      if (!isNaN(value)) {
        let reading = DATA.readings.find(r => 
          r.apartment_id === aptId && r.service_id === srvId && r.period === period
        );
        
        if (reading) {
          reading.value = value;
        } else {
          DATA.readings.push({
            id: Math.max(0, ...DATA.readings.map(r => r.id)) + 1,
            apartment_id: aptId,
            service_id: srvId,
            period,
            value
          });
        }
      }
    });
    
    // 2. Сохранить отопление
    const heatingInputs = document.querySelectorAll('.heating-correction-input');
    heatingInputs.forEach(input => {
      const aptId = parseInt(input.dataset.apt);
      const period = input.dataset.period;
      const enabled = input.checked;
      
      let heating = DATA.heating.find(h => 
        h.apartment_id === aptId && h.period === period
      );
      
      if (heating) {
        heating.enabled = enabled;
      } else {
        DATA.heating.push({
          id: Math.max(0, ...DATA.heating.map(h => h.id)) + 1,
          apartment_id: aptId,
          period,
          enabled
        });
      }
    });
    
    // 3. Сохранить переопределенные фиксированные услуги
    const fixedInputs = document.querySelectorAll('.fixed-correction-input');
    fixedInputs.forEach(input => {
      const aptId = parseInt(input.dataset.apt);
      const srvId = parseInt(input.dataset.service);
      const period = input.dataset.period;
      const value = parseFloat(input.value);
      
      const apt = DATA.apartments.find(a => a.id === aptId);
      const defaultTariff = getTariff(srvId, apt.type);
      
      if (!isNaN(value) && value !== defaultTariff) {
        // Сохранить только если значение отличается от тарифа
        let override = DATA.overrides.find(o => 
          o.apartment_id === aptId && o.service_id === srvId && o.period === period
        );
        
        if (override) {
          override.amount = value;
        } else {
          DATA.overrides.push({
            id: Math.max(0, ...DATA.overrides.map(o => o.id)) + 1,
            apartment_id: aptId,
            service_id: srvId,
            period,
            amount: value
          });
        }
      } else if (value === defaultTariff) {
        // Удалить override если вернули к тарифу
        DATA.overrides = DATA.overrides.filter(o => 
          !(o.apartment_id === aptId && o.service_id === srvId && o.period === period)
        );
      }
    });
    
    // 4. Сохранить доп начисления
    const chargeInputs = document.querySelectorAll('.charge-correction-input');
    const commentInputs = document.querySelectorAll('.comment-correction-input');
    
    chargeInputs.forEach((input, idx) => {
      const aptId = parseInt(input.dataset.apt);
      const period = input.dataset.period;
      const amount = parseFloat(input.value);
      const comment = commentInputs[idx].value.trim();
      
      if (!isNaN(amount) && amount > 0 && comment) {
        let charge = DATA.charges.find(c => 
          c.apartment_id === aptId && c.period === period
        );
        
        if (charge) {
          charge.amount = amount;
          charge.comment = comment;
        } else {
          DATA.charges.push({
            id: Math.max(0, ...DATA.charges.map(c => c.id)) + 1,
            apartment_id: aptId,
            period,
            amount,
            comment
          });
        }
      } else if ((!amount || amount <= 0) && !comment) {
        // Удалить если очистили
        DATA.charges = DATA.charges.filter(c => 
          !(c.apartment_id === aptId && c.period === period)
        );
      }
    });
    
    // Сохранить все в GitHub
    await writeCSV('readings.csv', DATA.readings);
    await writeCSV('heating.csv', DATA.heating);
    await writeCSV('overrides.csv', DATA.overrides);
    await writeCSV('charges.csv', DATA.charges);
    
    showStatus('Все данные сохранены в CSV файлы', 'success');
    
  } catch (error) {
    showStatus(`Ошибка: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

// ========== Квитанция на оплату ==========
function generateReceipt() {
  const aptId = parseInt(document.getElementById('receiptApartment').value);
  const year = parseInt(document.getElementById('receiptYear').value);
  const month = parseInt(document.getElementById('receiptMonth').value);
  
  if (!aptId) {
    alert('Выберите квартиру');
    return;
  }
  
  const apt = DATA.apartments.find(a => a.id === aptId);
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                      'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  
  document.getElementById('receiptPanel').style.display = 'block';
  document.getElementById('receiptAptName').textContent = apt.name;
  document.getElementById('receiptPeriodDisplay').textContent = `${monthNames[month-1]} ${year}`;
  
  let html = '<table><thead><tr>';
  html += '<th>Услуга</th>';
  html += '<th>Предыдущее</th>';
  html += '<th>Текущее</th>';
  html += '<th>Расход</th>';
  html += '<th>Тариф</th>';
  html += '<th>Начисление</th>';
  html += '</tr></thead><tbody>';
  
  let grandTotal = 0;
  
  DATA.services.forEach(srv => {
    const tariff = getTariff(srv.id, apt.type);
    
    if (srv.calc_type === 'meter') {
      const prev = getReading(aptId, srv.id, getPrevPeriod(period)) || 0;
      const curr = getReading(aptId, srv.id, period) || 0;
      const volume = curr - prev;
      const amount = volume * tariff;
      grandTotal += amount;
      
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td>${prev.toFixed(2)}</td>
        <td>${curr.toFixed(2)}</td>
        <td>${volume.toFixed(2)} ${srv.unit}</td>
        <td>${tariff} ₽</td>
        <td class="amount">${amount.toFixed(2)} ₽</td>
      </tr>`;
      
    } else if (srv.calc_type === 'calculated') {
      let volume = 0;
      let amount = 0;
      
      if (srv.id === 2) {
        const elecPrev = getReading(aptId, 1, getPrevPeriod(period)) || 0;
        const elecCurr = getReading(aptId, 1, period) || 0;
        volume = (elecCurr - elecPrev) * 0.1;
        amount = volume * tariff;
      } else if (srv.id === 5) {
        const hvPrev = getReading(aptId, 3, getPrevPeriod(period)) || 0;
        const hvCurr = getReading(aptId, 3, period) || 0;
        const gvPrev = getReading(aptId, 4, getPrevPeriod(period)) || 0;
        const gvCurr = getReading(aptId, 4, period) || 0;
        volume = (hvCurr - hvPrev) + (gvCurr - gvPrev);
        amount = volume * tariff;
      }
      
      grandTotal += amount;
      
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td colspan="2" style="text-align:center;">Автоматически</td>
        <td>${volume.toFixed(2)} ${srv.unit}</td>
        <td>${tariff} ₽</td>
        <td class="amount">${amount.toFixed(2)} ₽</td>
      </tr>`;
      
    } else if (srv.calc_type === 'checkbox') {
      const enabled = getHeating(aptId, period);
      const amount = enabled ? tariff : 0;
      grandTotal += amount;
      
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td colspan="3" style="text-align:center;">${enabled ? 'Включено' : 'Выключено'}</td>
        <td>${tariff} ₽</td>
        <td class="amount">${amount.toFixed(2)} ₽</td>
      </tr>`;
      
    } else if (srv.calc_type === 'fixed') {
      const override = getOverride(aptId, srv.id, period);
      const amount = override !== null ? override : tariff;
      grandTotal += amount;
      
      html += `<tr>
        <td><strong>${srv.name}</strong></td>
        <td colspan="3" style="text-align:center;">Фиксированная</td>
        <td>${tariff} ₽${override ? ' (изм.)' : ''}</td>
        <td class="amount">${amount.toFixed(2)} ₽</td>
      </tr>`;
    }
  });
  
  // Доп начисления
  const charge = getCharge(aptId, period);
  if (charge) {
    grandTotal += charge.amount;
    html += `<tr class="charge-row">
      <td><strong>Доп. начисления</strong></td>
      <td colspan="4">${charge.comment}</td>
      <td class="amount">${charge.amount.toFixed(2)} ₽</td>
    </tr>`;
  }
  
  // Итого
  html += `<tr class="total-row">
    <td colspan="5"><strong>ИТОГО К ОПЛАТЕ:</strong></td>
    <td><strong>${grandTotal.toFixed(2)} ₽</strong></td>
  </tr>`;
  
  html += '</tbody></table>';
  document.getElementById('receiptTable').innerHTML = html;
  document.getElementById('exportReceiptBtn').disabled = false;
}

function exportReceiptToWord() {
  alert('Экспорт квитанции в Word будет реализован в следующей версии.\nПока можете использовать Ctrl+P для печати.');
}

// ========== Тарифы ==========
function displayTariffs() {
  let html = '<table><thead><tr><th>Услуга</th><th>Цена</th><th>Тип квартиры</th></tr></thead><tbody>';
  
  DATA.tariffs.forEach(t => {
    const srv = DATA.services.find(s => s.id === t.service_id);
    const aptType = t.apartment_type === 'all' ? 'Все' : 
                    t.apartment_type === 'studio' ? 'Студии' : 'Двухуровневые';
    
    html += `<tr>
      <td>${srv?.name || 'N/A'}</td>
      <td><strong class="amount">${t.price} ₽</strong></td>
      <td><span class="badge badge-primary">${aptType}</span></td>
    </tr>`;
  });
  
  html += '</tbody></table>';
  document.getElementById('tariffsTable').innerHTML = html;
}

async function updateTariff() {
  const srvId = parseInt(document.getElementById('tariffService').value);
  const price = parseFloat(document.getElementById('tariffPrice').value);
  const aptType = document.getElementById('tariffAptType').value;
  
  if (!srvId || !price) {
    alert('Заполните все поля');
    return;
  }
  
  showLoader(true);
  
  try {
    let tariff = DATA.tariffs.find(t => 
      t.service_id === srvId && t.apartment_type === aptType
    );
    
    if (tariff) {
      tariff.price = price;
    } else {
      DATA.tariffs.push({
        id: Math.max(0, ...DATA.tariffs.map(t => t.id)) + 1,
        service_id: srvId,
        price,
        apartment_type: aptType
      });
    }
    
    await writeCSV('tariffs.csv', DATA.tariffs);
    showStatus('Тариф обновлён', 'success');
    displayTariffs();
    
  } catch (error) {
    showStatus(`Ошибка: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

// ========== Вспомогательные ==========
function getTariff(serviceId, aptType) {
  const tariff = DATA.tariffs.find(t => 
    t.service_id === serviceId && 
    (t.apartment_type === 'all' || t.apartment_type === aptType)
  );
  return tariff ? tariff.price : 0;
}

function getReading(aptId, srvId, period) {
  const reading = DATA.readings.find(r => 
    r.apartment_id === aptId && 
    r.service_id === srvId && 
    r.period === period
  );
  return reading ? reading.value : null;
}

function getHeating(aptId, period) {
  const heating = DATA.heating.find(h => 
    h.apartment_id === aptId && h.period === period
  );
  return heating ? heating.enabled : false;
}

function getCharge(aptId, period) {
  return DATA.charges.find(c => 
    c.apartment_id === aptId && c.period === period
  );
}

function getOverride(aptId, srvId, period) {
  const override = DATA.overrides.find(o => 
    o.apartment_id === aptId && 
    o.service_id === srvId && 
    o.period === period
  );
  return override ? override.amount : null;
}

function getPrevPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

// ========== Глобальные функции ==========
window.calculateData = calculateData;
window.saveData = saveData;
window.saveSettings = saveSettings;
window.clearSettings = clearSettings;
window.updateTariff = updateTariff;
window.showHistoryFull = showHistoryFull;
window.exportToExcel = exportToExcel;
window.showCorrectionForm = showCorrectionForm;
window.saveCorrectionData = saveCorrectionData;
window.generateReceipt = generateReceipt;
window.exportReceiptToWord = exportReceiptToWord;
