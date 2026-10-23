#!/usr/bin/env python3
"""Wave G2 — premium design rollout transform for GENERATED page families.

Applies the Wave A design contract (css/nd-tokens.css tokens, nd-chrome.css
component language) to the generator-baked families and to the generators
themselves, so a future rebuild emits the same end state:

  * Stock pages  (stocks/*/index.html + stocks/index.html,
                  generator: tools/build-symbol-pages.js)
  * Wrap archive (nepse-decode/wrap/**, generator:
                  tools/build-market-wrap-archive.js)
  * css/sig-pro.css token mapping (shared by signal + stock pages)

PRESENTATION ONLY: no data values and no text content are changed — only
class attributes, stylesheet links/version strings, one meta attribute,
the inline <style> payloads, and the tab script's keyboard handling
(additive: roving tabindex + Home/End, per the APG tabs pattern).

Every replacement is an exact-string match with occurrence assertions.
The run is ATOMIC: all files are transformed in memory first; if any
assertion fails, nothing is written and the errors are printed.
The transform is IDEMPOTENT: a second run reports 0 changed files.

Usage: python3 tools/rollout-g2-transform.py [--report-only]
"""
import glob
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

OLD_SP_CSS = '/* price snapshot: 3D card */\n.sp-snap{margin:22px 0}\n.sp-price-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 38%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:20px;padding:22px 24px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -2px 6px rgba(0,0,0,.15),0 3px 8px rgba(0,0,0,.45),0 18px 44px rgba(0,0,0,.4);display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;justify-content:space-between}\n.sp-price-main{min-width:200px}\n.sp-price{font-family:var(--nd-font-display,Georgia,serif);font-size:2rem;font-weight:700;color:var(--nd-text,#fff);letter-spacing:-.01em}\n.sp-chg{font-size:.95rem;font-weight:700;margin-top:6px}\n.sp-chg.pos{color:var(--nd-up,#4ADE80)}\n.sp-chg.neg{color:var(--nd-down,#F87171)}\n.sp-live-badge{display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;background:var(--nd-lime,#B8E62E);color:#0A0C10}\n.sp-price-side{display:flex;gap:28px;flex-wrap:wrap}\n.sp-stat{display:flex;flex-direction:column;gap:4px}\n.sp-stat-v{font-size:1.05rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n.sp-stat-l{font-size:.75rem;color:var(--nd-dim,#8E98A8);text-transform:uppercase;letter-spacing:.05em;font-weight:600}\n/* tabs: dimensional pills like sig-tabs */\n.sp-tabs{display:flex;gap:10px;margin:6px 0 28px;flex-wrap:wrap}\n.sp-tab{padding:10px 20px;color:var(--nd-muted,#B8C0CE);font:inherit;font-weight:600;font-size:.9rem;cursor:pointer;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:999px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 5px rgba(0,0,0,.35);transition:border-color .15s,color .15s,transform .15s}\n.sp-tab:hover{border-color:var(--nd-lime,#B8E62E);color:var(--nd-text,#fff);transform:translateY(-1px)}\n.sp-tab.active{color:#0A0C10;font-weight:700;background:linear-gradient(180deg,#D4F34A 0%,var(--nd-lime,#B8E62E) 55%,#9BCB24 100%);border-color:#D4F34A;box-shadow:inset 0 2px 0 rgba(255,255,255,.5),inset 0 -3px 6px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.5),0 6px 18px rgba(184,230,46,.35)}\n.sp-tabpanel{margin-bottom:8px}\n/* notes */\n.sp-note{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-left:4px solid var(--nd-lime,#B8E62E);border-radius:16px;padding:15px 20px;margin:18px 0;font-size:.9rem;color:var(--nd-muted,#B8C0CE);line-height:1.65;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 3px 8px rgba(0,0,0,.4)}\n.sp-note strong{color:var(--nd-text,#fff)}\n/* overview links */\n.sp-links{list-style:none;margin:18px 0;padding:0;display:grid;gap:10px}\n.sp-links a{display:block;padding:14px 20px;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 5px rgba(0,0,0,.3);transition:border-color .15s,transform .15s}\n.sp-links a:hover{border-color:var(--nd-lime,#B8E62E);transform:translateY(-1px)}\n/* verdict pills */\n.vpill{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:16px;padding:16px 20px;margin:14px 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 3px 8px rgba(0,0,0,.35)}\n.vpill-tf{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nd-dim,#8E98A8);margin-right:12px}\n.vpill-v{display:inline-block;padding:4px 14px;border-radius:999px;font-weight:700;font-size:.85rem}\n.vpill-v.vg-sb{background:rgba(74,222,128,.15);color:var(--nd-up,#4ADE80);border:1px solid rgba(74,222,128,.4)}\n.vpill-v.vg-b{background:rgba(184,230,46,.12);color:var(--nd-lime,#B8E62E);border:1px solid rgba(184,230,46,.35)}\n.vpill-v.vg-h{background:rgba(255,255,255,.06);color:var(--nd-muted,#B8C0CE);border:1px solid var(--nd-border,#1E2430)}\n.vpill-v.vg-e{background:rgba(248,113,113,.12);color:var(--nd-down,#F87171);border:1px solid rgba(248,113,113,.35)}\n.vpill-v.vg-se{background:rgba(248,113,113,.2);color:#FCA5A5;border:1px solid rgba(248,113,113,.5)}\n.vpill-v.vg-na{background:rgba(255,255,255,.04);color:var(--nd-dim,#8E98A8);border:1px solid var(--nd-border,#1E2430)}\n.vpill-meta{display:block;margin-top:8px;font-size:.82rem;color:var(--nd-dim,#8E98A8)}\n.vpill-na{color:var(--nd-dim,#8E98A8);font-size:.88rem}\n/* fundamentals */\n.sp-fund-group{margin:24px 0}\n.sp-fund-sub{font-size:1rem;font-weight:700;color:var(--nd-text,#fff);margin:0 0 12px}\n.sp-fund-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}\n@media(min-width:700px){.sp-fund-grid{grid-template-columns:repeat(3,1fr)}}\n.sp-fund{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 38%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:16px;padding:14px 16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 2px 6px rgba(0,0,0,.35)}\n.sp-fund-l{display:block;font-size:.75rem;color:var(--nd-dim,#8E98A8);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}\n.sp-fund-v{display:block;font-size:1.1rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n.sp-fund-v.na{color:var(--nd-dim,#8E98A8);font-weight:400}\n/* tables */\n.sp-table-wrap{overflow-x:auto;margin:18px 0;border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 3px 8px rgba(0,0,0,.45),0 18px 44px rgba(0,0,0,.35)}\n.sp-peer-table{width:100%;border-collapse:separate;border-spacing:0;font-size:.85rem;background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,0) 60px),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:20px;overflow:hidden;color:var(--nd-text,#fff)}\n.sp-peer-table th,.sp-peer-table td{padding:11px 13px;text-align:left;border-bottom:1px solid var(--nd-border,#1E2430);white-space:nowrap}\n.sp-peer-table th{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0)),var(--nd-panel-2,#161A23);font-weight:700;color:var(--nd-lime,#B8E62E);font-size:.76rem;letter-spacing:.07em;text-transform:uppercase;border-bottom:1px solid var(--nd-border-strong,#2A3342)}\n.sp-peer-table tr:last-child td{border-bottom:none}\n.sp-peer-table td.num,.sp-peer-table th.num{text-align:right;font-variant-numeric:tabular-nums}\n.sp-peer-table tbody tr:hover td{background:rgba(255,255,255,.025)}\n.sp-peer-table tr.cur td{background:rgba(184,230,46,.06)}\n.sp-peer-table td.pos{color:var(--nd-up,#4ADE80);font-weight:700}\n.sp-peer-table td.neg{color:var(--nd-down,#F87171);font-weight:700}\n.sp-peer-table a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none}\n.sp-peer-table a:hover{color:var(--nd-lime,#B8E62E);text-decoration:underline}\n.sp-sec-row td{background:var(--nd-panel-2,#161A23);padding:10px 13px}\n.sp-sec-row strong{color:var(--nd-lime,#B8E62E);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase}\n/* news */\n.sp-news{list-style:none;margin:16px 0;padding:0;display:grid;gap:10px}\n.sp-news li{padding:14px 18px;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 5px rgba(0,0,0,.3)}\n.sp-news a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none;line-height:1.5}\n.sp-news a:hover{color:var(--nd-lime,#B8E62E)}\n.sp-news-src{display:block;margin-top:6px;font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n/* peers + disclaimer + directory */\n.sp-peers{list-style:none;margin:14px 0;padding:0;display:flex;flex-wrap:wrap;gap:10px}\n.sp-peers a{display:inline-block;padding:9px 18px;border-radius:999px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-size:.88rem;font-weight:600;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 2px 5px rgba(0,0,0,.3);transition:border-color .15s,transform .15s}\n.sp-peers a:hover{border-color:var(--nd-lime,#B8E62E);transform:translateY(-1px)}\n.sp-disc{margin:32px 0 0;padding:16px 20px;border-radius:14px;background:rgba(255,255,255,.02);border:1px dashed var(--nd-border,#1E2430);font-size:.85rem;color:var(--nd-dim,#8E98A8);line-height:1.6}\n.sp-dir{list-style:none;margin:20px 0;padding:0;display:grid;gap:8px}\n.sp-dir li{padding:12px 18px;border-radius:12px;background:var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430)}\n.sp-dir a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none}\n.sp-dir a:hover{color:var(--nd-lime,#B8E62E)}\n.sp-type{font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-left:8px}\n/* investment calendar: new design */\n.inv-cal{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 3px 8px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.3);margin:20px 0;overflow:hidden}\n.inv-cal-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem 1.4rem;border-bottom:1px solid var(--nd-border,#1E2430)}\n.inv-cal-head h2{margin:0;font-size:1.15rem;font-weight:700;color:var(--nd-text,#fff)}\n.inv-cal-co{font-size:.82rem;color:var(--nd-dim,#8E98A8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}\n.inv-cal-body{display:flex;gap:0;padding:1.25rem;flex-wrap:wrap}\n.inv-cal-nav{display:flex;flex-direction:column;min-width:150px;border:1px solid var(--nd-border,#1E2430);border-radius:12px;overflow:hidden;align-self:flex-start;background:var(--nd-panel-2,#161A23)}\n.inv-cal-tab{appearance:none;border:0;border-bottom:1px solid var(--nd-border,#1E2430);background:transparent;padding:.85rem 1rem;font-size:.8rem;font-weight:600;letter-spacing:.04em;color:var(--nd-muted,#B8C0CE);cursor:pointer;text-align:center;transition:background .15s,color .15s}\n.inv-cal-tab:last-child{border-bottom:0}\n.inv-cal-tab:hover{color:var(--nd-text,#fff)}\n.inv-cal-tab.active{background:linear-gradient(180deg,#D4F34A 0%,var(--nd-lime,#B8E62E) 55%,#9BCB24 100%);color:#0A0C10;font-weight:700}\n.inv-cal-count{display:inline-block;background:rgba(0,0,0,.15);border-radius:10px;padding:1px 7px;font-size:.72rem;margin-left:4px}\n.inv-cal-tab.active .inv-cal-count{background:rgba(0,0,0,.18)}\n.inv-cal-main{flex:1;min-width:0;padding-left:1.25rem}\n.inv-cal-controls{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.8rem;flex-wrap:wrap}\n.inv-cal-controls label{font-size:.88rem;color:var(--nd-muted,#B8C0CE)}\n.inv-cal-perpage,.inv-cal-q{border:1px solid var(--nd-border,#1E2430);border-radius:10px;padding:.45rem .7rem;font-size:.88rem;background:var(--nd-panel-2,#161A23);color:var(--nd-text,#fff)}\n.inv-cal-q{width:180px}\n.inv-cal-scroll{overflow-x:auto;border:1px solid var(--nd-border,#1E2430);border-radius:14px}\n.inv-cal-table{width:100%;border-collapse:collapse;font-size:.88rem;min-width:520px;background:var(--nd-panel,#12141A);color:var(--nd-text,#fff)}\n.inv-cal-table thead th{background:var(--nd-panel-2,#161A23);color:var(--nd-lime,#B8E62E);font-weight:700;padding:.7rem .8rem;text-align:center;white-space:nowrap;font-size:.78rem;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid var(--nd-border-strong,#2A3342)}\n.inv-cal-table tbody td{padding:.65rem .8rem;border-bottom:1px solid var(--nd-border,#1E2430);text-align:center;font-variant-numeric:tabular-nums}\n.inv-cal-table tbody tr:last-child td{border-bottom:none}\n.inv-cal-table tbody tr:hover td{background:rgba(255,255,255,.02)}\n.inv-pill{display:inline-block;padding:3px 12px;border-radius:999px;font-size:.75rem;font-weight:700}\n.inv-pill-open{background:rgba(74,222,128,.15);color:var(--nd-up,#4ADE80);border:1px solid rgba(74,222,128,.4)}\n.inv-pill-closed{background:rgba(255,255,255,.05);color:var(--nd-dim,#8E98A8);border:1px solid var(--nd-border,#1E2430)}\n.inv-cal-foot{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:.9rem;flex-wrap:wrap}\n.inv-cal-info{font-size:.85rem;color:var(--nd-dim,#8E98A8)}\n.inv-cal-pages{display:flex;gap:6px;align-items:center}\n.inv-cal-prev,.inv-cal-next,.inv-cal-pg{padding:7px 14px;border:1px solid var(--nd-border,#1E2430);border-radius:10px;background:var(--nd-panel-2,#161A23);color:var(--nd-text,#fff);cursor:pointer;font-size:.82rem;font-weight:600}\n.inv-cal-prev:hover:not(:disabled),.inv-cal-next:hover:not(:disabled),.inv-cal-pg:hover{border-color:var(--nd-lime,#B8E62E)}\n.inv-cal-prev:disabled,.inv-cal-next:disabled{opacity:.4;cursor:default}\n.inv-cal-pg.cur{background:var(--nd-lime,#B8E62E);color:#0A0C10;border-color:var(--nd-lime,#B8E62E);font-weight:700}\n.inv-cal-empty{margin:1.2rem}\n/* valuation lab: new design */\n.d2-val-lab{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:20px;padding:22px 24px;margin:22px 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 3px 8px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.3)}\n.d2-val-label{font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nd-dim,#8E98A8);margin:0 0 12px}\n.d2-val-grid{display:grid;gap:20px}\n@media(min-width:900px){.d2-val-grid{grid-template-columns:340px 1fr}}\n.d2-bank-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px}\n.d2-bank-chips button{padding:7px 14px;border-radius:999px;border:1px solid var(--nd-border,#1E2430);background:var(--nd-panel-2,#161A23);color:var(--nd-muted,#B8C0CE);font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:border-color .15s,color .15s}\n.d2-bank-chips button:hover{border-color:var(--nd-lime,#B8E62E);color:var(--nd-text,#fff)}\n.d2-bank-chips button[aria-pressed="true"]{background:var(--nd-lime,#B8E62E);color:#0A0C10;border-color:var(--nd-lime,#B8E62E);font-weight:700}\n.d2-val-co-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:6px 0 14px}\n.d2-val-co-sym{font-size:1.3rem;font-weight:800;color:var(--nd-text,#fff)}\n.d2-val-co-name{font-size:.85rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n.d2-val-co-price{text-align:right}\n.d2-val-co-price .p{font-size:1.2rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n.d2-val-co-price .c{font-size:.85rem;font-weight:700}\n.d2-val-co-price .c.up{color:var(--nd-up,#4ADE80)}\n.d2-val-co-price .c.dn{color:var(--nd-down,#F87171)}\n.d2-metric-rows{display:grid;gap:8px}\n.d2-metric-row{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 16px;border-radius:14px;border:1px solid var(--nd-border,#1E2430);background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0) 50%),var(--nd-panel-2,#161A23);cursor:pointer;color:var(--nd-text,#fff);font:inherit;transition:border-color .15s,transform .15s}\n.d2-metric-row:hover{border-color:var(--nd-lime,#B8E62E);transform:translateY(-1px)}\n.d2-metric-row[aria-pressed="true"]{border-color:var(--nd-lime,#B8E62E);box-shadow:0 0 0 1px var(--nd-lime,#B8E62E),0 4px 14px rgba(184,230,46,.15)}\n.d2-metric-row .m-name{font-weight:700;font-size:.9rem}\n.d2-metric-row .m-name small{display:block;font-weight:400;font-size:.75rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n.d2-metric-row .m-val{font-weight:700;font-variant-numeric:tabular-nums;color:var(--nd-lime,#B8E62E)}\n.d2-val-chart-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}\n.d2-val-chart-head strong{color:var(--nd-text,#fff);font-size:1.05rem}\n.d2-val-chart-head span{display:block;font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n.d2-val-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.78rem;color:var(--nd-dim,#8E98A8)}\n.d2-val-chart{background:var(--nd-inset,#0D0F14);border:1px solid var(--nd-border,#1E2430);border-radius:14px;padding:12px;min-height:280px}\n.d2-val-chart canvas{width:100%;height:280px;display:block}\n.d2-fresh{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px;font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n.d2-fresh b{color:var(--nd-muted,#B8C0CE)}\n/* light theme */\n[data-theme="light"] .sp-price-card,[data-theme="light"] .vpill,[data-theme="light"] .sp-fund,[data-theme="light"] .inv-cal,[data-theme="light"] .d2-val-lab{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;box-shadow:inset 0 2px 0 #FFFFFF,0 1px 2px rgba(10,12,16,.1),0 8px 24px rgba(10,12,16,.1)}\n[data-theme="light"] .sp-tab{background:linear-gradient(180deg,#FFFFFF 0%,#EDF1F5 100%);border-color:#CBD4DE;color:#3F4753;box-shadow:inset 0 2px 0 #FFFFFF,0 1px 2px rgba(10,12,16,.1)}\n[data-theme="light"] .sp-tab:hover{border-color:#4D7C0F;color:#0A0C10}\n[data-theme="light"] .sp-tab.active{background:linear-gradient(180deg,#6BAE16 0%,#4D7C0F 60%,#3E650C 100%);border-color:#3E650C;color:#fff}\n[data-theme="light"] .sp-price,[data-theme="light"] .sp-stat-v,[data-theme="light"] .sp-fund-v,[data-theme="light"] .d2-val-co-sym,[data-theme="light"] .inv-cal-head h2{color:#0A0C10}\n[data-theme="light"] .sp-note{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;border-left-color:#4D7C0F;color:#3F4753}\n[data-theme="light"] .sp-note strong{color:#0A0C10}\n[data-theme="light"] .sp-peer-table,[data-theme="light"] .inv-cal-table{background:#fff;color:#0A0C10;border-color:#CBD4DE}\n[data-theme="light"] .sp-peer-table th,[data-theme="light"] .inv-cal-table thead th{background:linear-gradient(180deg,#FFFFFF,#E8EDF2);color:#3E650C}\n[data-theme="light"] .sp-peer-table td,[data-theme="light"] .inv-cal-table tbody td{border-bottom-color:#E8EDF2}\n[data-theme="light"] .sp-peer-table a{color:#0A0C10}\n[data-theme="light"] .sp-links a,[data-theme="light"] .sp-news li,[data-theme="light"] .sp-peers a,[data-theme="light"] .sp-dir li{background:linear-gradient(180deg,#FFFFFF,#F4F7FA);border-color:#CBD4DE;color:#0A0C10}\n[data-theme="light"] .sp-links a,[data-theme="light"] .sp-news a{color:#0A0C10}\n[data-theme="light"] .d2-metric-row{background:linear-gradient(180deg,#FFFFFF,#F4F7FA);border-color:#CBD4DE;color:#0A0C10}\n[data-theme="light"] .d2-metric-row .m-val{color:#4D7C0F}\n[data-theme="light"] .d2-bank-chips button{background:#EFF2F6;border-color:#D5DCE4;color:#3F4753}\n[data-theme="light"] .d2-bank-chips button[aria-pressed="true"]{background:#4D7C0F;border-color:#4D7C0F;color:#fff}\n'
NEW_SP_CSS = '/* price snapshot: hero card — nd-card depth language, token spacing scale */\n.sp-snap{margin:var(--nd-s6) 0}\n.sp-price-card{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 38%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);padding:var(--nd-s5) var(--nd-s6);box-shadow:var(--nd-rim),var(--nd-e2);display:flex;gap:var(--nd-s6);flex-wrap:wrap;align-items:flex-start;justify-content:space-between}\n.sp-price-main{min-width:200px}\n.sp-price{font-family:var(--nd-font-display,Georgia,serif);font-size:var(--step-4);font-weight:700;color:var(--nd-text,#fff);letter-spacing:-.01em}\n.sp-chg{font-size:.95rem;font-weight:700;margin-top:6px}\n.sp-chg.pos{color:var(--nd-up,#4ADE80)}\n.sp-chg.neg{color:var(--nd-down,#F87171)}\n.sp-live-badge{display:inline-block;margin-top:8px;padding:3px var(--nd-s3);border-radius:var(--nd-r-pill);font-size:.72rem;font-weight:700;background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10)}\n.sp-price-side{display:flex;gap:var(--nd-s6);flex-wrap:wrap}\n.sp-stat{display:flex;flex-direction:column;gap:var(--nd-s1)}\n.sp-stat-v{font-size:1.05rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n.sp-stat-l{font-size:.75rem;color:var(--nd-dim,#8E98A8);text-transform:uppercase;letter-spacing:.05em;font-weight:600}\n/* tabs: nd-tabs--pill language (contract in css/nd-chrome.css); the JS\n   contract is unchanged — .active class + aria-selected stay in sync,\n   roving tabindex + Arrow/Home/End keys per the APG tabs pattern */\n.sp-tabs{display:flex;gap:var(--nd-s2);margin:var(--nd-s2) 0 var(--nd-s6);flex-wrap:wrap}\n.sp-tab{display:inline-flex;align-items:center;min-height:40px;padding:0 16px;font-family:var(--nd-font-sans);font-weight:600;font-size:.8125rem;color:var(--nd-muted,#B8C0CE);cursor:pointer;background:var(--nd-panel,#12141A);border:1px solid var(--nd-border-strong,#2A3140);border-radius:var(--nd-r-pill);box-shadow:var(--nd-rim),var(--nd-e1);transition:color var(--nd-t-fast) var(--nd-ease),background var(--nd-t-fast) var(--nd-ease),border-color var(--nd-t-fast) var(--nd-ease),box-shadow var(--nd-t-fast) var(--nd-ease)}\n.sp-tab:hover{color:var(--nd-text,#fff)}\n.sp-tab:focus-visible{outline:none;box-shadow:var(--nd-focus-ring)}\n.sp-tab.active{background:linear-gradient(180deg,color-mix(in srgb,var(--nd-lime,#B8E62E) 88%,#fff),var(--nd-lime,#B8E62E));color:var(--nd-on-lime,#0A0C10);border-color:transparent}\n.sp-tabpanel{margin-bottom:var(--nd-s2)}\n/* notes */\n.sp-note{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-left:4px solid var(--nd-lime,#B8E62E);border-radius:var(--nd-r-lg);padding:var(--nd-s4) var(--nd-s5);margin:var(--nd-s5) 0;font-size:.9rem;color:var(--nd-muted,#B8C0CE);line-height:1.65;box-shadow:var(--nd-rim),var(--nd-e1)}\n.sp-note strong{color:var(--nd-text,#fff)}\n/* overview links */\n.sp-links{list-style:none;margin:var(--nd-s5) 0;padding:0;display:grid;gap:var(--nd-s3)}\n.sp-links a{display:block;padding:var(--nd-s3) var(--nd-s5);border-radius:var(--nd-r-lg);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-weight:600;box-shadow:var(--nd-rim),var(--nd-e1);transition:border-color var(--nd-t-fast) var(--nd-ease),background var(--nd-t-fast) var(--nd-ease)}\n.sp-links a:hover{border-color:var(--nd-lime,#B8E62E);background:var(--nd-lime-faint)}\n/* verdict pills */\n.vpill{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:var(--nd-s4) var(--nd-s5);margin:var(--nd-s4) 0;box-shadow:var(--nd-rim),var(--nd-e1)}\n.vpill-tf{display:inline-block;font-size:.75rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nd-dim,#8E98A8);margin-right:12px}\n.vpill-v{display:inline-block;padding:4px 14px;border-radius:999px;font-weight:700;font-size:.85rem}\n.vpill-v.vg-sb{background:var(--nd-up-soft);color:var(--nd-up,#4ADE80);border:1px solid rgba(74,222,128,.4)}\n.vpill-v.vg-b{background:var(--nd-lime-soft);color:var(--nd-lime,#B8E62E);border:1px solid rgba(184,230,46,.35)}\n.vpill-v.vg-h{background:rgba(255,255,255,.06);color:var(--nd-muted,#B8C0CE);border:1px solid var(--nd-border,#1E2430)}\n.vpill-v.vg-e{background:var(--nd-down-soft);color:var(--nd-down,#F87171);border:1px solid rgba(248,113,113,.35)}\n.vpill-v.vg-se{background:rgba(248,113,113,.2);color:#FCA5A5;border:1px solid rgba(248,113,113,.5)}\n.vpill-v.vg-na{background:rgba(255,255,255,.04);color:var(--nd-dim,#8E98A8);border:1px solid var(--nd-border,#1E2430)}\n.vpill-meta{display:block;margin-top:8px;font-size:.82rem;color:var(--nd-dim,#8E98A8)}\n.vpill-na{color:var(--nd-dim,#8E98A8);font-size:.88rem}\n/* fundamentals */\n.sp-fund-group{margin:var(--nd-s6) 0}\n.sp-fund-sub{font-size:1rem;font-weight:700;color:var(--nd-text,#fff);margin:0 0 12px}\n.sp-fund-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--nd-s3)}\n@media(min-width:700px){.sp-fund-grid{grid-template-columns:repeat(3,1fr)}}\n.sp-fund{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,0) 38%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:var(--nd-s4);box-shadow:var(--nd-rim),var(--nd-e1)}\n.sp-fund-l{display:block;font-size:.75rem;color:var(--nd-dim,#8E98A8);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}\n.sp-fund-v{display:block;font-size:1.1rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n.sp-fund-v.na{color:var(--nd-dim,#8E98A8);font-weight:400}\n/* tables: markup carries .nd-table inside .nd-tablewrap, so the table\n   system in css/nd-chrome.css governs (sticky header + first column,\n   mono small-caps dim headers, surface-shift zebra, .num right-align).\n   Only stock-specific extras live here. Specificity note: the section\n   and current-row rules are written to tie nd-table\'s zebra/hover and\n   win on source order (this block loads after nd-chrome.css). */\n.sp-table-wrap{overflow:auto;margin:var(--nd-s5) 0;background:var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);box-shadow:var(--nd-rim),var(--nd-e1)}\n.sp-peer-table tbody tr.cur td{background:var(--nd-lime-soft)}\n.sp-peer-table a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none}\n.sp-peer-table a:hover{color:var(--nd-lime,#B8E62E);text-decoration:underline}\n.sp-peer-table td.pos{color:var(--nd-up,#4ADE80);font-weight:700}\n.sp-peer-table td.neg{color:var(--nd-down,#F87171);font-weight:700}\n.sp-peer-table tbody tr.sp-sec-row td{background:var(--nd-panel-2,#161A23)}\n.sp-sec-row strong{font-family:var(--nd-font-mono,ui-monospace,monospace);font-weight:600;font-size:.6875rem;letter-spacing:.09em;text-transform:uppercase;color:var(--nd-dim,#8E98A8)}\n/* news */\n.sp-news{list-style:none;margin:var(--nd-s4) 0;padding:0;display:grid;gap:var(--nd-s3)}\n.sp-news li{padding:var(--nd-s4) var(--nd-s5);border-radius:var(--nd-r-lg);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);box-shadow:var(--nd-rim),var(--nd-e1)}\n.sp-news a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none;line-height:1.5}\n.sp-news a:hover{color:var(--nd-lime,#B8E62E)}\n.sp-news-src{display:block;margin-top:6px;font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n/* peers + disclaimer + directory */\n.sp-peers{list-style:none;margin:var(--nd-s4) 0;padding:0;display:flex;flex-wrap:wrap;gap:var(--nd-s3)}\n.sp-peers a{display:inline-block;padding:var(--nd-s2) var(--nd-s5);border-radius:var(--nd-r-pill);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 50%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-size:.88rem;font-weight:600;box-shadow:var(--nd-rim),var(--nd-e1);transition:border-color var(--nd-t-fast) var(--nd-ease)}\n.sp-peers a:hover{border-color:var(--nd-lime,#B8E62E)}\n.sp-disc{margin:var(--nd-s8) 0 0;padding:var(--nd-s4) var(--nd-s5);border-radius:var(--nd-r-lg);background:rgba(255,255,255,.02);border:1px dashed var(--nd-border,#1E2430);font-size:.85rem;color:var(--nd-dim,#8E98A8);line-height:1.6}\n.sp-dir{list-style:none;margin:var(--nd-s5) 0;padding:0;display:grid;gap:var(--nd-s2)}\n.sp-dir li{padding:var(--nd-s3) var(--nd-s5);border-radius:var(--nd-r-md);background:var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430)}\n.sp-dir a{color:var(--nd-text,#fff);font-weight:600;text-decoration:none}\n.sp-dir a:hover{color:var(--nd-lime,#B8E62E)}\n.sp-type{font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-left:8px}\n/* investment calendar: card shell on tokens; its table rides .nd-table\n   (markup) inside the .nd-tablewrap scroll shell */\n.inv-cal{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);box-shadow:var(--nd-rim),var(--nd-e1);margin:var(--nd-s5) 0;overflow:hidden}\n.inv-cal-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:var(--nd-s4) var(--nd-s5);border-bottom:1px solid var(--nd-border,#1E2430)}\n.inv-cal-head h2{margin:0;font-size:1.15rem;font-weight:700;color:var(--nd-text,#fff)}\n.inv-cal-co{font-size:.82rem;color:var(--nd-dim,#8E98A8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}\n.inv-cal-body{display:flex;gap:0;padding:var(--nd-s5);flex-wrap:wrap}\n.inv-cal-nav{display:flex;flex-direction:column;min-width:150px;border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);overflow:hidden;align-self:flex-start;background:var(--nd-panel-2,#161A23)}\n.inv-cal-tab{appearance:none;border:0;border-bottom:1px solid var(--nd-border,#1E2430);background:transparent;padding:.85rem 1rem;font-size:.8rem;font-weight:600;letter-spacing:.04em;color:var(--nd-muted,#B8C0CE);cursor:pointer;text-align:center;transition:background var(--nd-t-fast) var(--nd-ease),color var(--nd-t-fast) var(--nd-ease)}\n.inv-cal-tab:last-child{border-bottom:0}\n.inv-cal-tab:hover{color:var(--nd-text,#fff)}\n.inv-cal-tab.active{background:linear-gradient(180deg,color-mix(in srgb,var(--nd-lime,#B8E62E) 88%,#fff),var(--nd-lime,#B8E62E));color:var(--nd-on-lime,#0A0C10);font-weight:700}\n.inv-cal-count{display:inline-block;background:rgba(0,0,0,.15);border-radius:10px;padding:1px 7px;font-size:.72rem;margin-left:4px}\n.inv-cal-tab.active .inv-cal-count{background:rgba(0,0,0,.18)}\n.inv-cal-main{flex:1;min-width:0;padding-left:var(--nd-s5)}\n.inv-cal-controls{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:.8rem;flex-wrap:wrap}\n.inv-cal-controls label{font-size:.88rem;color:var(--nd-muted,#B8C0CE)}\n.inv-cal-perpage,.inv-cal-q{border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);padding:.45rem .7rem;font-size:.88rem;background:var(--nd-panel-2,#161A23);color:var(--nd-text,#fff)}\n.inv-cal-q{width:180px}\n.inv-cal-table{min-width:520px}\n.inv-pill{display:inline-block;padding:3px 12px;border-radius:999px;font-size:.75rem;font-weight:700}\n.inv-pill-open{background:rgba(74,222,128,.15);color:var(--nd-up,#4ADE80);border:1px solid rgba(74,222,128,.4)}\n.inv-pill-closed{background:rgba(255,255,255,.05);color:var(--nd-dim,#8E98A8);border:1px solid var(--nd-border,#1E2430)}\n.inv-cal-foot{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:.9rem;flex-wrap:wrap}\n.inv-cal-info{font-size:.85rem;color:var(--nd-dim,#8E98A8)}\n.inv-cal-pages{display:flex;gap:6px;align-items:center}\n.inv-cal-prev,.inv-cal-next,.inv-cal-pg{padding:7px 14px;border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-md);background:var(--nd-panel-2,#161A23);color:var(--nd-text,#fff);cursor:pointer;font-size:.82rem;font-weight:600}\n.inv-cal-prev:hover:not(:disabled),.inv-cal-next:hover:not(:disabled),.inv-cal-pg:hover{border-color:var(--nd-lime,#B8E62E)}\n.inv-cal-prev:disabled,.inv-cal-next:disabled{opacity:.4;cursor:default}\n.inv-cal-pg.cur{background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10);border-color:var(--nd-lime,#B8E62E);font-weight:700}\n.inv-cal-empty{margin:1.2rem}\n/* valuation lab: card shell on tokens */\n.d2-val-lab{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,0) 45%),var(--nd-panel,#12141A);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);padding:var(--nd-s5) var(--nd-s6);margin:var(--nd-s6) 0;box-shadow:var(--nd-rim),var(--nd-e1)}\n.d2-val-label{font-size:.78rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--nd-dim,#8E98A8);margin:0 0 12px}\n.d2-val-grid{display:grid;gap:20px}\n@media(min-width:900px){.d2-val-grid{grid-template-columns:340px 1fr}}\n.d2-bank-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px}\n.d2-bank-chips button{padding:7px 14px;border-radius:var(--nd-r-pill);border:1px solid var(--nd-border,#1E2430);background:var(--nd-panel-2,#161A23);color:var(--nd-muted,#B8C0CE);font:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:border-color .15s,color .15s}\n.d2-bank-chips button:hover{border-color:var(--nd-lime,#B8E62E);color:var(--nd-text,#fff)}\n.d2-bank-chips button[aria-pressed="true"]{background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10);border-color:var(--nd-lime,#B8E62E);font-weight:700}\n.d2-val-co-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin:6px 0 14px}\n.d2-val-co-sym{font-size:1.3rem;font-weight:800;color:var(--nd-text,#fff)}\n.d2-val-co-name{font-size:.85rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n.d2-val-co-price{text-align:right}\n.d2-val-co-price .p{font-size:1.2rem;font-weight:700;color:var(--nd-text,#fff);font-variant-numeric:tabular-nums}\n.d2-val-co-price .c{font-size:.85rem;font-weight:700}\n.d2-val-co-price .c.up{color:var(--nd-up,#4ADE80)}\n.d2-val-co-price .c.dn{color:var(--nd-down,#F87171)}\n.d2-metric-rows{display:grid;gap:8px}\n.d2-metric-row{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 16px;border-radius:var(--nd-r-lg);border:1px solid var(--nd-border,#1E2430);background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0) 50%),var(--nd-panel-2,#161A23);cursor:pointer;color:var(--nd-text,#fff);font:inherit;transition:border-color var(--nd-t-fast) var(--nd-ease),box-shadow var(--nd-t-fast) var(--nd-ease)}\n.d2-metric-row:hover{border-color:var(--nd-lime,#B8E62E)}\n.d2-metric-row[aria-pressed="true"]{border-color:var(--nd-lime,#B8E62E);box-shadow:0 0 0 1px var(--nd-lime,#B8E62E),0 4px 14px rgba(184,230,46,.15)}\n.d2-metric-row .m-name{font-weight:700;font-size:.9rem}\n.d2-metric-row .m-name small{display:block;font-weight:400;font-size:.75rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n.d2-metric-row .m-val{font-weight:700;font-variant-numeric:tabular-nums;color:var(--nd-text,#fff)}\n.d2-val-chart-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}\n.d2-val-chart-head strong{color:var(--nd-text,#fff);font-size:1.05rem}\n.d2-val-chart-head span{display:block;font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:2px}\n.d2-val-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:.78rem;color:var(--nd-dim,#8E98A8)}\n.d2-val-chart{background:var(--nd-inset,#0D0F14);border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-lg);padding:12px;min-height:280px}\n.d2-val-chart canvas{width:100%;height:280px;display:block}\n.d2-fresh{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:14px;font-size:.8rem;color:var(--nd-dim,#8E98A8)}\n.d2-fresh b{color:var(--nd-muted,#B8C0CE)}\n/* light theme: token-driven components (tabs, tables) flip with the\n   tokens; only the deep-card light recipe remains explicit here */\n[data-theme="light"] .sp-price-card,[data-theme="light"] .vpill,[data-theme="light"] .sp-fund,[data-theme="light"] .inv-cal,[data-theme="light"] .d2-val-lab{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;box-shadow:inset 0 2px 0 #FFFFFF,0 1px 2px rgba(10,12,16,.1),0 8px 24px rgba(10,12,16,.1)}\n[data-theme="light"] .sp-price,[data-theme="light"] .sp-stat-v,[data-theme="light"] .sp-fund-v,[data-theme="light"] .d2-val-co-sym,[data-theme="light"] .inv-cal-head h2{color:#0A0C10}\n[data-theme="light"] .sp-note{background:linear-gradient(180deg,#FFFFFF 0%,#F4F7FA 100%);border-color:#CBD4DE;border-left-color:#4D7C0F;color:#3F4753}\n[data-theme="light"] .sp-note strong{color:#0A0C10}\n[data-theme="light"] .sp-links a,[data-theme="light"] .sp-news li,[data-theme="light"] .sp-peers a,[data-theme="light"] .sp-dir li{background:linear-gradient(180deg,#FFFFFF,#F4F7FA);border-color:#CBD4DE;color:#0A0C10}\n[data-theme="light"] .sp-links a,[data-theme="light"] .sp-news a{color:#0A0C10}\n[data-theme="light"] .d2-metric-row{background:linear-gradient(180deg,#FFFFFF,#F4F7FA);border-color:#CBD4DE;color:#0A0C10}\n[data-theme="light"] .d2-bank-chips button{background:#EFF2F6;border-color:#D5DCE4;color:#3F4753}\n[data-theme="light"] .d2-bank-chips button[aria-pressed="true"]{background:#4D7C0F;border-color:#4D7C0F;color:#fff}\n'
OLD_WRAP_CSS = '.wrap-arc{max-width:860px;margin:0 auto;padding:28px 20px 64px}\n.wrap-arc .kicker{font:600 .72rem/1.4 var(--nd-font-mono,ui-monospace,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--nd-lime,#B8E62E);margin-bottom:10px}\n.wrap-arc h1{font-family:var(--nd-font-display,Georgia,serif);font-weight:700;font-size:clamp(1.9rem,3.6vw,2.9rem);line-height:1.12;letter-spacing:-.02em;color:var(--nd-text,#fff);margin:0 0 10px}\n.wrap-arc .lede{color:var(--nd-muted,#B8C0CE);font-size:1.02rem;line-height:1.7;margin:0 0 30px;max-width:64ch}\n.wa-entry{border:1px solid var(--nd-border,#1E2430);border-radius:16px;background:var(--nd-panel,#12141A);padding:22px 22px 18px;margin:0 0 20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.05)}\n.wa-entry .wa-date{font:600 .7rem/1.4 var(--nd-font-mono,ui-monospace,monospace);letter-spacing:.12em;text-transform:uppercase;color:var(--nd-muted,#B8C0CE);margin-bottom:8px}\n.wa-entry h2{font-family:var(--nd-font-display,Georgia,serif);font-weight:700;font-size:clamp(1.25rem,2.4vw,1.7rem);line-height:1.2;letter-spacing:-.01em;margin:0 0 10px;color:var(--nd-text,#fff)}\n.wa-entry h2 .dir-up{color:#4ade80}.wa-entry h2 .dir-dn{color:#f87171}\n[data-theme="light"] .wa-entry h2 .dir-up{color:#16a34a}[data-theme="light"] .wa-entry h2 .dir-dn{color:#dc2626}\n.wa-entry p{color:var(--nd-muted,#B8C0CE);line-height:1.75;margin:0 0 10px}\n.wa-entry p strong{color:var(--nd-text,#fff);font-weight:600}\n.wa-entry .wa-meta{font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:12px;padding-top:12px;border-top:1px solid var(--nd-border,#1E2430)}\n.wa-entry .wa-meta strong{color:var(--nd-text,#fff)}\n.wa-pager{display:flex;gap:10px;align-items:center;justify-content:center;margin:34px 0 0;flex-wrap:wrap}\n.wa-pager a,.wa-pager span.cur{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-weight:600;font-size:.9rem;background:var(--nd-panel,#12141A)}\n.wa-pager a:hover{border-color:var(--nd-lime,#B8E62E)}\n.wa-pager span.cur{background:var(--nd-lime,#B8E62E);color:#0A0C10;border-color:var(--nd-lime,#B8E62E)}\n.wa-crumb{font-size:.82rem;color:var(--nd-dim,#8E98A8);margin-bottom:16px}\n.wa-crumb a{color:var(--nd-lime,#B8E62E);text-decoration:none}\n'
NEW_WRAP_CSS = '.wrap-arc{max-width:860px;margin:0 auto;padding:var(--nd-s8) var(--nd-s5) var(--nd-s16)}\n.wrap-arc .kicker{font:600 .72rem/1.4 var(--nd-font-mono,ui-monospace,monospace);letter-spacing:.14em;text-transform:uppercase;color:var(--nd-lime,#B8E62E);margin-bottom:var(--nd-s3)}\n.wrap-arc h1{font-family:var(--nd-font-display,Georgia,serif);font-weight:700;font-size:var(--nd-text-h1);line-height:1.12;letter-spacing:-.02em;color:var(--nd-text,#fff);margin:0 0 var(--nd-s3)}\n.wrap-arc .lede{color:var(--nd-muted,#B8C0CE);font-size:1.02rem;line-height:1.7;margin:0 0 var(--nd-s8);max-width:64ch}\n.wa-entry{border:1px solid var(--nd-border,#1E2430);border-radius:var(--nd-r-card);background:var(--nd-panel,#12141A);padding:var(--nd-s5) var(--nd-s5) var(--nd-s4);margin:0 0 var(--nd-s5);box-shadow:var(--nd-rim),var(--nd-e1)}\n.wa-entry .wa-date{font:600 .7rem/1.4 var(--nd-font-mono,ui-monospace,monospace);letter-spacing:.12em;text-transform:uppercase;color:var(--nd-muted,#B8C0CE);margin-bottom:var(--nd-s2)}\n.wa-entry h2{font-family:var(--nd-font-display,Georgia,serif);font-weight:700;font-size:var(--nd-text-h2);line-height:1.2;letter-spacing:-.01em;margin:0 0 var(--nd-s3);color:var(--nd-text,#fff)}\n.wa-entry h2 .dir-up{color:var(--nd-up,#4ADE80)}.wa-entry h2 .dir-dn{color:var(--nd-down,#F87171)}\n.wa-entry p{color:var(--nd-muted,#B8C0CE);line-height:1.75;margin:0 0 var(--nd-s3)}\n.wa-entry p strong{color:var(--nd-text,#fff);font-weight:600}\n.wa-entry .wa-meta{font-size:.8rem;color:var(--nd-dim,#8E98A8);margin-top:var(--nd-s3);padding-top:var(--nd-s3);border-top:1px solid var(--nd-border,#1E2430)}\n.wa-entry .wa-meta strong{color:var(--nd-text,#fff)}\n.wa-pager{display:flex;gap:var(--nd-s3);align-items:center;justify-content:center;margin:var(--nd-s8) 0 0;flex-wrap:wrap}\n.wa-pager a,.wa-pager span.cur{display:inline-flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;padding:0 var(--nd-s4);border-radius:var(--nd-r-pill);border:1px solid var(--nd-border,#1E2430);color:var(--nd-text,#fff);text-decoration:none;font-weight:600;font-size:.9rem;background:var(--nd-panel,#12141A);box-shadow:var(--nd-rim),var(--nd-e1)}\n.wa-pager a:hover{border-color:var(--nd-lime,#B8E62E)}\n.wa-pager span.cur{background:var(--nd-lime,#B8E62E);color:var(--nd-on-lime,#0A0C10);border-color:var(--nd-lime,#B8E62E)}\n.wa-crumb{font-size:.82rem;color:var(--nd-dim,#8E98A8);margin-bottom:16px}\n.wa-crumb a{color:var(--nd-lime,#B8E62E);text-decoration:none}\n'
OLD_SEG = 'var tabs=document.querySelectorAll(".sp-tab"),panels=document.querySelectorAll(".sp-tabpanel");function on(n){tabs.forEach(function(t){var a=t.dataset.tab===n;t.classList.toggle("active",a);t.setAttribute("aria-selected",a);});panels.forEach(function(p){var a=p.dataset.panel===n;p.classList.toggle("active",a);if(a)p.removeAttribute("hidden");else p.setAttribute("hidden","");});}tabs.forEach(function(t){t.addEventListener("click",function(){on(t.dataset.tab);});t.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key==="ArrowLeft"){var i=Array.prototype.indexOf.call(tabs,t);var nx=e.key==="ArrowRight"?(i+1)%tabs.length:(i-1+tabs.length)%tabs.length;tabs[nx].focus();on(tabs[nx].dataset.tab);}});});'
NEW_SEG = 'var tabs=document.querySelectorAll(".sp-tab"),panels=document.querySelectorAll(".sp-tabpanel");function on(n){tabs.forEach(function(t){var a=t.dataset.tab===n;t.classList.toggle("active",a);t.setAttribute("aria-selected",a);t.tabIndex=a?0:-1;});panels.forEach(function(p){var a=p.dataset.panel===n;p.classList.toggle("active",a);if(a)p.removeAttribute("hidden");else p.setAttribute("hidden","");});}tabs.forEach(function(t){if(!t.classList.contains("active"))t.tabIndex=-1;t.addEventListener("click",function(){on(t.dataset.tab);});t.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key==="ArrowLeft"||e.key==="Home"||e.key==="End"){e.preventDefault();var i=Array.prototype.indexOf.call(tabs,t);var nx=e.key==="Home"?0:e.key==="End"?tabs.length-1:e.key==="ArrowRight"?(i+1)%tabs.length:(i-1+tabs.length)%tabs.length;tabs[nx].focus();on(tabs[nx].dataset.tab);}});});'
OLD_SIG_DIM = '/* Contrast fix: --nd-dim (#6B7280) is 3.81:1 on dark panels — below AA for\n   small text. Scope a brighter dim to signal pages only. */\n.sig-wrap{--nd-dim:#7D8590}'
NEW_SIG_DIM = '/* (Wave G2) Scoped --nd-dim override retired: css/nd-tokens.css now\n   defines --nd-dim as #8E98A8 (brighter than the #6B7280 this once\n   patched), so signal pages inherit the token like every other family. */'

