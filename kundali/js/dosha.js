"use strict";
/* Dosha (affliction) analysis module.
 *
 * Pure JavaScript, no dependencies. All computation is client-side.
 *
 * Usage: analyzeDoshas(planets)
 *   planets = { sun, moon, mars, mercury, jupiter, venus, saturn,
 *               rahu, ketu, ascendant }   // sidereal longitudes, degrees 0-360
 *
 * Each dosha returns:
 *   { present, details, cancellations, severity }
 * where severity is one of 'none' | 'mild' | 'moderate' | 'strong'.
 * Mangal Dosha additionally returns fromLagna and fromMoon.
 *
 * Method notes (deliberately simple and transparent):
 * - Houses are whole-sign: house 1 is the sign containing the reference
 *   point (ascendant or Moon), house 2 the next sign, and so on.
 * - Conjunction orbs: 10 deg for the Sun/Jupiter/Mars "with Rahu" checks,
 *   6 deg for the Kaal Sarp axis check.
 *
 * Framing: doshas are presented as AREAS FOR AWARENESS, not curses and
 * not predictions of misfortune. Classical cancellations are shown with
 * equal prominence, and severity is always reduced when a cancellation
 * applies. This is the simplified textbook model; a professional
 * astrologer weighs many more factors before drawing conclusions.
 */

/* ------------------------------- constants ------------------------------ */

const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
  "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];

const PLANET_LABELS = {
  sun: "Sun", moon: "Moon", mars: "Mars", mercury: "Mercury",
  jupiter: "Jupiter", venus: "Venus", saturn: "Saturn",
  rahu: "Rahu", ketu: "Ketu"
};

const CLASSICAL_PLANETS = ["sun", "moon", "mars", "mercury", "jupiter", "venus", "saturn"];

const MARS_OWN_SIGNS = [1, 8];            // Aries, Scorpio
const MARS_EXALTED_SIGN = 10;             // Capricorn
const JUPITER_OWN_SIGNS = [9, 12];        // Sagittarius, Pisces
const JUPITER_EXALTED_SIGN = 5;           // Cancer
const SUN_OWN_SIGN = 5;                   // Leo
const SUN_EXALTED_SIGN = 1;               // Aries
const MERCURY_VENUS_SIGNS = [2, 3, 6, 7]; // Taurus, Gemini, Virgo, Libra

const MANGAL_HOUSES = [1, 2, 4, 7, 8, 12];
const MARS_ASPECTS = [4, 7, 8];           // Mars special aspects (whole-sign)
const JUPITER_ASPECTS = [5, 7, 9];        // Jupiter special aspects (whole-sign)

const CONJUNCT_ORB = 10; // deg, for the "planet with Rahu" doshas
const AXIS_ORB = 6;      // deg, for the Kaal Sarp axis check

const KAAL_SARP_TYPES = {
  1: "Anant", 2: "Kulik", 3: "Vasuki", 4: "Shankhpal",
  5: "Padma", 6: "Mahapadma", 7: "Takshak", 8: "Karkotak",
  9: "Shankhachood", 10: "Ghatak", 11: "Vishdhar", 12: "Sheshnag"
};

/* -------------------------------- helpers ------------------------------- */

function norm360(lon) {
  return ((lon % 360) + 360) % 360;
}

// Sign number 1-12 (1 = Aries) containing the longitude.
function signOf(lon) {
  return Math.floor(norm360(lon) / 30) + 1;
}

function signNameOf(lon) {
  return SIGN_NAMES[signOf(lon) - 1];
}

// Whole-sign house of planetLon counted from refLon (1-12).
function houseFrom(planetLon, refLon) {
  return ((signOf(planetLon) - signOf(refLon) + 12) % 12) + 1;
}

// Sign number found in house h (1-12) counted from sign s (1-12).
function signInHouseFrom(s, h) {
  return ((s - 1 + h - 1) % 12) + 1;
}

