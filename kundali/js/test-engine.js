"use strict";
/* Browser test runner for the astro engine.
 * Run: open test.html or call runEngineTests() in console.
 */

function runEngineTests() {
  const jd = 2452354.440972222;  // 2002-03-20 22:35 UTC
  const lat = 27.1667, lon = 87.0667;
  const expected = {
    ascendant: 300.9982, sun: 336.2539, moon: 52.4170,
    mars: 19.6991, mercury: 320.5448, jupiter: 72.3430,
    venus: 352.1043, saturn: 45.6655, rahu: 58.2935, ketu: 238.2935
  };
  const result = computeKundali(jd, lat, lon);
  const output = [];
  let allPass = true, maxErr = 0;
  output.push('=== ENGINE ACCEPTANCE TEST ===');
  for (const key of Object.keys(expected)) {
    const v = result[key];
    const e = expected[key];
    let err = v - e;
    err = ((err + 540) % 360) - 180;
    const errArcsec = err * 3600;
    const pass = Math.abs(err) <= 0.15;
    if (!pass) allPass = false;
    maxErr = Math.max(maxErr, Math.abs(errArcsec));
    output.push(`${pass?'PASS':'FAIL'} ${key}: ${v.toFixed(4)} vs ${e} (${errArcsec.toFixed(1)}")`);
  }
  output.push(`Max error: ${maxErr.toFixed(1)}" (tolerance 540")`);
  output.push(allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED');
  
  // Dasha test
  const moon = result.moon;
  const mahas = vimshottariMahadashas(moon, jd);
  output.push('\n=== DASHA TEST ===');
  output.push(`Moon: ${formatDate(mahas[0].startJD)} to ${formatDate(mahas[0].endJD)} (exp 20 Mar 2002 to 27 Nov 2002)`);
  output.push(`Mars: ${formatDate(mahas[1].startJD)} to ${formatDate(mahas[1].endJD)} (exp 27 Nov 2002 to 26 Nov 2009)`);
  output.push(`Rahu: ${formatDate(mahas[2].startJD)} to ${formatDate(mahas[2].endJD)} (exp 26 Nov 2009 to 26 Nov 2027)`);
  
  return output.join('\n');
}

// Auto-run if in browser with ?test=1
if (typeof window !== 'undefined' && window.location.search.includes('test=1')) {
  window.addEventListener('DOMContentLoaded', () => {
    const pre = document.createElement('pre');
    pre.textContent = runEngineTests();
    document.body.appendChild(pre);
  });
}
