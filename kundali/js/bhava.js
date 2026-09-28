"use strict";
/* Bhava (house) analysis - Simplified.
 * Uses whole sign houses from Lagna.
 */

function bhavaAnalysis(planets) {
  const ascSign = Math.floor(planets.ascendant / 30);
  const houses = {};
  const planetKeys = ['sun','moon','mars','mercury','jupiter','venus','saturn','rahu','ketu'];
  planetKeys.forEach(key => {
    const sign = Math.floor(planets[key] / 30);
    const house = ((sign - ascSign + 12) % 12) + 1;
    if (!houses[house]) houses[house] = [];
    houses[house].push(key);
  });
  return {houses: houses, ascSign: ascSign};
}

function houseSignifications(house) {
  const sig = {
    1: "Self, personality, health, overall life",
    2: "Wealth, family, speech, food",
    3: "Siblings, courage, short travels, communication",
    4: "Mother, home, property, education, happiness",
    5: "Children, creativity, romance, intelligence",
    6: "Enemies, disease, service, daily work",
    7: "Partnership, marriage, business, spouse",
    8: "Longevity, transformation, inheritance, occult",
    9: "Fortune, dharma, father, higher learning, travel",
    10: "Career, profession, status, karma",
    11: "Gains, friends, aspirations, elder siblings",
    12: "Losses, expenses, foreign, spirituality, liberation"
  };
  return sig[house] || "";
}
