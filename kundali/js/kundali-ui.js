"use strict";
/* Kundali UI - Form handling, chart rendering, report generation.
 * All calculations client-side. No data transmitted.
 */

let currentKundali = null;
let currentChartVarga = 'D1';

const CHART_ABBREV = {sun:'Su', moon:'Mo', mars:'Ma', mercury:'Me', jupiter:'Ju', venus:'Ve', saturn:'Sa', rahu:'Ra', ketu:'Ke'};
const CHART_PLANET_KEYS = ['sun','moon','mars','mercury','jupiter','venus','saturn','rahu','ketu'];
const CHART_PLANET_NAMES = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn','Rahu','Ketu'];

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function initKundaliUI() {
  // Populate city dropdown
  const citySelect = document.getElementById('birthCity');
  if (citySelect && typeof CITIES !== 'undefined') {
    CITIES.forEach((c, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = c.name;
      citySelect.appendChild(opt);
    });
    citySelect.addEventListener('change', (e) => {
      const c = CITIES[parseInt(e.target.value, 10)];
      if (c) {
        document.getElementById('birthLat').value = c.lat;
        document.getElementById('birthLon').value = c.lon;
        if (typeof c.tz !== 'undefined') document.getElementById('tzOffset').value = c.tz;
      }
    });
  }

  // Main form submit
  const form = document.getElementById('kundaliForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      calculateKundali();
    });
  }

  // Print button
  const printBtn = document.getElementById('printBtn');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  // Varga switcher buttons
  document.querySelectorAll('.varga-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentChartVarga = btn.getAttribute('data-varga');
      document.querySelectorAll('.varga-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (currentKundali) renderChart(currentKundali.planets);
    });
  });

  // Matching form
  const matchBtn = document.getElementById('matchBtn');
  if (matchBtn) {
    matchBtn.addEventListener('click', (e) => {
      e.preventDefault();
      calculateMatching();
    });
  }
  const matchPrintBtn = document.getElementById('matchPrintBtn');
  if (matchPrintBtn) {
    matchPrintBtn.addEventListener('click', () => window.print());
  }
}

// JD from date/time/UTC-offset inputs. Same math as the verified getBirthJD.
function jdFromParts(dateStr, timeStr, tz) {
  const parts = dateStr.split('-').map(Number);
  const tparts = timeStr.split(':').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  const hh = tparts[0] || 0, mm = tparts[1] || 0;
  const utcHours = (hh + mm / 60.0) - tz;
  return dateToJD(y, m, d) + (utcHours / 24.0);
}

function getBirthJD() {
  const dateStr = document.getElementById('birthDate').value; // YYYY-MM-DD
  const timeStr = document.getElementById('birthTime').value; // HH:MM
  const tz = parseFloat(document.getElementById('tzOffset').value) || 5.75;
  return jdFromParts(dateStr, timeStr, tz);
}

function calculateKundali() {
  const name = document.getElementById('birthName').value || 'Seeker';
  const lat = parseFloat(document.getElementById('birthLat').value);
  const lon = parseFloat(document.getElementById('birthLon').value);

  if (isNaN(lat) || isNaN(lon)) {
    alert('Please enter valid latitude and longitude.');
    return;
  }

  const jd = getBirthJD();
  const planets = computeKundali(jd, lat, lon);

  currentKundali = {name, jd, lat, lon, planets};
  currentChartVarga = 'D1';
  document.querySelectorAll('.varga-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-varga') === 'D1'));
  displayResults(currentKundali);
  document.getElementById('results').style.display = 'block';
  document.getElementById('results').scrollIntoView({behavior: 'smooth'});
}

/* ---------------- North Indian chart ----------------
 * Square, both diagonals, and the mid-side diamond. 12 regions.
 * House 1 (Lagna) is the top diamond; houses run counterclockwise:
 * 1 top diamond, 2 top-left triangle, 3 left-top triangle, 4 left diamond,
 * 5 left-bottom triangle, 6 bottom-left triangle, 7 bottom diamond,
 * 8 bottom-right triangle, 9 right-bottom triangle, 10 right diamond,
 * 11 right-top triangle, 12 top-right triangle.
 * Opposite houses sit opposite each other (1-7, 2-8, 3-9, 4-10, 5-11, 6-12).
 */

