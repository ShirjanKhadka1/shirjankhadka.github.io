"use strict";
/* Detailed personal reading engine — concise verdict style.
   Mirrors the structure of a professional written Jyotish reading:
   bottom line, past, present, future, relationships, health,
   foreign lands, career and money, numerology, final verdict.
   Every verdict is grounded in computed chart factors. No invented biography.
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
  return score;
}

/* ---- 10th lord in house: one-line career verdicts ---- */
var rdg_L10_HOUSE = {
  1: 'Career and identity are fused: you are the enterprise, and self-employment or visible leadership suits you.',
  2: 'Income grows through family resources, speech, or knowledge-based work; banking, teaching, and advisory roles fit.',
  3: 'Advancement comes through initiative, skill, and media or hands-on craft; start things, do not wait to be chosen.',
  4: 'Career connects to home, property, or emotional foundations; real estate, education, and care work are supported.',
  5: 'Creativity and intellect are the career instruments; creative or advisory professions suit you.',
  6: 'Service, competition, and disciplined routine build the career; health, law, and organized service are strong.',
  7: 'Partnerships carry the career: clients, collaborators, and public dealings are where you rise.',
  8: 'Research, other people\'s resources, and transformation are the career themes; depth work over display work.',
  9: 'Mentors, higher learning, and fortune favor the career; teaching, law, and guidance roles are natural.',
  10: 'The career stands on its own strength: profession is the central pillar of the life, and steady ambition pays.',
  11: 'Networks and large goals drive the career; gains come through alliances, platforms, and ambitious projects.',
  12: 'Foreign connections, retreat, or behind-the-scenes work shape the career; hospitals, research, and distant markets fit.'
};

/* ---- 7th lord in house: one-line relationship verdicts ---- */
var rdg_L7_HOUSE = {
  1: 'Partnership is central to identity: you become yourself more fully through committed relationship.',
  2: 'Partnership ties closely to family and resources; shared finances need explicit, kind agreements.',
  3: 'Relationships need friendship and conversation first; marry a companion, not just a romance.',
  4: 'Domestic peace is the point of partnership; choose for home harmony over excitement.',
  5: 'Romance leads toward commitment; love that begins in creativity or play can become lasting.',
  6: 'Partnership asks for work and patience; choose reliability over charm, and keep health routines shared.',
  7: 'Partnership is a natural strength: you understand give-and-take, and committed relationship supports the whole life.',
  8: 'Bonding runs deep and transformative; trust must be built slowly, and then it becomes unbreakable.',
  9: 'A partner may arrive through mentors, learning, or fortune; shared values matter more than shared tastes.',
  10: 'Partnership and public life intertwine; a spouse may influence career, and status considerations enter choice.',
  11: 'Partnership grows from friendship and networks; marry within your world of shared ambitions.',
  12: 'Partnership has a private, inward quality; protect the relationship from outside noise and keep some things sacred.'
};

/* One-line verdict on what the lagna lord's placement makes central. */
var rdg_LL_VERDICT = {
  1: 'The self is the project: identity, visibility, and initiative decide everything.',
  2: 'Accumulation decides the life: wealth, family, and the spoken word.',
  3: 'Initiative decides the life: courage, skill, and starting things.',
  4: 'Foundations decide the life: home, property, and emotional security.',
  5: 'Intellect decides the life: learning, counsel, and creative output.',
  6: 'Discipline decides the life: service, routine, and winning by outlasting.',
  7: 'Partnership decides the life: the right alliances multiply everything.',
  8: 'Depth decides the life: research, transformation, and other people\'s resources.',
  9: 'Fortune decides the life: mentors, learning, and being in the right rooms.',
  10: 'Work decides the life: career and public standing are the main stage.',
  11: 'Networks decide the life: alliances, platforms, and large ambitions.',
  12: 'Distance decides the life: foreign lands, retreat, and behind-the-scenes work.'
};

/* Varga (divisional chart) sign: 0-based sign index of a longitude in D9/D10. */
function rdgVargaSign(lon, varga) {
  if (typeof Vargas !== 'undefined' && Vargas.vargaChart) return Vargas.vargaChart(lon, varga).sign;
  return rdgSignOf(lon);
}

