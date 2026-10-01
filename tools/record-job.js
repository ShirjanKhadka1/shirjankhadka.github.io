#!/usr/bin/env node
/**
 * tools/record-job.js — record one pipeline job run into nepse-chart/data/jobs.json
 * Usage: node tools/record-job.js <job-name> <success|failed|skipped> [detail] [--session YYYY-MM-DD]
 * Preserves other jobs' records. Always exits 0 (recording must not break builds).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const td = require('./trading-days');

try {
  const ROOT = path.join(__dirname, '..');
  const FILE = path.join(ROOT, 'nepse-chart', 'data', 'jobs.json');
  const [job, status, detail] = process.argv.slice(2);
  const sessArg = (process.argv.find(a => a.startsWith('--session=')) || '').split('=')[1];
  if (!job || !status) throw new Error('usage: record-job.js <job> <success|failed|skipped> [detail]');
  let jobs = {};
  try { jobs = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { /* first run */ }
  const now = new Date();
  jobs[job] = {
    status,
    ran_at_npt: td.todayNPT(now) + 'T' + td.timeNPT(now) + ':00+05:45',
    session_date: sessArg || td.expectedSessionDate(now),
    detail: detail || '',
  };
  fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2) + '\n');
  console.log(`recorded job ${job} = ${status}`);
} catch (e) {
  console.error('record-job failed (non-fatal):', e.message);
}