// Smallest angular separation between two longitudes, 0-180.
function angularSep(a, b) {
  const d = Math.abs(norm360(a) - norm360(b)) % 360;
  return d > 180 ? 360 - d : d;
}

// Whole-sign aspect check: is targetLon aspected by aspecterLon
// through any of the given aspect offsets (houses from the aspecter)?
function isAspectedBy(targetLon, aspecterLon, offsets) {
  return offsets.indexOf(houseFrom(targetLon, aspecterLon)) !== -1;
}

function deg(x) {
  return x.toFixed(2) + " deg";
}

function countPhrase(n) {
  return n + " planet" + (n === 1 ? "" : "s");
}

function validatePlanets(p) {
  if (!p || typeof p !== "object") {
    throw new Error("analyzeDoshas: expected an object with planet longitudes in degrees.");
  }
  const keys = ["sun", "moon", "mars", "mercury", "jupiter", "venus",
    "saturn", "rahu", "ketu", "ascendant"];
  for (const k of keys) {
    if (typeof p[k] !== "number" || !isFinite(p[k])) {
      throw new Error("analyzeDoshas: planets." + k + " must be a number (degrees 0-360).");
    }
  }
}

/* ------------------------------ Mangal Dosha ---------------------------- */
// Mars in houses 1, 2, 4, 7, 8 or 12 from the Lagna or from the Moon.

function analyzeMangalDosha(p) {
  const marsSign = signOf(p.mars);
  const houseLagna = houseFrom(p.mars, p.ascendant);
  const houseMoon = houseFrom(p.mars, p.moon);
  const fromLagna = MANGAL_HOUSES.indexOf(houseLagna) !== -1;
  const fromMoon = MANGAL_HOUSES.indexOf(houseMoon) !== -1;
  const present = fromLagna || fromMoon;

  const cancellations = [];
  if (present) {
    // Mars in its own or exaltation sign.
    if (MARS_OWN_SIGNS.indexOf(marsSign) !== -1) {
      cancellations.push("Mars is in its own sign, " + SIGN_NAMES[marsSign - 1] +
        ". Classical texts treat this as neutralizing Mangal Dosha.");
    } else if (marsSign === MARS_EXALTED_SIGN) {
      cancellations.push("Mars is exalted in Capricorn. Classical texts treat this " +
        "as neutralizing Mangal Dosha.");
    }
    // Mars in the 2nd from Lagna but in a Mercury/Venus sign.
    if (houseLagna === 2 && MERCURY_VENUS_SIGNS.indexOf(marsSign) !== -1) {
      cancellations.push("Mars is in the 2nd house from the ascendant but placed in " +
        SIGN_NAMES[marsSign - 1] + ", a sign of Mercury/Venus. Tradition does not " +
        "count this placement as Mangal Dosha.");
    }
    // Jupiter aspects Mars (guru-drishti).
    if (isAspectedBy(p.mars, p.jupiter, JUPITER_ASPECTS)) {
      cancellations.push("Jupiter aspects Mars (guru-drishti). Traditional texts say " +
        "this calms and neutralizes Mangal Dosha.");
    }
    // Jupiter or Venus in the Lagna.
    const jupInLagna = houseFrom(p.jupiter, p.ascendant) === 1;
    const venInLagna = houseFrom(p.venus, p.ascendant) === 1;
    if (jupInLagna || venInLagna) {
      const who = (jupInLagna ? "Jupiter" : "") +
        (jupInLagna && venInLagna ? " and " : "") +
        (venInLagna ? "Venus" : "");
      cancellations.push(who + " occupies the ascendant (1st house). A benefic in " +
        "the 1st house is traditionally said to cancel Mangal Dosha.");
    }
    // Mars aspects the Lagna.
    if (MARS_ASPECTS.indexOf(houseFrom(p.ascendant, p.mars)) !== -1) {
      cancellations.push("Mars aspects the ascendant. Traditional texts count this " +
        "as a cancellation of Mangal Dosha.");
    }
    // Mars aspects its own sign (Aries/Scorpio in its 4th, 7th or 8th aspect).
    const ownAspected = MARS_ASPECTS
      .map(function (h) { return signInHouseFrom(marsSign, h); })
      .filter(function (s) { return MARS_OWN_SIGNS.indexOf(s) !== -1; })[0];
    if (ownAspected) {
      cancellations.push("Mars aspects its own sign, " + SIGN_NAMES[ownAspected - 1] +
        ". Traditional texts count this self-regard of Mars as a cancellation " +
        "of the dosha.");
    }
  }

  let details, severity;
  if (!present) {
    details = "Mars is in house " + houseLagna + " from the ascendant and house " +
      houseMoon + " from the Moon (whole-sign houses). The classical Mangal Dosha " +
      "houses are 1, 2, 4, 7, 8 and 12, so no Mangal Dosha is present in this chart.";
    severity = "none";
  } else {
    const refs = [];
    if (fromLagna) refs.push("the ascendant (house " + houseLagna + ", " + signNameOf(p.mars) + ")");
    if (fromMoon) refs.push("the Moon (house " + houseMoon + ", " + signNameOf(p.mars) + ")");
    details = "Mars occupies a classical Mangal Dosha house from " + refs.join(" and ") +
      ". Traditional astrology links this placement with a forthright, high-energy " +
      "temperament that benefits from conscious give-and-take in close partnerships. " +
      "It is an area for awareness and adjustment, not a verdict on relationships. " +
      "The classical cancellations below carry equal weight in traditional assessment. " +
      "(Compatibility note: tradition holds the dosha neutralized when both " +
      "partners' charts carry it.)";
    severity = (fromLagna && fromMoon) ? "strong" : "moderate";
    if (cancellations.length > 0) severity = "mild";
  }

  return {
    present: present,
    fromLagna: fromLagna,
    fromMoon: fromMoon,
    details: details,
    cancellations: cancellations,
    severity: severity
  };
}

