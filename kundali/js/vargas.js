/* vargas.js — Parashara divisional (varga) chart computations.
 *
 * Pure JavaScript, no dependencies. Works in any browser or Node.
 * Input: planet sidereal longitude in degrees (any number; normalized to 0-360).
 *
 * Every varga function returns { sign: 0-11, degree: 0-30 }
 *   sign: 0 = Aries, 1 = Taurus, ... 11 = Pisces (see SIGN_NAMES)
 *   degree: longitude of the planet *within* the varga sign, 0-30.
 *           The fractional position inside the occupied varga division is
 *           scaled back up to a full 0-30 degree range (standard practice),
 *           so {sign, degree} fully describes the varga placement.
 */

(function (global) {
  'use strict';

  var SIGN_NAMES = [
    'Aries', 'Taurus', 'Gemini', 'Cancer',
    'Leo', 'Virgo', 'Libra', 'Scorpio',
    'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'
  ];

  // Sign indices for movable / fixed / dual classification
  // Movable (chara): Aries, Cancer, Libra, Capricorn
  // Fixed (sthira): Taurus, Leo, Scorpio, Aquarius
  // Dual (dwisvabhava): Gemini, Virgo, Sagittarius, Pisces
  var MOVABLE = { 0: true, 3: true, 6: true, 9: true };
  var FIXED = { 1: true, 4: true, 7: true, 10: true };

  function norm(long) {
    var l = long % 360;
    if (l < 0) l += 360;
    return l;
  }

  function isOddSign(sign) {
    return sign % 2 === 0; // 0-based: Aries(0), Gemini(2), ... are odd signs
  }

  function isMovable(sign) { return !!MOVABLE[sign]; }
  function isFixed(sign) { return !!FIXED[sign]; }
  // else dual

  // Generic helper: split the 30-degree sign into `n` equal parts,
  // pick the division index `idx` counted from `startSign`,
  // and scale the intra-division fraction back to 0-30 degrees.
  function equalParts(sign, degInSign, n, startSign, idx) {
    var partLen = 30 / n;
    var i = (idx === undefined) ? Math.floor(degInSign / partLen) : idx;
    if (i >= n) i = n - 1;
    var frac = (degInSign - i * partLen) / partLen;
    return {
      sign: (startSign + i) % 12,
      degree: frac * 30
    };
  }

  // ---- D1 Rashi -----------------------------------------------------------
  function rashi(long) {
    var l = norm(long);
    return { sign: Math.floor(l / 30) % 12, degree: l % 30 };
  }

  // ---- D2 Hora ------------------------------------------------------------
  // Odd signs:  Sun Hora (0-15 deg) = Leo,  Moon Hora (15-30 deg) = Cancer
  // Even signs: Moon Hora (0-15 deg) = Cancer, Sun Hora (15-30 deg) = Leo
  function hora(long) {
    var r = rashi(long);
    var sunHora = (isOddSign(r.sign) && r.degree < 15) ||
                  (!isOddSign(r.sign) && r.degree >= 15);
    var s = sunHora ? 4 : 3; // Leo = 4, Cancer = 3
    var frac = r.degree < 15 ? r.degree / 15 : (r.degree - 15) / 15;
    return { sign: s, degree: frac * 30 };
  }

  // ---- D3 Drekkana --------------------------------------------------------
  // 0-10 deg: same sign; 10-20 deg: 5th from it; 20-30 deg: 9th from it
  // (i.e. offsets of 0, 4, 8 signs — not sequential)
  function drekkana(long) {
    var r = rashi(long);
    var partLen = 10;
    var i = Math.floor(r.degree / partLen);
    if (i > 2) i = 2;
    var offsets = [0, 4, 8];
    var frac = (r.degree - i * partLen) / partLen;
    return {
      sign: (r.sign + offsets[i]) % 12,
      degree: frac * 30
    };
  }

  // ---- D7 Saptamsha -------------------------------------------------------
  // 7 parts. Odd signs: count from same sign. Even signs: count from 7th.
  function saptamsha(long) {
    var r = rashi(long);
    var start = isOddSign(r.sign) ? r.sign : (r.sign + 6) % 12;
    return equalParts(r.sign, r.degree, 7, start);
  }

  // ---- D9 Navamsha --------------------------------------------------------
  // 9 parts of 3 deg 20 min.
  // Movable signs: start from same sign; fixed: from 9th; dual: from 5th.
  function navamsha(long) {
    var r = rashi(long);
    var start;
    if (isMovable(r.sign)) start = r.sign;
    else if (isFixed(r.sign)) start = (r.sign + 8) % 12; // 9th from
    else start = (r.sign + 4) % 12;                      // 5th from
    return equalParts(r.sign, r.degree, 9, start);
  }

  // ---- D10 Dashamsha ------------------------------------------------------
  // 10 parts of 3 deg. Odd signs: start from same sign; even: from 9th.
  function dashamsha(long) {
    var r = rashi(long);
    var start = isOddSign(r.sign) ? r.sign : (r.sign + 8) % 12;
    return equalParts(r.sign, r.degree, 10, start);
  }

  // ---- D12 Dwadashamsha ---------------------------------------------------
  // 12 parts of 2 deg 30 min, counted from the same sign.
  function dwadashamsha(long) {
    var r = rashi(long);
    return equalParts(r.sign, r.degree, 12, r.sign);
  }

  // ---- D30 Trimshamsha ----------------------------------------------------
  // Unequal parts: Mars 5, Saturn 5, Jupiter 8, Mercury 7, Venus 5 deg.
  // Odd signs order:  Mars, Saturn, Jupiter, Mercury, Venus
  // Even signs order: Venus, Mercury, Jupiter, Saturn, Mars (reverse)
  // Resulting signs use the lord's own sign: odd-sign case uses the
  // masculine/first sign (Aries, Capricorn, Sagittarius, Gemini, Taurus),
  // even-sign case uses the second (Scorpio, Aquarius, Pisces, Virgo, Libra).
  var TRIMSHAMSHA_LORDS = [
    { lord: 'Mars',    odd: 0,  even: 7  },  // Aries / Scorpio
    { lord: 'Saturn',  odd: 9,  even: 10 },  // Capricorn / Aquarius
    { lord: 'Jupiter', odd: 8,  even: 11 },  // Sagittarius / Pisces
    { lord: 'Mercury', odd: 2,  even: 5  },  // Gemini / Virgo
    { lord: 'Venus',   odd: 1,  even: 6  }   // Taurus / Libra
  ];
  var TRIMSHAMSHA_LENGTHS = [5, 5, 8, 7, 5]; // sums to 30

  function trimshamsha(long) {
    var r = rashi(long);
    var odd = isOddSign(r.sign);
    var order = odd ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    var acc = 0;
    for (var k = 0; k < 5; k++) {
      var li = order[k];
      var len = TRIMSHAMSHA_LENGTHS[li];
      if (r.degree < acc + len || k === 4) {
        var entry = TRIMSHAMSHA_LORDS[li];
        var frac = (r.degree - acc) / len;
        return {
          sign: odd ? entry.odd : entry.even,
          degree: frac * 30
        };
      }
      acc += len;
    }
    /* unreachable */
    return { sign: r.sign, degree: r.degree };
  }

  // ---- Lookup tables ------------------------------------------------------
  var VARGAS = {
    D1:  rashi,
    D2:  hora,
    D3:  drekkana,
    D7:  saptamsha,
    D9:  navamsha,
    D10: dashamsha,
    D12: dwadashamsha,
    D30: trimshamsha,
    // long-name aliases
    rashi: rashi,
    hora: hora,
    drekkana: drekkana,
    saptamsha: saptamsha,
    navamsha: navamsha,
    dashamsha: dashamsha,
    dwadashamsha: dwadashamsha,
    trimshamsha: trimshamsha
  };

  // vargaPosition(planetLong, vargaName) -> sign index 0-11 (0 = Aries)
  // vargaName: 'D1'..'D30' or a long name ('rashi', 'hora', ...),
  // case-insensitive.
  function vargaPosition(planetLong, vargaName) {
    return vargaChart(planetLong, vargaName).sign;
  }

  // vargaChart(planetLong, vargaName) -> { sign, degree }
  function vargaChart(planetLong, vargaName) {
    var key = String(vargaName).toLowerCase();
    var fn = VARGAS[key] || VARGAS[key.toUpperCase()];
    if (!fn) throw new Error('Unknown varga: ' + vargaName);
    return fn(planetLong);
  }

  // ---- Self-test: Moon at 52.4076 deg -------------------------------------
  // D1: Taurus (sign 1), deg 22.4076
  // D9: Taurus is fixed -> start from 9th (Capricorn); idx = floor(22.4076/3.3333) = 6
  //     -> Cancer (sign 3)

  var api = {
    SIGN_NAMES: SIGN_NAMES,
    rashi: rashi,
    hora: hora,
    drekkana: drekkana,
    saptamsha: saptamsha,
    navamsha: navamsha,
    dashamsha: dashamsha,
    dwadashamsha: dwadashamsha,
    trimshamsha: trimshamsha,
    vargaPosition: vargaPosition,
    vargaChart: vargaChart,
    isOddSign: isOddSign,
    isMovable: isMovable,
    isFixed: isFixed
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.Vargas = api;
})(typeof window !== 'undefined' ? window : globalThis);