// Per-house anchors as fractions of chart size: [numX, numY, planetsX, planetsY]
const HOUSE_ANCHORS = [
  null,
  [0.50, 0.075, 0.50, 0.32],  // 1 top diamond
  [0.155, 0.045, 0.27, 0.135], // 2 top-left triangle
  [0.045, 0.155, 0.135, 0.27], // 3 left-top triangle
  [0.075, 0.50, 0.31, 0.50],  // 4 left diamond
  [0.045, 0.845, 0.135, 0.73], // 5 left-bottom triangle
  [0.155, 0.955, 0.27, 0.865], // 6 bottom-left triangle
  [0.50, 0.925, 0.50, 0.68],  // 7 bottom diamond
  [0.845, 0.955, 0.73, 0.865], // 8 bottom-right triangle
  [0.955, 0.845, 0.865, 0.73], // 9 right-bottom triangle
  [0.925, 0.50, 0.69, 0.50],  // 10 right diamond
  [0.955, 0.155, 0.865, 0.27], // 11 right-top triangle
  [0.845, 0.045, 0.73, 0.135]  // 12 top-right triangle
];

function housePlacements(planets, varga) {
  // Returns {lagnaSign, houses: {1:[labels], ...}, signOfHouse: {1: signIdx}}
  let lagnaSign, signOf;
  if (varga === 'D1' || typeof Vargas === 'undefined') {
    lagnaSign = Math.floor(planets.ascendant / 30) % 12;
    signOf = (lon) => Math.floor(lon / 30) % 12;
  } else {
    lagnaSign = Vargas.vargaChart(planets.ascendant, varga).sign;
    signOf = (lon) => Vargas.vargaChart(lon, varga).sign;
  }
  const houses = {};
  const signOfHouse = {};
  for (let h = 1; h <= 12; h++) { houses[h] = []; signOfHouse[h] = (lagnaSign + h - 1) % 12; }
  houses[1].push('As');
  CHART_PLANET_KEYS.forEach((key) => {
    const s = signOf(planets[key]);
    const h = ((s - lagnaSign + 12) % 12) + 1;
    houses[h].push(CHART_ABBREV[key]);
  });
  return {lagnaSign, houses, signOfHouse};
}