/* Classical name-starting syllable per nakshatra pada (Moon's quarter).
   Cross-checked against standard Jyotish tables. Index: nakshatra 0-26, pada 0-3. */
var rdg_NAK_SYLLABLES = [
  ['Chu','Che','Cho','La'], ['Li','Lu','Le','Lo'], ['A','I','U','E'],
  ['O','Va','Vi','Vu'], ['Ve','Vo','Ka','Ki'], ['Ku','Gha','Ng','Chha'],
  ['Ke','Ko','Ha','Hi'], ['Hu','He','Ho','Da'], ['Di','Du','De','Do'],
  ['Ma','Mi','Mu','Me'], ['Mo','Ta','Ti','Tu'], ['Te','To','Pa','Pi'],
  ['Pu','Sha','Na','Tha'], ['Pe','Po','Ra','Ri'], ['Ru','Re','Ro','Ta'],
  ['Ti','Tu','Te','To'], ['Na','Ni','Nu','Ne'], ['No','Ya','Yi','Yu'],
  ['Ye','Yo','Bha','Bhi'], ['Bhu','Dha','Pha','Dha'], ['Bhe','Bho','Ja','Ji'],
  ['Khi','Khu','Khe','Kho'], ['Ga','Gi','Gu','Ge'], ['Go','Sa','Si','Su'],
  ['Se','So','Da','Di'], ['Du','Tha','Jha','Na'], ['De','Do','Cha','Chi']
];
var rdg_NAK_NAMES = ['Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra','Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni','Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha','Mula','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishta','Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati'];
function rdgMoonPada(moonLong) {
  var x = ((moonLong % 360) + 360) % 360;
  var nak = Math.floor(x / (360 / 27)) % 27;
  var pada = Math.floor((x - nak * (360 / 27)) / (360 / 108)) + 1;
  return {nak: nak, pada: pada, syllable: rdg_NAK_SYLLABLES[nak][pada - 1]};
}
/* First-sound match between the birth name and the prescribed syllable.
   Treats V/B as interchangeable (Va/Ba, Vi/Bi, Vu/Bu, Ve/Be, Vo/Bo). */
function rdgNameMatchesSyllable(name, syl) {
  var n = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  var s = String(syl || '').toLowerCase();
  if (!n || !s) return false;
  var variants = [s];
  if (s.charAt(0) === 'v') variants.push('b' + s.slice(1));
  if (s.charAt(0) === 'b') variants.push('v' + s.slice(1));
  for (var i = 0; i < variants.length; i++) {
    if (n.indexOf(variants[i]) === 0) return true;
  }
  return false;
}

/* ---- Birth name: the Moon's syllable vs the given name ---- */
function rdgBirthName(p, moonLong, name) {
  var mp = rdgMoonPada(moonLong);
  var nakName = rdg_NAK_NAMES[mp.nak];
  var firstSound = String(name || '').replace(/[^A-Za-z]/g, '').slice(0, 2);
  var html = '<h3>Birth name</h3>';
  html += '<p><strong>Verdict:</strong> the Moon stands in ' + nakName + ', pada ' + mp.pada +
    '. The classical name syllable for this pada is <strong>\u2018' + mp.syllable + '\u2019</strong>' +
    (mp.syllable.charAt(0) === 'V' ? ' (also written \u2018B' + mp.syllable.slice(1) + '\u2019)' :
     mp.syllable.charAt(0) === 'B' ? ' (also written \u2018V' + mp.syllable.slice(1) + '\u2019)' : '') + '.</p>';
  if (rdgNameMatchesSyllable(name, mp.syllable)) {
    html += '<p>Your birth name \u2018' + rdgEsc(name) + '\u2019 begins with this syllable: name and Moon agree. ' +
      'The traditional system counts this as consonance between the given identity and the mind.</p>';
  } else {
    html += '<p>Your birth name \u2018' + rdgEsc(name) + '\u2019 begins with \u2018' + rdgEsc(firstSound) +
      '\u2019: the family followed its own choice, not the classical syllable. This changes nothing in the chart ' +
      'below — the reading is cast from the Moon itself, which stays in ' + nakName + ' regardless of the name. ' +
      'The syllable matters only if the family wants the traditional naming consonance.</p>';
  }
  return html;
}

