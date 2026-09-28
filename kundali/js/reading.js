"use strict";
/* Detailed personal reading engine.
   Generates a long-form, chart-specific narrative in the style of a professional
   Jyotish consultation: bottom line, past-present-future dasha chapters,
   temperament, relationships, career paths, money, symbolic health, and timing.
   Every sentence is grounded in computed chart factors. No invented biography.
   All globals here use the rdg prefix to avoid collisions. */

var rdg_SIGNS = ['Aries','Taurus','Gemini','Cancer','Leo','Virgo','Libra','Scorpio','Sagittarius','Capricorn','Aquarius','Pisces'];
var rdg_LORDS = ['Mars','Venus','Mercury','Moon','Sun','Mercury','Venus','Mars','Jupiter','Saturn','Saturn','Jupiter'];
var rdg_EXALT = {sun:0, moon:1, mars:9, mercury:5, jupiter:3, venus:11, saturn:6};
var rdg_DEBIL = {sun:6, moon:7, mars:3, mercury:11, jupiter:9, venus:5, saturn:0};
var rdg_OWN = {sun:[4], moon:[3], mars:[0,7], mercury:[2,5], jupiter:[8,11], venus:[1,6], saturn:[9,10]};
var rdg_KEYS = ['sun','moon','mars','mercury','jupiter','venus','saturn'];
var rdg_NAMES = {sun:'Sun', moon:'Moon', mars:'Mars', mercury:'Mercury', jupiter:'Jupiter', venus:'Venus', saturn:'Saturn', rahu:'Rahu', ketu:'Ketu'};