TOKENS_LINK = '<link rel="stylesheet" href="/css/nd-tokens.css?v=20261023a">\n'
ERRORS = []
REPORT = {}


def rep(text, old, new, label, expect=None):
    """Exact replace with assertion. Returns (text, n). Idempotent:
    old absent + new present counts as already-applied (n=0, no error)."""
    n = text.count(old)
    if n == 0:
        if new not in text:
            ERRORS.append(f'{label}: pattern not found')
        return text, 0
    if expect is not None and n != expect:
        ERRORS.append(f'{label}: expected {expect} occurrence(s), found {n}')
        return text, 0
    return text.replace(old, new), n


def note(family, key, n=1):
    REPORT.setdefault(family, {}).setdefault(key, 0)
    REPORT[family][key] += n


# ---------------------------------------------------------------- stocks
def transform_stock(text, rel):
    fam = 'stocks'
    orig = text
    legacy = (OLD_SP_CSS not in text and NEW_SP_CSS not in text
              and '<style>' not in text)
    # 1. inline style block: swap (standard) or inject (legacy template)
    if OLD_SP_CSS in text:
        text = text.replace(OLD_SP_CSS, NEW_SP_CSS)
        note(fam, 'style_swapped')
    elif NEW_SP_CSS in text:
        note(fam, 'style_already')
    elif legacy:
        text = text.replace('</head>', '<style>\n' + NEW_SP_CSS +
                            '</style>\n</head>', 1)
        note(fam, 'style_injected_legacy')
    else:
        ERRORS.append(f'{rel}: unrecognised style-block state')
        return orig
    # 2. explicit token chain link
    if 'nd-tokens.css' in text:
        note(fam, 'tokens_already')
    else:
        anchors = [a for a in ('<link rel="stylesheet" href="/css/nd-chrome.css',
                               '<link rel="stylesheet" href="/css/nd-editorial-theme.css')
                   if a in text]
        if not anchors:
            ERRORS.append(f'{rel}: no stylesheet anchor for tokens link')
            return orig
        anchor = min(anchors, key=lambda a: text.index(a))
        i = text.index(anchor)
        text = text[:i] + TOKENS_LINK + text[i:]
        note(fam, 'tokens_added' + ('_legacy' if legacy else ''))
    # 3. sig-pro cache-bust (only on pages that load it)
    vs = re.findall(r'sig-pro\.css\?v=([^"]*)', text)
    if vs and any(v != '20261023a' for v in vs):
        text = re.sub(r'sig-pro\.css\?v=[^"]*', 'sig-pro.css?v=20261023a', text)
        note(fam, 'sigpro_version_bumped', len(vs))
    # 4. static theme-color: cream -> token canvas (Wave A adoption fix)
    if '<meta name="theme-color" content="#FAF8F2">' in text:
        text = text.replace('<meta name="theme-color" content="#FAF8F2">',
                            '<meta name="theme-color" content="#0A0C10">')
        note(fam, 'theme_color_fixed')
    # 5. nd-table adoption in markup
    for old, new, key in [
        ('<div class="sp-table-wrap">', '<div class="sp-table-wrap nd-tablewrap">', 'tablewrap'),
        ('<table class="sp-peer-table">', '<table class="sp-peer-table nd-table">', 'peer_table'),
        ('<div class="inv-cal-scroll">', '<div class="inv-cal-scroll nd-tablewrap">', 'inv_wrap'),
        ('<table class="inv-cal-table">', '<table class="inv-cal-table nd-table nd-table--dense">', 'inv_table'),
    ]:
        c = text.count(old)
        if c:
            text = text.replace(old, new)
            note(fam, 'markup_' + key, c)
    # 6. tab script: roving tabindex + Home/End (APG), behaviour preserved
    if 'data-tab="overview"' in text:
        if OLD_SEG in text:
            text = text.replace(OLD_SEG, NEW_SEG)
            note(fam, 'tab_script_patched')
        elif NEW_SEG in text:
            note(fam, 'tab_script_already')
        else:
            ERRORS.append(f'{rel}: tab script segment not recognised')
            return orig
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


