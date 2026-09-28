"use strict";
/* Ashtakavarga - Bhinnashtakavarga (BAV) and Sarvashtakavarga (SAV).
 * Source: BPHS Ashtakavarga chapter; standard Parasari tables (spec 6.1).
 *
 * For a planet P's ashtakavarga, each contributor C (Sun..Saturn + Lagna) gives
 * one bindu in each sign where P sits in the listed houses from C's sign.
 * Houses are whole-sign distances: house = ((Psign - Csign) mod 12) + 1.
 *
 * Rahu/Ketu are NOT contributors in the Parasari system (stated, not used).
 * Each planet's BAV row includes its Lagna contributor row (the published totals
 * 48/49/39/54/56/52/39 count 8 contributors). lagnaAV[s] records, per sign, in
 * how many of the 7 BAVs the Lagna contributes a bindu.
 * SAV total is always 337 (48+49+39+54+56+52+39) - used as a checksum in tests.
 *
 * API: computeAshtakavarga(planets) -> {bhinna:{sun:[12],...}, lagnaAV:[12], sarva:[12]}
 *   planets: result of computeKundali() -> sidereal longitudes + ascendant.
 */

(function () {

var PLANETS = ['sun', 'moon', 'mars', 'mercury', 'jupiter', 'venus', 'saturn'];

// BAV_TABLE[P][C] = houses (from C's sign) where P earns a bindu from C.
// Contributors order: sun, moon, mars, mercury, jupiter, venus, saturn, lagna.
var BAV_TABLE = {
  sun: {
    sun:     [1, 2, 4, 7, 8, 9, 10, 11],
    moon:    [3, 6, 10, 11],
    mars:    [1, 2, 4, 7, 8, 9, 10, 11],
    mercury: [3, 5, 6, 9, 10, 11, 12],
    jupiter: [5, 6, 9, 11],
    venus:   [6, 7, 12],
    saturn:  [1, 2, 4, 7, 8, 9, 10, 11],
    lagna:   [3, 4, 6, 10, 11, 12]
  },
  moon: {
    moon:    [1, 3, 6, 7, 10, 11],
    sun:     [3, 6, 7, 8, 10, 11],
    mars:    [2, 3, 5, 6, 9, 10, 11],
    mercury: [1, 3, 4, 5, 7, 8, 10, 11],
    jupiter: [1, 4, 7, 8, 10, 11, 12],
    venus:   [3, 4, 5, 7, 9, 10, 11],
    saturn:  [3, 5, 6, 11],
    lagna:   [3, 6, 10, 11]
  },
  mars: {
    mars:    [1, 2, 4, 7, 8, 10, 11],
    sun:     [3, 5, 6, 10, 11],
    moon:    [3, 6, 11],
    mercury: [3, 5, 6, 11],
    jupiter: [6, 10, 11, 12],
    venus:   [6, 8, 11, 12],
    saturn:  [1, 4, 7, 8, 9, 10, 11],
    lagna:   [1, 3, 6, 10, 11]   // corrected: published Mars AV total is 39 (7+5+3+4+4+4+7+5)
  },
  mercury: {
    mercury: [1, 3, 5, 6, 9, 10, 11, 12],
    sun:     [5, 6, 9, 11],
    moon:    [2, 4, 6, 8, 10, 11],
    mars:    [1, 2, 3, 4, 7, 8, 9, 10, 11],
    jupiter: [6, 8, 11, 12],
    venus:   [1, 2, 3, 4, 5, 8, 9, 11],
    saturn:  [1, 2, 4, 7, 8, 9, 10, 11],
    lagna:   [1, 2, 4, 6, 8, 10, 11]
  },
  jupiter: {
    jupiter: [1, 2, 3, 4, 7, 8, 10, 11],
    sun:     [1, 2, 3, 4, 7, 8, 9, 10, 11],
    moon:    [2, 5, 7, 9, 11],
    mars:    [1, 2, 4, 7, 8, 10, 11],
    mercury: [1, 2, 4, 5, 6, 9, 10, 11],
    venus:   [2, 5, 6, 9, 10, 11],
    saturn:  [3, 5, 6, 12],
    lagna:   [1, 2, 4, 5, 6, 7, 9, 10, 11]
  },
  venus: {
    venus:   [1, 2, 3, 4, 5, 8, 9, 11, 12],
    sun:     [8, 11, 12],
    moon:    [1, 2, 3, 4, 5, 8, 9, 11, 12],
    mars:    [3, 5, 6, 9, 11, 12],
    mercury: [3, 5, 6, 9, 11],
    jupiter: [5, 8, 9, 10, 11],
    saturn:  [3, 4, 5, 8, 9, 10, 11],
    lagna:   [1, 2, 3, 4, 5, 8, 9, 11]
  },
  saturn: {
    saturn:  [3, 5, 6, 11],
    sun:     [1, 2, 4, 7, 8, 10, 11],
    moon:    [3, 6, 11],
    mars:    [3, 5, 6, 10, 11, 12],
    mercury: [6, 8, 9, 10, 11, 12],
    jupiter: [5, 6, 11, 12],
    venus:   [6, 11, 12],
    lagna:   [1, 3, 4, 6, 10, 11]
  }
};

var PUBLISHED_TOTALS = {sun: 48, moon: 49, mars: 39, mercury: 54,
                        jupiter: 56, venus: 52, saturn: 39};
var SAV_TOTAL = 337;

function signOf(lon) {
  var x = lon % 360; if (x < 0) x += 360;
  return Math.floor(x / 30) % 12;
}

function computeAshtakavarga(planets) {
  var pSign = {}, i, p, s;
  for (i = 0; i < PLANETS.length; i++) pSign[PLANETS[i]] = signOf(planets[PLANETS[i]]);
  var lagnaSign = signOf(planets.ascendant);

  var bhinna = {}, lagnaAV = [];
  for (s = 0; s < 12; s++) lagnaAV.push(0);
  for (i = 0; i < PLANETS.length; i++) {
    var row = [];
    for (s = 0; s < 12; s++) row.push(0);
    bhinna[PLANETS[i]] = row;
  }

  // For each planet P and each sign S: count contributors C (7 planets + Lagna)
  // with house(P from C) in the table. The published BAV totals
  // (48/49/39/54/56/52/39) include the Lagna contributor row.
  for (i = 0; i < PLANETS.length; i++) {
    p = PLANETS[i];
    var table = BAV_TABLE[p];
    for (s = 0; s < 12; s++) {
      var bindus = 0;
      for (var c = 0; c < PLANETS.length; c++) {
        var cp = PLANETS[c];
        var house = (((s - pSign[cp]) % 12) + 12) % 12 + 1;
        if (table[cp].indexOf(house) >= 0) bindus++;
      }
      var lh = (((s - lagnaSign) % 12) + 12) % 12 + 1;
      if (table.lagna.indexOf(lh) >= 0) { bindus++; lagnaAV[s]++; }
      bhinna[p][s] = bindus;
    }
  }

  var sarva = [];
  for (s = 0; s < 12; s++) {
    var sum = 0;
    for (i = 0; i < PLANETS.length; i++) sum += bhinna[PLANETS[i]][s];
    sarva.push(sum);
  }

  return {bhinna: bhinna, lagnaAV: lagnaAV, sarva: sarva};
}

// Traditional strength band for a SAV value (tendency, not fate)
function savBand(v) {
  if (v < 25) return 'below average - a quieter area of life, needs steady effort';
  if (v <= 30) return 'average - mixed results, typical ups and downs';
  return 'above average - a supportive area of life';
}

function strongestSigns(sarva, n) {
  var idx = [], s;
  for (s = 0; s < 12; s++) idx.push(s);
  idx.sort(function (a, b) { return sarva[b] - sarva[a]; });
  return idx.slice(0, n || 3);
}

/* expose */
var AshtakavargaAPI = {
  computeAshtakavarga: computeAshtakavarga,
  savBand: savBand,
  strongestSigns: strongestSigns,
  BAV_TABLE: BAV_TABLE,
  PUBLISHED_TOTALS: PUBLISHED_TOTALS,
  SAV_TOTAL: SAV_TOTAL
};
if (typeof window !== 'undefined') {
  window.computeAshtakavarga = computeAshtakavarga;
  window.AshtakavargaAPI = AshtakavargaAPI;
}
if (typeof module !== 'undefined' && module.exports) module.exports = AshtakavargaAPI;

})();
