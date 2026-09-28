"use strict";
/* Gochar (transits) - Simplified.
 * Compares current planet positions to natal chart.
 */

function gocharAnalysis(natalPlanets, transitJD) {
  const transit = computeKundali(transitJD, 27.1667, 87.0667); // lat/lon not needed for planets
  const result = {};
  const planetKeys = ['sun','moon','mars','mercury','jupiter','venus','saturn'];
  
  // Sade Sati: Saturn transiting over natal Moon sign, or 12th/2nd from it
  const natalMoonSign = Math.floor(natalPlanets.moon / 30);
  const transitSaturnSign = Math.floor(transit.saturn / 30);
  const sadeSati = [11, 0, 1].includes((transitSaturnSign - natalMoonSign + 12) % 12);
  
  result.sadeSati = {
    active: sadeSati,
    natalMoonSign: natalMoonSign,
    transitSaturnSign: transitSaturnSign,
    note: sadeSati ? "Saturn is transiting near your natal Moon. A period for patience and steady work." : "No Sade Sati at this time."
  };
  
  // Current transits by house from natal Moon
  planetKeys.forEach(key => {
    const tSign = Math.floor(transit[key] / 30);
    const houseFromMoon = ((tSign - natalMoonSign + 12) % 12) + 1;
    result[key] = {sign: tSign, houseFromMoon: houseFromMoon};
  });
  
  return result;
}

/* ============ 12-month gochar outlook (spec 10) ============
 * For each of the next 12 calendar months (from the current month), compute
 * transiting Jupiter, Saturn and Rahu/Ketu at mid-month, their signs and
 * houses from the natal Moon, classical favorability (BPHS/Saravali gochar
 * rules), Sade Sati / Dhaiya phase if active, and SAV bindu support.
 * Framing: tendencies for planning and reflection, never event predictions.
 */

var GOCHAR_GOOD = {
  // classical favorable houses counted from the natal Moon (spec 10)
  sun: [3, 6, 10, 11], moon: [1, 3, 6, 7, 10, 11], mars: [3, 6, 11],
  mercury: [2, 4, 6, 8, 10, 11], jupiter: [2, 5, 7, 9, 11],
  venus: [1, 2, 3, 4, 5, 8, 9, 11, 12], saturn: [3, 6, 11], rahu: [3, 6, 11]
};
var MONTH_NAMES = ['January','February','March','April','May','June','July',
  'August','September','October','November','December'];

function _midMonthJD(year, month0) {
  // JD (UTC) of the 15th, 12:00 UTC
  return Date.UTC(year, month0, 15, 12, 0, 0) / 86400000 + 2440587.5;
}

function _sadeSatiPhase(satSign, moonSign) {
  var rel = (((satSign - moonSign) % 12) + 12) % 12 + 1; // house from Moon
  if (rel === 12) return {active: true, phase: 'Rising', text: 'Saturn transits the 12th from your Moon (Sade Sati, rising phase): a time of restlessness, expenses, and possible relocation. Steady routine helps.'};
  if (rel === 1) return {active: true, phase: 'Peak', text: 'Saturn transits your Moon sign (Sade Sati, peak phase): the most intense stretch, asking for patience, discipline, and care of health and home. Met with steadiness, it can restructure life for the better.'};
  if (rel === 2) return {active: true, phase: 'Setting', text: 'Saturn transits the 2nd from your Moon (Sade Sati, setting phase): gradual resolution. Family and financial matters settle; lessons convert into stability.'};
  if (rel === 4) return {active: true, phase: 'Kantaka (Dhaiya)', text: 'Saturn transits the 4th from your Moon (Kantaka Dhaiya): a testing stretch for home, property, and emotional calm. Avoid hasty domestic decisions.'};
  if (rel === 8) return {active: true, phase: 'Ashtama', text: 'Saturn transits the 8th from your Moon (Ashtama Shani): a period of sudden changes and inner pressure. Keep routines simple and avoid speculation.'};
  return {active: false, phase: null, text: ''};
}