# ---------------------------------------------------------------- wrap
def transform_wrap(text, rel):
    fam = 'wrap'
    orig = text
    if OLD_WRAP_CSS in text:
        text = text.replace(OLD_WRAP_CSS, NEW_WRAP_CSS)
        note(fam, 'style_swapped')
    elif NEW_WRAP_CSS in text:
        note(fam, 'style_already')
    else:
        ERRORS.append(f'{rel}: wrap style block not recognised')
        return orig
    if 'nd-tokens.css' in text:
        note(fam, 'tokens_already')
    else:
        anchor = '<link rel="stylesheet" href="/css/nd-editorial-theme.css'
        if anchor not in text:
            ERRORS.append(f'{rel}: no editorial anchor for tokens link')
            return orig
        i = text.index(anchor)
        text = text[:i] + TOKENS_LINK + text[i:]
        note(fam, 'tokens_added')
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


# ---------------------------------------------------------------- sig-pro
def transform_sigpro(text):
    fam = 'sig-pro'
    orig = text
    text, _ = rep(text, OLD_SIG_DIM, NEW_SIG_DIM, 'sig-pro dim override', expect=1)
    text, _ = rep(text,
                  'linear-gradient(180deg,#D4F34A 0%,var(--nd-lime,#B8E62E) 55%,#9BCB24 100%)',
                  'linear-gradient(180deg,color-mix(in srgb,var(--nd-lime,#B8E62E) 88%,#fff),var(--nd-lime,#B8E62E))',
                  'sig-pro active tab gradient (dark)', expect=1)
    text, _ = rep(text, 'border-color:#D4F34A;', 'border-color:transparent;',
                  'sig-pro active tab border (dark)', expect=1)
    text, _ = rep(text,
                  'linear-gradient(180deg,#6BAE16 0%,#4D7C0F 60%,#3E650C 100%)',
                  'linear-gradient(180deg,color-mix(in srgb,var(--nd-lime) 88%,#fff),var(--nd-lime))',
                  'sig-pro active tab gradient (light)', expect=1)
    text, _ = rep(text, 'border-color:#3E650C;border-top-color:#8FD41F;',
                  'border-color:transparent;',
                  'sig-pro active tab border (light)', expect=1)
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


