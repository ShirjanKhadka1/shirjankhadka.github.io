"use strict";
/* Vimshottari Dasha - Five levels.
 * Based on Moon's sidereal longitude (nakshatra).
 * All calculations client-side.
 */

const DASHA_LORDS = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
const DASHA_YEARS = {Ketu:7, Venus:20, Sun:6, Moon:10, Mars:7, Rahu:18, Jupiter:16, Saturn:19, Mercury:17};
const NAKSHATRA_LORDS = [
// Ashwini(0) to Revati(26)
'Ketu','Venus','Sun','Moon','Mars','Rahu','Jupiter','Saturn','Mercury', // 0-8
'Ketu','Venus','Sun','Moon','Mars','Rahu','Jupiter','Saturn','Mercury', // 9-17
'Ketu','Venus','Sun','Moon','Mars','Rahu','Jupiter','Saturn','Mercury'  // 18-26
];

function nakshatraFromMoon(moonLong) {
  const idx = Math.floor(moonLong / (360.0/27.0)) % 27;
  const pada = Math.floor((moonLong % (360.0/27.0)) / (360.0/108.0)) + 1;
  return {index: idx, lord: NAKSHATRA_LORDS[idx], pada: pada};
}

function vimshottariBalance(moonLong, birthJD) {
  // Returns {lord, balanceYears} - balance of dasha at birth
  const nak = nakshatraFromMoon(moonLong);
  const nakLen = 360.0/27.0;
  const traversed = moonLong % nakLen;
  const remaining = nakLen - traversed;
  const fraction = remaining / nakLen;
  const balanceYears = fraction * DASHA_YEARS[nak.lord];
  return {lord: nak.lord, balanceYears: balanceYears, nakshatra: nak.index, pada: nak.pada};
}

// Julian Day to Date (for dasha boundaries)
function jdToDate(jd) {
  // Convert JD to calendar date
  let z = Math.floor(jd + 0.5);
  let f = (jd + 0.5) - z;
  let a = z;
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25)/36524.25);
    a = z + 1 + alpha - Math.floor(alpha/4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1)/365.25);
  const d = Math.floor(365.25*c);
  const e = Math.floor((b - d)/30.6001);
  const day = b - d - Math.floor(30.6001*e) + f;
  const month = (e < 14) ? e - 1 : e - 13;
  const year = (month > 2) ? c - 4716 : c - 4715;
  return {year: year, month: month, day: Math.floor(day)};
}

function dateToJD(y, m, d) {
  // Gregorian calendar
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y/100);
  const b = 2 - a + Math.floor(a/4);
  return Math.floor(365.25*(y+4716)) + Math.floor(30.6001*(m+1)) + d + b - 1524.5;
}

function formatDate(jd) {
  const dt = jdToDate(jd);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dt.day} ${months[dt.month-1]} ${dt.year}`;
}

// Generate Mahadasha sequence from birth
function vimshottariMahadashas(moonLong, birthJD) {
  const bal = vimshottariBalance(moonLong, birthJD);
  const startIdx = DASHA_LORDS.indexOf(bal.lord);
  const result = [];
  let currentJD = birthJD;
  // First (balance) dasha
  result.push({
    lord: bal.lord,
    startJD: currentJD,
    endJD: currentJD + bal.balanceYears * 365.25,
    years: bal.balanceYears
  });
  currentJD = result[0].endJD;
  // Subsequent dashas (full cycles)
  for (let i = 1; i < 9; i++) {
    const lord = DASHA_LORDS[(startIdx + i) % 9];
    const years = DASHA_YEARS[lord];
    result.push({
      lord: lord,
      startJD: currentJD,
      endJD: currentJD + years * 365.25,
      years: years
    });
    currentJD = result[result.length-1].endJD;
  }
  return result;
}

// Antardashas within a Mahadasha
function vimshottariAntardashas(mahaLord, mahaStartJD, mahaYears) {
  const startIdx = DASHA_LORDS.indexOf(mahaLord);
  const result = [];
  let currentJD = mahaStartJD;
  const totalYears = DASHA_YEARS[mahaLord];
  for (let i = 0; i < 9; i++) {
    const lord = DASHA_LORDS[(startIdx + i) % 9];
    const years = (DASHA_YEARS[lord] / 120.0) * mahaYears;
    // For balance maha, scale proportionally
    const actualYears = (mahaYears / totalYears) * (DASHA_YEARS[lord] / 120.0) * totalYears;
    // Simpler: proportional to mahaYears
    const antYears = (DASHA_YEARS[lord] / 120.0) * mahaYears;
    result.push({
      lord: lord,
      startJD: currentJD,
      endJD: currentJD + antYears * 365.25,
      years: antYears
    });
    currentJD = result[result.length-1].endJD;
  }
  return result;
}
