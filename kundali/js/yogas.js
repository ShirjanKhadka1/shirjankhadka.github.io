"use strict";
/* Classical yoga detection with bespoke narratives.
   Each yoga found produces a specific paragraph naming the actual planets,
   signs and houses involved. All globals use the yg prefix. */

var yg_SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
var yg_LORDS = ['Mars','Venus','Mercury','Moon','Sun','Mercury','Venus','Mars','Jupiter','Saturn','Saturn','Jupiter'];
var yg_EXALT = {sun:0, moon:1, mars:9, mercury:5, jupiter:3, venus:11, saturn:6};
var yg_OWN = {sun:[4], moon:[3], mars:[0,7], mercury:[2,5], jupiter:[8,11], venus:[1,6], saturn:[9,10]};
var yg_DEBIL = {sun:6, moon:7, mars:3, mercury:11, jupiter:9, venus:5, saturn:0};

function ygSignOf(lon) { var x = lon % 360; if (x < 0) x += 360; return Math.floor(x / 30) % 12; }
function ygHouseOf(p, key) {
  var ascS = ygSignOf(p.ascendant);
  return ((ygSignOf(p[key]) - ascS + 12) % 12) + 1;
}
function ygHouseFromMoon(p, key) {
  var ms = ygSignOf(p.moon);
  return ((ygSignOf(p[key]) - ms + 12) % 12) + 1;
}
function ygHouseSign(p, h) { return (ygSignOf(p.ascendant) + h - 1) % 12; }
function ygHouseLord(p, h) { return yg_LORDS[ygHouseSign(p, h)]; }
function ygIsDignified(key, lon) {
  var s = ygSignOf(lon);
  return yg_EXALT[key] === s || (yg_OWN[key] && yg_OWN[key].indexOf(s) >= 0);
}
function ygIsDebilitated(key, lon) { return yg_DEBIL[key] === ygSignOf(lon); }
function ygOrd(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }
function ygCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

var yg_PMP = {
  mars:    {name:'Ruchaka', text:'fearlessness, physical energy and command. Tradition associates Ruchaka with leaders, builders and those who win through courage.'},
  mercury: {name:'Bhadra',  text:'sharp intellect, eloquence and learning. Tradition associates Bhadra with scholars, traders and master communicators.'},
  jupiter: {name:'Hamsa',   text:'wisdom, counsel and moral authority. Tradition associates Hamsa with teachers, advisors and guides others trust.'},
  venus:   {name:'Malavya', text:'refinement, arts and material grace. Tradition associates Malavya with artists, connoisseurs and those who prosper through beauty and harmony.'},
  saturn:  {name:'Shasha',  text:'discipline, endurance and command over systems. Tradition associates Shasha with administrators, organizers and those who rise through sheer perseverance.'}
};