# ------------------------------------------------------- symbol generator
def js_block_from_css(css):
    def esc(s):
        return s.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'")
    lines = ['const SP_STYLES =', "'<style>\\n' +"]
    for ln in css.split('\n')[:-1]:
        lines.append("'" + esc(ln) + "\\n' +")
    lines.append("'</style>\\n';")
    return '\n'.join(lines)


def eval_sp_styles(block):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(block + '\nprocess.stdout.write(SP_STYLES);')
        tmp = f.name
    try:
        out = subprocess.run(['node', tmp], capture_output=True, text=True)
        if out.returncode != 0:
            ERRORS.append('node eval of SP_STYLES failed: ' + out.stderr[:200])
            return None
        return out.stdout
    finally:
        os.unlink(tmp)


def transform_symbol_generator(text):
    fam = 'gen-symbol'
    orig = text
    # --- SP_STYLES splice (verified by evaluating the JS string) ---
    start = text.index('const SP_STYLES =')
    end_marker = "'</style>\\n';"
    end = text.index(end_marker, start) + len(end_marker)
    cur = eval_sp_styles(text[start:end])
    if cur == '<style>\n' + NEW_SP_CSS + '</style>\n':
        note(fam, 'sp_styles_already')
    elif cur == '<style>\n' + OLD_SP_CSS + '</style>\n':
        text = text[:start] + js_block_from_css(NEW_SP_CSS) + text[end:]
        note(fam, 'sp_styles_spliced')
        # self-verify the splice
        start = text.index('const SP_STYLES =')
        end = text.index(end_marker, start) + len(end_marker)
        if eval_sp_styles(text[start:end]) != '<style>\n' + NEW_SP_CSS + '</style>\n':
            ERRORS.append('gen-symbol: SP_STYLES splice verification failed')
            return orig
    else:
        ERRORS.append('gen-symbol: SP_STYLES does not match old or new CSS')
        return orig
    # --- head: tokens link after fonts.css (head + indexPage) ---
    fonts_line = "'<link rel=\"stylesheet\" href=\"/css/fonts.css\">\\n' +"
    if 'nd-tokens.css' in text:
        note(fam, 'tokens_already')
    else:
        text, _ = rep(text, fonts_line,
                      fonts_line + "\n    '<link rel=\"stylesheet\" href=\"/css/nd-tokens.css?v=20261023a\">\\n' +",
                      'gen-symbol tokens link', expect=2)
    # --- version alignment with the baked pages ---
    for old, new, label, expect in [
        ('nd-chrome.css?v=20261009d', 'nd-chrome.css?v=20261023a', 'chrome css v', 2),
        ('nd-editorial-theme.css?v=20261009b', 'nd-editorial-theme.css?v=20261023a', 'editorial css v', 2),
        ('sig-pro.css?v=20261006a', 'sig-pro.css?v=20261023a', 'sig-pro css v', 2),
        ('nd-chrome.js?v=20261014a', 'nd-chrome.js?v=20261023a', 'chrome js v', 1),
        ('theme-toggle.js?v=20261006c', 'theme-toggle.js?v=20261023a', 'theme-toggle js v', 1),
        ('<meta name="theme-color" content="#FAF8F2">', '<meta name="theme-color" content="#0A0C10">', 'theme-color', 1),
    ]:
        text, _ = rep(text, old, new, 'gen-symbol ' + label, expect=expect)
    # --- table markup emissions ---
    text, _ = rep(text,
                  '<div class="sp-table-wrap"><table class="sp-peer-table">',
                  '<div class="sp-table-wrap nd-tablewrap"><table class="sp-peer-table nd-table">',
                  'gen-symbol peer table markup', expect=2)
    text, _ = rep(text,
                  '<div class="inv-cal-scroll"><table class="inv-cal-table">',
                  '<div class="inv-cal-scroll nd-tablewrap"><table class="inv-cal-table nd-table nd-table--dense">',
                  'gen-symbol inv-cal markup', expect=4)
    # --- tab script fragments (emitted script must equal NEW_SEG) ---
    text, _ = rep(text,
                  't.classList.toggle("active",a);t.setAttribute("aria-selected",a);});',
                  't.classList.toggle("active",a);t.setAttribute("aria-selected",a);t.tabIndex=a?0:-1;});',
                  'gen-symbol on() roving tabindex', expect=1)
    text, _ = rep(text,
                  "h += 'tabs.forEach(function(t){t.addEventListener(\"click\",function(){on(t.dataset.tab);});';",
                  "h += 'tabs.forEach(function(t){if(!t.classList.contains(\"active\"))t.tabIndex=-1;';\n"
                  "  h += 't.addEventListener(\"click\",function(){on(t.dataset.tab);});';",
                  'gen-symbol tab init tabindex', expect=1)
    text, _ = rep(text,
                  'if(e.key==="ArrowRight"||e.key==="ArrowLeft"){',
                  'if(e.key==="ArrowRight"||e.key==="ArrowLeft"||e.key==="Home"||e.key==="End"){e.preventDefault();',
                  'gen-symbol keydown Home/End', expect=1)
    text, _ = rep(text,
                  'var nx=e.key==="ArrowRight"?(i+1)%tabs.length:(i-1+tabs.length)%tabs.length;',
                  'var nx=e.key==="Home"?0:e.key==="End"?tabs.length-1:e.key==="ArrowRight"?(i+1)%tabs.length:(i-1+tabs.length)%tabs.length;',
                  'gen-symbol keydown jump target', expect=1)
    # --- verify: reconstructed emitted segment == NEW_SEG ---
    parts, capture = [], False
    for line in text.split('\n'):
        if 'data-goto-tab' in line:
            break
        if 'var tabs=document.querySelectorAll' in line:
            capture = True
        if capture:
            m = re.search(r"h \+= '((?:[^'\\]|\\.)*)';", line)
            if m:
                parts.append(m.group(1))
    if ''.join(parts) != NEW_SEG:
        ERRORS.append('gen-symbol: reconstructed tab segment != NEW_SEG')
        return orig
    note(fam, 'segment_verified')
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