function drawNorthIndianChart(planets, varga) {
  const S = 440;
  const T = S / 2; // half
  const Q = S / 4; // quarter
  const TQ = (3 * S) / 4;
  const pl = housePlacements(planets, varga);

  let svg = `<svg viewBox="0 0 ${S} ${S}" class="kundali-chart" role="img" aria-label="North Indian kundali chart">`;
  svg += `<rect x="2" y="2" width="${S-4}" height="${S-4}" fill="#fffdf7" stroke="#5a3a1a" stroke-width="3"/>`;
  // Diagonals
  svg += `<line x1="0" y1="0" x2="${S}" y2="${S}" stroke="#5a3a1a" stroke-width="1.5"/>`;
  svg += `<line x1="${S}" y1="0" x2="0" y2="${S}" stroke="#5a3a1a" stroke-width="1.5"/>`;
  // Mid-side diamond: T(top-mid) R(right-mid) B(bottom-mid) L(left-mid)
  svg += `<line x1="${T}" y1="0" x2="${S}" y2="${T}" stroke="#5a3a1a" stroke-width="1.5"/>`;
  svg += `<line x1="${S}" y1="${T}" x2="${T}" y2="${S}" stroke="#5a3a1a" stroke-width="1.5"/>`;
  svg += `<line x1="${T}" y1="${S}" x2="0" y2="${T}" stroke="#5a3a1a" stroke-width="1.5"/>`;
  svg += `<line x1="0" y1="${T}" x2="${T}" y2="0" stroke="#5a3a1a" stroke-width="1.5"/>`;

  for (let h = 1; h <= 12; h++) {
    const a = HOUSE_ANCHORS[h];
    const signNum = pl.signOfHouse[h] + 1; // 1-12, Aries = 1
    const nx = (a[0] * S).toFixed(1), ny = (a[1] * S).toFixed(1);
    const px = (a[2] * S).toFixed(1), py = (a[3] * S).toFixed(1);
    svg += `<text x="${nx}" y="${ny}" text-anchor="middle" font-size="12" fill="#8b4513" font-weight="bold">${signNum}</text>`;
    const labels = pl.houses[h];
    if (labels.length > 0) {
      const lines = [];
      for (let i = 0; i < labels.length; i += 3) lines.push(labels.slice(i, i + 3).join(' '));
      const startDy = -((lines.length - 1) * 7);
      let tspans = '';
      lines.forEach((ln, i) => {
        const dy = i === 0 ? startDy : 14;
        tspans += `<tspan x="${px}" dy="${dy}">${ln}</tspan>`;
      });
      svg += `<text x="${px}" y="${py}" text-anchor="middle" font-size="12.5" fill="#222">${tspans}</text>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

const VARGA_LABELS = {
  D1: 'Rashi Chart (D1): the main birth chart',
  D9: 'Navamsha Chart (D9): inner strength and marriage',
  D10: 'Dashamsha Chart (D10): career and profession'
};

function renderChart(planets) {
  const el = document.getElementById('d1Chart');
  if (!el) return;
  el.innerHTML = drawNorthIndianChart(planets, currentChartVarga) +
    `<p class="varga-label">${VARGA_LABELS[currentChartVarga] || ''}</p>`;
}

/* ---------------- Dasha: five levels ---------------- */

function dashaSubPeriods(lord, startJD, parentYears) {
  // Same proportional logic as vimshottariAntardashas: sub = parent * (years/120)
  const idx = DASHA_LORDS.indexOf(lord);
  const out = [];
  let cur = startJD;
  for (let i = 0; i < 9; i++) {
    const l = DASHA_LORDS[(idx + i) % 9];
    const yrs = (DASHA_YEARS[l] / 120) * parentYears;
    const days = yrs * 365.25;
    out.push({lord: l, startJD: cur, endJD: cur + days, years: yrs});
    cur += days;
  }
  return out;
}

function currentDashaChain(mahas, jd) {
  const chain = [];
  const m = mahas.find(x => jd >= x.startJD && jd < x.endJD);
  if (!m) return chain;
  chain.push({level: 'Mahadasha', lord: m.lord, startJD: m.startJD, endJD: m.endJD});
  const names = ['Antardasha', 'Pratyantardasha', 'Sookshmadasha', 'Pranadasha'];
  let subs = dashaSubPeriods(m.lord, m.startJD, m.years);
  for (let lv = 0; lv < 4; lv++) {
    const s = subs.find(x => jd >= x.startJD && jd < x.endJD);
    if (!s) break;
    chain.push({level: names[lv], lord: s.lord, startJD: s.startJD, endJD: s.endJD});
    subs = dashaSubPeriods(s.lord, s.startJD, s.years);
  }
  return chain;
}

function renderDashaSection(p, birthJD) {
  const mahas = vimshottariMahadashas(p.moon, birthJD);
  let html = '<h3>Vimshottari Mahadasha (full sequence)</h3>';
  html += '<table class="dasha-table"><tr><th>Dasha</th><th>Start</th><th>End</th></tr>';
  mahas.forEach(m => {
    html += `<tr><td>${m.lord}</td><td>${formatDate(m.startJD)}</td><td>${formatDate(m.endJD)}</td></tr>`;
  });
  html += '</table>';

  const nowJD = Date.now() / 86400000 + 2440587.5;
  const chain = currentDashaChain(mahas, nowJD);
  if (chain.length > 0) {
    html += '<h3>Running period right now (five levels)</h3>';
    html += '<table class="dasha-table chain-table"><tr><th>Level</th><th>Lord</th><th>From</th><th>To</th></tr>';
    chain.forEach(c => {
      html += `<tr><td>${c.level}</td><td><strong>${c.lord}</strong></td><td>${formatDate(c.startJD)}</td><td>${formatDate(c.endJD)}</td></tr>`;
    });
    html += '</table>';
    const top = chain[chain.length - 1];
    const interp = (typeof getDashaPortrait !== 'undefined') ? getDashaPortrait(top.lord) : getDashaInterp(top.lord);
    if (interp) html += `<p>${interp}</p>`;
  }
  return html;
}

/* ---------------- Main report ---------------- */

function displayResults(k) {
  const p = k.planets;

  // Planet table
  let html = '<table class="planet-table"><tr><th>Planet</th><th>Longitude</th><th>Sign</th><th>Nakshatra</th></tr>';
  CHART_PLANET_KEYS.forEach((key, i) => {
    const lon = p[key];
    const sign = SIGNS[Math.floor(lon / 30) % 12];
    const nakIdx = Math.floor(lon / (360 / 27)) % 27;
    const nak = NAKSHATRAS[nakIdx];
    html += `<tr><td>${CHART_PLANET_NAMES[i]}</td><td>${lon.toFixed(2)}&deg;</td><td>${sign}</td><td>${nak}</td></tr>`;
  });
  const ascSign = SIGNS[Math.floor(p.ascendant / 30) % 12];
  html += `<tr><td><strong>Ascendant</strong></td><td>${p.ascendant.toFixed(2)}&deg;</td><td>${ascSign}</td><td>-</td></tr>`;
  html += '</table>';
  document.getElementById('planetTable').innerHTML = html;

  // Chart with varga switcher
  renderChart(p);

  // Shadbala (depth module, defensive)
  const shadbalaEl = document.getElementById('shadbalaSection');
  if (shadbalaEl) {
    if (typeof computeShadbala !== 'undefined') {
      const sb = computeShadbala(p);
      let sh = '<h3>Shadbala (sixfold planetary strength)</h3>';
      sh += '<table class="planet-table"><tr><th>Planet</th><th>Total (rupas)</th><th>Required</th><th>Strength</th></tr>';
      CHART_PLANET_KEYS.slice(0, 7).forEach((key, i) => {
        const r = sb[key];
        if (!r) return;
        const strong = r.totalRupas >= r.minimum;
        sh += `<tr><td>${CHART_PLANET_NAMES[i]}</td><td>${r.totalRupas.toFixed(2)}</td><td>${r.minimum}</td><td>${strong ? 'Strong' : 'Weak'}</td></tr>`;
      });
      sh += '</table><p class="note">Strengths are measured in rupas against the classical minimum for each planet. A weak Shadbala suggests the planet needs support to express fully.</p>';
      shadbalaEl.innerHTML = sh;
      shadbalaEl.style.display = 'block';
    } else {
      shadbalaEl.style.display = 'none';
    }
  }

  // Ashtakavarga (depth module, defensive)
  const avEl = document.getElementById('ashtakavargaSection');
  if (avEl) {
    if (typeof computeAshtakavarga !== 'undefined') {
      const av = computeAshtakavarga(p);
      let ah = '<h3>Ashtakavarga (Sarvashtakavarga)</h3>';
      ah += '<p class="note">Bindus (auspicious points) per house counted from the ascendant. Houses with 28 or more bindus are traditionally considered strong.</p>';
      ah += '<table class="planet-table"><tr><th>House</th>' +
        [1,2,3,4,5,6,7,8,9,10,11,12].map(h => `<th>${h}</th>`).join('') + '</tr><tr><td><strong>Bindus</strong></td>' +
        av.sarva.map(b => `<td>${b}</td>`).join('') + '</tr></table>';
      avEl.innerHTML = ah;
      avEl.style.display = 'block';
    } else {
      avEl.style.display = 'none';
    }
  }

  // Dasha
  document.getElementById('dashaSection').innerHTML = renderDashaSection(p, k.jd);

  // Gochar outlook (depth module, defensive)
  const gocharEl = document.getElementById('gocharSection');
  if (gocharEl) {
    if (typeof gocharOutlook !== 'undefined') {
      const outlook = gocharOutlook(p);
      let gh = '<h3>Transit outlook (next 12 months)</h3><ul class="gochar-list">';
      outlook.forEach(m => { gh += `<li><strong>${esc(m.month)}</strong>: ${esc(m.text)}</li>`; });
      gh += '</ul>';
      gocharEl.innerHTML = gh;
      gocharEl.style.display = 'block';
    } else {
      gocharEl.style.display = 'none';
    }
  }

  // Interpretations
  let interpHtml = `<h3>Chart Overview</h3>`;
  interpHtml += `<p><strong>Name:</strong> ${esc(k.name)}</p>`;
  const lagnaPortrait = (typeof getLagnaPortrait !== 'undefined')
    ? getLagnaPortrait(Math.floor(p.ascendant / 30) % 12)
    : getLagnaInterp(p.ascendant);
  if (lagnaPortrait) interpHtml += `<p>${lagnaPortrait}</p>`;
  const moonNakIdx = Math.floor(p.moon / (360 / 27)) % 27;
  const moonPada = Math.floor((p.moon % (360 / 27)) / (360 / 108)) + 1;
  interpHtml += `<p><strong>Moon Nakshatra:</strong> ${NAKSHATRAS[moonNakIdx]} (Pada ${moonPada})</p>`;
  if (typeof getMoonNakshatraPortrait !== 'undefined') {
    const mnp = getMoonNakshatraPortrait(p.moon);
    if (mnp) interpHtml += `<p>${mnp}</p>`;
  }
  // Planet-in-house lines
  if (typeof getPlanetInHouse !== 'undefined') {
    const ascS = Math.floor(p.ascendant / 30) % 12;
    interpHtml += '<h3>Planets in houses</h3>';
    CHART_PLANET_KEYS.forEach((key, i) => {
      const house = ((Math.floor(p[key] / 30) % 12) - ascS + 12) % 12 + 1;
      const t = getPlanetInHouse(CHART_PLANET_NAMES[i], house);
      if (t) interpHtml += `<p><strong>${CHART_PLANET_NAMES[i]} in house ${house}:</strong> ${t}</p>`;
    });
  }
  // Remedies
  if (typeof getRemediesSection !== 'undefined') {
    const rem = getRemediesSection();
    if (rem) interpHtml += `<h3>Traditional remedies (belief, not prescription)</h3><p>${rem}</p>`;
  }
  // Q and A
  if (typeof getQASection !== 'undefined') {
    const qa = getQASection();
    if (qa) interpHtml += `<h3>Common questions</h3>${qa}`;
  }
  document.getElementById('interpSection').innerHTML = interpHtml;

  // Doshas (if module loaded)
  if (typeof analyzeDoshas !== 'undefined') {
    const doshas = analyzeDoshas(p);
    let doshaHtml = '<h3>Dosha Analysis</h3>';
    doshaHtml += '<p class="note">Each dosha is shown with its classical cancellations given equal weight. A dosha is an area for awareness, never a verdict on a person or relationship.</p>';
    for (const key of Object.keys(doshas)) {
      const d = doshas[key];
      doshaHtml += `<div class="dosha"><h4>${esc(key)}</h4>`;
      doshaHtml += `<p>Present: ${d.present ? 'Yes' : 'No'}</p>`;
      if (d.details) doshaHtml += `<p>${d.details}</p>`;
      if (d.cancellations && d.cancellations.length > 0) {
        doshaHtml += `<p><strong>Cancellations/Exceptions:</strong></p><ul>`;
        d.cancellations.forEach(c => doshaHtml += `<li>${c}</li>`);
        doshaHtml += `</ul>`;
      }
      doshaHtml += `</div>`;
    }
    document.getElementById('doshaSection').innerHTML = doshaHtml;
  }

  // Disclaimer
  document.getElementById('disclaimer').innerHTML = `<p class="disclaimer">${INTERP.disclaimer}</p><p class="privacy">Your birth details never leave your device. All calculations happen in your browser.</p>`;
}

/* ---------------- Marriage matching ---------------- */

function readPerson(prefix) {
  const g = (id) => document.getElementById(prefix + id);
  const name = g('Name').value || (prefix === 'p1' ? 'Person 1' : 'Person 2');
  const dateStr = g('Date').value;
  const timeStr = g('Time').value;
  const lat = parseFloat(g('Lat').value);
  const lon = parseFloat(g('Lon').value);
  const tz = parseFloat(g('Tz').value);
  if (!dateStr || !timeStr || isNaN(lat) || isNaN(lon) || isNaN(tz)) return null;
  const jd = jdFromParts(dateStr, timeStr, tz);
  const planets = computeKundali(jd, lat, lon);
  return {name, jd, lat, lon, tz, planets};
}

function mangalSummary(p) {
  if (typeof analyzeDoshas === 'undefined') return null;
  const m = analyzeDoshas(p).mangalDosha;
  return m;
}

function renderMangalCompare(name, p) {
  const m = mangalSummary(p);
  if (!m) return `<p>Mangal check unavailable.</p>`;
  let h = `<div class="dosha"><h4>${esc(name)}</h4>`;
  h += `<p>Mangal Dosha: <strong>${m.present ? 'Present' : 'Absent'}</strong>`;
  if (m.present) {
    const refs = [];
    if (m.fromLagna) refs.push('from the ascendant');
    if (m.fromMoon) refs.push('from the Moon');
    h += ` (${refs.join(' and ')})`;
    if (m.severity) h += `, assessed as ${m.severity}`;
  }
  h += `</p>`;
  if (m.present && m.cancellations && m.cancellations.length > 0) {
    h += `<p><strong>Classical cancellations that apply:</strong></p><ul>`;
    m.cancellations.forEach(c => h += `<li>${c}</li>`);
    h += `</ul>`;
  }
  h += `</div>`;
  return h;
}

function calculateMatching() {
  const out = document.getElementById('matchResults');
  const p1 = readPerson('p1');
  const p2 = readPerson('p2');
  if (!p1 || !p2) {
    out.innerHTML = '<p class="error">Please fill in complete birth details (date, time, latitude, longitude, UTC offset) for both people.</p>';
    return;
  }
  const roleSel = document.getElementById('p1Role');
  const p1IsBride = !roleSel || roleSel.value === 'bride';
  const bride = p1IsBride ? p1 : p2;
  const groom = p1IsBride ? p2 : p1;

  let html = `<h3>Guna Milan: ${esc(bride.name)} and ${esc(groom.name)}</h3>`;

  if (typeof window.gunaMilan === 'undefined' && typeof gunaMilan === 'undefined') {
    out.innerHTML = '<p class="error">Matching module not loaded. Please reload the page.</p>';
    return;
  }
  const gm = (typeof window.gunaMilan !== 'undefined') ? window.gunaMilan : gunaMilan;
  let result;
  try {
    result = gm(bride.planets.moon, groom.planets.moon);
  } catch (err) {
    out.innerHTML = '<p class="error">Could not compute the match. Please check the birth details.</p>';
    return;
  }

  const order = ['varna','vashya','tara','yoni','maitri','gana','bhakoota','nadi'];
  const titles = {varna:'Varna', vashya:'Vashya', tara:'Tara', yoni:'Yoni', maitri:'Graha Maitri', gana:'Gana', bhakoota:'Bhakoota', nadi:'Nadi'};
  html += '<table class="planet-table koota-table"><tr><th>Koota</th><th>Score</th><th>How it was judged</th></tr>';
  order.forEach(k => {
    html += `<tr><td><strong>${titles[k]}</strong></td><td>${result.scores[k]}/${result.max[k]}</td><td>${result.notes[k] || ''}</td></tr>`;
  });
  html += `</table>`;
  html += `<p class="verdict">Total: <strong>${result.total} / 36</strong>, verdict: ${esc(result.verdict)}</p>`;
  html += `<p class="note">${result.warning}</p>`;

  // Mangal comparison for both
  html += `<h3>Mangal Dosha check (both charts)</h3>`;
  html += renderMangalCompare(bride.name + ' (bride)', bride.planets);
  html += renderMangalCompare(groom.name + ' (groom)', groom.planets);
  const mb = mangalSummary(bride.planets), mg = mangalSummary(groom.planets);
  if (mb && mg) {
    if (mb.present && mg.present) {
      html += '<p class="note"><strong>Dosha Samya:</strong> both charts carry Mangal Dosha. Traditional astrology holds that the dosha is neutralized when both partners carry it, and the cancellations listed above still apply to each chart.</p>';
    } else if (mb.present || mg.present) {
      html += '<p class="note">Mangal Dosha appears in only one of the two charts. Review the cancellations listed for the affected chart, and consider the full charts and family counsel before drawing conclusions.</p>';
    } else {
      html += '<p class="note">Neither chart carries Mangal Dosha.</p>';
    }
  }

  html += `<div class="report-actions"><button id="matchPrintBtn2" class="btn-secondary">Print / Save PDF</button></div>`;
  out.innerHTML = html;
  const pb = document.getElementById('matchPrintBtn2');
  if (pb) pb.addEventListener('click', () => window.print());
  out.scrollIntoView({behavior: 'smooth'});
}

// Initialize on load
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initKundaliUI);
}