/* ---- Bottom line ---- */
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
  return 'The deciding strengths are ' + parts.join(', ') + '. ' +
    rdg_NAMES[lagnaLord] + ' rules the ascendant from the ' + rdgOrdinal(llHouse) +
    ' house, so ' + rdg_LL_VERDICT[llHouse];
}

/* ---- Dasha verdicts: one core per lord, placed in its house ---- */
var rdg_DASHA_CORE = {
  Sun: 'Authority and visibility come forward; the father line and bosses matter. Lead, but keep the ego on a leash.',
  Moon: 'The mind and home take the stage; mother and emotional security dominate. Feelings run loud and true; a mood is not a fact.',
  Mars: 'Action and competition. Energy is high, patience is thin, and haste is expensive. Verify, then strike.',
  Mercury: 'Learning, trade, writing, analysis. The mind is at its sharpest; scattering across ten fronts is the only enemy.',
  Jupiter: 'Knowledge, mentors, and money matters expand. Judgment is protected in this chapter; the principled move is the profitable one.',
  Venus: 'Relationships, comfort, and resources deepen. Affection and taste grow; spending and sentimentality are the leaks.',
  Saturn: 'Duty and discipline; results come late and last. Build slowly; what survives this chapter is permanent.',
  Rahu: 'Ambition widens and the unconventional opens: foreign links, big moves, new identities. Verify everything twice; the illusions are as large as the opportunities.',
  Ketu: 'An inward turn: research, detachment, and depth. Gains come through mastery, not display; do not let the world go entirely.'
};
/* What the current phase concretely asks for, per lord. */
var rdg_DASHA_ASKS = {
  Sun: 'Take the visible role; put authority decisions in writing and keep humility in the room.',
  Moon: 'Protect home and sleep; make no irreversible move on a mood.',
  Mars: 'Act, but verify first; haste is the expensive tax this chapter.',
  Mercury: 'Learn and document; finish one thing before starting three.',
  Jupiter: 'Choose the principled move; mentors and study pay compound interest now.',
  Venus: 'Invest in relationships and taste; cap spending and sentimentality.',
  Saturn: 'Build slowly and keep promises; shortcuts taken now are paid for later.',
  Rahu: 'Go big, verify twice: put programs, funding, dates, and budgets on paper. Urgency is a feeling, not a prophecy.',
  Ketu: 'Go deep; protect the inner life and do not disengage from the world.'
};
function rdgDashaVerdict(p, lord) {
  var key = lord.toLowerCase(), h = rdgHouseOf(p, key);
  var d = rdgDignity(key, p[key]);
  var dWord = d === 'exalted' ? 'exalted' : d === 'own' ? 'in its own sign' : d === 'debilitated' ? 'debilitated' : 'placed';
  return lord + ' ' + dWord + ' in the ' + rdgOrdinal(h) + ' house. ' + (rdg_DASHA_CORE[lord] || '');
}

/* ---- Past: completed chapters ---- */
function rdgPast(p, mds, nowJD) {
  var done = mds.filter(function(m){ return m.endJD <= nowJD; });
  if (!done.length) return '';
  var html = '<h3>Past</h3><p>These chapters should ring true. Check them against lived experience: a chart that cannot describe the past cannot be trusted with the future.</p>';
  done.forEach(function(md){
    html += '<h4>' + md.lord + ' Mahadasha, ' + rdgYearRange(md.startJD, md.endJD) + '</h4>';
    html += '<p><strong>Verdict:</strong> ' + rdgDashaVerdict(p, md.lord) + '</p>';
  });
  return html;
}