# --------------------------------------------------------- wrap generator
def transform_wrap_generator(text):
    fam = 'gen-wrap'
    orig = text
    if OLD_WRAP_CSS in text:
        text = text.replace(OLD_WRAP_CSS, NEW_WRAP_CSS)
        note(fam, 'style_swapped')
    elif NEW_WRAP_CSS in text:
        note(fam, 'style_already')
    else:
        ERRORS.append('gen-wrap: COMMON_HEAD style not recognised')
        return orig
    text, _ = rep(text,
                  '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261009b">',
                  '<link rel="stylesheet" href="/css/nd-tokens.css?v=20261023a">\n'
                  '<link rel="stylesheet" href="/css/nd-editorial-theme.css?v=20261023a">',
                  'gen-wrap tokens link + editorial v', expect=1)
    for old, new, label in [
        ('nepse-design-system.css?v=c967c332', 'nepse-design-system.css?v=20261023a', 'design-system v'),
        ('nd-chrome.css?v=20261009f', 'nd-chrome.css?v=20261023a', 'chrome css v'),
        ('nd-chrome.js?v=20261014a', 'nd-chrome.js?v=20261023a', 'chrome js v'),
    ]:
        text, _ = rep(text, old, new, 'gen-wrap ' + label, expect=1)
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


