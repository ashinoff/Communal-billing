// ==================== Утилиты и настройки ====================
const APP = {
  settings: {
    owner: '',
    repo: '',
    branch: 'main',
    datadir: 'data',
    token: ''
  },
  data: {
    apartments: [],
    services: [],
    tariffs: [],
    meters: [],
    readings: [],
    adjustments: []
  },
  chart: null
};

// Загрузка настроек из localStorage
function loadSettings() {
  const saved = localStorage.getItem('ghSettings');
  if (saved) {
    Object.assign(APP.settings, JSON.parse(saved));
    document.getElementById('owner').value = APP.settings.owner;
    document.getElementById('repo').value = APP.settings.repo;
    document.getElementById('branch').value = APP.settings.branch;
    document.getElementById('datadir').value = APP.settings.datadir;
    document.getElementById('token').value = APP.settings.token;
  }
}

// Сохранение настроек
function saveSettings() {
  APP.settings.owner = document.getElementById('owner').value.trim();
  APP.settings.repo = document.getElementById('repo').value.trim();
  APP.settings.branch = document.getElementById('branch').value.trim();
  APP.settings.datadir = document.getElementById('datadir').value.trim();
  APP.settings.token = document.getElementById('token').value.trim();
  
  localStorage.setItem('ghSettings', JSON.stringify(APP.settings));
  showStatus('settingsStatus', 'success', '✓ Настройки сохранены');
  
  // Загрузить данные после сохранения
  reloadAllData();
}

// Показ статуса
function showStatus(elementId, type, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.className = `status-message ${type} show`;
  setTimeout(() => el.classList.remove('show'), 5000);
}

// Показать/скрыть загрузчик
function showLoader(show = true) {
  document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

// ==================== Работа с GitHub API ====================
async function githubRequest(path, method = 'GET', body = null) {
  const { owner, repo, branch, token } = APP.settings;
  
  if (!owner || !repo || !token) {
    throw new Error('Заполните настройки GitHub');
  }
  
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json'
  };
  
  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'GitHub API error');
  }
  
  return response.json();
}

// Чтение CSV файла
async function readCSV(filename) {
  try {
    const { datadir } = APP.settings;
    const data = await githubRequest(`${datadir}/${filename}`);
    const content = atob(data.content);
    return parseCSV(content);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return [];
  }
}

// Запись CSV файла
async function writeCSV(filename, data) {
  try {
    const { datadir, branch } = APP.settings;
    const path = `${datadir}/${filename}`;
    
    // Получаем текущий SHA файла
    let sha;
    try {
      const existing = await githubRequest(path);
      sha = existing.sha;
    } catch (e) {
      sha = null; // Файл не существует
    }
    
    const content = btoa(unescape(encodeURIComponent(serializeCSV(data))));
    
    await githubRequest(path, 'PUT', {
      message: `Update ${filename}`,
      content,
      sha,
      branch
    });
    
    return true;
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    throw error;
  }
}

// Парсинг CSV
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((header, i) => {
      let value = values[i] ? values[i].trim() : '';
      // Попытка преобразовать в число
      if (value && !isNaN(value)) {
        value = parseFloat(value);
      }
      obj[header] = value;
    });
    return obj;
  });
}

// Сериализация CSV
function serializeCSV(data) {
  if (!data.length) return '';
  const headers = Object.keys(data[0]);
  const rows = [headers.join(',')];
  data.forEach(item => {
    const values = headers.map(h => {
      const val = item[h];
      return val === undefined || val === null ? '' : String(val);
    });
    rows.push(values.join(','));
  });
  return rows.join('\n');
}

// ==================== Загрузка всех данных ====================
async function reloadAllData() {
  showLoader(true);
  try {
    APP.data.apartments = await readCSV('apartments.csv');
    APP.data.services = await readCSV('services.csv');
    APP.data.tariffs = await readCSV('tariffs.csv');
    APP.data.meters = await readCSV('meters.csv');
    APP.data.readings = await readCSV('readings.csv');
    APP.data.adjustments = await readCSV('adjustments.csv');
    
    populateDropdowns();
    showStatus('settingsStatus', 'success', '✓ Данные загружены');
  } catch (error) {
    showStatus('settingsStatus', 'error', '✗ Ошибка загрузки: ' + error.message);
  } finally {
    showLoader(false);
  }
}