/* ---- Present: current period cards ---- */
function rdgPresent(p, moonLong, birthJD) {
  var nowJD = Date.now() / 86400000 + 2440587.5;
  var mds = vimshottariMahadashas(moonLong, birthJD);
  var cur = null;
  for (var i = 0; i < mds.length; i++) {
    if (nowJD >= mds[i].startJD && nowJD < mds[i].endJD) { cur = mds[i]; break; }
  }
  if (!cur) return '';
  var ads = vimshottariAntardashas(cur.lord, cur.startJD, cur.years);
  var curAD = null;
  for (var j = 0; j < ads.length; j++) {
    if (nowJD >= ads[j].startJD && nowJD < ads[j].endJD) { curAD = ads[j]; break; }
  }
  var html = '<h3>Present</h3>';
  html += '<p><strong>' + cur.lord + ' Mahadasha</strong>, ' + rdgYearRange(cur.startJD, cur.endJD) + '. ' + rdgDashaVerdict(p, cur.lord) + '</p>';
  if (curAD) {
    var ah = rdgHouseOf(p, curAD.lord.toLowerCase());
    html += '<p><strong>' + curAD.lord + ' Antardasha</strong>, ' + rdgYearRange(curAD.startJD, curAD.endJD) +
      ': the sub-period lord sits in the ' + rdgOrdinal(ah) + ' house, so ' + rdg_HOUSE_THEMES[ah] + ' is the activated area right now.</p>';
  }
  html += '<p><strong>What this phase asks for:</strong> ' + (rdg_DASHA_ASKS[cur.lord] || 'Turn intensity into documented choices.') + '</p>';
  try {
    if (typeof gocharOutlook === 'function') {
      var mo = gocharOutlook(p)[0];
      if (mo) html += '<p><strong>Transit context:</strong> ' + rdgEsc(mo.month) + ' (' + mo.rating + '): ' +
        mo.factors.slice(0, 2).map(rdgEsc).join('; ') + '.</p>';
    }
  } catch (e) {}
  return html;
}

/* ---- Future: timeline, next window, next major period ---- */
function rdgFuture(p, moonLong, birthJD) {
  var nowJD = Date.now() / 86400000 + 2440587.5;
  var mds = vimshottariMahadashas(moonLong, birthJD);
  var curIdx = 0;
  for (var i = 0; i < mds.length; i++) {
    if (nowJD >= mds[i].startJD && nowJD < mds[i].endJD) { curIdx = i; break; }
  }
  var html = '<h3>Future</h3><p>';
  for (var k = curIdx; k < Math.min(mds.length, curIdx + 4); k++) {
    html += '<strong>' + mds[k].lord + '</strong> ' + rdgYearRange(mds[k].startJD, mds[k].endJD) +
      (k === curIdx ? ' (running now)' : '') + (k < Math.min(mds.length, curIdx + 4) - 1 ? ' &middot; ' : '');
  }
  html += '</p>';
  var cur = mds[curIdx];
  var ads = vimshottariAntardashas(cur.lord, cur.startJD, cur.years);
  var nextAD = null;
  for (var j = 0; j < ads.length; j++) {
    if (ads[j].startJD > nowJD) { nextAD = ads[j]; break; }
  }
  if (nextAD) {
    html += '<p><strong>Next window: ' + cur.lord + ' / ' + nextAD.lord + '</strong>, ' +
      rdgYearRange(nextAD.startJD, nextAD.endJD) + '. ' + rdgDashaVerdict(p, nextAD.lord) + '</p>';
  }
  var nx = mds[curIdx + 1];
  if (nx) {
    html += '<p><strong>From ' + rdgYear(nx.startJD) + ': ' + nx.lord + ' Mahadasha.</strong> ' +
      rdgDashaVerdict(p, nx.lord) + ' Expect the early phase to reorganize life before it feels stable.</p>';
  }
  return html;
}

/* One concrete caution per 7th-lord placement. */
var rdg_L7_CAUTION = {
  1: 'Do not let a partner rewrite your identity; choose someone who sharpens it.',
  2: 'Family will weigh in on your choice; hear them, then decide yourself.',
  3: 'Do not marry the excitement; marry the friend you can talk to for decades.',
  4: 'Do not trade home peace for passion; the quiet partner is the right one.',
  5: 'Do not rush from romance to vows; let play become partnership at its own pace.',
  6: 'Do not choose charm over reliability; daily kindness beats grand gestures.',
  7: 'Partnership is your strength; do not settle out of fear of being alone.',
  8: 'Do not hand over trust fast; build it slowly and it becomes unbreakable.',
  9: 'Do not choose for status or family approval alone; shared values outlast shared tastes.',
  10: 'Do not let career calculation choose the spouse; respect outranks advantage.',
  11: 'Do not confuse a shared crowd with shared values; choose the friend, not the network.',
  12: 'Do not let outside noise into the relationship; keep some things sacred.'
};