# --------------------------------------------------- actions page (1-off)
def transform_actions_page(text, rel):
    fam = 'actions'
    orig = text
    if 'nd-tokens.css' in text:
        note(fam, 'tokens_already')
    else:
        anchor = '<link rel="stylesheet" href="/css/nd-editorial-theme.css'
        if anchor not in text:
            ERRORS.append(f'{rel}: no editorial anchor for tokens link')
            return orig
        i = text.index(anchor)
        text = text[:i] + TOKENS_LINK + text[i:]
        note(fam, 'tokens_added')
    text, _ = rep(text, 'nd-actions.css?v=20261009a', 'nd-actions.css?v=20261023a',
                  'actions css v', expect=1)
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


def transform_actions_generator(text):
    fam = 'gen-actions'
    orig = text
    if 'nd-tokens.css' in text:
        note(fam, 'tokens_already')
    else:
        text, _ = rep(
            text,
            "'<link rel=\"stylesheet\" href=\"/css/nd-editorial-theme.css?v=20261003a\">\\n' +",
            "'<link rel=\"stylesheet\" href=\"/css/nd-tokens.css?v=20261023a\">\\n' +\n"
            "    '<link rel=\"stylesheet\" href=\"/css/nd-editorial-theme.css?v=20261023a\">\\n' +",
            'gen-actions tokens link + editorial v', expect=1)
    for old, new, label in [
        ('nd-chrome.css?v=20261004a', 'nd-chrome.css?v=20261023a', 'chrome css v'),
        ('nd-actions.css?v=20261009a', 'nd-actions.css?v=20261023a', 'actions css v'),
        ('nd-chrome.js?v=20261014a', 'nd-chrome.js?v=20261023a', 'chrome js v'),
    ]:
        text, _ = rep(text, old, new, 'gen-actions ' + label, expect=1)
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