/* ---------------------------- Kaal Sarp Dosha --------------------------- */
// All seven classical planets hemmed on one side of the Rahu-Ketu axis
// (within a single 180-degree half of the chart).

function analyzeKaalSarpDosha(p) {
  const EPS = 1e-6;
  // Signed position of each planet measured from Rahu (0-360).
  const rel = CLASSICAL_PLANETS.map(function (k) {
    return { key: k, d: norm360(p[k] - p.rahu) };
  });
  const inForwardHalf = rel.every(function (r) { return r.d > EPS && r.d < 180 - EPS; });
  const inBackwardHalf = rel.every(function (r) { return r.d > 180 + EPS && r.d < 360 - EPS; });
  const present = inForwardHalf || inBackwardHalf;

  const cancellations = [];
  if (present) {
    // A planet sitting on (very near) the axis breaks the enclosure.
    const onAxis = CLASSICAL_PLANETS.filter(function (k) {
      return angularSep(p[k], p.rahu) <= AXIS_ORB || angularSep(p[k], p.ketu) <= AXIS_ORB;
    });
    onAxis.forEach(function (k) {
      cancellations.push(PLANET_LABELS[k] + " sits within " + AXIS_ORB +
        " deg of the Rahu-Ketu axis. Traditional texts say a planet on the axis " +
        "breaks the enclosure.");
    });
  }

  let details, severity;
  if (!present) {
    const fwd = rel.filter(function (r) { return r.d < 180; }).length;
    const bwd = CLASSICAL_PLANETS.length - fwd;
    details = "The seven classical planets are split across the Rahu-Ketu axis (" +
      countPhrase(fwd) + " on the Rahu-to-Ketu side, " + countPhrase(bwd) +
      " on the Ketu-to-Rahu side). Kaal Sarp Dosha needs all seven on one side, " +
      "so it is not present.";
    severity = "none";
  } else {
    const side = inForwardHalf ? "Rahu-to-Ketu" : "Ketu-to-Rahu";
    const rahuHouse = houseFrom(p.rahu, p.ascendant);
    const typeName = KAAL_SARP_TYPES[rahuHouse];
    details = "All seven classical planets (Sun, Moon, Mars, Mercury, Jupiter, Venus, " +
      "Saturn) fall within one half of the chart divided by the Rahu-Ketu axis, on " +
      "the " + side + " side. Classical texts call this Kaal Sarp Dosha. With Rahu " +
      "in house " + rahuHouse + " from the ascendant, the traditional name for this " +
      "pattern is " + typeName + " Kaal Sarp. It is described as a pattern of " +
      "concentrated, all-or-nothing rhythms in life's undertakings, best met with " +
      "steady, patient effort. This is an area for awareness, not a prediction of " +
      "misfortune, and the cancellation below applies equally.";
    severity = cancellations.length > 0 ? "moderate" : "strong";
  }

  return {
    present: present,
    details: details,
    cancellations: cancellations,
    severity: severity
  };
}

