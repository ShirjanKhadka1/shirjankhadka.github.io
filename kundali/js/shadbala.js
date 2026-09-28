"use strict";
/* Shadbala - sixfold planetary strength (BPHS Shadbala chapter; Phaladeepika Ch.4).
 *
 * Scope: the seven classical planets (Sun..Saturn). Rahu/Ketu get no Shadbala
 * (standard; stated, not computed).
 * Unit: virupa (60 virupas = 1 rupa). Totals compared against classical minima.
 *
 * Method notes (documented choices, per research spec):
 * - Saptavargaja uses the BPHS 45/30/20/15/10/4/2 scheme with Panchadha Maitri
 *   (natural + temporal relationship) evaluated PER VARGA: the temporal part uses
 *   the planet's and the varga lord's signs in that same varga (documented
 *   choice; some software uses D1 positions instead). Moolatrikona 45 applies in
 *   Rashi (D1) only; exaltation in a varga scores 30 (same as own) - the
 *   classical table is silent on exaltation, so this is a documented,
 *   conservative choice.
 * - Retrograde is detected by net motion over the previous 5 days (engine
 *   longitudes) and reported as a boolean flag; it does not change Chesta bala,
 *   which follows the seeghra-kendra formula.
 * - Bhava madhya for Digbala = equal houses from lagna sphuta (spec 1.4).
 * - Natonnata uses a triangular day/night model peaking at midday/midnight
 *   (standard software reading of BPHS).
 * - Paksha bala: benefics peak at full moon, malefics at new moon; the other
 *   group scores 0 for this component (spec 3.3b).
 * - Moon's Chesta bala = its Paksha bala (common software convention, flagged).
 * - Abdadi lords (Varsha/Masa) use operational definitions: most recent sidereal
 *   solar sankranti for Masa, Mesha sankranti of the birth year for Varsha.
 * - Ayana bala uses sin(delta) = sin(eps) * sin(tropical longitude) (latitude
 *   omitted - documented simplification); Sun's result doubled per tradition.
 * - Yuddha (planetary war) is detected and reported qualitatively only.
 * - Rahu/Ketu cast no graha drishti here (standard BPHS: drishti belongs to the
 *   seven grahas); they are listed as malefics only for completeness.
 *
 * API: computeShadbala(planets, jd, lat, lon)
 *   planets: result of computeKundali() -> {ascendant, sun, moon, ...}
 *   jd, lat, lon: birth Julian Day (UTC), latitude, longitude East (optional but
 *     recommended; without them the time-dependent Kala components are skipped
 *     and flagged in result.meta.kalaPartial).
 * Returns per-planet {totalRupas, totalVirupas, minimum, minimumRupas, ratio,
 *   strong (boolean), retrograde (boolean), strength,
 *   breakdown:{sthana, dig, kala, chesta, naisargika, drik}} plus notes[].
 */