function rdgSignOf(lon) { var x = lon % 360; if (x < 0) x += 360; return Math.floor(x / 30) % 12; }
function rdgHouseOf(p, key) {
  var ascS = rdgSignOf(p.ascendant);
  return ((rdgSignOf(p[key]) - ascS + 12) % 12) + 1;
}
function rdgHouseSign(p, h) { return (rdgSignOf(p.ascendant) + h - 1) % 12; }
function rdgHouseLord(p, h) { return rdg_LORDS[rdgHouseSign(p, h)]; }
function rdgDignity(key, lon) {
  var s = rdgSignOf(lon);
  if (rdg_EXALT[key] === s) return 'exalted';
  if (rdg_DEBIL[key] === s) return 'debilitated';
  if (rdg_OWN[key] && rdg_OWN[key].indexOf(s) >= 0) return 'own';
  return 'neutral';
}
function rdgDignityPhrase(key, lon) {
  var d = rdgDignity(key, lon), s = rdg_SIGNS[rdgSignOf(lon)];
  if (d === 'exalted') return 'exalted in ' + s + ', its strongest placement';
  if (d === 'own') return 'in its own sign ' + s + ', steady and dependable';
  if (d === 'debilitated') return 'debilitated in ' + s + ', so this area needs conscious work';
  return 'in ' + s;
}
function rdgEsc(s) {
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function rdgYear(jd) {
  var d = new Date((jd - 2440587.5) * 86400000);
  return d.getUTCFullYear();
}
function rdgYearRange(a, b) {
  var da = new Date((a - 2440587.5) * 86400000), db = new Date((b - 2440587.5) * 86400000);
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  if (da.getUTCFullYear() === db.getUTCFullYear()) {
    if (db - da < 100 * 86400000) return months[da.getUTCMonth()] + ' ' + da.getUTCFullYear();
    return months[da.getUTCMonth()] + ' to ' + months[db.getUTCMonth()] + ' ' + db.getUTCFullYear();
  }
  return da.getUTCFullYear() + ' to ' + db.getUTCFullYear();
}

var rdg_HOUSE_THEMES = {
  1: 'self, vitality and initiative', 2: 'wealth, family and speech', 3: 'courage, initiative and skill with the hands',
  4: 'home, emotional foundations and property', 5: 'creativity, intellect and children', 6: 'competition, service and daily discipline',
  7: 'partnership and marriage', 8: 'transformation, research and shared resources', 9: 'fortune, mentors and higher learning',
  10: 'career and public standing', 11: 'gains, networks and ambitions', 12: 'foreign connections, retreat and the inner life'
};
function rdgOrdinal(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th'; }

/* Score a planet's overall strength for narrative ranking. */
function rdgStrength(p, key, jd) {
  var score = 0, lon = p[key], d = rdgDignity(key, lon);
  if (d === 'exalted') score += 3; else if (d === 'own') score += 2; else if (d === 'debilitated') score -= 2;
  var h = rdgHouseOf(p, key);
  if ([1,4,7,10].indexOf(h) >= 0) score += 1;
  if ([5,9].indexOf(h) >= 0) score += 1;
  if (typeof planetIsRetrograde === 'function' && planetIsRetrograde(key, jd)) score += 0;
  return score;
}

/* ---- Bespoke signature paragraphs: planet x dignity ---- */
var rdg_SIGNATURES = {
  sun: {
    exalted: 'An exalted Sun gives a strong spine: authority feels natural, and recognition follows sustained integrity rather than self-promotion. The classical warning is pride; the counsel is to spend authority on others and it returns multiplied.',
    own: 'The Sun in its own sign Leo gives steady self-respect and leadership that does not need applause. You are at your best with responsibility that is truly yours, and you wilt in roles where you must shrink to fit.',
    debilitated: 'A debilitated Sun asks for conscious confidence-building. Authority may feel borrowed in early life; the texts advise earning it inwardly first, through competence and kept promises, before the outer world grants it.'
  },
  moon: {
    exalted: 'An exalted Moon is one of the finest placements in the classical scheme: emotional intelligence, popularity, and a mind that stays clear under pressure. Others instinctively trust your read of a situation.',
    own: 'The Moon in its own sign Cancer gives deep feeling and strong attachment to home, people, and memory. Nurture is your native language; guard against carrying what belongs to others.',
    debilitated: 'A debilitated Moon makes the inner weather changeable, and the texts prescribe deliberate emotional hygiene: protected sleep, honest conversation, and no major decisions on the heaviest days.'
  },
  mars: {
    exalted: 'An exalted Mars gives exceptional drive and tactical intelligence: the courage to start and the stamina to finish. Tradition marks this as the signature of builders, competitors, and those who win hard things.',
    own: 'Mars in its own sign gives clean, honest energy: you act rather than brood, and you respect the same in others. Impatience is the tax; channel it into work and sport and it becomes an asset.',
    debilitated: 'A debilitated Mars scatters its fire: bursts of effort followed by friction or fatigue. The classical counsel is structure, choose one arena, train the energy like an athlete, and avoid decisions made in anger.'
  },
  mercury: {
    exalted: 'An exalted Mercury gives a first-rate analytical mind: precise, quick, and commercially sharp. Writing, analysis, trade, and technology are natural instruments; the risk is overthinking what should simply be felt.',
    own: 'Mercury in its own sign gives versatility of mind and fluency with ideas, numbers, and words. You learn fast and adapt faster; the counsel is to finish a few deep masteries instead of collecting many shallow ones.',
    debilitated: 'A debilitated Mercury muddles the signal: misunderstandings, second-guessing, and scattered study. The texts advise slowing down communication, writing things down, and verifying before concluding.'
  },
  jupiter: {
    exalted: 'An exalted Jupiter is the classical signature of wisdom and protection: mentors appear, judgment stays sound, and even difficult periods carry a hidden hand of guidance. Others seek your counsel because it proves right.',
    own: 'Jupiter in its own sign gives principled optimism and a talent for guidance, teaching, and finance. You believe things can be better and you work to make them so; guard against preaching to those who did not ask.',
    debilitated: 'A debilitated Jupiter clouds judgment about people and promises: trust must be verified, not assumed. The classical remedy is humility in counsel, conservatism with money lent, and teachers chosen by character, not charisma.'
  },
  venus: {
    exalted: 'An exalted Venus gives refined affection and an eye for harmony: deep loyalty in love, taste in art and environment, and a traditional signature of comfort and creative gifts. Relationships tend to heal rather than break.',
    own: 'Venus in its own sign gives warmth, charm, and a genuine love of beauty and pleasure. You create pleasantness around you; the counsel is to invest in real intimacy rather than mere comfort.',
    debilitated: 'A debilitated Venus distorts the mirror of relationships: expectations go unspoken and then unmet. The texts advise explicit agreements early, in love and in money, because clarity is what this placement must learn.'
  },
  saturn: {
    exalted: 'An exalted Saturn gives formidable staying power: discipline without bitterness, authority earned the slow way. Tradition reads this as the signature of those who build institutions and outlast every rival.',
    own: 'Saturn in its own sign gives structured endurance and respect for process. You do not mind the long road; in fact you distrust shortcuts. Responsibility gravitates to you because you carry it without complaint.',
    debilitated: 'A debilitated Saturn makes duty feel heavy and progress slow, and the texts warn against both resentment and evasion. The way through is smaller promises kept perfectly: Saturn pays compound interest on every honest effort.'
  }
};

function rdgHouseGroup(h) {
  if ([1,4,7,10].indexOf(h) >= 0) return 'kendra';
  if ([5,9].indexOf(h) >= 0) return 'trikona';
  if ([6,8,12].indexOf(h) >= 0) return 'dusthana';
  if ([3,6,10,11].indexOf(h) >= 0) return 'upachaya';
  return 'neutral';
}
function rdgGroupNote(h) {
  var g = rdgHouseGroup(h);
  if (g === 'kendra') return 'In a kendra, this is a visible, load-bearing part of the life, not a background detail.';
  if (g === 'trikona') return 'In a trikona, fortune and support flow toward this area with less friction than most.';
  if (g === 'upachaya') return 'In an upachaya house, this grows through sustained effort: slow at first, then compounding.';
  if (g === 'dusthana') return 'In a dusthana house, this area teaches through friction; what is learned here becomes wisdom, not just experience.';
  return '';
}

/* ---- Key yogas section ---- */
function rdgYogasSection(p) {
  var yogas = (typeof detectYogas === 'function') ? detectYogas(p) : [];
  var html = '<h3>The key yogas of your chart</h3>';
  if (yogas.length === 0) {
    html += '<p>No classical yogas stand out in this chart, which the texts read neutrally: the life is shaped more by dasha timing and effort than by standout combinations. The dignified planets below still mark your strengths.</p>';
    return html;
  }
  html += '<p>Yogas are the classical combinations, specific planetary patterns the texts name and interpret. These are the ones your chart carries:</p>';
  yogas.forEach(function(y) {
    html += '<h4>' + rdgEsc(y.name) + '</h4><p>' + rdgEsc(y.text) + '</p>';
  });
  return html;
}

/* ---- Signatures of dignified planets ---- */
function rdgSignatureSection(p) {
  var items = [];
  rdg_KEYS.forEach(function(key) {
    var d = rdgDignity(key, p[key]);
    if ((d === 'exalted' || d === 'own' || d === 'debilitated') && rdg_SIGNATURES[key] && rdg_SIGNATURES[key][d]) {
      items.push({key:key, d:d});
    }
  });
  if (items.length === 0) return '';
  var html = '<h3>Your strongest planetary signatures</h3>';
  html += '<p>These are the planets that speak loudest in your chart, by classical dignity. Each shapes a distinct part of your nature:</p>';
  items.forEach(function(it) {
    var h = rdgHouseOf(p, it.key);
    html += '<h4>' + rdg_NAMES[it.key] + ', ' + it.d + ' in the ' + rdgOrdinal(h) + ' house</h4>';
    html += '<p>' + rdg_SIGNATURES[it.key][it.d] + ' ' + rdgGroupNote(h) + '</p>';
  });
  return html;
}

/* ---- 10th lord in house: specific career lines ---- */
var rdg_L10_HOUSE = {
  1: 'career and identity are fused: you are the enterprise, and self-employment or visible leadership suits you.',
  2: 'income grows through family resources, speech, or knowledge-based work; banking, teaching, and advisory roles fit.',
  3: 'advancement comes through initiative, skill, and media or hands-on craft; start things, do not wait to be chosen.',
  4: 'career connects to home, property, or emotional foundations; real estate, education, and care work are supported.',
  5: 'creativity and intellect are the career instruments; speculation-free creative or advisory professions suit you.',
  6: 'service, competition, and disciplined routine build the career; health, law, and organized service are strong.',
  7: 'partnerships carry the career: clients, collaborators, and public dealings are where you rise.',
  8: 'research, other people\'s resources, and transformation are the career themes; depth work over display work.',
  9: 'mentors, higher learning, and fortune favor the career; teaching, law, and guidance roles are natural.',
  10: 'the career stands on its own strength: profession is the central pillar of the life, and steady ambition pays.',
  11: 'networks and large goals drive the career; gains come through alliances, platforms, and ambitious projects.',
  12: 'foreign connections, retreat, or behind-the-scenes work shape the career; hospitals, research, and distant markets fit.'
};

/* ---- 7th lord in house: specific relationship lines ---- */
var rdg_L7_HOUSE = {
  1: 'partnership is central to identity: you become yourself more fully through committed relationship.',
  2: 'partnership ties closely to family and resources; shared finances need explicit, kind agreements.',
  3: 'relationships need friendship and conversation first; marry a companion, not just a romance.',
  4: 'domestic peace is the point of partnership; choose for home harmony over excitement.',
  5: 'romance leads toward commitment; love that begins in creativity or play can become lasting.',
  6: 'partnership asks for work and patience; choose reliability over charm, and keep health routines shared.',
  7: 'partnership is a natural strength: you understand give-and-take, and committed relationship supports the whole life.',
  8: 'bonding runs deep and transformative; trust must be built slowly, and then it becomes unbreakable.',
  9: 'a partner may arrive through mentors, learning, or fortune; shared values matter more than shared tastes.',
  10: 'partnership and public life intertwine; a spouse may influence career, and status considerations enter choice.',
  11: 'partnership grows from friendship and networks; marry within your world of shared ambitions.',
  12: 'partnership has a private, inward quality; protect the relationship from outside noise and keep some things sacred.'
};
function rdgBottomLine(p, jd) {
  var scored = rdg_KEYS.map(function(k){ return {k:k, s:rdgStrength(p,k,jd)}; })
    .sort(function(a,b){ return b.s - a.s; });
  var top = scored.slice(0, 3), parts = [];
  top.forEach(function(t) {
    var h = rdgHouseOf(p, t.k);
    parts.push(rdg_NAMES[t.k] + ' ' + rdgDignity(t.k, p[t.k]) + ' in the ' + rdgOrdinal(h) + ' house');
  });
  var lagnaLord = rdgHouseLord(p, 1).toLowerCase();
  var llHouse = rdgHouseOf(p, lagnaLord);
  return 'The chart is anchored by ' + parts.join(', ') + '. ' +
    'With ' + rdg_NAMES[lagnaLord] + ' ruling the ascendant from the ' + rdgOrdinal(llHouse) + ' house, ' +
    'the life direction keeps returning to the themes of ' + rdg_HOUSE_THEMES[llHouse] + '. ' +
    'Read everything below as tendencies and timings from the classical texts, not as fixed fate: effort, character and circumstance always co-author the outcome.';
}

/* ---- Dasha chapter narrative ---- */
function rdgDashaChapter(p, md, nowJD, jd) {
  var lord = md.lord, key = lord.toLowerCase();
  var h = (key === 'rahu' || key === 'ketu') ? rdgHouseOf(p, key) : rdgHouseOf(p, key);
  var sign = rdg_SIGNS[rdgSignOf(p[key])];
  var dig = (rdg_EXALT[key] === rdgSignOf(p[key])) ? 'exalted' :
            (rdg_DEBIL[key] === rdgSignOf(p[key])) ? 'debilitated' :
            (rdg_OWN[key] && rdg_OWN[key].indexOf(rdgSignOf(p[key])) >= 0) ? 'in its own sign' : 'placed';
  var when = rdgYearRange(md.startJD, md.endJD);
  var tense = md.endJD <= nowJD ? 'past' : (md.startJD <= nowJD ? 'present' : 'future');
  var portrait = (typeof DASHA_PORTRAITS !== 'undefined' && DASHA_PORTRAITS[lord]) ? DASHA_PORTRAITS[lord] : '';
  var head = '<h4>' + lord + ' Mahadasha, ' + when + (tense === 'present' ? ' (running now)' : tense === 'past' ? ' (completed)' : ' (upcoming)') + '</h4>';
  var placement = '<p class="rdg-factors">Chart factors: ' + lord + ' ' + dig + ' in ' + sign + ', ' + rdgOrdinal(h) + ' house (themes: ' + rdg_HOUSE_THEMES[h] + ').</p>';
  var counsel = '';
  if (dig === 'exalted' || dig === 'in its own sign') counsel = 'A dignified period lord delivers its themes generously; this is a chapter to act boldly in its direction. ';
  else if (dig === 'debilitated') counsel = 'A debilitated period lord asks for humility and extra effort; lower the stakes, keep routines tight, and this chapter still yields its lessons. ';
  counsel += rdgGroupNote(h) + ' ';
  var open;
  if (tense === 'past') open = 'These years are behind you now, and they set the foundation you stand on. ';
  else if (tense === 'present') open = 'This is the chapter you are living inside right now. ';
  else open = 'This chapter is still ahead. Knowing its themes lets you prepare rather than react. ';
  return head + placement + '<p>' + open + rdgEsc(portrait) + '</p>' + (counsel ? '<p><em>' + counsel + '</em></p>' : '');
}

/* ---- Temperament ---- */
function rdgTemperament(p, moonLong) {
  var lagnaLord = rdgHouseLord(p, 1), llk = lagnaLord.toLowerCase();
  var llHouse = rdgHouseOf(p, llk);
  var moonSign = rdg_SIGNS[rdgSignOf(moonLong)];
  var moonHouse = rdgHouseOf(p, 'moon');
  var html = '<h3>Temperament and mind</h3>';
  html += '<p class="rdg-factors">Chart factors: ' + rdg_SIGNS[rdgSignOf(p.ascendant)] + ' rising; chart lord ' + lagnaLord + ' ' +
    rdgDignityPhrase(llk, p[llk]) + ', ' + rdgOrdinal(llHouse) + ' house; Moon in ' + moonSign + ', ' + rdgOrdinal(moonHouse) + ' house.</p>';
  html += '<p>You meet the world through ' + rdg_SIGNS[rdgSignOf(p.ascendant)] + ' rising, and your chart lord ' + lagnaLord +
    ' sits in the house of ' + rdg_HOUSE_THEMES[llHouse] + ', so that area of life keeps pulling your attention and energy. ' +
    'The Moon, which classical texts read as the mind itself, is ' + rdgDignity('moon', moonLong) +
    ' in ' + moonSign + '. ';
  var md = rdgDignity('moon', moonLong);
  if (md === 'exalted' || md === 'own') html += 'An emotionally strong Moon gives resilience: feelings run deep but recovery is quick, and others sense steadiness in you.';
  else if (md === 'debilitated') html += 'The Moon here asks for deliberate emotional hygiene: regular sleep, honest conversation, and not making big decisions on the heaviest days.';
  else html += 'The mind is adaptable rather than fixed: moods shift with circumstance, and routines that stabilize sleep and diet stabilize everything else.';
  html += '</p>';
  return html;
}

/* ---- Relationships ---- */
function rdgRelationships(p) {
  var lord7 = rdgHouseLord(p, 7), l7k = lord7.toLowerCase();
  var h7 = rdgHouseOf(p, l7k);
  var venusH = rdgHouseOf(p, 'venus');
  var html = '<h3>Relationships and marriage</h3>';
  html += '<p class="rdg-factors">Chart factors: 7th lord ' + lord7 + ' ' + rdgDignityPhrase(l7k, p[l7k]) + ', ' +
    rdgOrdinal(h7) + ' house; Venus ' + rdgDignityPhrase('venus', p.venus) + ', ' + rdgOrdinal(venusH) + ' house.</p>';
  html += '<p>Classical texts read partnership from the 7th house and its lord, with Venus describing the quality of affection. ';
  html += 'Your 7th lord ' + lord7 + ' operates through the ' + rdgOrdinal(h7) + ' house, so partnerships in your life tend to be colored by ' +
    rdg_HOUSE_THEMES[h7] + '. ' + rdg_L7_HOUSE[h7] + ' ';
  var vd = rdgDignity('venus', p.venus);
  if (vd === 'exalted' || vd === 'own') html += 'Venus is dignified, which tradition reads as a capacity for deep, loyal affection and an eye for harmony; relationships tend to repair rather than break.';
  else if (vd === 'debilitated') html += 'Venus needs conscious tending here: spell out expectations early, because unspoken assumptions are where friction starts.';
  else html += 'Affection is genuine but needs expression: say the appreciative things out loud instead of assuming they are obvious.';
  html += ' Timing matters more than verdicts: the dasha chapters above show when relationship themes activate. A difficult period for partnership is a season, not a sentence.</p>';
  return html;
}

/* ---- Career: concrete paths from chart ---- */
function rdgCareerPaths(p, jd) {
  var lord10 = rdgHouseLord(p, 10), l10k = lord10.toLowerCase();
  var h10 = rdgHouseOf(p, l10k);
  var paths = [];
  function consider(key, label, why) {
    var s = rdgStrength(p, key, jd);
    paths.push({key:key, label:label, why:why, s:s});
  }
  consider('saturn', 'Administration, engineering, law, or organized service', 'Saturn rules perseverance, systems and responsibility');
  consider('mercury', 'Trade, accounting, writing, teaching, or technology', 'Mercury rules intellect, commerce and communication');
  consider('jupiter', 'Finance, counseling, teaching, law, or advisory work', 'Jupiter rules wisdom, finance and guidance');
  consider('venus', 'Arts, hospitality, design, or finance and luxury trades', 'Venus rules aesthetics, comfort and wealth');
  consider('mars', 'Engineering, property, technical enterprise, or competitive fields', 'Mars rules courage, machinery and initiative');
  consider('sun', 'Leadership, management, government, or public roles', 'The Sun rules authority and visibility');
  consider('moon', 'Care work, hospitality, food, or public-facing roles', 'The Moon rules the public, care and nourishment');
  paths.sort(function(a,b){ return b.s - a.s; });
  var top = paths.slice(0, 4);
  var html = '<h3>Career: concrete directions</h3>';
  html += '<p class="rdg-factors">Chart factors: 10th lord ' + lord10 + ' ' + rdgDignityPhrase(l10k, p[l10k]) + ', ' +
    rdgOrdinal(h10) + ' house; strongest career significators ranked by dignity and placement.</p>';
  html += '<p>Classical texts judge profession from the 10th house, its lord, and the condition of Saturn, Mercury, Jupiter and the Sun. ' +
    'Your 10th lord ' + lord10 + ' works through the ' + rdgOrdinal(h10) + ' house: ' + rdg_L10_HOUSE[h10] + ' ' +
    'Ranked by the actual strength of each planet in your chart, the most supported directions are:</p><ol>';
  top.forEach(function(t, i) {
    html += '<li><strong>' + t.label + '.</strong> ' + t.why + '; your ' + rdg_NAMES[t.key] + ' is ' +
      rdgDignity(t.key, p[t.key]) + ' in the ' + rdgOrdinal(rdgHouseOf(p, t.key)) + ' house.</li>';
  });
  html += '</ol><p>This is a reflective reading, not a job guarantee. Skill, effort and market reality decide outcomes; the chart suggests where your energy meets the least resistance.</p>';
  return html;
}

/* ---- Money ---- */
function rdgMoney(p) {
  var lord2 = rdgHouseLord(p, 2), l2k = lord2.toLowerCase();
  var lord11 = rdgHouseLord(p, 11), l11k = lord11.toLowerCase();
  var h2 = rdgHouseOf(p, l2k), h11 = rdgHouseOf(p, l11k);
  var html = '<h3>Money and assets</h3>';
  html += '<p class="rdg-factors">Chart factors: 2nd lord ' + lord2 + ' in ' + rdgOrdinal(h2) + ' house; 11th lord ' + lord11 +
    ' in ' + rdgOrdinal(h11) + ' house; Jupiter ' + rdgDignity('jupiter', p.jupiter) + '.</p>';
  html += '<p>Wealth in the classical scheme is read from the 2nd house (accumulation) and 11th house (gains), with Jupiter as the natural significator of fortune. ';
  html += 'Your 2nd lord ' + lord2 + ' operates through ' + rdg_HOUSE_THEMES[h2] + ', suggesting savings grow steadiest when tied to that area. ';
  html += 'Your 11th lord ' + lord11 + ' works through ' + rdg_HOUSE_THEMES[h11] + ', which is where windfalls and network-driven gains tend to come from. ';
  var jd_ = rdgDignity('jupiter', p.jupiter);
  if (jd_ === 'exalted' || jd_ === 'own') html += 'A dignified Jupiter is the classical signature of money that recovers: setbacks happen, but the long arc bends toward accumulation.';
  else if (jd_ === 'debilitated') html += 'Jupiter needs support here: avoid speculation and keep reserves, because the chart favors earned, patient money over quick gains.';
  else html += 'Jupiter is neutrally placed: fortune responds to prudence, so budgeting and diversified effort matter more than timing.';
  html += ' Nothing here is financial advice; treat it as a traditional lens on your habits with money.</p>';
  return html;
}

/* ---- Health (symbolic, never medical) ---- */
function rdgHealth(p) {
  var lord6 = rdgHouseLord(p, 6), l6k = lord6.toLowerCase();
  var h6 = rdgHouseOf(p, l6k);
  var satH = rdgHouseOf(p, 'saturn');
  var html = '<h3>Health: a symbolic reading</h3>';
  html += '<p class="rdg-note">Symbolic only. This is traditional astrological symbolism, not medical advice. For any health concern, consult a qualified doctor.</p>';
  html += '<p class="rdg-factors">Chart factors: 6th lord ' + lord6 + ' in ' + rdgOrdinal(h6) + ' house; Saturn in ' + rdgOrdinal(satH) + ' house; Moon ' + rdgDignity('moon', p.moon) + '.</p>';
  html += '<p>Classical texts read the 6th house as the body\'s maintenance department: routines, immunity through discipline, and recovery from strain. ';
  html += 'Your 6th lord ' + lord6 + ' sits in the house of ' + rdg_HOUSE_THEMES[h6] + ', which tradition links to the area of life where stress tends to land in the body. ';
  html += 'Saturn in the ' + rdgOrdinal(satH) + ' house asks for regularity: sleep hours, meal times, and movement kept steady rather than intense. ';
  var md = rdgDignity('moon', p.moon);
  if (md === 'exalted' || md === 'own') html += 'A strong Moon is the classical recovery signature: the system bounces back well when given rest.';
  else html += 'The Moon asks for nervous-system care: wind down before sleep, limit stimulants late in the day, and treat rest as medicine.';
  html += '</p>';
  return html;
}

/* ---- Right now: current MD/AD ---- */
function rdgNow(p, moonLong, birthJD, jd) {
  var mds = vimshottariMahadashas(moonLong, birthJD);
  var nowJD = Date.now() / 86400000 + 2440587.5;
  var cur = null, idx = -1;
  for (var i = 0; i < mds.length; i++) {
    if (nowJD >= mds[i].startJD && nowJD < mds[i].endJD) { cur = mds[i]; idx = i; break; }
  }
  if (!cur) return '';
  var ads = vimshottariAntardashas(cur.lord, cur.startJD, cur.years);
  var curAD = null;
  for (var j = 0; j < ads.length; j++) {
    if (nowJD >= ads[j].startJD && nowJD < ads[j].endJD) { curAD = ads[j]; break; }
  }
  var lk = cur.lord.toLowerCase();
  var lh = rdgHouseOf(p, lk);
  var html = '<h3>Right now</h3>';
  html += '<p class="rdg-factors">Chart factors: running ' + cur.lord + ' Mahadasha (' + rdgYearRange(cur.startJD, cur.endJD) + ')' +
    (curAD ? ', ' + curAD.lord + ' Antardasha (' + rdgYearRange(curAD.startJD, curAD.endJD) + ')' : '') +
    '; ' + cur.lord + ' activates the ' + rdgOrdinal(lh) + ' house.</p>';
  html += '<p>You are inside ' + cur.lord + ' Mahadasha until ' + rdgYear(cur.endJD) + '. This period activates the ' +
    rdgOrdinal(lh) + ' house in your chart, so the themes of ' + rdg_HOUSE_THEMES[lh] + ' are foreground for these years. ';
  if (curAD) {
    var adl = (typeof getAntardashaLine === 'function') ? getAntardashaLine(curAD.lord) : '';
    html += 'Within it, ' + curAD.lord + ' Antardasha runs until ' + rdgYear(curAD.endJD) + ': ' + rdgEsc(adl) + ' ';
  }
  html += 'Use the period consciously: the dasha does not decide for you, it describes the weather. Dress for it.</p>';
  /* Transit context from the gochar engine */
  try {
    if (typeof gocharOutlook === 'function') {
      var months = gocharOutlook(p).slice(0, 3);
      var tHtml = '<h4>Transit context: the next few months</h4><ul>';
      months.forEach(function(mo) {
        tHtml += '<li><strong>' + rdgEsc(mo.month) + ' (' + mo.rating + '):</strong> ' +
          mo.factors.slice(0, 2).map(rdgEsc).join('; ') + '.</li>';
      });
      tHtml += '</ul>';
      html += tHtml;
    }
  } catch (e) { /* transit section optional */ }
  return html;
}

/* ---- Main entry ---- */
function renderDetailedReading(p, moonLong, birthJD, name) {
  var nowJD = Date.now() / 86400000 + 2440587.5;
  var mds = vimshottariMahadashas(moonLong, birthJD);
  var html = '<div class="rdg-reading">';
  html += '<h3>Your detailed reading</h3>';
  html += '<p class="rdg-for">Prepared for ' + rdgEsc(name) + ', from the Lahiri sidereal chart computed from the birth details given. ' +
    'Classical Jyotish is a traditional system of reflection and timing, not a science of prediction; read it as a mirror, not a verdict.</p>';

  html += '<h3>The bottom line</h3><p>' + rdgBottomLine(p, birthJD) + '</p>';

  html += rdgYogasSection(p);
  html += rdgSignatureSection(p);

  html += '<h3>Your life in chapters: past, present, future</h3>';
  html += '<p>Each major period below is dated from your birth. The running chapter is marked; completed chapters describe the foundation already built, upcoming ones the weather ahead.</p>';
  var curIdx = -1;
  for (var i = 0; i < mds.length; i++) {
    if (nowJD >= mds[i].startJD && nowJD < mds[i].endJD) { curIdx = i; break; }
  }
  if (curIdx < 0) curIdx = 0;
  var from = Math.max(0, curIdx - 3), to = Math.min(mds.length - 1, curIdx + 2);
  for (var k = from; k <= to; k++) {
    html += rdgDashaChapter(p, mds[k], nowJD, birthJD);
  }

  html += rdgNow(p, moonLong, birthJD, birthJD);
  html += rdgTemperament(p, moonLong);
  html += rdgRelationships(p);
  html += rdgCareerPaths(p, birthJD);
  html += rdgMoney(p);
  html += rdgHealth(p);

  html += '<p class="rdg-note">Method: whole-sign houses from the Lahiri ascendant; Vimshottari dashas from Moon nakshatra; dignity from classical exaltation, debilitation and ownership. ' +
    'Remedies and technical tables live under "For the curious" below. Nothing here is medical, financial, or legal advice.</p>';
  html += '</div>';
  return html;
}