/* ----------------------------- Pitra Dosha ------------------------------ */
// Simplified markers: Sun conjunct Rahu (within 10 deg), or Rahu in the
// 9th house from the Lagna.

function analyzePitraDosha(p) {
  const sep = angularSep(p.sun, p.rahu);
  const conjunct = sep <= CONJUNCT_ORB;
  const rahuHouse = houseFrom(p.rahu, p.ascendant);
  const rahuInNinth = rahuHouse === 9;
  const present = conjunct || rahuInNinth;

  const cancellations = [];
  if (present) {
    const sunSign = signOf(p.sun);
    if (sunSign === SUN_OWN_SIGN) {
      cancellations.push("The Sun is in its own sign, Leo. A strong Sun is " +
        "traditionally said to offset this combination.");
    } else if (sunSign === SUN_EXALTED_SIGN) {
      cancellations.push("The Sun is exalted in Aries. A strong Sun is " +
        "traditionally said to offset this combination.");
    }
    if (isAspectedBy(p.sun, p.jupiter, JUPITER_ASPECTS)) {
      cancellations.push("Jupiter aspects the Sun (guru-drishti), which traditional " +
        "texts say protects and neutralizes the affliction.");
    }
    if (houseFrom(p.jupiter, p.ascendant) === 9) {
      cancellations.push("Jupiter occupies the 9th house, strengthening the house of " +
        "lineage, which traditional texts say offsets this dosha.");
    }
  }

  let details, severity;
  if (!present) {
    details = "Sun-Rahu separation is " + deg(sep) + " (this check uses a " +
      CONJUNCT_ORB + " deg orb), and Rahu is in house " + rahuHouse +
      " from the ascendant (this check looks for house 9). Neither simplified " +
      "marker for Pitra Dosha is present.";
    severity = "none";
  } else {
    const markers = [];
    if (conjunct) markers.push("the Sun is within " + deg(sep) + " of Rahu, a close conjunction");
    if (rahuInNinth) markers.push("Rahu occupies the 9th house from the ascendant, the house of lineage and mentors");
    details = "In this chart " + markers.join(", and ") + ". " +
      (markers.length > 1 ? "These are" : "This is") +
      " the simplified marker" + (markers.length > 1 ? "s" : "") +
      " used here for Pitra Dosha, a classical theme linked with the ancestral line " +
      "and the father figure. It is treated as an area for reflection and goodwill, " +
      "not a verdict on family. The cancellations below carry equal weight.";
    severity = cancellations.length > 0 ? "mild" : "moderate";
  }

  return {
    present: present,
    details: details,
    cancellations: cancellations,
    severity: severity
  };
}

/* -------------------------- Guru Chandal Dosha -------------------------- */
// Jupiter conjunct Rahu (within 10 deg).