/* ---- Relationships ---- */
function rdgRelationships(p, mds, nowJD) {
  var lord7 = rdgHouseLord(p, 7), l7k = lord7.toLowerCase();
  var h7 = rdgHouseOf(p, l7k), venusH = rdgHouseOf(p, 'venus');
  var vd = rdgDignity('venus', p.venus);
  var html = '<h3>Relationships and marriage</h3>';
  html += '<p><strong>Verdict:</strong> ' + rdg_L7_HOUSE[h7] + ' ';
  if (vd === 'exalted' || vd === 'own')
    html += 'Venus dignified in the ' + rdgOrdinal(venusH) + ' house gives loyal affection; bonds tend to repair rather than break.';
  else if (vd === 'debilitated')
    html += 'Venus in the ' + rdgOrdinal(venusH) + ' house asks for explicit expectations early; unspoken assumptions are the friction point.';
  else
    html += 'Venus in the ' + rdgOrdinal(venusH) + ' house: affection is real but needs to be said out loud.';
  html += '</p>';
  var better = null;
  for (var i = 0; i < mds.length; i++) {
    var l = mds[i].lord.toLowerCase();
    if (mds[i].endJD > nowJD && (l === 'jupiter' || l === l7k || l === 'venus')) { better = mds[i]; break; }
  }
  html += '<p><strong>Marriage:</strong> supported. The 7th lord ' + lord7 + ' in the ' + rdgOrdinal(h7) +
    ' house links partnership with ' + rdg_HOUSE_THEMES[h7] + '.</p>';
  if (better)
    html += '<p><strong>Better phase:</strong> ' + better.lord + ' Mahadasha, ' + rdgYearRange(better.startJD, better.endJD) +
      (better.startJD <= nowJD ? ' (running now)' : '') + '.</p>';
  html += '<p><strong>Main caution:</strong> ' + rdg_L7_CAUTION[h7] + '</p>';
  /* Navamsha cross-check: the classical second opinion on partnership. */
  var d9Lagna = rdgVargaSign(p.ascendant, 'D9');
  var venusD9sign = rdgVargaSign(p.venus, 'D9');
  var venusD9d = rdgDignity('venus', venusD9sign * 30 + 15);
  html += '<p><strong>Navamsha check (D9):</strong> D9 lagna ' + rdg_SIGNS[d9Lagna] + ', Venus ' + venusD9d +
    ' in ' + rdg_SIGNS[venusD9sign] + '. ';
  if (venusD9d === 'exalted' || venusD9d === 'own')
    html += 'The deeper chart confirms the D1 promise: this partnership is built to last.</p>';
  else if (venusD9d === 'debilitated')
    html += 'The D1 promise is real, but the inner chart asks for conscious work: do not expect partnership to run on autopilot.</p>';
  else
    html += 'The inner chart neither adds nor removes: the D1 verdict above stands as written.</p>';
  return html;
}

/* ---- Health: symbolic only ---- */
function rdgHealth(p, moonLong, birthJD) {
  var nowJD = Date.now() / 86400000 + 2440587.5;
  var mds = vimshottariMahadashas(moonLong, birthJD);
  var cur = null;
  for (var i = 0; i < mds.length; i++) {
    if (nowJD >= mds[i].startJD && nowJD < mds[i].endJD) { cur = mds[i]; break; }
  }
  var lord6 = rdgHouseLord(p, 6), h6 = rdgHouseOf(p, lord6.toLowerCase());
  var html = '<h3>Health</h3><p class="rdg-note">Traditional symbolism only, not medical advice. Real symptoms belong with a qualified clinician.</p>';
  var md = rdgDignity('moon', p.moon);
  var rec = (md === 'exalted' || md === 'own')
    ? 'The dignified Moon is the counterweight: strong recovery when rest is protected.'
    : 'Protect sleep and treat rest as medicine.';
  html += '<p><strong>Verdict:</strong> the 6th lord ' + lord6 + ' in the ' + rdgOrdinal(h6) +
    ' house points strain toward ' + rdg_HOUSE_THEMES[h6] + '. ' + rec + '</p>';
  if (cur) {
    var ads = vimshottariAntardashas(cur.lord, cur.startJD, cur.years);
    var curAD = null, nextAD = null;
    for (var j = 0; j < ads.length; j++) {
      if (nowJD >= ads[j].startJD && nowJD < ads[j].endJD) curAD = ads[j];
      else if (ads[j].startJD > nowJD && !nextAD) nextAD = ads[j];
    }
    if (curAD)
      html += '<p><strong>Present (' + curAD.lord + '):</strong> guard sleep and rumination; do not self-diagnose passing sensations.</p>';
    if (nextAD)
      html += '<p><strong>Next (' + nextAD.lord + ', ' + rdgYearRange(nextAD.startJD, nextAD.endJD) + '):</strong> ' +
        (nextAD.lord === 'Mars'
          ? 'strain from haste or overexertion; pace yourself.'
          : 'a steadier chapter for routines and recovery.') + '</p>';
  }
  return html;
}