def transform_actions_css(text):
    fam = 'actions-css'
    orig = text
    text, _ = rep(text, 'var(--nd-lime, #C6F135)', 'var(--nd-lime, #B8E62E)',
                  'actions css lime fallback', expect=1)
    if text != orig:
        note(fam, 'files_changed')
    note(fam, 'files_seen')
    return text


# ------------------------------------------------------------------- main
def main():
    report_only = '--report-only' in sys.argv
    jobs = []  # (path, new_text)
    stock_files = sorted(glob.glob(os.path.join(ROOT, 'stocks', '*', 'index.html')))
    stock_files.append(os.path.join(ROOT, 'stocks', 'index.html'))
    for p in stock_files:
        with open(p, encoding='utf-8') as f:
            jobs.append((p, transform_stock(f.read(), os.path.relpath(p, ROOT))))
    wrap_files = sorted(glob.glob(os.path.join(ROOT, 'nepse-decode', 'wrap', '**', 'index.html'), recursive=True))
    for p in wrap_files:
        with open(p, encoding='utf-8') as f:
            jobs.append((p, transform_wrap(f.read(), os.path.relpath(p, ROOT))))
    p = os.path.join(ROOT, 'nepse-actions', 'index.html')
    with open(p, encoding='utf-8') as f:
        jobs.append((p, transform_actions_page(f.read(), 'nepse-actions/index.html')))
    for rel, fn in [('css/sig-pro.css', transform_sigpro),
                    ('css/nd-actions.css', transform_actions_css),
                    ('tools/build-symbol-pages.js', transform_symbol_generator),
                    ('tools/build-market-wrap-archive.js', transform_wrap_generator),
                    ('tools/build-actions-page.js', transform_actions_generator)]:
        p = os.path.join(ROOT, rel)
        with open(p, encoding='utf-8') as f:
            jobs.append((p, fn(f.read())))
    if ERRORS:
        print('ABORT — no files written. Errors:')
        for e in ERRORS:
            print('  -', e)
        return 1
    changed = 0
    for p, new_text in jobs:
        with open(p, encoding='utf-8') as f:
            old_text = f.read()
        if new_text != old_text:
            changed += 1
            if not report_only:
                with open(p, 'w', encoding='utf-8') as f:
                    f.write(new_text)
    for fam in sorted(REPORT):
        print(fam, REPORT[fam])
    print('files changed:', changed, ('(report-only)' if report_only else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