function gocharOutlook(natalPlanets) {
  var out = [];
  var moonSign = Math.floor((((natalPlanets.moon % 360) + 360) % 360) / 30);
  var sav = null;
  try {
    if (typeof computeAshtakavarga !== 'undefined') sav = computeAshtakavarga(natalPlanets).sarva;
  } catch (e) { sav = null; }

  var now = new Date();
  var prevSatSign = null, prevJupSign = null;

  for (var m = 0; m < 12; m++) {
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
    var jd = _midMonthJD(d.getUTCFullYear(), d.getUTCMonth());
    var tr = computeKundali(jd, 27.1667, 87.0667); // lat/lon irrelevant for planets
    var satSign = Math.floor(tr.saturn / 30) % 12;
    var jupSign = Math.floor(tr.jupiter / 30) % 12;
    var rahuSign = Math.floor(tr.rahu / 30) % 12;

    var satHouse = (((satSign - moonSign) % 12) + 12) % 12 + 1;
    var jupHouse = (((jupSign - moonSign) % 12) + 12) % 12 + 1;
    var rahuHouse = (((rahuSign - moonSign) % 12) + 12) % 12 + 1;

    var factors = [];
    var score = 0;

    var jupGood = GOCHAR_GOOD.jupiter.indexOf(jupHouse) >= 0;
    var satGood = GOCHAR_GOOD.saturn.indexOf(satHouse) >= 0;
    var rahuGood = GOCHAR_GOOD.rahu.indexOf(rahuHouse) >= 0;
    if (jupGood) { score += 2; factors.push('Jupiter transits the ' + jupHouse + ordinal(jupHouse) + ' from your Moon, classically favorable for growth and guidance'); }
    else { score -= 1; factors.push('Jupiter transits the ' + jupHouse + ordinal(jupHouse) + ' from your Moon, a quieter stretch for expansion'); }
    if (satGood) { score += 1; factors.push('Saturn transits the ' + satHouse + ordinal(satHouse) + ' from your Moon, classically supportive of steady effort'); }
    else { score -= 1; factors.push('Saturn transits the ' + satHouse + ordinal(satHouse) + ' from your Moon, asking for patience and discipline'); }
    if (rahuGood) { score += 1; factors.push('Rahu transits the ' + rahuHouse + ordinal(rahuHouse) + ' from your Moon, supportive of bold initiatives'); }

    if (prevSatSign !== null && satSign !== prevSatSign)
      factors.push('Saturn changes sign this month, marking a shift in its long term themes');
    if (prevJupSign !== null && jupSign !== prevJupSign)
      factors.push('Jupiter changes sign this month, opening a new yearly theme');
    prevSatSign = satSign; prevJupSign = jupSign;

    var sade = _sadeSatiPhase(satSign, moonSign);
    if (sade.active) { score -= 1; factors.push(sade.text); }

    if (sav) {
      var sv = sav[satSign];
      factors.push('Sarvashtakavarga strength of Saturn\'s sign: ' + sv + ' bindus (' +
        (sv >= 30 ? 'supportive' : sv <= 24 ? 'obstructed' : 'mixed') + ')');
      if (sv >= 30) score += 1; else if (sv <= 24) score -= 1;
    }

    var rating = score >= 2 ? 'supportive' : score <= -2 ? 'demanding' : 'mixed';
    out.push({
      month: MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
      jupiter: {sign: jupSign, signName: SIGNS_LIST[jupSign], houseFromMoon: jupHouse, favorable: jupGood},
      saturn: {sign: satSign, signName: SIGNS_LIST[satSign], houseFromMoon: satHouse, favorable: satGood},
      rahu: {sign: rahuSign, signName: SIGNS_LIST[rahuSign], houseFromMoon: rahuHouse, favorable: rahuGood},
      sadeSati: sade,
      savBindu: sav ? sav[satSign] : null,
      rating: rating,
      factors: factors
    });
  }
  return out;
}

function ordinal(n) {
  if (n === 1) return 'st'; if (n === 2) return 'nd'; if (n === 3) return 'rd';
  return 'th';
}

var SIGNS_LIST = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];

if (typeof window !== 'undefined') {
  window.gocharAnalysis = gocharAnalysis;
  window.gocharOutlook = gocharOutlook;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {gocharAnalysis: gocharAnalysis, gocharOutlook: gocharOutlook};
}