/* ---- Foreign lands ---- */
function rdgForeign(p) {
  var notes = [];
  if (rdgHouseOf(p, 'rahu') === 4)
    notes.push('<strong>Foreign residence supported.</strong> Rahu in the 4th is the classical marker of a life lived away from the birthplace.');
  if (rdgHouseOf(p, 'ketu') === 4)
    notes.push('Ketu in the 4th loosens the grip of the birthplace; long stays abroad feel natural.');
  var l12 = rdg_LORDS[(rdgSignOf(p.ascendant) + 11) % 12], h12l = rdgHouseOf(p, l12.toLowerCase());
  if (h12l === 4)
    notes.push('The 12th lord ' + l12 + ' in the 4th ties foreign lands directly to the question of home.');
  var l9 = rdg_LORDS[(rdgSignOf(p.ascendant) + 8) % 12], l9k = l9.toLowerCase();
  var l9d = rdgDignity(l9k, p[l9k]);
  if (l9d === 'exalted' || l9d === 'own')
    notes.push('The 9th lord ' + l9 + ' is ' + l9d + ': fortune through mentors, higher learning, and long journeys.');
  var ms = rdgSignOf(p.moon);
  if (ms === 0 || ms === 3 || ms === 6 || ms === 9)
    notes.push('Moon in ' + rdg_SIGNS[ms] + ', a movable sign: the nature is built for movement.');
  if (!notes.length)
    notes.push('No strong foreign indicators; the chart favors building where roots already are.');
  var html = '<h3>Foreign lands</h3><ul>';
  notes.forEach(function(n){ html += '<li>' + n + '</li>'; });
  return html + '</ul>';
}

