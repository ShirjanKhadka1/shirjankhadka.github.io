/* Ashtakoota Guna Milan: Vedic marriage matching (Moon-based).
 *
 * Client-side, dependency-free. Give it two sidereal Moon longitudes
 * (degrees, 0-360) and it returns the eight koota scores out of 36.
 *
 * Nakshatra and pada are derived from the longitude itself, so no
 * separate pada input is needed.
 *
 * Tables verified against classical sources:
 *  - Nakshatra -> yoni / gana / nadi per standard Panchanga tables
 *    (BPHS tradition; yoni inimical pairs per Saravali).
 *  - Graha Maitri uses natural (naisargika) planetary friendship and
 *    the scoring from Gayatri Devi Vasudev, "The Art of Matching Charts".
 *  - Yoni friendly pairs follow the BPHS / B.V. Raman table; the seven
 *    canonical enemy pairs (cat-rat, dog-deer, cow-tiger, elephant-lion,
 *    horse-buffalo, sheep-monkey, serpent-mongoose) take precedence.
 *
 * Simplified where noted in comments. This is an educational tool:
 * see WARNING below.
 */
(function () {
"use strict";

/* ---------------- reference tables ---------------- */

var NAKSHATRAS = [
  "Ashwini", "Bharani", "Krittika", "Rohini", "Mrigashira", "Ardra",
  "Punarvasu", "Pushya", "Ashlesha", "Magha", "Purva Phalguni",
  "Uttara Phalguni", "Hasta", "Chitra", "Swati", "Vishakha", "Anuradha",
  "Jyeshtha", "Mula", "Purva Ashadha", "Uttara Ashadha", "Shravana",
  "Dhanishta", "Shatabhisha", "Purva Bhadrapada", "Uttara Bhadrapada",
  "Revati"
];

var RASHIS = [
  "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

var RASHI_LORDS = [
  "Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury",
  "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"
];

/* Yoni animal per nakshatra (index 0-26). */
var NAKSHATRA_YONI = [
  "Horse", "Elephant", "Sheep", "Serpent", "Serpent", "Dog", "Cat",
  "Sheep", "Cat", "Rat", "Rat", "Cow", "Buffalo", "Tiger", "Buffalo",
  "Tiger", "Deer", "Deer", "Dog", "Monkey", "Mongoose", "Monkey",
  "Lion", "Horse", "Lion", "Cow", "Elephant"
];

/* Gana per nakshatra: Deva / Manushya / Rakshasa. */
var NAKSHATRA_GANA = [
  "Deva", "Manushya", "Rakshasa", "Manushya", "Deva", "Manushya", "Deva",
  "Deva", "Rakshasa", "Rakshasa", "Manushya", "Manushya", "Deva",
  "Rakshasa", "Deva", "Rakshasa", "Deva", "Rakshasa", "Rakshasa",
  "Manushya", "Manushya", "Deva", "Rakshasa", "Rakshasa", "Manushya",
  "Manushya", "Deva"
];

/* Nadi per nakshatra. Adi = Vata, Madhya = Pitta, Antya = Kapha. */
var NAKSHATRA_NADI = [
  "Adi", "Madhya", "Antya", "Antya", "Madhya", "Adi", "Adi",
  "Madhya", "Antya", "Antya", "Madhya", "Adi", "Adi", "Madhya",
  "Antya", "Antya", "Madhya", "Adi", "Adi", "Madhya", "Antya",
  "Antya", "Madhya", "Adi", "Adi", "Madhya", "Antya"
];

var NADI_LABEL = {
  "Adi": "Adi (Vata)",
  "Madhya": "Madhya (Pitta)",
  "Antya": "Antya (Kapha)"
};

/* Varna rank per Moon sign: 1 Brahmin, 2 Kshatriya, 3 Vaishya, 4 Shudra. */
var VARNA_NAMES = { 1: "Brahmin", 2: "Kshatriya", 3: "Vaishya", 4: "Shudra" };
var RASHI_VARNA = [
  2, 3, 4, 1, 2, 3,
  4, 1, 2, 3, 4, 1
];

/* Natural (naisargika) planetary friendship, from each planet's view. */
var NATURAL_MAITRI = {
  "Sun":     { friends: ["Moon", "Mars", "Jupiter"], enemies: ["Venus", "Saturn"] },
  "Moon":    { friends: ["Sun", "Mercury"],           enemies: [] },
  "Mars":    { friends: ["Sun", "Moon", "Jupiter"],   enemies: ["Mercury"] },
  "Mercury": { friends: ["Sun", "Venus"],             enemies: ["Moon"] },
  "Jupiter": { friends: ["Sun", "Moon", "Mars"],      enemies: ["Mercury", "Venus"] },
  "Venus":   { friends: ["Mercury", "Saturn"],        enemies: ["Sun", "Moon"] },
  "Saturn":  { friends: ["Mercury", "Venus"],         enemies: ["Sun", "Moon", "Mars"] }
};

/* The seven canonical yoni enemy pairs (order-independent). */
var YONI_ENEMY_PAIRS = [
  ["Cat", "Rat"], ["Dog", "Deer"], ["Cow", "Tiger"],
  ["Elephant", "Lion"], ["Horse", "Buffalo"],
  ["Sheep", "Monkey"], ["Serpent", "Mongoose"]
];

/* Yoni friendly pairs (BPHS / B.V. Raman tradition, simplified). */
var YONI_FRIENDS = {
  "Horse":    ["Elephant", "Tiger"],
  "Elephant": ["Horse", "Cow"],
  "Sheep":    ["Cow", "Deer"],
  "Serpent":  ["Cat", "Deer"],
  "Dog":      ["Tiger", "Horse"],
  "Cat":      ["Serpent"],
  "Rat":      ["Monkey"],
  "Cow":      ["Elephant", "Horse"],
  "Buffalo":  ["Elephant", "Deer"],
  "Tiger":    ["Dog", "Horse"],
  "Deer":     ["Cow", "Elephant"],
  "Monkey":   ["Rat", "Horse"],
  "Mongoose": ["Cow", "Deer"],
  "Lion":     ["Horse", "Cow"]
};

var MAX_POINTS = {
  varna: 1, vashya: 2, tara: 3, yoni: 4,
  maitri: 5, gana: 6, bhakoota: 7, nadi: 8
};

var KOOTA_TITLES = {
  varna: "Varna",
  vashya: "Vashya",
  tara: "Tara",
  yoni: "Yoni",
  maitri: "Graha Maitri",
  gana: "Gana",
  bhakoota: "Bhakoota",
  nadi: "Nadi"
};

var WARNING = "Guna Milan is one Moon-based factor, not a final marriage " +
  "judgment. Consider Mangal Dosha, charts, and families.";

/* ---------------- helpers ---------------- */

function norm360(x) {
  x = Number(x) % 360;
  if (isNaN(x)) return NaN;
  return x < 0 ? x + 360 : x;
}

function nakshatraIndexOf(moonLong) {
  return Math.min(26, Math.floor(norm360(moonLong) / (360 / 27) + 1e-9));
}

function padaOf(moonLong) {
  var span = 360 / 27;
  var within = norm360(moonLong) % span;
  return Math.min(4, Math.floor(within / (span / 4) + 1e-9) + 1);
}

function rashiIndexOf(moonLong) {
  return Math.min(11, Math.floor(norm360(moonLong) / 30 + 1e-9));
}

/* Vashya category of a Moon position. Sagittarius and Capricorn are split
 * by halves: Sagittarius 1st half = Manava, 2nd half = Chatushpada;
 * Capricorn 1st half = Chatushpada, 2nd half = Jalachara. */
function vashyaOf(moonLong) {
  var r = rashiIndexOf(moonLong);
  var degInSign = norm360(moonLong) % 30;
  if (r === 8) return degInSign < 15 ? "Manava" : "Chatushpada";   /* Sagittarius */
  if (r === 9) return degInSign < 15 ? "Chatushpada" : "Jalachara"; /* Capricorn */
  switch (r) {
    case 0: case 1: return "Chatushpada";            /* Aries, Taurus */
    case 2: case 5: case 6: case 10: return "Manava"; /* Gemini, Virgo, Libra, Aquarius */
    case 3: case 11: return "Jalachara";             /* Cancer, Pisces */
    case 4: return "Vanachara";                      /* Leo */
    case 7: return "Keeta";                          /* Scorpio */
  }
  return "Manava";
}

function planetRelation(fromPlanet, toPlanet) {
  if (fromPlanet === toPlanet) return "friend"; /* same lord: treated as friendly */
  var t = NATURAL_MAITRI[fromPlanet];
  if (t.friends.indexOf(toPlanet) !== -1) return "friend";
  if (t.enemies.indexOf(toPlanet) !== -1) return "enemy";
  return "neutral";
}

function yoniAreEnemies(a, b) {
  for (var i = 0; i < YONI_ENEMY_PAIRS.length; i++) {
    var p = YONI_ENEMY_PAIRS[i];
    if ((p[0] === a && p[1] === b) || (p[0] === b && p[1] === a)) return true;
  }
  return false;
}

function yoniAreFriends(a, b) {
  var f = YONI_FRIENDS[a] || [];
  return f.indexOf(b) !== -1;
}

function personFromMoon(moonLong) {
  var nak = nakshatraIndexOf(moonLong);
  var rashi = rashiIndexOf(moonLong);
  return {
    moonLong: norm360(moonLong),
    nakshatraIndex: nak,
    nakshatra: NAKSHATRAS[nak],
    pada: padaOf(moonLong),
    rashiIndex: rashi,
    rashi: RASHIS[rashi],
    rashiLord: RASHI_LORDS[rashi],
    varnaRank: RASHI_VARNA[rashi],
    varna: VARNA_NAMES[RASHI_VARNA[rashi]],
    vashya: vashyaOf(moonLong),
    yoni: NAKSHATRA_YONI[nak],
    gana: NAKSHATRA_GANA[nak],
    nadi: NAKSHATRA_NADI[nak],
    nadiLabel: NADI_LABEL[NAKSHATRA_NADI[nak]]
  };
}

/* ---------------- the eight kootas ---------------- */

function scoreVarna(bride, groom) {
  var pts = groom.varnaRank >= bride.varnaRank ? 1 : 0;
  return {
    points: pts,
    note: "Bride: " + bride.rashi + " (" + bride.varna + ") · Groom: " +
      groom.rashi + " (" + groom.varna + "). " +
      (pts ? "Groom's varna is equal to or higher than the bride's."
           : "Groom's varna is lower than the bride's.")
  };
}

function scoreVashya(bride, groom) {
  var pts = 0, why;
  if (bride.vashya === groom.vashya) {
    pts = 2; why = "same category";
  } else if ((bride.vashya === "Manava" && groom.vashya === "Chatushpada") ||
             (bride.vashya === "Chatushpada" && groom.vashya === "Manava")) {
    pts = 1; why = "Manava-Chatushpada are mutually friendly";
  } else {
    why = "categories do not support each other";
  }
  return {
    points: pts,
    note: "Bride: " + bride.vashya + " · Groom: " + groom.vashya + ", " + why + "."
  };
}

function scoreTara(bride, groom) {
  /* Tara number: count the groom's nakshatra from the bride's (0-based
   * indices), reduced mod 9. 3, 5, 7 score 0; all others score 3. */
  var tara = (((groom.nakshatraIndex - bride.nakshatraIndex) % 9) + 9) % 9 + 1;
  var pts = (tara === 3 || tara === 5 || tara === 7) ? 0 : 3;
  var names = { 1: "Janma", 2: "Sampat", 3: "Vipat", 4: "Kshema",
                5: "Pratyak", 6: "Sadhaka", 7: "Nidhana",
                8: "Mitra", 9: "Paramamitra" };
  return {
    points: pts,
    note: "Tara " + tara + " (" + names[tara] + "): counting from bride's " +
      bride.nakshatra + " to groom's " + groom.nakshatra + ". " +
      (pts ? "Supportive tara."
           : "A low tara, worth a closer look at health and stamina factors.")
  };
}

function scoreYoni(bride, groom) {
  var a = bride.yoni, b = groom.yoni, pts, why;
  if (a === b) { pts = 4; why = "same yoni"; }
  else if (yoniAreEnemies(a, b)) { pts = 1; why = "traditionally conflicting pair"; }
  else if (yoniAreFriends(a, b)) { pts = 3; why = "friendly pair"; }
  else { pts = 2; why = "neutral pair"; }
  return {
    points: pts,
    note: "Bride: " + a + " (" + bride.nakshatra + ") · Groom: " + b +
      " (" + groom.nakshatra + "), " + why + "."
  };
}

function scoreMaitri(bride, groom) {
  var rB = planetRelation(bride.rashiLord, groom.rashiLord);
  var rG = planetRelation(groom.rashiLord, bride.rashiLord);
  var f = function (r) { return r === "friend"; };
  var n = function (r) { return r === "neutral"; };
  var e = function (r) { return r === "enemy"; };
  var pts;
  if (f(rB) && f(rG)) pts = 5;
  else if ((f(rB) && n(rG)) || (n(rB) && f(rG))) pts = 4;
  else if (n(rB) && n(rG)) pts = 3;
  else if ((f(rB) && e(rG)) || (e(rB) && f(rG))) pts = 2;
  else pts = 0; /* neutral+enemy, or mutual enemies */
  return {
    points: pts,
    note: "Moon-sign lords: bride's " + bride.rashiLord + " (" + bride.rashi + ") · " +
      "groom's " + groom.rashiLord + " (" + groom.rashi + "). " +
      "Natural relation " + bride.rashiLord + "→" + groom.rashiLord + ": " + rB +
      "; " + groom.rashiLord + "→" + bride.rashiLord + ": " + rG + "."
  };
}

function scoreGana(bride, groom) {
  var a = bride.gana, b = groom.gana, pts;
  if (a === b) pts = 6;
  else if ((a === "Deva" && b === "Manushya") ||
           (a === "Manushya" && b === "Deva")) pts = 5;
  else if ((a === "Manushya" && b === "Rakshasa") ||
           (a === "Rakshasa" && b === "Manushya")) pts = 2;
  else pts = 0; /* Deva + Rakshasa */
  return {
    points: pts,
    note: "Bride: " + a + " (" + bride.nakshatra + ") · Groom: " + b +
      " (" + groom.nakshatra + ")."
  };
}

function scoreBhakoota(bride, groom) {
  /* Count the groom's Moon sign from the bride's (inclusive, 1-12).
   * 2/12, 5/9 and 6/8 positions score 0; all others score 7.
   * Classical exception: a 6/8 pair ruled by the same planet is acceptable. */
  var n = (((groom.rashiIndex - bride.rashiIndex) % 12) + 12) % 12 + 1;
  var bad = (n === 2 || n === 12 || n === 5 || n === 9 || n === 6 || n === 8);
  var exception = bad && (n === 6 || n === 8) &&
    bride.rashiLord === groom.rashiLord;
  var pts = (bad && !exception) ? 0 : 7;
  var label = { 1: "1/1", 2: "2/12", 3: "3/11", 4: "4/10", 5: "5/9",
                6: "6/8", 7: "1/7", 8: "6/8", 9: "5/9", 10: "4/10",
                11: "3/11", 12: "2/12" }[n];
  return {
    points: pts,
    note: "Moon signs " + label + " apart (bride " + bride.rashi + ", groom " +
      groom.rashi + "). " +
      (pts ? (exception ? "6/8, but both signs share lord " + bride.rashiLord + ", acceptable."
                        : "Supportive placement.")
           : "A low bhakoota, so emotional and financial rhythms need conscious alignment.")
  };
}

function scoreNadi(bride, groom) {
  var same = bride.nadi === groom.nadi;
  return {
    points: same ? 0 : 8,
    note: "Bride: " + bride.nadiLabel + " · Groom: " + groom.nadiLabel + ". " +
      (same ? "Same nadi, traditionally the weakest single factor here; look at the full charts."
            : "Different nadis, the strongest single match factor.")
  };
}

/* ---------------- verdict ---------------- */

function verdictFor(total) {
  if (total >= 32) return "Excellent";
  if (total >= 24) return "Good";
  if (total >= 18) return "Average";
  return "Needs attention";
}

/* ---------------- main API ---------------- */

/* gunaMilan(brideMoonLong, groomMoonLong)
 * Both longitudes are sidereal degrees (0-360). Returns:
 * {
 *   scores:  { varna, vashya, tara, yoni, maitri, gana, bhakoota, nadi },
 *   max:     { ... }  (per-koota maximums, summing to 36),
 *   total:   0-36,
 *   verdict: "Excellent" | "Good" | "Average" | "Needs attention",
 *   notes:   { ... }  (one plain-language line per koota),
 *   bride:   { ...derived details... },
 *   groom:   { ...derived details... },
 *   warning: "..."
 * } */
function gunaMilan(brideMoonLong, groomMoonLong) {
  if (isNaN(norm360(brideMoonLong)) || isNaN(norm360(groomMoonLong))) {
    throw new Error("gunaMilan: Moon longitudes must be numbers (sidereal degrees).");
  }
  var bride = personFromMoon(brideMoonLong);
  var groom = personFromMoon(groomMoonLong);

  var scorers = {
    varna: scoreVarna, vashya: scoreVashya, tara: scoreTara,
    yoni: scoreYoni, maitri: scoreMaitri, gana: scoreGana,
    bhakoota: scoreBhakoota, nadi: scoreNadi
  };

  var scores = {}, notes = {}, total = 0;
  for (var key in scorers) {
    if (!scorers.hasOwnProperty(key)) continue;
    var r = scorers[key](bride, groom);
    scores[key] = r.points;
    notes[key] = KOOTA_TITLES[key] + ": " + r.note +
      " (" + r.points + "/" + MAX_POINTS[key] + ")";
    total += r.points;
  }

  return {
    scores: scores,
    max: {
      varna: 1, vashya: 2, tara: 3, yoni: 4,
      maitri: 5, gana: 6, bhakoota: 7, nadi: 8
    },
    total: total,
    verdict: verdictFor(total),
    notes: notes,
    bride: bride,
    groom: groom,
    warning: WARNING
  };
}

/* ---------------- exports ---------------- */

var KundaliMatching = {
  gunaMilan: gunaMilan,
  nakshatraIndexOf: nakshatraIndexOf,
  padaOf: padaOf,
  rashiIndexOf: rashiIndexOf,
  personFromMoon: personFromMoon,
  verdictFor: verdictFor,
  WARNING: WARNING,
  tables: {
    NAKSHATRAS: NAKSHATRAS,
    RASHIS: RASHIS,
    RASHI_LORDS: RASHI_LORDS,
    NAKSHATRA_YONI: NAKSHATRA_YONI,
    NAKSHATRA_GANA: NAKSHATRA_GANA,
    NAKSHATRA_NADI: NAKSHATRA_NADI,
    NADI_LABEL: NADI_LABEL,
    VARNA_NAMES: VARNA_NAMES,
    RASHI_VARNA: RASHI_VARNA,
    NATURAL_MAITRI: NATURAL_MAITRI,
    YONI_ENEMY_PAIRS: YONI_ENEMY_PAIRS,
    YONI_FRIENDS: YONI_FRIENDS,
    MAX_POINTS: MAX_POINTS
  }
};

if (typeof window !== "undefined") {
  window.gunaMilan = gunaMilan;
  window.KundaliMatching = KundaliMatching;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = KundaliMatching;
}

})();
