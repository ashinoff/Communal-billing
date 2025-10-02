// ========== Глобальное хранилище ==========
const DATA = {
  apartments: [],
  services: [],
  tariffs: [],
  readings: [],
  charges: [],
  heating: [],
  settings: {
    owner: '',
    repo: '',
    branch: 'main',
    datadir: 'data',
    token: ''
  }
};

let chart = null;

// ========== Инициализация ==========
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  setupViewMode();
  
  // Если настройки есть, загружаем данные
  if (DATA.settings.token) {
    loadAllData();
  }
});

// ========== Вкладки ==========
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Убрать активные классы
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      // Добавить активные классы
      btn.classList.add('active');
      document.getElementById(tab).classList.add('active');
      
      // Загрузить данные для вкладки
      if (tab === 'tariffs') {
        displayTariffs();
      }
    });
  });
}

// ========== Переключатель показания/объемы ==========
function setupViewMode() {
  document.querySelectorAll('input[name="viewMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const aptId = document.getElementById('apartment').value;
      if (aptId) {
        renderHistory3Months(parseInt(aptId), DATA.apartments.find(a => a.id == aptId).type);
      }
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
  
  // Валидация
  if (!DATA.settings.owner) {
    showStatus('✗ Заполните поле Owner', 'error');
    return;
  }
  if (!DATA.settings.repo) {
    showStatus('✗ Заполните поле Repository', 'error');
    return;
  }
  if (!DATA.settings.token) {
    showStatus('✗ Заполните Personal Access Token', 'error');
    return;
  }
  
  localStorage.setItem('communalSettings', JSON.stringify(DATA.settings));
  showStatus('✓ Настройки сохранены, загружаем данные...', 'success');
  
  loadAllData();
}

function clearSettings() {
  if (confirm('Очистить все сохранённые настройки?')) {
    localStorage.removeItem('communalSettings');
    DATA.settings = {
      owner: '',
      repo: '',
      branch: 'main',
      datadir: 'data',
      token: ''
    };
    document.getElementById('owner').value = '';
    document.getElementById('repo').value = '';
    document.getElementById('branch').value = 'main';
    document.getElementById('datadir').value = 'data';
    document.getElementById('token').value = '';
    showStatus('✓ Настройки очищены', 'success');
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
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`GitHub API: ${response.status}`);
  return response.json();
}

async function readCSV(filename) {
  try {
    const { datadir } = DATA.settings;
    const data = await githubAPI(`${datadir}/${filename}`);
    const csv = atob(data.content.replace(/\n/g, ''));
    return parseCSV(csv);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return [];
  }
}

async function writeCSV(filename, data) {
  const { datadir, branch } = DATA.settings;
  const path = `${datadir}/${filename}`;
  
  // Получить SHA
  let sha;
  try {
    const file = await githubAPI(path);
    sha = file.sha;
  } catch (e) {
    sha = null;
  }
  
  const csv = serializeCSV(data);
  const content = btoa(unescape(encodeURIComponent(csv)));
  
  await githubAPI(path, 'PUT', {
    message: `Update ${filename}`,
    content,
    sha,
    branch
  });
}

// ========== CSV парсинг ==========
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
      
      // Конвертация типов
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
    
    populateDropdowns();
    showStatus(`✓ Загружено квартир: ${DATA.apartments.length}`, 'success');
  } catch (error) {
    showStatus(`✗ Ошибка загрузки: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

function populateDropdowns() {
  // Квартиры
  const selects = ['apartment', 'historyApartment'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">Выберите квартиру...</option>';
    DATA.apartments.forEach(apt => {
      sel.innerHTML += `<option value="${apt.id}">${apt.name}</option>`;
    });
  });
  
  // Услуги для тарифов
  const srvSel = document.getElementById('tariffService');
  srvSel.innerHTML = '<option value="">Выберите услугу...</option>';
  DATA.services.forEach(srv => {
    srvSel.innerHTML += `<option value="${srv.id}">${srv.name}</option>`;
  });
  
  // События выбора квартиры
  document.getElementById('apartment').onchange = (e) => {
    if (e.target.value) showCalculations(e.target.value);
  };
  
  document.getElementById('historyApartment').onchange = (e) => {
    if (e.target.value) showHistory(e.target.value);
  };
}

// ========== Расчёты ==========
function showCalculations(aptId) {
  aptId = parseInt(aptId);
  const apt = DATA.apartments.find(a => a.id === aptId);
  if (!apt) return;
  
  document.getElementById('calcPanel').style.display = 'block';
  
  // Текущий период
  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('currentPeriod').textContent = currentPeriod;
  
  // Форма ввода
  renderInputForm(aptId, currentPeriod, apt.type);
  
  // История за 3 месяца
  renderHistory3Months(aptId, apt.type);
  
  // Итоги
  renderTotals(aptId, apt.type);
}

function renderInputForm(aptId, period, aptType) {
  const form = document.getElementById('inputForm');
  
  let html = '<div class="input-grid">';
  
  DATA.services.forEach(srv => {
    const tariff = getTariff(srv.id, aptType);
    
    if (srv.calc_type === 'meter') {
      // Услуги со счётчиками (электричество, вода)
      const prev = getReading(aptId, srv.id, getPrevPeriod(period));
      const curr = getReading(aptId, srv.id, period);
      const volume = curr && prev ? curr - prev : 0;
      
      html += `
        <div class="input-item">
          <div class="input-header">
            <strong>${srv.name}</strong>
            <span class="tariff-badge">${tariff} ₽/${srv.unit}</span>
          </div>
          <div class="input-row">
            <div class="input-col">
              <label>Предыдущее показание</label>
              <input type="text" value="${prev || 0}" disabled>
            </div>
            <div class="input-col">
              <label>Текущее показание</label>
              <input type="number" step="0.01" value="${curr || ''}" 
                data-service="${srv.id}" class="reading-input" 
                placeholder="Введите показание">
            </div>
          </div>
          <div class="result">
            Расход: <strong>${volume.toFixed(2)} ${srv.unit}</strong> = 
            <strong class="amount">${(volume * tariff).toFixed(2)} ₽</strong>
          </div>
        </div>`;
      
    } else if (srv.calc_type === 'calculated') {
      // Вычисляемые (освещение МОП, водоотведение)
      let volume = 0;
      let amount = 0;
      
      if (srv.id === 2) {
        const elecPrev = getReading(aptId, 1, getPrevPeriod(period));
        const elecCurr = getReading(aptId, 1, period);
        volume = elecCurr && elecPrev ? (elecCurr - elecPrev) * 0.1 : 0;
        amount = volume * tariff;
      } else if (srv.id === 5) {
        const hvPrev = getReading(aptId, 3, getPrevPeriod(period));
        const hvCurr = getReading(aptId, 3, period);
        const gvPrev = getReading(aptId, 4, getPrevPeriod(period));
        const gvCurr = getReading(aptId, 4, period);
        
        const hvVol = hvCurr && hvPrev ? hvCurr - hvPrev : 0;
        const gvVol = gvCurr && gvPrev ? gvCurr - gvPrev : 0;
        volume = hvVol + gvVol;
        amount = volume * tariff;
      }
      
      html += `
        <div class="input-item auto">
          <div class="input-header">
            <strong>${srv.name}</strong>
            <span class="tariff-badge">${tariff} ₽/${srv.unit}</span>
          </div>
          <div class="result">
            Автоматически: <strong>${volume.toFixed(2)} ${srv.unit}</strong> = 
            <strong class="amount">${amount.toFixed(2)} ₽</strong>
          </div>
        </div>`;
      
    } else if (srv.calc_type === 'checkbox') {
      // Отопление
      const enabled = getHeating(aptId, period);
      
      html += `
        <div class="input-item">
          <div class="input-header">
            <strong>${srv.name}</strong>
            <span class="tariff-badge">${tariff} ₽/мес</span>
          </div>
          <div class="checkbox-row">
            <label class="checkbox-label">
              <input type="checkbox" ${enabled ? 'checked' : ''} 
                data-service="${srv.id}" class="heating-checkbox">
              <span>Отопление включено</span>
            </label>
          </div>
          <div class="result">
            Сумма: <strong class="amount">${enabled ? tariff.toFixed(2) : '0.00'} ₽</strong>
          </div>
        </div>`;
      
    } else if (srv.calc_type === 'fixed') {
      // Фиксированные услуги
      html += `
        <div class="input-item auto">
          <div class="input-header">
            <strong>${srv.name}</strong>
            <span class="tariff-badge">${tariff} ₽/мес</span>
          </div>
          <div class="result">
            Фиксированная сумма: <strong class="amount">${tariff.toFixed(2)} ₽</strong>
          </div>
        </div>`;
    }
  });
  
  // Доп начисления
  const charge = getCharge(aptId, period);
  html += `
    <div class="input-item charge">
      <div class="input-header">
        <strong>Дополнительные начисления</strong>
      </div>
      <div class="input-row">
        <div class="input-col">
          <label>Сумма (₽)</label>
          <input type="number" step="0.01" value="${charge?.amount || ''}" 
            id="chargeAmount" placeholder="0.00">
        </div>
        <div class="input-col flex-2">
          <label>Комментарий</label>
          <input type="text" placeholder="За что начисление?" 
            value="${charge?.comment || ''}" id="chargeComment">
        </div>
      </div>
      ${charge ? `<div class="result">Сумма: <strong class="amount">${charge.amount.toFixed(2)} ₽</strong></div>` : ''}
    </div>`;
  
  html += '</div>';
  form.innerHTML = html;
  
  // Обновление при изменении чекбокса отопления
  document.querySelectorAll('.heating-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      showCalculations(aptId);
    });
  });
  
  // Обновление при изменении показаний
  document.querySelectorAll('.reading-input').forEach(input => {
    input.addEventListener('input', () => {
      showCalculations(aptId);
    });
  });
}

function renderHistory3Months(aptId, aptType) {
  const now = new Date();
  const periods = [];
  
  // Последние 3 месяца
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  
  const viewMode = document.querySelector('input[name="viewMode"]:checked').value;
  
  let html = '<table><thead><tr><th>Услуга</th>';
  periods.forEach(p => {
    html += `<th>${p}</th>`;
  });
  html += '</tr></thead><tbody>';
  
  DATA.services.forEach(srv => {
    html += `<tr><td>${srv.name}</td>`;
    
    periods.forEach(period => {
      if (srv.calc_type === 'meter') {
        const prev = getReading(aptId, srv.id, getPrevPeriod(period));
        const curr = getReading(aptId, srv.id, period);
        
        if (viewMode === 'readings') {
          html += `<td>${curr || '—'}</td>`;
        } else {
          const vol = curr && prev ? (curr - prev).toFixed(2) : '—';
          html += `<td>${vol}</td>`;
        }
      } else if (srv.calc_type === 'checkbox') {
        const enabled = getHeating(aptId, period);
        html += `<td>${enabled ? '✓' : '—'}</td>`;
      } else {
        html += `<td>—</td>`;
      }
    });
    
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  document.getElementById('historyTable').innerHTML = html;
}

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
    html += `<tr><td>${srv.name}</td>`;
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
  html += `<tr><td>Доп. начисления</td>`;
  periods.forEach((period, idx) => {
    const charge = getCharge(aptId, period);
    const amt = charge?.amount || 0;
    totals[idx] += amt;
    html += `<td>${amt.toFixed(2)} ₽</td>`;
  });
  html += '</tr>';
  
  // Итого
  html += `<tr style="background: rgba(59, 130, 246, 0.1); font-weight: bold;">
    <td>ИТОГО:</td>`;
  totals.forEach(t => html += `<td>${t.toFixed(2)} ₽</td>`);
  html += '</tr></tbody></table>';
  
  document.getElementById('totalsTable').innerHTML = html;
}

// ========== Сохранение данных ==========
async function saveData() {
  const aptId = parseInt(document.getElementById('apartment').value);
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  showLoader(true);
  
  try {
    // Показания счётчиков
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
    document.querySelectorAll('.heating-checkbox').forEach(cb => {
      const enabled = cb.checked;
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
    
    // Доп начисления
    const chargeAmount = parseFloat(document.getElementById('chargeAmount').value);
    const chargeComment = document.getElementById('chargeComment').value.trim();
    
    if (chargeAmount && chargeComment) {
      let charge = DATA.charges.find(c => 
        c.apartment_id === aptId && c.period === period
      );
      
      if (charge) {
        charge.amount = chargeAmount;
        charge.comment = chargeComment;
      } else {
        DATA.charges.push({
          id: Math.max(0, ...DATA.charges.map(c => c.id)) + 1,
          apartment_id: aptId,
          period,
          amount: chargeAmount,
          comment: chargeComment
        });
      }
    }
    
    // Сохранить в GitHub
    await writeCSV('readings.csv', DATA.readings);
    await writeCSV('heating.csv', DATA.heating);
    await writeCSV('charges.csv', DATA.charges);
    
    showStatus('✓ Данные сохранены', 'success');
    showCalculations(aptId);
    
  } catch (error) {
    showStatus(`✗ Ошибка: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

// ========== История ==========
function showHistory(aptId) {
  aptId = parseInt(aptId);
  document.getElementById('historyPanel').style.display = 'block';
  
  // Собрать все периоды
  const periods = [...new Set(DATA.readings.map(r => r.period))].sort();
  
  // Таблица
  let html = '<table><thead><tr><th>Период</th>';
  DATA.services.forEach(srv => html += `<th>${srv.name}</th>`);
  html += '<th>ИТОГО</th></tr></thead><tbody>';
  
  const apt = DATA.apartments.find(a => a.id === aptId);
  const chartData = [];
  
  periods.forEach(period => {
    html += `<tr><td>${period}</td>`;
    let total = 0;
    
    DATA.services.forEach(srv => {
      const tariff = getTariff(srv.id, apt.type);
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
      
      total += amount;
      html += `<td>${amount.toFixed(2)}</td>`;
    });
    
    const charge = getCharge(aptId, period);
    if (charge) total += charge.amount;
    
    html += `<td><strong>${total.toFixed(2)} ₽</strong></td></tr>`;
    chartData.push({ period, total });
  });
  
  html += '</tbody></table>';
  document.getElementById('consumptionTable').innerHTML = html;
  
  // График
  renderChart(chartData);
}

function renderChart(data) {
  const canvas = document.getElementById('chart');
  
  if (chart) chart.destroy();
  
  chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map(d => d.period),
      datasets: [{
        label: 'Расходы, ₽',
        data: data.map(d => d.total),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#f1f5f9' } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: '#cbd5e1' },
          grid: { color: '#334155' }
        },
        x: {
          ticks: { color: '#cbd5e1' },
          grid: { color: '#334155' }
        }
      }
    }
  });
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
      <td><strong>${t.price} ₽</strong></td>
      <td>${aptType}</td>
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
    // Найти или создать тариф
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
    showStatus('✓ Тариф обновлён', 'success');
    displayTariffs();
    
  } catch (error) {
    showStatus(`✗ Ошибка: ${error.message}`, 'error');
  } finally {
    showLoader(false);
  }
}

// ========== Вспомогательные функции ==========
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
window.saveData = saveData;
window.saveSettings = saveSettings;
window.clearSettings = clearSettings;
window.updateTariff = updateTariff;