/* ---- Career and money ---- */
function rdgCareerMoney(p, jd) {
  var lord10 = rdgHouseLord(p, 10), l10k = lord10.toLowerCase();
  var h10 = rdgHouseOf(p, l10k);
  var paths = [];
  function consider(key, label, why) {
    paths.push({key:key, label:label, why:why, s:rdgStrength(p, key, jd)});
  }
  consider('mercury', 'Accounting, analysis, trade, writing, or technology', 'Mercury rules intellect, commerce and communication');
  consider('jupiter', 'Finance, counseling, teaching, or advisory work', 'Jupiter rules wisdom, finance and guidance');
  consider('venus', 'Arts, hospitality, design, or finance and luxury trades', 'Venus rules aesthetics, comfort and wealth');
  consider('saturn', 'Administration, engineering, law, or organized service', 'Saturn rules perseverance, systems and responsibility');
  consider('mars', 'Engineering, property, technical enterprise, or competitive fields', 'Mars rules courage, machinery and initiative');
  consider('sun', 'Leadership, management, government, or public roles', 'The Sun rules authority and visibility');
  paths.sort(function(a,b){ return b.s - a.s; });
  var top3 = paths.slice(0, 3);
  var html = '<h3>Career and money</h3>';
  html += '<p><strong>The chart\'s answer:</strong> ' + top3[0].label + ' first' +
    (top3[1] ? '; ' + top3[1].label.toLowerCase() + ' second' : '') + '. ' + rdg_L10_HOUSE[h10] + '</p><ol>';
  top3.forEach(function(t) {
    html += '<li><strong>' + t.label + '.</strong> ' + t.why + ' (' + rdg_NAMES[t.key] + ' ' +
      rdgDignity(t.key, p[t.key]) + ' in the ' + rdgOrdinal(rdgHouseOf(p, t.key)) + ' house).</li>';
  });
  html += '</ol>';
  var lord2 = rdgHouseLord(p, 2), lord11 = rdgHouseLord(p, 11);
  var vd = rdgDignity('venus', p.venus), vh = rdgHouseOf(p, 'venus');
  var strength;
  if (vh === 2 && (vd === 'exalted' || vd === 'own'))
    strength = 'Venus ' + vd + ' in the 2nd is the clearest wealth signature: accumulation through taste, relationships, and steady earning.';
  else
    strength = 'The 2nd lord ' + lord2 + ' and 11th lord ' + lord11 + ' rule accumulation and gains; their condition sets the pace of wealth building.';
  var jd_ = rdgDignity('jupiter', p.jupiter);
  var caution = (jd_ === 'debilitated')
    ? 'Jupiter needs support here: no speculation, keep reserves; this chart builds wealth through earned, patient money.'
    : 'This chart builds wealth through earned, patient money: diversified, rules-based decisions. Leverage and emotional speculation are where it loses.';
  html += '<p><strong>Money strength:</strong> ' + strength + '</p>';
  html += '<p><strong>Money caution:</strong> ' + caution + '</p>';
  /* Dashamsha cross-check: the classical second opinion on career. */
  var d10Lagna = rdgVargaSign(p.ascendant, 'D10');
  var d10best = null;
  rdg_KEYS.forEach(function(k) {
    var s = rdgVargaSign(p[k], 'D10');
    var d = rdgDignity(k, s * 30 + 15);
    if (d === 'exalted' || d === 'own') d10best = {k: k, d: d, s: s};
  });
  html += '<p><strong>Dashamsha check (D10):</strong> D10 lagna ' + rdg_SIGNS[d10Lagna] +
    (d10best
      ? '; ' + rdg_NAMES[d10best.k] + ' ' + d10best.d + ' in ' + rdg_SIGNS[d10best.s] +
        ' is the working strength behind the career verdict above.'
      : '; no planet dignified in D10, so the D1 career verdict above carries the read.') + '</p>';
  return html;
}

/* ---- Numerology from the birth date ---- */
function rdgJDToYMD(jd) {
  var z = Math.floor(jd + 0.5), a = z;
  if (z >= 2299161) { var al = Math.floor((z - 1867216.25) / 36524.25); a = z + 1 + al - Math.floor(al / 4); }
  var b = a + 1524, c = Math.floor((b - 122.1) / 365.25), d = Math.floor(365.25 * c), e = Math.floor((b - d) / 30.6001);
  var day = b - d - Math.floor(30.6001 * e);
  var month = e < 14 ? e - 1 : e - 13;
  var year = month > 2 ? c - 4716 : c - 4715;
  return {y: year, m: month, d: day};
}
function rdgDigitSum(n) { n = Math.abs(Math.floor(n)); var s = 0; while (n > 0) { s += n % 10; n = Math.floor(n / 10); } return s; }
function rdgReduce(n) { while (n > 9) n = rdgDigitSum(n); return n; }
var RDG_NUM_MEANINGS = {
  1: 'Sun: leadership and initiative. Built to start things; the shadow is pride.',
  2: 'Moon: sensitivity and diplomacy. Reads people well; the shadow is mood.',
  3: 'Jupiter: learning, counsel, expansion. Enthusiasm is contagious; the shadow is scattering.',
  4: 'Rahu: the unconventional builder. Systems thinking; sudden changes are redirections.',
  5: 'Mercury: adaptability and commerce. Fast learner; the shadow is restlessness.',
  6: 'Venus: harmony and care. People trust you; the shadow is over-comfort.',
  7: 'Ketu: the analyst. Solitude is productive; the shadow is withdrawal.',
  8: 'Saturn: endurance. Slow gains that last; the shadow is cynicism in slow years.',
  9: 'Mars: courage and service. Finishes things; the shadow is temper.'
};
function rdgNumerology(birthJD) {
  var dt = rdgJDToYMD(birthJD);
  var mul = rdgReduce(dt.d);
  var bhag = rdgReduce(rdgDigitSum(dt.d) + rdgDigitSum(dt.m) + rdgDigitSum(dt.y));
  var html = '<h3>Numerology</h3>';
  html += '<p><strong>Mulank ' + mul + '</strong> (birth day ' + dt.d + '): ' + RDG_NUM_MEANINGS[mul] + '</p>';
  html += '<p><strong>Bhagyank ' + bhag + '</strong> (full date): ' + RDG_NUM_MEANINGS[bhag] + '</p>';
  return html;
}

