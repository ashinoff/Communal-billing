// Patch: safer apartment dropdown + quick diagnostics
(function(){
  const origReloadAll = window.reloadAll;
  if (typeof origReloadAll === 'function') {
    window.reloadAll = async function(){
      try {
        await origReloadAll();
        // After data loaded, verify apartments select
        const calcSel = document.getElementById('calcApartment');
        const histSel = document.getElementById('histApartment');
        if (calcSel && (!calcSel.options || calcSel.options.length===0)) {
          calcSel.innerHTML = '<option value="">— Нет квартир (заполните data/apartments.csv) —</option>';
        }
        if (histSel && (!histSel.options || histSel.options.length===0)) {
          histSel.innerHTML = '<option value="">— Нет квартир —</option>';
        }
      } catch (e) {
        console.error('reloadAll failed:', e);
        alert('Ошибка загрузки данных из GitHub. Проверьте Owner/Repo/Token в настройках.');
      }
    }
  }
})();