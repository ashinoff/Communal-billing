// ---- State / settings ----
const S = {
  owner: localStorage.getItem('owner') || 'ashinoff',
  repo: localStorage.getItem('repo') || 'Communal-billing',
  branch: localStorage.getItem('branch') || 'main',
  datadir: localStorage.getItem('datadir') || 'data',
  token: localStorage.getItem('token') || '',
};
function setStatus(msg){ document.getElementById('settingsStatus').textContent = msg; }

function initSettingsForm(){
  owner.value = S.owner; repo.value = S.repo; branch.value = S.branch; datadir.value = S.datadir; token.value = S.token;
  document.getElementById('saveSettings').onclick = ()=>{
    S.owner = owner.value.trim(); S.repo = repo.value.trim(); S.branch = branch.value.trim(); S.datadir = datadir.value.trim(); S.token = token.value.trim();
    localStorage.setItem('owner', S.owner); localStorage.setItem('repo', S.repo); localStorage.setItem('branch', S.branch); localStorage.setItem('datadir', S.datadir); localStorage.setItem('token', S.token);
    setStatus('Saved'); reloadAll();
  };
  // default month/year = now
  const now = new Date(); calcYear.value = now.getFullYear(); calcMonth.value = now.getMonth()+1;
}

// ---- GitHub API helpers ----
function apiBase(path){ return `https://api.github.com/repos/${S.owner}/${S.repo}/contents/${path}?ref=${S.branch}`; }
async function ghGet(path){
  const r = await fetch(apiBase(path), { headers: { 'Authorization': `token ${S.token}`, 'Accept': 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
  return r.json();
}
async function ghPut(path, bytes, message){
  const meta = await ghGet(path).catch(()=>null);
  const sha = meta?.sha;
  const body = { message, content: btoa(String.fromCharCode(...new Uint8Array(bytes))), branch: S.branch, ...(sha?{sha}:{}), };
  const r = await fetch(`https://api.github.com/repos/${S.owner}/${S.repo}/contents/${path}`, {
    method: 'PUT', headers: { 'Authorization': `token ${S.token}`, 'Accept': 'application/vnd.github+json' }, body: JSON.stringify(body)
  });
  if(!r.ok){ throw new Error(`PUT ${path}: ${r.status} ${await r.text()}`); }
  return r.json();
}
async function loadCSV(name){
  const meta = await ghGet(`${S.datadir}/${name}.csv`);
  const content = atob(meta.content.replace(/\n/g,''));
  const rows = content.trim()? content.split(/\r?\n/): [];
  const headers = rows[0]?.split(',') || [];
  const data = rows.slice(1).map(line => {
    const vals = line.split(','); const o = {}; headers.forEach((h,i)=>o[h]=vals[i]??''); return o;
  });
  return { headers, data, sha: meta.sha };
}
function toCSV(headers, rows){
  const lines = [headers.join(',')];
  rows.forEach(r=> lines.push(headers.map(h=> String(r[h]??'')).join(',')));
  return new TextEncoder().encode(lines.join('\n'));
}
function nextId(rows){ return rows.length ? (1+Math.max(...rows.map(r=>parseInt(r.id||'0',10)))) : 1; }
function yymm(y,m){ const mm=String(m).padStart(2,'0'); return `${y}-${mm}-01`; }
function ensure(arr, headers){ return arr.length? arr: []; }

// ---- Data ----
let apartments, services, tariffs, meters, readings, adjustments;

// ---- Load all ----
async function reloadAll(){
  [apartments, services, tariffs, meters, readings, adjustments] = await Promise.all([
    loadCSV('apartments'), loadCSV('services'), loadCSV('tariffs'),
    loadCSV('meters'), loadCSV('readings'), loadCSV('adjustments')
  ]);
  fillApartmentSelects();
  renderTariffs();
}
function fillApartmentSelects(){
  const opts = apartments.data.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  calcApartment.innerHTML = opts; histApartment.innerHTML = opts;
}

// ---- Helpers ----
function isDuplex(apartmentName){
  return apartmentName.toLowerCase().includes('2х уровневый') || apartmentName.toLowerCase().includes('двухуров');
}
function serviceIdByCode(code){ const s = services.data.find(x=>x.code===code); return s? s.id : null; }
function tariffFor(service_id, period){
  const items = tariffs.data.filter(t=> t.service_id===String(service_id) && t.start_date<=period).sort((a,b)=> b.start_date.localeCompare(a.start_date));
  for(const t of items){ if(!t.end_date || t.end_date>=period) return parseFloat(t.price||'0'); }
  return 0;
}
// auto-ensure 1 meter per (apartment, service). Serial is not used.
async function ensureMeter(apartment_id, service_id){
  const found = meters.data.find(m=> m.apartment_id===String(apartment_id) && m.service_id===String(service_id));
  if(found) return found;
  const row = { id: String(nextId(meters.data)), apartment_id: String(apartment_id), service_id: String(service_id), serial: '', is_shared: 'false' };
  const newRows = [...meters.data, row];
  await ghPut(`${S.datadir}/meters.csv`, toCSV(meters.headers, newRows), `Auto-create meter apt=${apartment_id} svc=${service_id}`);
  meters.data = newRows;
  return row;
}
function prevReading(meter_id, period){
  const prev = readings.data.filter(r=> r.meter_id===String(meter_id) && r.period < period).sort((a,b)=> a.period.localeCompare(b.period)).pop();
  return prev? parseFloat(prev.value||'0') : 0;
}
function getReading(meter_id, period){
  return readings.data.find(r=> r.meter_id===String(meter_id) && r.period===period);
}
async function upsertReading(meter_id, period, val){
  const exists = getReading(meter_id, period);
  if(exists){ const newRows = readings.data.map(r=> r===exists? { ...r, value: String(val) } : r ); await ghPut(`${S.datadir}/readings.csv`, toCSV(readings.headers, newRows), `Update reading meter=${meter_id} @ ${period}`); readings.data = newRows; }
  else { const newRow = { id:String(nextId(readings.data)), meter_id:String(meter_id), period, value:String(val) }; const newRows = [...readings.data, newRow]; await ghPut(`${S.datadir}/readings.csv`, toCSV(readings.headers, newRows), `Insert reading meter=${meter_id} @ ${period}`); readings.data=newRows; }
}

// ---- UI: Calc ----
calcReload.onclick = renderCalcPage;
async function renderCalcPage(){
  const aid = calcApartment.value; if(!aid) return;
  const apt = apartments.data.find(a=>a.id===aid);
  const y = parseInt(calcYear.value,10); const m = parseInt(calcMonth.value,10);
  const per = yymm(y,m);
  const months = [0,1,2].map(k=>{ const d = new Date(y, m-1-k, 1); return yymm(d.getFullYear(), d.getMonth()+1); }); // current + 2 prev
  const vm = viewMode.value; // 'readings' or 'volumes'

  // Services we input readings for (ЭЭ, ХВС, ГВС). Lighting_mop comes from ЭЭ-объём*0.1; Sewer from sums.
  const sElec = serviceIdByCode('electricity');
  const sCold = serviceIdByCode('coldwater');
  const sHot  = serviceIdByCode('hotwater');
  const sLight= serviceIdByCode('lighting_mop');
  const sSewer= serviceIdByCode('sewer');
  const sHeatS= serviceIdByCode('heating_studio');
  const sHeatD= serviceIdByCode('heating_duplex');
  const sMaint= serviceIdByCode('maintenance');
  const sGar  = serviceIdByCode('garbage');
  const sNet  = serviceIdByCode('internet');

  // ensure meters exist (auto)
  const mElec = await ensureMeter(aid, sElec);
  const mCold = await ensureMeter(aid, sCold);
  const mHot  = await ensureMeter(aid, sHot);

  // Build inputs for 3 months
  const container = document.getElementById('calcInputs'); container.innerHTML='';
  const tbl = document.createElement('table');
  const head = ['Месяц','Электроэнергия','ХВС','ГВС','Освещение МОП','Водоотведение','Отопление','Содержание','Мусор','Интернет','Доп. начисления (₽)','Комментарий'];
  const trh = document.createElement('tr'); head.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); }); const thead=document.createElement('thead'); thead.appendChild(trh); tbl.appendChild(thead);
  const tbody = document.createElement('tbody');

  const is_duplex = isDuplex(apt.name);
  const heat_service = is_duplex ? sHeatD : sHeatS;

  for(const p of months){
    // readings values
    const prevE = prevReading(mElec.id, p), curE = getReading(mElec.id, p)?.value || '';
    const prevC = prevReading(mCold.id, p), curC = getReading(mCold.id, p)?.value || '';
    const prevH = prevReading(mHot.id,  p), curH = getReading(mHot.id,  p)?.value || '';

    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p}</td>
      <td><input type="number" step="0.01" id="e_${p}" value="${curE}" placeholder="${vm==='readings'?'показ.':'объём'}"></td>
      <td><input type="number" step="0.01" id="c_${p}" value="${curC}" placeholder="${vm==='readings'?'показ.':'объём'}"></td>
      <td><input type="number" step="0.01" id="h_${p}" value="${curH}" placeholder="${vm==='readings'?'показ.':'объём'}"></td>
      <td class="calc" id="light_${p}"></td>
      <td class="calc" id="sewer_${p}"></td>
      <td><label><input type="checkbox" id="heat_${p}" checked> начислять</label></td>
      <td><label><input type="checkbox" id="maint_${p}" checked> начислять</label></td>
      <td><label><input type="checkbox" id="gar_${p}" checked> начислять</label></td>
      <td><label><input type="checkbox" id="net_${p}" checked> начислять</label></td>
      <td><input type="number" step="0.01" id="adj_${p}" value=""></td>
      <td><input type="text" id="adjc_${p}" placeholder="за что..."></td>`;
    tbody.appendChild(tr);

    // init computed fields from existing readings/volumes
    computeRow(p);
    // save handlers (on change of current period only for persistence)
    ['e','c','h'].forEach(prefix=>{
      document.getElementById(`${prefix}_${p}`).addEventListener('change', async (ev)=>{
        const val = parseFloat(ev.target.value||'0');
        if(vm==='readings'){
          const meter = prefix==='e'? mElec : (prefix==='c'? mCold : mHot);
          await upsertReading(meter.id, p, val);
        }else{
          // volumes mode: convert to reading = prev + volume
          const prev = prefix==='e'? prevE : (prefix==='c'? prevC : prevH);
          const meter = prefix==='e'? mElec : (prefix==='c'? mCold : mHot);
          const newReading = prev + val;
          await upsertReading(meter.id, p, newReading);
          document.getElementById(`${prefix}_${p}`).value = String(newReading);
        }
        computeRow(p);
        computeTotals(months, aid, heat_service);
      });
    });
    ['heat_','maint_','gar_','net_','adj_','adjc_'].forEach(pref=>{
      const el = document.getElementById(`${pref}${p}`);
      el.addEventListener('change', ()=>{ computeRow(p); computeTotals(months, aid, heat_service); });
    });
  }
  tbl.appendChild(tbody); container.appendChild(tbl);

  computeTotals(months, aid, heat_service);

  function computeRow(p){
    const e_read = parseFloat(document.getElementById(`e_${p}`).value||'0');
    const c_read = parseFloat(document.getElementById(`c_${p}`).value||'0');
    const h_read = parseFloat(document.getElementById(`h_${p}`).value||'0');
    const e_vol = e_read - prevReading(mElec.id, p);
    const c_vol = c_read - prevReading(mCold.id, p);
    const h_vol = h_read - prevReading(mHot.id, p);
    const e_price = tariffFor(sElec, p);
    const c_price = tariffFor(sCold, p);
    const h_price = tariffFor(sHot,  p);
    const light_vol = Math.max(0, e_vol) * 0.1;
    const sewer_vol = Math.max(0, c_vol) + Math.max(0, h_vol);
    const light_price = tariffFor(sLight, p) || e_price; // если тариф освещения не задан, берём как электро
    const sewer_price = tariffFor(sSewer, p);
    document.getElementById(`light_${p}`).textContent = `${light_vol.toFixed(2)} × ${light_price.toFixed(2)}`;
    document.getElementById(`sewer_${p}`).textContent = `${sewer_vol.toFixed(2)} × ${sewer_price.toFixed(2)}`;
  }

  function computeTotals(months, aid, heat_service){
    // Рассчитываем только для текущего (первого в списке)
    const p = months[0];
    const e_read = parseFloat(document.getElementById(`e_${p}`).value||'0');
    const c_read = parseFloat(document.getElementById(`c_${p}`).value||'0');
    const h_read = parseFloat(document.getElementById(`h_${p}`).value||'0');
    const e_vol = Math.max(0, e_read - prevReading(mElec.id, p));
    const c_vol = Math.max(0, c_read - prevReading(mCold.id, p));
    const h_vol = Math.max(0, h_read - prevReading(mHot.id,  p));

    const e_price = tariffFor(sElec, p);
    const c_price = tariffFor(sCold, p);
    const h_price = tariffFor(sHot,  p);
    const light_vol = e_vol * 0.1;
    const light_price = tariffFor(sLight, p) || e_price;
    const sewer_vol = c_vol + h_vol;
    const sewer_price = tariffFor(sSewer, p);

    const apply_heat = document.getElementById(`heat_${p}`).checked;
    const apply_maint= document.getElementById(`maint_${p}`).checked;
    const apply_gar  = document.getElementById(`gar_${p}`).checked;
    const apply_net  = document.getElementById(`net_${p}`).checked;

    const heat_price = apply_heat ? tariffFor(heat_service, p) : 0;
    const maint_price= apply_maint? tariffFor(sMaint, p):0;
    const gar_price  = apply_gar  ? tariffFor(sGar, p):0;
    const net_price  = apply_net  ? tariffFor(sNet, p):0;

    const adj = parseFloat(document.getElementById(`adj_${p}`).value||'0');

    const rows = [
      { Вид:'Электроэнергия', Объем:e_vol.toFixed(2), Тариф:e_price.toFixed(2), Сумма:(e_vol*e_price).toFixed(2) },
      { Вид:'Освещение МОП',  Объем:light_vol.toFixed(2), Тариф:light_price.toFixed(2), Сумма:(light_vol*light_price).toFixed(2) },
      { Вид:'Холодная вода',  Объем:c_vol.toFixed(2), Тариф:c_price.toFixed(2), Сумма:(c_vol*c_price).toFixed(2) },
      { Вид:'Горячая вода',   Объем:h_vol.toFixed(2), Тариф:h_price.toFixed(2), Сумма:(h_vol*h_price).toFixed(2) },
      { Вид:'Водоотведение',  Объем:sewer_vol.toFixed(2), Тариф:sewer_price.toFixed(2), Сумма:(sewer_vol*sewer_price).toFixed(2) },
      { Вид:'Отопление',      Объем:'—', Тариф:heat_price.toFixed(2), Сумма:heat_price.toFixed(2) },
      { Вид:'Содержание',     Объем:'—', Тариф:maint_price.toFixed(2), Сумма:maint_price.toFixed(2) },
      { Вид:'Мусор',          Объем:'—', Тариф:gar_price.toFixed(2),   Сумма:gar_price.toFixed(2) },
      { Вид:'Интернет',       Объем:'—', Тариф:net_price.toFixed(2),   Сумма:net_price.toFixed(2) },
      { Вид:'Доп.начисления', Объем:'—', Тариф:'—', Сумма:adj.toFixed(2) },
    ];
    const sum = rows.reduce((a,r)=> a + parseFloat(r.Сумма==='—'?0:r.Сумма), 0);
    rows.push({ Вид:'ИТОГО', Объем:'', Тариф:'', Сумма:sum.toFixed(2) });
    renderTable('calcTotals', ['Вид','Объем','Тариф','Сумма'], rows);
  }

  function renderTable(containerId, headers, rows){
    const wrap = document.getElementById(containerId); const t=document.createElement('table');
    const thead=document.createElement('thead'); const trh=document.createElement('tr');
    headers.forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); }); thead.appendChild(trh); t.appendChild(thead);
    const tb=document.createElement('tbody'); rows.forEach(r=>{ const tr=document.createElement('tr'); headers.forEach(h=>{ const td=document.createElement('td'); td.textContent = r[h] ?? ''; tr.appendChild(td); }); tb.appendChild(tr); }); t.appendChild(tb);
    wrap.innerHTML=''; wrap.appendChild(t);
  }
}

// ---- UI: History ----
let chart;
histReload.onclick = renderHistory;
function asPeriod(d){ const dt = new Date(d); return dt.toISOString().slice(0,10); }
async function renderHistory(){
  const aid = histApartment.value; if(!aid) return;
  // Gather all months from readings for this apartment
  const aptMeters = meters.data.filter(m=> m.apartment_id===aid).map(m=> m.id);
  const rs = readings.data.filter(r=> aptMeters.includes(r.meter_id));
  const byMonth = {};
  for(const r of rs){ byMonth[r.period] = byMonth[r.period] || { elec:0, cold:0, hot:0 }; }
  // Compute monthly totals (simple; without fixed items)
  for(const p of Object.keys(byMonth)){
    const eMeter = meters.data.find(m=> m.apartment_id===aid && m.service_id===services.data.find(s=>s.code==='electricity').id);
    const cMeter = meters.data.find(m=> m.apartment_id===aid && m.service_id===services.data.find(s=>s.code==='coldwater').id);
    const hMeter = meters.data.find(m=> m.apartment_id===aid && m.service_id===services.data.find(s=>s.code==='hotwater').id);
    const prev = (id)=> readings.data.filter(x=> x.meter_id===String(id) && x.period < p).sort((a,b)=> a.period.localeCompare(b.period)).pop();
    const cur  = (id)=> readings.data.find(x=> x.meter_id===String(id) && x.period===p);
    const eVol = Math.max(0, (parseFloat(cur(eMeter?.id)?.value||'0') - parseFloat(prev(eMeter?.id)?.value||'0')));
    const cVol = Math.max(0, (parseFloat(cur(cMeter?.id)?.value||'0') - parseFloat(prev(cMeter?.id)?.value||'0')));
    const hVol = Math.max(0, (parseFloat(cur(hMeter?.id)?.value||'0') - parseFloat(prev(hMeter?.id)?.value||'0')));
    const ePr  = tariffFor(services.data.find(s=>s.code==='electricity').id, p);
    const cPr  = tariffFor(services.data.find(s=>s.code==='coldwater').id, p);
    const hPr  = tariffFor(services.data.find(s=>s.code==='hotwater').id, p);
    const mopPr= tariffFor(services.data.find(s=>s.code==='lighting_mop').id, p) || ePr;
    const sewPr= tariffFor(services.data.find(s=>s.code==='sewer').id, p);
    const mopVol = eVol*0.1;
    const sewVol = cVol+hVol;
    const total = eVol*ePr + mopVol*mopPr + cVol*cPr + hVol*hPr + sewVol*sewPr; // без фикс/доп
    byMonth[p].total = +total.toFixed(2);
  }
  const months = Object.keys(byMonth).sort();
  const rows = months.map(m=> ({ Месяц:m, Сумма: byMonth[m].total.toFixed(2) }));
  // Table
  const wrap = document.getElementById('histTable'); const t=document.createElement('table');
  const thead=document.createElement('thead'); const trh=document.createElement('tr'); ['Месяц','Сумма'].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); }); thead.appendChild(trh); t.appendChild(thead);
  const tb=document.createElement('tbody'); rows.forEach(r=>{ const tr=document.createElement('tr'); ['Месяц','Сумма'].forEach(h=>{ const td=document.createElement('td'); td.textContent=r[h]; tr.appendChild(td); }); tb.appendChild(tr); }); t.appendChild(tb); wrap.innerHTML=''; wrap.appendChild(t);
  // Chart
  const ctx = document.getElementById('histChart').getContext('2d');
  if(chart) chart.destroy();
  chart = new Chart(ctx, { type:'line', data:{ labels: months, datasets:[{ label:'Начисления (без фикс.)', data: months.map(m=> byMonth[m].total) }] }, options:{ responsive:true, maintainAspectRatio:false } });
}

// ---- UI: Tariffs ----
function renderTariffs(){
  // table
  renderTariffTable();
  // form
  tarService.innerHTML = services.data.map(s=> `<option value="${s.id}">${s.name}</option>`).join('');
  tarHasEnd.onchange = (e)=> tarEnd.disabled = !e.target.checked;
  addTariff.onclick = async ()=>{
    const sid = tarService.value; const price = parseFloat(tarPrice.value||'0'); const start = tarStart.value; const end = tarHasEnd.checked ? tarEnd.value : '';
    if(!sid || !start) return;
    const row = { id: String(nextId(tariffs.data)), service_id: String(sid), price: String(price), start_date: start, end_date: end };
    const newRows = [...tariffs.data, row];
    await ghPut(`${S.datadir}/tariffs.csv`, toCSV(tariffs.headers, newRows), `Add tariff service=${sid} from ${start}`);
    tariffs.data = newRows; renderTariffTable();
  };
}
function renderTariffTable(){
  const wrap = document.getElementById('tarTable'); const t=document.createElement('table');
  const thead=document.createElement('thead'); const trh=document.createElement('tr'); ['service_id','price','start_date','end_date'].forEach(h=>{ const th=document.createElement('th'); th.textContent=h; trh.appendChild(th); }); thead.appendChild(trh); t.appendChild(thead);
  const tb=document.createElement('tbody'); tariffs.data.slice().sort((a,b)=> (a.service_id===b.service_id? b.start_date.localeCompare(a.start_date) : a.service_id.localeCompare(b.service_id))).forEach(r=>{
    const tr=document.createElement('tr'); ['service_id','price','start_date','end_date'].forEach(h=>{ const td=document.createElement('td'); td.textContent=r[h]||''; tr.appendChild(td); }); tb.appendChild(tr);
  }); t.appendChild(tb); wrap.innerHTML=''; wrap.appendChild(t);
}

// ---- Tabs ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => { document.querySelectorAll('.tab').forEach(s => s.hidden = true); document.getElementById(btn.dataset.tab).hidden = false; });
});

// ---- Boot ----
initSettingsForm(); reloadAll();