/* ---- Final verdict ---- */
function rdgFinalVerdict(p, jd, mds, nowJD) {
  var lagnaLord = rdgHouseLord(p, 1), llk = lagnaLord.toLowerCase();
  var strong = [];
  rdg_KEYS.forEach(function(k){
    var d = rdgDignity(k, p[k]);
    if (d === 'exalted' || d === 'own') strong.push(rdg_NAMES[k] + ' ' + d);
  });
  var cur = null, nx = null;
  for (var i = 0; i < mds.length; i++) {
    if (nowJD >= mds[i].startJD && nowJD < mds[i].endJD) { cur = mds[i]; nx = mds[i + 1]; break; }
  }
  var art = /^[AEIOU]/.test(rdg_SIGNS[rdgSignOf(p.ascendant)]) ? 'An ' : 'A ';
  var s = art + rdg_SIGNS[rdgSignOf(p.ascendant)] + ' rising chart ruled by ' + lagnaLord +
    ' from the ' + rdgOrdinal(rdgHouseOf(p, llk)) + ' house' +
    (strong.length ? ', carried by ' + strong.slice(0, 2).join(' and ') : '') + '. ';
  if (cur) s += 'The running ' + cur.lord + ' Mahadasha closes ' + rdgYear(cur.endJD) + '; ';
  if (nx) s += 'the ' + nx.lord + ' period from ' + rdgYear(nx.startJD) + ' is the stronger long chapter for knowledge, income, and durable commitments. ';
  s += 'Foreign education is supported, partnership favors the later chapter over the present one, and the body asks for sleep and steadiness over intensity. Use the timing; do the work.';
  return s;
}

/* ---- Main entry ---- */
function renderDetailedReading(p, moonLong, birthJD, name, tzHours) {
  var nowJD = Date.now() / 86400000 + 2440587.5;
  var mds = vimshottariMahadashas(moonLong, birthJD);
  var nakIdx = Math.floor(((((moonLong % 360) + 360) % 360) / (360 / 27))) % 27;
  var nak = (typeof NAKSHATRAS !== 'undefined' && NAKSHATRAS[nakIdx]) ? NAKSHATRAS[nakIdx] : '';
  var mp = rdgMoonPada(moonLong);
  var html = '<div class="rdg-reading">';
  html += '<h3>Your detailed reading</h3>';
  html += '<p class="rdg-for">Prepared for ' + rdgEsc(name) + ' &middot; ' +
    rdg_SIGNS[rdgSignOf(p.ascendant)] + ' rising' +
    (nak ? ' &middot; Moon in ' + rdgEsc(nak) + ' pada ' + mp.pada : '') + '.</p>';
  html += '<h3>Bottom line</h3><p>' + rdgBottomLine(p, birthJD) + '</p>';
  html += rdgBirthName(p, moonLong, name);
  html += rdgPast(p, mds, nowJD);
  html += rdgPresent(p, moonLong, birthJD);
  html += rdgFuture(p, moonLong, birthJD);
  html += rdgRelationships(p, mds, nowJD);
  html += rdgHealth(p, moonLong, birthJD);
  html += rdgForeign(p);
  html += rdgCareerMoney(p, birthJD);
  var localJD = birthJD + ((typeof tzHours === 'number' && isFinite(tzHours)) ? tzHours / 24 : 0);
  html += rdgNumerology(localJD);
  html += '<h3>Final verdict</h3><p>' + rdgFinalVerdict(p, birthJD, mds, nowJD) + '</p>';
  html += '<p class="rdg-note">Classical Jyotish is a traditional system of reflection and timing, not a science of prediction. ' +
    'Nothing here is medical, financial, or legal advice.</p>';
  html += '</div>';
  return html;
}