function detectYogas(p) {
  var found = [];
  var KENDRA = [1,4,7,10];

  /* Pancha Mahapurusha */
  ['mars','mercury','jupiter','venus','saturn'].forEach(function(key) {
    if (ygIsDignified(key, p[key]) && KENDRA.indexOf(ygHouseOf(p, key)) >= 0) {
      var info = yg_PMP[key];
      found.push({
        name: info.name + ' Mahapurusha Yoga',
        text: ygCap(key) + ' is ' + (yg_EXALT[key] === ygSignOf(p[key]) ? 'exalted' : 'in its own sign') +
          ' in ' + yg_SIGNS[ygSignOf(p[key])] + ', placed in the kendra ' + ygOrd(ygHouseOf(p, key)) +
          ' house. This forms ' + info.name + ' Mahapurusha Yoga, one of the five great person-forming combinations: ' +
          info.text + ' Because the planet stands in a kendra, its gifts show visibly in the life, not just inwardly.'
      });
    }
  });

  /* Gaja Kesari: Jupiter in kendra from Moon */
  if ([1,4,7,10].indexOf(ygHouseFromMoon(p, 'jupiter')) >= 0) {
    found.push({
      name: 'Gaja Kesari Yoga',
      text: 'Jupiter stands in a kendra from your Moon (the ' + ygOrd(ygHouseFromMoon(p, 'jupiter')) +
        ' from the Moon in ' + yg_SIGNS[ygSignOf(p.moon)] + '), forming Gaja Kesari Yoga, the "elephant-lion" combination. ' +
        'Classical texts read this as intelligence allied with character: sound judgment, respected counsel, and a reputation that survives storms. ' +
        'It is traditionally said to protect the native even in difficult dashas.'
    });
  }

  /* Budha-Aditya: Sun and Mercury in the same sign */
  if (ygSignOf(p.sun) === ygSignOf(p.mercury)) {
    found.push({
      name: 'Budha-Aditya Yoga',
      text: 'Sun and Mercury share ' + yg_SIGNS[ygSignOf(p.sun)] + ' in the ' + ygOrd(ygHouseOf(p, 'sun')) +
        ' house, forming Budha-Aditya Yoga. Tradition reads this as intellect fused with purpose: ' +
        'clear thinking in the service of clear goals, skill in analysis, writing, and advisory work.'
    });
  }

  /* Chandra-Mangala: Moon and Mars in the same sign */
  if (ygSignOf(p.moon) === ygSignOf(p.mars)) {
    found.push({
      name: 'Chandra-Mangala Yoga',
      text: 'Moon and Mars stand together in ' + yg_SIGNS[ygSignOf(p.moon)] + ', forming Chandra-Mangala Yoga, ' +
        'a classical wealth combination. Tradition reads it as emotional drive converted into enterprise: ' +
        'the native earns through initiative and nerve. The counsel is to keep the fire aimed at building, not at quarrels.'
    });
  }

  /* Neecha Bhanga: debilitated planet with cancellation */
  ['sun','moon','mars','mercury','jupiter','venus','saturn'].forEach(function(key) {
    if (!ygIsDebilitated(key, p[key])) return;
    var dispSign = ygSignOf(p[key]);
    var dispLord = yg_LORDS[dispSign].toLowerCase();
    var exLord = null;
    for (var k in yg_EXALT) { if (yg_EXALT[k] === dispSign) exLord = k; }
    var cancelled = null;
    if ([1,4,7,10].indexOf(ygHouseOf(p, dispLord)) >= 0)
      cancelled = 'its dispositor ' + ygCap(dispLord) + ' stands in the kendra ' + ygOrd(ygHouseOf(p, dispLord)) + ' house from the ascendant';
    else if ([1,4,7,10].indexOf(ygHouseFromMoon(p, dispLord)) >= 0)
      cancelled = 'its dispositor ' + ygCap(dispLord) + ' stands in a kendra from the Moon';
    else if (exLord && [1,4,7,10].indexOf(ygHouseOf(p, exLord)) >= 0)
      cancelled = 'the lord of its exaltation sign, ' + ygCap(exLord) + ', stands in the kendra ' + ygOrd(ygHouseOf(p, exLord)) + ' house';
    if (cancelled) {
      found.push({
        name: 'Neecha Bhanga Raja Yoga (' + ygCap(key) + ')',
        text: ygCap(key) + ' is debilitated in ' + yg_SIGNS[dispSign] + ', but the debility is cancelled because ' +
          cancelled + '. This is Neecha Bhanga Raja Yoga: the classical texts say a cancelled fall becomes a rise. ' +
          'The significations of ' + ygCap(key) + ' may stumble early in life and then strengthen markedly, often becoming a source of distinction rather than weakness.'
      });
    }
  });

  /* Dhana yogas: lords of 2, 5, 9, 11 connected */
  var dhanaLords = [2,5,9,11].map(function(h){ return ygHouseLord(p, h).toLowerCase(); });
  var seen = {}, pairs = [];
  for (var i = 0; i < dhanaLords.length; i++) {
    for (var j = i + 1; j < dhanaLords.length; j++) {
      var a = dhanaLords[i], b = dhanaLords[j];
      if (a === b || seen[a+'+'+b] || seen[b+'+'+a]) continue;
      var ha = ygHouseOf(p, a), hb = ygHouseOf(p, b);
      var conjunct = ygSignOf(p[a]) === ygSignOf(p[b]);
      var kendraTrikona = ([1,4,7,10,5,9].indexOf(ha) >= 0 && [1,4,7,10,5,9].indexOf(hb) >= 0);
      if (conjunct || kendraTrikona) {
        seen[a+'+'+b] = 1;
        pairs.push({a:a, b:b, how: conjunct ? 'conjoined in the ' + ygOrd(ha) + ' house' :
          'placed in the ' + ygOrd(ha) + ' and ' + ygOrd(hb) + ' houses'});
      }
    }
  }
  if (pairs.length > 0) {
    var desc = pairs.slice(0, 2).map(function(pr){ return ygCap(pr.a) + ' and ' + ygCap(pr.b) + ' ' + pr.how; }).join('; ');
    found.push({
      name: 'Dhana Yoga',
      text: 'Wealth combinations are present: ' + desc + '. Dhana yogas connect the houses of accumulation (2nd), ' +
        'intelligence (5th), fortune (9th) and gains (11th). Tradition reads these as channels through which resources ' +
        'can accumulate across the life, especially during the dashas of the planets involved.'
    });
  }

  return found;
}
