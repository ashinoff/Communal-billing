// ========== Глобальное хранилище ==========
const DATA = {
  apartments: [],
  services: [],
  tariffs: [],
  readings: [],
  charges: [],
  heating: [],
  settings: { owner: '', repo: '', branch: 'main', datadir: 'data', token: '' },
  calculated: false,
  historyMode: 'readings'
};

let chart = null;

// ========== Инициализация ==========
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  
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
  ['apartment', 'historyApartment'].forEach(id => {
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
      amount = tariff;
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
        amount = tariff;
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

function renderHistory3Months(aptId, aptType) {
  const now = new Date();
  const periods = [];
  
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  
  let html = '<table><thead><tr><th>Услуга</th>';
  periods.forEach(p => html += `<th>${p}</th>`);
  html += '</tr></thead><tbody>';
  
  DATA.services.forEach(srv => {
    html += `<tr><td><strong>${srv.name}</strong></td>`;
    
    periods.forEach(period => {
      if (srv.calc_type === 'meter') {
        const prev = getReading(aptId, srv.id, getPrevPeriod(period));
        const curr = getReading(aptId, srv.id, period);
        
        if (DATA.historyMode === 'readings') {
          html += `<td>${curr !== null ? curr : '—'}</td>`;
        } else {
          const vol = curr && prev ? (curr - prev).toFixed(2) : '—';
          html += `<td>${vol}</td>`;
        }
      } else if (srv.calc_type === 'checkbox') {
        const enabled = getHeating(aptId, period);
        html += `<td style="text-align:center;">${enabled ? '✓' : '—'}</td>`;
      } else {
        html += `<td>—</td>`;
      }
    });
    
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  document.getElementById('historyTable').innerHTML = html;
}

function toggleHistoryMode(mode) {
  DATA.historyMode = mode;
  const aptId = document.getElementById('apartment').value;
  if (aptId) {
    const apt = DATA.apartments.find(a => a.id == aptId);
    renderHistory3Months(parseInt(aptId), apt.type);
  }
}

// ========== История на 12 месяцев ==========
function showHistoryFull() {
  const aptId = parseInt(document.getElementById('historyApartment').value);
  const year = parseInt(document.getElementById('historyYear').value);
  
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
  
  // Таблица: услуги в строках, месяцы в столбцах
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
          amount = eCurr && ePrev ? (eCurr - ePrev) * 0.1 * tariff : 0;
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
        amount = tariff;
      }
      
      chartData[idx] += amount;
      rowTotal += amount;
      html += `<td>${amount > 0 ? amount.toFixed(2) : '—'}</td>`;
    });
    
    html += `<td><strong>${rowTotal.toFixed(2)} ₽</strong></td></tr>`;
  });
  
  // Доп начисления
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
  html += '</tbody></table>';
  
  document.getElementById('consumptionTable').innerHTML = html;
  
  // График
  renderChart(periods, chartData);
}

function renderChart(periods, data) {
  const canvas = document.getElementById('chart');
  if (chart) chart.destroy();
  
  const monthNames = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  
  chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: monthNames,
      datasets: [{
        label: 'Расходы, ₽',
        data: data,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37, 99, 235, 0.1)',
        tension: 0.3,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#475569' },
          grid: { color: '#e2e8f0' }
        },
        x: {
          ticks: { color: '#475569' },
          grid: { color: '#e2e8f0' }
        }
      }
    }
  });
}

function exportToExcel() {
  alert('Экспорт в Excel будет реализован в следующей версии');
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
window.toggleHistoryMode = toggleHistoryMode;
window.showHistoryFull = showHistoryFull;
window.exportToExcel = exportToExcel;