function analyzeGuruChandalDosha(p) {
  const sep = angularSep(p.jupiter, p.rahu);
  const present = sep <= CONJUNCT_ORB;

  const cancellations = [];
  if (present) {
    const jupSign = signOf(p.jupiter);
    if (JUPITER_OWN_SIGNS.indexOf(jupSign) !== -1) {
      cancellations.push("Jupiter is in its own sign, " + SIGN_NAMES[jupSign - 1] +
        ". A strong Jupiter is traditionally said to neutralize this combination.");
    } else if (jupSign === JUPITER_EXALTED_SIGN) {
      cancellations.push("Jupiter is exalted in Cancer. A strong Jupiter is " +
        "traditionally said to neutralize this combination.");
    }
    const jupHouse = houseFrom(p.jupiter, p.ascendant);
    if ([1, 4, 5, 7, 9, 10].indexOf(jupHouse) !== -1) {
      cancellations.push("Jupiter occupies house " + jupHouse + " from the ascendant, " +
        "a kendra/trikona (angular/trine) house. Such a strong placement is " +
        "traditionally said to offset the affliction.");
    }
    if (isAspectedBy(p.jupiter, p.venus, [7])) {
      cancellations.push("Venus aspects Jupiter, traditionally a moderating influence " +
        "on this combination.");
    }
  }

  let details, severity;
  if (!present) {
    details = "Jupiter-Rahu separation is " + deg(sep) + ", outside the " +
      CONJUNCT_ORB + " deg orb used for this check. Guru Chandal Dosha is not present.";
    severity = "none";
  } else {
    details = "Jupiter is within " + deg(sep) + " of Rahu. Classical texts call this " +
      "combination Guru Chandal Dosha and associate it with an unconventional, " +
      "questioning attitude toward received wisdom and teachers. It is presented " +
      "here as an area for awareness about discernment in guidance, not a moral " +
      "judgment. The cancellations below carry equal weight.";
    severity = cancellations.length > 0 ? "mild" : "moderate";
  }

  return {
    present: present,
    details: details,
    cancellations: cancellations,
    severity: severity
  };
}

/* ---------------------------- Angarak Dosha ----------------------------- */
// Mars conjunct Rahu (within 10 deg).

function analyzeAngarakDosha(p) {
  const sep = angularSep(p.mars, p.rahu);
  const present = sep <= CONJUNCT_ORB;

  const cancellations = [];
  if (present) {
    const marsSign = signOf(p.mars);
    if (MARS_OWN_SIGNS.indexOf(marsSign) !== -1) {
      cancellations.push("Mars is in its own sign, " + SIGN_NAMES[marsSign - 1] +
        ". Classical texts treat this as neutralizing Angarak Dosha.");
    } else if (marsSign === MARS_EXALTED_SIGN) {
      cancellations.push("Mars is exalted in Capricorn. Classical texts treat this " +
        "as neutralizing Angarak Dosha.");
    }
    if (isAspectedBy(p.mars, p.jupiter, JUPITER_ASPECTS)) {
      cancellations.push("Jupiter aspects Mars (guru-drishti), which traditional " +
        "texts say calms this combination.");
    }
  }

  let details, severity;
  if (!present) {
    details = "Mars-Rahu separation is " + deg(sep) + ", outside the " +
      CONJUNCT_ORB + " deg orb used for this check. Angarak Dosha is not present.";
    severity = "none";
  } else {
    details = "Mars is within " + deg(sep) + " of Rahu. Classical texts call this " +
      "pairing Angarak Dosha and link it with intense, impulsive drives. It is an " +
      "area for awareness about channeling energy constructively, especially in " +
      "speech and quick decisions, not a prediction of harm. The cancellations " +
      "below carry equal weight.";
    severity = cancellations.length > 0 ? "mild" : "moderate";
  }

  return {
    present: present,
    details: details,
    cancellations: cancellations,
    severity: severity
  };
}

/* --------------------------------- main --------------------------------- */

function analyzeDoshas(planets) {
  validatePlanets(planets);
  return {
    mangalDosha: analyzeMangalDosha(planets),
    kaalSarpDosha: analyzeKaalSarpDosha(planets),
    pitraDosha: analyzePitraDosha(planets),
    guruChandalDosha: analyzeGuruChandalDosha(planets),
    angarakDosha: analyzeAngarakDosha(planets)
  };
}