// Заполнение выпадающих списков
function populateDropdowns() {
  const { apartments, services } = APP.data;
  
  // Квартиры
  const aptSelects = ['calcApartment', 'histApartment'];
  aptSelects.forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">Выберите квартиру...</option>';
    apartments.forEach(apt => {
      select.innerHTML += `<option value="${apt.id}">${apt.name}</option>`;
    });
  });
  
  // Услуги для тарифов
  const srvSelect = document.getElementById('tarService');
  srvSelect.innerHTML = '<option value="">Выберите услугу...</option>';
  services.forEach(srv => {
    srvSelect.innerHTML += `<option value="${srv.id}">${srv.name}</option>`;
  });
  
  // Установить текущую дату
  const now = new Date();
  document.getElementById('calcYear').value = now.getFullYear();
  document.getElementById('calcMonth').value = now.getMonth() + 1;
}

// ==================== Расчёт начислений ====================
function showCalculations() {
  const aptId = parseInt(document.getElementById('calcApartment').value);
  const year = parseInt(document.getElementById('calcYear').value);
  const month = parseInt(document.getElementById('calcMonth').value);
  const viewMode = document.getElementById('viewMode').value;
  
  if (!aptId || !year || !month) {
    alert('Выберите квартиру, год и месяц');
    return;
  }
  
  const period = `${year}-${String(month).padStart(2, '0')}`;
  const apartment = APP.data.apartments.find(a => a.id === aptId);
  const meters = APP.data.meters.filter(m => m.apartment_id === aptId);
  
  // Показать панель ввода показаний
  const inputsDiv = document.getElementById('calcInputs');
  const inputsContent = document.getElementById('calcInputsContent');
  inputsDiv.style.display = 'block';
  inputsContent.innerHTML = '';
  
  if (meters.length === 0) {
    inputsContent.innerHTML = '<p>У этой квартиры нет счётчиков</p>';
    return;
  }
  
  let html = '<table><thead><tr><th>Услуга</th><th>Счётчик</th>';
  if (viewMode === 'readings') {
    html += '<th>Предыдущее</th><th>Текущее</th>';
  } else {
    html += '<th>Объём</th>';
  }
  html += '</tr></thead><tbody>';
  
  meters.forEach(meter => {
    const service = APP.data.services.find(s => s.id === meter.service_id);
    const prevReading = getPreviousReading(meter.id, period);
    const currReading = getCurrentReading(meter.id, period);
    
    html += `<tr>
      <td>${service ? service.name : 'N/A'}</td>
      <td>${meter.serial || 'б/н'}</td>`;
    
    if (viewMode === 'readings') {
      html += `
        <td>${prevReading || 0}</td>
        <td><input type="number" step="0.01" value="${currReading || ''}" 
            data-meter="${meter.id}" class="reading-input" /></td>`;
    } else {
      const volume = currReading && prevReading ? (currReading - prevReading) : 0;
      html += `<td>${volume.toFixed(2)}</td>`;
    }
    
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  
  if (viewMode === 'readings') {
    html += '<button onclick="saveReadings()" class="btn btn-primary mt-2">Сохранить показания</button>';
  }
  
  inputsContent.innerHTML = html;
  
  // Рассчитать итоги
  calculateTotals(aptId, period);
}

// Получить предыдущее показание
function getPreviousReading(meterId, period) {
  const [year, month] = period.split('-').map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  
  const reading = APP.data.readings.find(r => 
    r.meter_id === meterId && r.period === prevPeriod
  );
  
  return reading ? reading.value : null;
}

// Получить текущее показание
function getCurrentReading(meterId, period) {
  const reading = APP.data.readings.find(r => 
    r.meter_id === meterId && r.period === period
  );
  return reading ? reading.value : null;
}

// Сохранить показания
async function saveReadings() {
  const period = `${document.getElementById('calcYear').value}-${String(document.getElementById('calcMonth').value).padStart(2, '0')}`;
  const inputs = document.querySelectorAll('.reading-input');
  
  inputs.forEach(input => {
    const meterId = parseInt(input.dataset.meter);
    const value = parseFloat(input.value);
    
    if (!isNaN(value)) {
      // Найти или создать запись
      let reading = APP.data.readings.find(r => 
        r.meter_id === meterId && r.period === period
      );
      
      if (reading) {
        reading.value = value;
      } else {
        const newId = Math.max(0, ...APP.data.readings.map(r => r.id)) + 1;
        APP.data.readings.push({
          id: newId,
          meter_id: meterId,
          period: period,
          value: value
        });
      }
    }
  });
  
  showLoader(true);
  try {
    await writeCSV('readings.csv', APP.data.readings);
    showStatus('settingsStatus', 'success', '✓ Показания сохранены');
    showCalculations(); // Обновить отображение
  } catch (error) {
    showStatus('settingsStatus', 'error', '✗ Ошибка сохранения: ' + error.message);
  } finally {
    showLoader(false);
  }
}

// Рассчитать итоги
function calculateTotals(aptId, period) {
  const meters = APP.data.meters.filter(m => m.apartment_id === aptId);
  const totals = [];
  let grandTotal = 0;
  
  meters.forEach(meter => {
    const service = APP.data.services.find(s => s.id === meter.service_id);
    const prevReading = getPreviousReading(meter.id, period);
    const currReading = getCurrentReading(meter.id, period);
    
    if (currReading !== null && prevReading !== null && service) {
      const volume = currReading - prevReading;
      const tariff = getTariffForPeriod(service.id, period);
      const amount = volume * (tariff || 0);
      
      totals.push({
        service: service.name,
        unit: service.unit,
        volume: volume.toFixed(2),
        tariff: (tariff || 0).toFixed(2),
        amount: amount.toFixed(2)
      });
      
      grandTotal += amount;
    }
  });
  
  const totalsDiv = document.getElementById('calcTotals');
  const totalsContent = document.getElementById('calcTotalsContent');
  
  if (totals.length === 0) {
    totalsDiv.style.display = 'none';
    return;
  }
  
  totalsDiv.style.display = 'block';
  
  let html = `<table>
    <thead>
      <tr>
        <th>Услуга</th>
        <th>Объём</th>
        <th>Тариф</th>
        <th>Сумма</th>
      </tr>
    </thead>
    <tbody>`;
  
  totals.forEach(t => {
    html += `<tr>
      <td>${t.service}</td>
      <td>${t.volume} ${t.unit}</td>
      <td>${t.tariff} ₽/${t.unit}</td>
      <td><strong>${t.amount} ₽</strong></td>
    </tr>`;
  });
  
  html += `<tr style="background: rgba(59, 130, 246, 0.1); font-weight: bold;">
    <td colspan="3">ИТОГО:</td>
    <td>${grandTotal.toFixed(2)} ₽</td>
  </tr>`;
  
  html += '</tbody></table>';
  totalsContent.innerHTML = html;
}

// Получить тариф для периода
function getTariffForPeriod(serviceId, period) {
  const periodDate = new Date(period + '-01');
  
  const validTariffs = APP.data.tariffs.filter(t => {
    if (t.service_id !== serviceId) return false;
    
    const startDate = new Date(t.start_date);
    if (periodDate < startDate) return false;
    
    if (t.end_date) {
      const endDate = new Date(t.end_date);
      if (periodDate > endDate) return false;
    }
    
    return true;
  });
  
  if (validTariffs.length === 0) return null;
  
  // Берём самый поздний тариф
  validTariffs.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
  return validTariffs[0].price;
}

// ==================== История ====================
function showHistory() {
  const aptId = parseInt(document.getElementById('histApartment').value);
  
  if (!aptId) {
    alert('Выберите квартиру');
    return;
  }
  
  const meters = APP.data.meters.filter(m => m.apartment_id === aptId);
  
  // Собираем все периоды с данными
  const periodTotals = {};
  
  meters.forEach(meter => {
    const service = APP.data.services.find(s => s.id === meter.service_id);
    const readings = APP.data.readings.filter(r => r.meter_id === meter.id)
      .sort((a, b) => a.period.localeCompare(b.period));
    
    for (let i = 1; i < readings.length; i++) {
      const curr = readings[i];
      const prev = readings[i - 1];
      const volume = curr.value - prev.value;
      const tariff = getTariffForPeriod(service.id, curr.period);
      const amount = volume * (tariff || 0);
      
      if (!periodTotals[curr.period]) {
        periodTotals[curr.period] = 0;
      }
      periodTotals[curr.period] += amount;
    }
  });
  
  const periods = Object.keys(periodTotals).sort();
  
  // Таблица
  const histTable = document.getElementById('histTable');
  const histTableContent = document.getElementById('histTableContent');
  
  if (periods.length === 0) {
    histTable.style.display = 'none';
    return;
  }
  
  histTable.style.display = 'block';
  
  let html = `<table>
    <thead>
      <tr>
        <th>Период</th>
        <th>Сумма</th>
      </tr>
    </thead>
    <tbody>`;
  
  periods.forEach(period => {
    html += `<tr>
      <td>${period}</td>
      <td><strong>${periodTotals[period].toFixed(2)} ₽</strong></td>
    </tr>`;
  });
  
  html += '</tbody></table>';
  histTableContent.innerHTML = html;
  
  // График
  showHistoryChart(periods, periodTotals);
}

function showHistoryChart(periods, totals) {
  const chartCard = document.getElementById('histChartCard');
  const canvas = document.getElementById('histChart');
  
  if (periods.length === 0) {
    chartCard.style.display = 'none';
    return;
  }
  
  chartCard.style.display = 'block';
  
  if (APP.chart) {
    APP.chart.destroy();
  }
  
  const data = periods.map(p => totals[p]);
  
  APP.chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: periods,
      datasets: [{
        label: 'Расходы, ₽',
        data: data,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#f1f5f9' }
        }
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

// ==================== Тарифы ====================
function loadTariffs() {
  const table = document.getElementById('tarTableContent');
  const { tariffs, services } = APP.data;
  
  if (tariffs.length === 0) {
    table.innerHTML = '<p>Нет тарифов</p>';
    return;
  }
  
  let html = `<table>
    <thead>
      <tr>
        <th>Услуга</th>
        <th>Цена</th>
        <th>Период действия</th>
      </tr>
    </thead>
    <tbody>`;
  
  tariffs.forEach(t => {
    const service = services.find(s => s.id === t.service_id);
    const endDate = t.end_date || 'по настоящее время';
    
    html += `<tr>
      <td>${service ? service.name : 'N/A'}</td>
      <td><strong>${t.price} ₽</strong></td>
      <td>${t.start_date} — ${endDate}</td>
    </tr>`;
  });
  
  html += '</tbody></table>';
  table.innerHTML = html;
}

async function addTariff() {
  const serviceId = parseInt(document.getElementById('tarService').value);
  const price = parseFloat(document.getElementById('tarPrice').value);
  const startDate = document.getElementById('tarStart').value;
  const hasEnd = document.getElementById('tarHasEnd').checked;
  const endDate = hasEnd ? document.getElementById('tarEnd').value : null;
  
  if (!serviceId || !price || !startDate) {
    alert('Заполните все обязательные поля');
    return;
  }
  
  const newId = Math.max(0, ...APP.data.tariffs.map(t => t.id)) + 1;
  APP.data.tariffs.push({
    id: newId,
    service_id: serviceId,
    price: price,
    start_date: startDate,
    end_date: endDate || ''
  });
  
  showLoader(true);
  try {
    await writeCSV('tariffs.csv', APP.data.tariffs);
    showStatus('settingsStatus', 'success', '✓ Тариф добавлен');
    loadTariffs();
    
    // Очистить форму
    document.getElementById('tarService').value = '';
    document.getElementById('tarPrice').value = '';
    document.getElementById('tarStart').value = '';
    document.getElementById('tarEnd').value = '';
    document.getElementById('tarHasEnd').checked = false;
    document.getElementById('tarEnd').disabled = true;
  } catch (error) {
    showStatus('settingsStatus', 'error', '✗ Ошибка: ' + error.message);
  } finally {
    showLoader(false);
  }
}

// ==================== Инициализация ====================
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  // Вкладки
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      // Переключить активные вкладки
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(tab).classList.add('active');
      
      // Загрузить данные для вкладки
      if (tab === 'tariffs') {
        loadTariffs();
      }
    });
  });
  
  // Настройки
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('testConnection').addEventListener('click', async () => {
    showLoader(true);
    try {
      await githubRequest('');
      showStatus('settingsStatus', 'success', '✓ Соединение успешно');
    } catch (error) {
      showStatus('settingsStatus', 'error', '✗ Ошибка: ' + error.message);
    } finally {
      showLoader(false);
    }
  });
  
  // Расчёт
  document.getElementById('calcReload').addEventListener('click', showCalculations);
  
  // История
  document.getElementById('histReload').addEventListener('click', showHistory);
  
  // Тарифы
  document.getElementById('addTariff').addEventListener('click', addTariff);
  document.getElementById('tarHasEnd').addEventListener('change', (e) => {
    document.getElementById('tarEnd').disabled = !e.target.checked;
  });
  
  // Автозагрузка данных если настройки есть
  if (APP.settings.token) {
    reloadAllData();
  }
});

// Глобальные функции
window.saveReadings = saveReadings;
window.reloadAllData = reloadAllData;