(function () {

var PLANETS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];
var PNAME = {sun: 'Sun', moon: 'Moon', mars: 'Mars', mercury: 'Mercury',
             jupiter: 'Jupiter', venus: 'Venus', saturn: 'Saturn'};

// Classical minimum totals in virupas (below minimum = weak)
var MINIMA = {sun: 390, moon: 360, mars: 300, mercury: 420,
              jupiter: 390, venus: 330, saturn: 300};

var SIGN_LORD = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury',
                 'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];

var EXALTED = {sun: 0, moon: 1, mars: 9, mercury: 5, jupiter: 3, venus: 11, saturn: 6};
var DEBILIT = {sun: 6, moon: 7, mars: 3, mercury: 11, jupiter: 9, venus: 5, saturn: 0};
// Deepest debilitation points (degrees, sidereal) - for Uchcha bala
var DEBIL_PT = {sun: 190, moon: 213, mars: 118, mercury: 345,
                jupiter: 275, venus: 177, saturn: 20};
// Moolatrikona degree ranges in D1: [sign, fromDeg, toDeg]
var MT_RANGE = {sun: [4, 0, 20], moon: [1, 3, 30], mars: [0, 0, 12],
                mercury: [5, 15, 20], jupiter: [8, 0, 10],
                venus: [6, 0, 15], saturn: [10, 0, 20]};
var OWN_SIGNS = {sun: [4], moon: [3], mars: [0, 7], mercury: [2, 5],
                 jupiter: [8, 11], venus: [1, 6], saturn: [9, 10]};

// Natural (naisargika) relationships
var NATURAL = {
  sun:     {friend: ['moon', 'mars', 'jupiter'], enemy: ['venus', 'saturn'], neutral: ['mercury']},
  moon:    {friend: ['sun', 'mercury'], enemy: [], neutral: ['mars', 'jupiter', 'venus', 'saturn']},
  mars:    {friend: ['sun', 'moon', 'jupiter'], enemy: ['mercury'], neutral: ['venus', 'saturn']},
  mercury: {friend: ['sun', 'venus'], enemy: ['moon'], neutral: ['mars', 'jupiter', 'saturn']},
  jupiter: {friend: ['sun', 'moon', 'mars'], enemy: ['mercury', 'venus'], neutral: ['saturn']},
  venus:   {friend: ['mercury', 'saturn'], enemy: ['sun', 'moon'], neutral: ['mars', 'jupiter']},
  saturn:  {friend: ['mercury', 'venus'], enemy: ['sun', 'moon', 'mars'], neutral: ['jupiter']}
};

var NAISARGIKA = {sun: 60, moon: 51.43, venus: 42.86, jupiter: 34.29,
                  mercury: 25.71, mars: 17.14, saturn: 8.57};

// Digbala strong houses (1-based)
var DIG_HOUSE = {sun: 10, mars: 10, mercury: 1, jupiter: 1, moon: 4, venus: 4, saturn: 7};

// Chaldean order for hora lords
var CHALDEAN = ['saturn', 'jupiter', 'mars', 'sun', 'venus', 'mercury', 'moon'];
var WEEKDAY_LORDS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

/* ---------- small helpers ---------- */
function norm360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
function signOf(lon) { return Math.floor(norm360(lon) / 30) % 12; }
// folded angular distance 0..180
function angDist(a, b) {
  var d = Math.abs(norm360(a) - norm360(b)) % 360;
  return d > 180 ? 360 - d : d;
}
function ayan(jd) {
  var T = (jd - 2451545.0) / 36525.0;
  if (typeof lahiriAyanamsha !== 'undefined') return lahiriAyanamsha(T);
  return 23.857092;
}
// tropical longitude from sidereal (engine defines sidereal = tropical - ayanamsha)
function tropical(sidLon, jd) { return norm360(sidLon + ayan(jd)); }

/* planet longitude at a JD via engine globals */
var ENG_NAME = {sun: 'sun', moon: 'moon', mars: 'mar', mercury: 'mer',
                jupiter: 'jup', venus: 'ven', saturn: 'sat'};
function planetLonAt(p, jd) {
  if (p === 'sun' && typeof sunSidereal !== 'undefined') return sunSidereal(jd);
  if (p === 'moon' && typeof moonSiderealLongitude !== 'undefined') return moonSiderealLongitude(jd);
  if (typeof planetSidereal !== 'undefined') return planetSidereal(ENG_NAME[p], jd);
  return NaN;
}
function isRetrograde(p, jd) {
  if (p === 'sun' || p === 'moon') return false;
  if (typeof jd !== 'number') return false;
  var now = planetLonAt(p, jd), then = planetLonAt(p, jd - 5);
  if (!(now >= 0) || !(then >= 0)) return false;
  var d = norm360(now - then); // net motion over the previous 5 days
  return d > 180; // net backward motion = retrograde
}

/* ---------- sunrise / sunset (NOAA-style, Meeus) ---------- */
function sunriseSunset(jd0, lat, lon) {
  // jd0: JD at 0h UTC of the date. Returns {sunrise, sunset} as JD (UTC), or null.
  var n = jd0 - 2451545.0 + 0.0008;
  var L = norm360(280.460 + 0.9856474 * n);
  var g = norm360(357.528 + 0.9856003 * n) * Math.PI / 180;
  var lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180;
  var eps = 23.4392911 * Math.PI / 180;
  var dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  var latR = lat * Math.PI / 180;
  // hour angle for sunrise/sunset, zenith 90.833 deg
  var cosH = (Math.cos(90.833 * Math.PI / 180) - Math.sin(latR) * Math.sin(dec)) /
             (Math.cos(latR) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null; // polar day/night
  var H = Math.acos(cosH) * 180 / Math.PI / 15; // hours
  var lngH = lon / 15;
  // equation of time (minutes), standard approximation
  var B = (360 / 365 * (n - 81)) * Math.PI / 180;
  var eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  var jdNoon = jd0 + (12 - lngH - eot / 60) / 24; // solar noon as JD (UTC)
  return {sunrise: jdNoon - H / 24, sunset: jdNoon + H / 24};
}

/* ---------- Panchadha Maitri ---------- */
function naturalRel(p, q) {
  if (p === q) return 'friend';
  var r = NATURAL[p];
  if (r.friend.indexOf(q) >= 0) return 'friend';
  if (r.enemy.indexOf(q) >= 0) return 'enemy';
  return 'neutral';
}
function temporalRel(pSign, qSign) {
  var h = ((qSign - pSign) % 12 + 12) % 12 + 1;
  return (h === 2 || h === 3 || h === 4 || h === 10 || h === 11 || h === 12) ? 'friend' : 'enemy';
}
function panchadha(p, q, pSign, qSign) {
  var nat = naturalRel(p, q), tmp = temporalRel(pSign, qSign);
  if (nat === 'friend' && tmp === 'friend') return 'intimate';
  if (nat === 'friend' && tmp === 'enemy') return 'neutral';
  if (nat === 'neutral' && tmp === 'friend') return 'friend';
  if (nat === 'neutral' && tmp === 'enemy') return 'enemy';
  if (nat === 'enemy' && tmp === 'friend') return 'neutral';
  return 'bitter'; // enemy + enemy
}
var PANCHADHA_SCORE = {intimate: 20, friend: 15, neutral: 10, enemy: 4, bitter: 2};

/* ---------- Sthana bala ---------- */
function uchchaBala(p, lon) {
  var d = angDist(lon, DEBIL_PT[p]);
  return d / 3; // 0..60
}
function vargaSign(p, lon, varga) {
  try {
    if (typeof Vargas !== 'undefined' && Vargas.vargaChart)
      return Vargas.vargaChart(lon, varga).sign;
  } catch (e) {}
  return signOf(lon);
}
function inMT(p, lon) {
  var r = MT_RANGE[p], s = signOf(lon), deg = norm360(lon) % 30;
  return s === r[0] && deg >= r[1] && deg <= r[2];
}
function saptavargajaBala(p, lon, planets) {
  // Panchadha Maitri is evaluated PER VARGA: the temporal (tatkalika) component
  // uses P's sign and the varga lord's sign in the same varga V. (Documented
  // choice: some software instead uses D1 positions for the temporal part.)
  var vargas = ['D1', 'D2', 'D3', 'D7', 'D9', 'D12', 'D30'];
  var total = 0, detail = [];
  for (var i = 0; i < vargas.length; i++) {
    var v = vargas[i], vs = vargaSign(p, lon, v), lord = SIGN_LORD[vs], score;
    if (v === 'D1' && inMT(p, lon)) score = 45;
    else if (vs === DEBILIT[p]) score = 0;
    else if (vs === EXALTED[p]) score = 30; // documented choice
    else if (OWN_SIGNS[p].indexOf(vs) >= 0) score = 30;
    else {
      var lordVSign = vargaSign(lord, planets[lord], v);
      var rel = panchadha(p, lord, vs, lordVSign);
      score = PANCHADHA_SCORE[rel];
    }
    total += score;
    detail.push(v + ':' + score);
  }
  return {total: total, detail: detail.join(' ')};
}
function ojhayugmaBala(p, lon) {
  var female = (p === 'moon' || p === 'venus');
  var d1odd = signOf(lon) % 2 === 0; // Aries=0 odd sign
  var d9odd = vargaSign(p, lon, 'D9') % 2 === 0;
  var s = 0;
  if (female) { if (!d1odd) s += 15; if (!d9odd) s += 15; }
  else { if (d1odd) s += 15; if (d9odd) s += 15; }
  return s;
}
function kendradiBala(p, lon, ascSign) {
  var h = ((signOf(lon) - ascSign) % 12 + 12) % 12 + 1;
  if (h === 1 || h === 4 || h === 7 || h === 10) return 60;
  if (h === 2 || h === 5 || h === 8 || h === 11) return 30;
  return 15;
}
function drekkanaBala(p, lon) {
  var dk = Math.floor((norm360(lon) % 30) / 10); // 0,1,2
  var male = (p === 'sun' || p === 'mars' || p === 'jupiter');
  var neuter = (p === 'mercury' || p === 'saturn');
  if (dk === 0 && male) return 15;
  if (dk === 1 && neuter) return 15;
  if (dk === 2 && !male && !neuter) return 15;
  return 0;
}
function sthanaBala(p, lon, ascSign, planets) {
  var u = uchchaBala(p, lon);
  var sv = saptavargajaBala(p, lon, planets);
  var oj = ojhayugmaBala(p, lon);
  var ke = kendradiBala(p, lon, ascSign);
  var dr = drekkanaBala(p, lon);
  return {total: u + sv.total + oj + ke + dr,
          uchcha: u, saptavargaja: sv.total, saptavargajaDetail: sv.detail,
          ojhayugma: oj, kendradi: ke, drekkana: dr};
}

/* ---------- Digbala ---------- */
function digBala(p, lon, ascendant) {
  var S = norm360(ascendant + 30 * (DIG_HOUSE[p] - 1));
  var d = angDist(lon, S);
  var v = (180 - d) / 3;
  return Math.max(0, Math.min(60, v));
}

/* ---------- Kala bala ---------- */
function weekdayOf(jd) {
  return Math.floor(jd + 1.5) % 7; // 0=Sunday..6=Saturday
}
function natonnataBala(p, jd, lat, lon, ss) {
  if (p === 'mercury') return 60;
  if (!ss) return 0;
  var dayLen = (ss.sunset - ss.sunrise) * 24; // hours
  var nightLen = 24 - dayLen;
  var tH = (jd - ss.sunrise) * 24; // hours since sunrise
  var dayGroup = (p === 'sun' || p === 'jupiter' || p === 'venus');
  var isDay = tH >= 0 && tH <= dayLen;
  if (dayGroup) {
    if (!isDay) return 0;
    var g = tH, half = dayLen / 2;
    return 60 * (g <= half ? g / half : (dayLen - g) / half);
  } else {
    if (isDay) return 0;
    var tn = tH < 0 ? tH + 24 : tH - dayLen; // hours since sunset
    var hn = nightLen / 2;
    return 60 * (tn <= hn ? tn / hn : (nightLen - tn) / hn);
  }
}
function pakshaBala(p, sunLon, moonLon) {
  var e = norm360(moonLon - sunLon); // 0=new, 180=full
  var fromFull = Math.abs(180 - e); // 0 at full, 180 at new
  var benefic = (p === 'moon' || p === 'mercury' || p === 'jupiter' || p === 'venus');
  if (benefic) return (180 - fromFull) / 3;
  return fromFull / 3; // malefics peak at new moon
}
function tribhagaBala(p, jd, ss) {
  if (p === 'jupiter') return 60;
  if (!ss) return 0;
  var dayLen = (ss.sunset - ss.sunrise) * 24;
  var tH = (jd - ss.sunrise) * 24;
  var isDay = tH >= 0 && tH <= dayLen;
  var third;
  if (isDay) {
    third = Math.min(2, Math.floor(tH / (dayLen / 3)));
    var dayLords = ['mercury', 'sun', 'saturn'];
    return dayLords[third] === p ? 60 : 0;
  }
  var tn = tH < 0 ? tH + 24 : tH - dayLen;
  var nightLen = 24 - dayLen;
  third = Math.min(2, Math.floor(tn / (nightLen / 3)));
  var nightLords = ['moon', 'venus', 'mars'];
  return nightLords[third] === p ? 60 : 0;
}
function horaLord(jd, lat, lon, ss) {
  if (!ss) return null;
  var wd = WEEKDAY_LORDS[weekdayOf(jd)];
  var startIdx = CHALDEAN.indexOf(wd);
  var dayLen = (ss.sunset - ss.sunrise) * 24;
  var tH = (jd - ss.sunrise) * 24;
  var h;
  if (tH >= 0 && tH <= dayLen) h = Math.min(11, Math.floor(tH / (dayLen / 12)));
  else {
    var tn = tH < 0 ? tH + 24 : tH - dayLen;
    h = 12 + Math.min(11, Math.floor(tn / ((24 - dayLen) / 12)));
  }
  return CHALDEAN[(startIdx + h) % 7];
}
// most recent sidereal solar ingress (sankranti) at or before jd; returns JD or null
function prevSankranti(jd, wantMesha) {
  if (typeof sunSidereal === 'undefined') return null;
  function sSign(j) { return signOf(sunSidereal(j)); }
  if (wantMesha) {
    // seed near April 14 of the relevant year
    var d = new Date((jd - 2440587.5) * 86400000);
    var yr = d.getUTCFullYear();
    var seed;
    if (d.getUTCMonth() < 3) yr -= 1; // Jan-Mar: Mesha sankranti was last April
    seed = Date.UTC(yr, 3, 14, 12, 0, 0) / 86400000 + 2440587.5;
    var j = seed, guard = 0;
    while (sSign(j) !== 0 && guard++ < 10) j -= 1;
    guard = 0;
    while (sSign(j - 1) === 0 && guard++ < 10) j -= 1; // step back to ingress day
    return j;
  }
  var j2 = Math.floor(jd), guard2 = 0, s0 = sSign(jd);
  while (sSign(j2) === s0 && guard2++ < 35) j2 -= 1;
  return j2 + 1;
}
function abdadiBala(p, jd, lat, lon, ss) {
  var parts = {varsha: 0, masa: 0, dina: 0, hora: 0};
  if (typeof jd !== 'number') return {total: 0, parts: parts};
  var dinaLord = WEEKDAY_LORDS[weekdayOf(jd)];
  if (dinaLord === p) parts.dina = 45;
  var hl = horaLord(jd, lat, lon, ss);
  if (hl === p) parts.hora = 60;
  var sank = prevSankranti(jd, false);
  if (sank !== null) {
    var masaLord = WEEKDAY_LORDS[weekdayOf(sank)];
    if (masaLord === p) parts.masa = 30;
  }
  var mesha = prevSankranti(jd, true);
  if (mesha !== null) {
    var varshaLord = WEEKDAY_LORDS[weekdayOf(mesha)];
    if (varshaLord === p) parts.varsha = 15;
  }
  parts.total = parts.varsha + parts.masa + parts.dina + parts.hora;
  return parts;
}
function ayanaBala(p, sidLon, jd) {
  var eps = (23.4392911 - 0.0130042 * ((jd - 2451545.0) / 36525.0)) * Math.PI / 180;
  var lamT = tropical(sidLon, jd) * Math.PI / 180;
  var delta = Math.asin(Math.sin(eps) * Math.sin(lamT)) * 180 / Math.PI;
  var v;
  if (p === 'sun' || p === 'mars' || p === 'jupiter' || p === 'venus') v = (24 + delta) * 60 / 48;
  else if (p === 'moon' || p === 'saturn') v = (24 - delta) * 60 / 48;
  else v = (24 + Math.abs(delta)) * 60 / 48; // mercury
  if (p === 'sun') v *= 2; // traditional doubling
  return v;
}
function kalaBala(p, planets, jd, lat, lon, ss, paksha) {
  var nat = (typeof jd === 'number' && ss) ? natonnataBala(p, jd, lat, lon, ss) : 0;
  var tri = (typeof jd === 'number' && ss) ? tribhagaBala(p, jd, ss) : 0;
  var abd = abdadiBala(p, jd, lat, lon, ss);
  var aya = (typeof jd === 'number') ? ayanaBala(p, planets[p], jd) : 0;
  var total = nat + paksha + tri + abd.total + aya;
  return {total: total, natonnata: nat, paksha: paksha, tribhaga: tri,
          abdadi: abd, ayana: aya};
}

/* ---------- Chesta bala ---------- */
function meanSunLon(jd) {
  var T = (jd - 2451545.0) / 36525.0;
  return norm360(280.46061837 + 36000.770053608 * T);
}
function chestaBala(p, sidLon, jd, paksha) {
  if (p === 'moon') return paksha; // conventional choice, flagged
  if (p === 'sun') {
    if (typeof jd !== 'number') return 30;
    var c = norm360(tropical(sidLon, jd) + 90);
    if (c > 180) c = 360 - c;
    return c / 3;
  }
  if (typeof jd !== 'number') return 30;
  var k = norm360(sidLon - meanSunLon(jd));
  if (k > 180) k = 360 - k;
  return k / 3;
}

/* ---------- Drik bala ---------- */
var SPECIAL_ASPECTS = {mars: [4, 8], jupiter: [5, 9], saturn: [3, 10]};
function isBenefic(p, moonWaxing) {
  if (p === 'jupiter' || p === 'venus' || p === 'mercury') return true;
  if (p === 'moon') return moonWaxing;
  return false;
}
function drikBala(p, planets, moonWaxing) {
  var ben = 0, mal = 0;
  for (var i = 0; i < PLANETS.length; i++) {
    var a = PLANETS[i];
    if (a === p) continue;
    var houses = [7].concat(SPECIAL_ASPECTS[a] || []);
    for (var k = 0; k < houses.length; k++) {
      var point = norm360(planets[a] + 30 * (houses[k] - 1));
      var orb = angDist(planets[p], point);
      if (orb <= 15) {
        var val = 60 * (1 - orb / 15);
        if (isBenefic(a, moonWaxing)) ben += val; else mal += val;
      }
    }
  }
  return (ben - mal) / 4;
}

/* ---------- main ---------- */
function computeShadbala(planets, jd, lat, lon) {
  var notes = [];
  var hasTime = (typeof jd === 'number');
  var hasPlace = (typeof lat === 'number' && typeof lon === 'number');
  var ss = (hasTime && hasPlace) ? sunriseSunset(Math.floor(jd - 0.5) + 0.5, lat, lon) : null;
  if (hasTime && hasPlace && !ss) notes.push('Polar day/night at this location and date; day-night based balas set to 0.');

  var ascSign = signOf(planets.ascendant);

  var e = norm360(planets.moon - planets.sun);
  var moonWaxing = e < 180;

  // Yuddha detection (qualitative)
  var warriors = ['mars', 'mercury', 'jupiter', 'venus', 'saturn'];
  var yuddhaPairs = [];
  for (var a = 0; a < warriors.length; a++) for (var b = a + 1; b < warriors.length; b++) {
    if (angDist(planets[warriors[a]], planets[warriors[b]]) <= 1)
      yuddhaPairs.push(PNAME[warriors[a]] + ' and ' + PNAME[warriors[b]]);
  }
  if (yuddhaPairs.length)
    notes.push('Planetary war (Graha Yuddha) detected between ' + yuddhaPairs.join('; ') +
      ' - classical texts treat the brighter, more northerly planet as victor and read it as a contest signature. Not added to the numeric total.');

  var out = {notes: notes, meta: {kalaPartial: !(hasTime && hasPlace)}};
  for (var n = 0; n < PLANETS.length; n++) {
    var p = PLANETS[n], lon = planets[p];
    var st = sthanaBala(p, lon, ascSign, planets);
    var dg = digBala(p, lon, planets.ascendant);
    var pk = pakshaBala(p, planets.sun, planets.moon);
    var ka = kalaBala(p, planets, jd, lat, lon, ss, pk);
    var ch = chestaBala(p, lon, jd, pk);
    var na = NAISARGIKA[p];
    var dr = drikBala(p, planets, moonWaxing);
    var totalV = st.total + dg + ka.total + ch + na + dr;
    var min = MINIMA[p], ratio = totalV / min;
    out[p] = {
      totalVirupas: Math.round(totalV * 100) / 100,
      totalRupas: Math.round(totalV / 60 * 100) / 100,
      minimum: min,
      minimumRupas: Math.round(min / 60 * 100) / 100,
      ratio: Math.round(ratio * 100) / 100,
      strong: ratio >= 1,
      retrograde: isRetrograde(p, jd),
      strength: ratio >= 1 ? 'strong' : (ratio >= 0.8 ? 'average' : 'weak'),
      breakdown: {
        sthana: st, dig: Math.round(dg * 100) / 100, kala: ka,
        chesta: Math.round(ch * 100) / 100,
        naisargika: na, drik: Math.round(dr * 100) / 100
      }
    };
  }
  if (!hasTime) notes.push('No birth time supplied: Natonnata, Tribhaga, Hora and Ayana components are 0; totals are understated.');
  return out;
}

function shadbalaLine(p, r) {
  var b = r.breakdown;
  return PNAME[p] + ': ' + r.totalRupas + ' rupas against a minimum of ' + r.minimumRupas +
    ' (' + r.strength + '). Sthana ' + Math.round(b.sthana.total) +
    ', Dig ' + Math.round(b.dig) + ', Kala ' + Math.round(b.kala.total) +
    ', Chesta ' + Math.round(b.chesta) + ', Naisargika ' + b.naisargika +
    ', Drik ' + Math.round(b.drik) + ' virupas.';
}

/* expose */
var ShadbalaAPI = {computeShadbala: computeShadbala, shadbalaLine: shadbalaLine, MINIMA: MINIMA};
if (typeof window !== 'undefined') {
  window.computeShadbala = computeShadbala;
  window.ShadbalaAPI = ShadbalaAPI;
}
if (typeof module !== 'undefined' && module.exports) module.exports = ShadbalaAPI;

})();
