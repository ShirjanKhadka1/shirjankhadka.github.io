/* Shared broker data helpers — P16: 5 separate broker pages */
(function(){
"use strict";
var BASE = '/nepse-brokers/data/';

function fmtN(n, d){ d = d===undefined?2:d; if(n==null||!isFinite(Number(n))) return '–';
  return Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtV(n){ if(n==null||!isFinite(Number(n))) return '–'; var a=Math.abs(Number(n));
  if(a>=1e7) return 'Rs '+(Number(n)/1e7).toFixed(2)+' Cr';
  if(a>=1e5) return 'Rs '+(Number(n)/1e5).toFixed(2)+' L';
  return 'Rs '+Math.round(Number(n)).toLocaleString('en-US'); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cls(v){ return v>0?'pos':(v<0?'neg':''); }

function loadMeta(){
  return fetch(BASE+'meta.json').then(function(r){return r.json()});
}
function loadBrokers(){
  return fetch(BASE+'brokers.json').then(function(r){return r.json()});
}
function loadPeriod(p, asof){
  var url;
  if (p === 'latest') url = BASE+'intraday.json';
  else if (p === 'asof') url = BASE+'daily/'+asof+'.json';
  else url = BASE+'periods/'+p+'.json';
  return fetch(url, { cache: 'no-store' }).then(function(r){
    if(!r.ok) {
      // FALLBACK: intraday.json only exists during market hours.
      // Fall back to 1D period data when it's missing (weekends/holidays).
      if (p === 'latest') return fetch(BASE+'periods/1D.json', { cache: 'no-store' })
        .then(function(r2){ if(!r2.ok) throw new Error('no-data'); return r2.json(); });
      throw new Error('no-data');
    }
    return r.json();
  });
}
function label(p, d, asof){
  if(p==='latest') return 'live today'+(d&&d.asof?' (as of '+String(d.asof).slice(11,16)+' UTC)':'');
  if(p==='asof') return asof;
  return d && d.from ? d.from+' → '+d.to+' ('+d.trading_days+' sessions)' : p;
}
/* Sortable table helper: headers with data-sort keys, click toggles asc/desc */
function makeSortable(table, getRows, renderRows){
  var state = { key: null, dir: 1 };
  table.querySelectorAll('th[data-sort]').forEach(function(th){
    th.style.cursor = 'pointer';
    th.addEventListener('click', function(){
      var k = th.getAttribute('data-sort');
      if(state.key === k){ state.dir *= -1; } else { state.key = k; state.dir = -1; }
      table.querySelectorAll('th[data-sort]').forEach(function(o){
        o.classList.remove('sorted-asc','sorted-desc');
        var ind = o.querySelector('.sort-ind'); if(ind) ind.remove();
      });
      th.classList.add(state.dir === 1 ? 'sorted-asc' : 'sorted-desc');
      var ind = document.createElement('span');
      ind.className = 'sort-ind';
      ind.textContent = state.dir === 1 ? ' ▲' : ' ▼';
      th.appendChild(ind);
      var rows = getRows().slice();
      rows.sort(function(a,b){
        var va = a[k], vb = b[k];
        if(typeof va === 'string') va = va.toLowerCase();
        if(typeof vb === 'string') vb = vb.toLowerCase();
        if(va < vb) return -1 * state.dir;
        if(va > vb) return 1 * state.dir;
        return 0;
      });
      renderRows(rows);
    });
  });
  return state;
}

window.BrokerCommon = {
  BASE: BASE, fmtN: fmtN, fmtV: fmtV, esc: esc, cls: cls,
  loadMeta: loadMeta, loadBrokers: loadBrokers, loadPeriod: loadPeriod,
  label: label, makeSortable: makeSortable
};
})();
