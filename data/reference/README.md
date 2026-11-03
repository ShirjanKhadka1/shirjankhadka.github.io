# Instrument & sector master — `data/reference/instruments.json`

**Status: ADOPTED (Charter v4.2 item 4A, 2026-11-03).** Single source of truth
for `instrument_type` + `sector` from this merge forward. No consumer is wired
to this file yet — 4B wires consumers and deletes the old classifiers; this PR
is the master file plus this README and nothing else.

## File

- `instruments.json` — version `1`, **428 rows**, one per listed security.
  Every row carries `source` + `as_of` individually. `issuer_id` is null on all
  428 rows: no permitted source supplies an issuer registry, and none was
  derived from any symbol.
- Counts (recomputed from the rows, not hand-adjusted): EQUITY 281, DEBENTURE
  68, MUTUAL_FUND 61, PROMOTER 18. By sector: Commercial Bank 68, Development
  Bank 22, Finance 17, Hotels and Tourism 8, Hydropower 114, Investment 9, Life
  Insurance 16, Manufacturing and Processing 18, Microfinance 51, Non Life
  Insurance 16, Trading 2, UNCONFIRMED 87.

## Classification fields: TWO ONLY

`instrument_type` and `sector`. TYPE decides ranking inclusion, never sector:
a DEBENTURE / PROMOTER / MUTUAL_FUND row carrying a real sector (e.g. a bank
debenture under Commercial Bank) is still excluded from equity rankings by its
type. Promoter and preference shares stay linked to the parent; they never
appear in "Others" unless this master says so for a named row (it currently
says so for none).

## Normalised sector vocabulary

One term per concept. `Commercial Bank` (not Banking / Commercial Banks),
`Development Bank`, `Finance`, `Hotels and Tourism`, `Hydropower` (not Hydro
Power), `Investment`, `Life Insurance`, `Manufacturing and Processing`,
`Microfinance`, `Non Life Insurance`, `Trading`. There are NO "Promoter
Shares", "Debentures", "Mutual Funds", or "Others" sector values in this file.
`UNCONFIRMED` is a marker, not a sector: it means no sector is asserted for
that row. It is never a fallback guess and never feeds a board or ranking.

## Debenture sector rule (verbatim from the file's `debenture_sector_rule`)

A debenture's sector is the sector of its ISSUING institution, taken from that
issuer's EQUITY row in this master. The issuer is decided ONLY as follows, in
order: (1) NAME EVIDENCE — if the debenture's universe name explicitly names
the issuing institution, the issuer is the master EQUITY row for that
institution (the name must identify one institution unambiguously). (2)
SYMBOL-STEM CONVENTION — NEPSE debenture symbols are formed as
`<issuer-code>D<maturity>[suffix]`; the issuer is the master EQUITY row whose
symbol equals that stem EXACTLY, no fuzzy matching, no issuer outside the
master asserted. (3) OTHERWISE UNCONFIRMED — if neither step identifies an
EQUITY row, or the identified issuer's own sector is UNCONFIRMED, the
debenture's sector is UNCONFIRMED with the reason in-row. A word in the
debenture name never implies a sector (an "Energy Bond" is not Hydropower),
and a merger successor is never asserted without a permitted source — a legacy
issuer code with no EQUITY row is UNCONFIRMED, not remapped to a guessed
successor.

## Promoter sector rule

A promoter share's sector is its PARENT's sector (the `parent_symbol` EQUITY
row). `parent_symbol` is carried only where the live universe itself evidences
the link by paired name. Heuristic suffix-strip candidates and unlinked rows
are UNCONFIRMED. `parent_verified` is false on every row: no filing or
official-register extract was checked for any parent link.

## Mutual-fund sector policy

A mutual-fund scheme has no issuer sector in this model: the sponsor /
fund-house sector is NOT the scheme's sector, so all 61 MUTUAL_FUND rows carry
sector UNCONFIRMED. Schemes are governed by `instrument_type`, never by
sector. Reintroducing a "Mutual Fund" sector value needs an explicit owner
decision.

## Provenance tiers (read the per-row fields, not just the headline)

- `verified` = sector + type evidenced by the sources named in-row.
- `UNCONFIRMED` = sector not asserted; the reason is in `gaps`, candidate
  evidence (if any) in `notes`/`disagreements`, never silently adopted.
- ADBL = Commercial Bank per Charter v4.1 owner decision (stands; NEPSE
  register extract still owed for filing-verified tier).
- BENH (Hydropower), SIGS2 (MUTUAL_FUND type), PMLIP (PROMOTER → PMLI) are
  carried with their provenance tiers intact; none is filing-verified.
- NICD88 + SBD87 were added by item 4A(d) (traded 2026-10-28, Debentures stock
  pages exist, per task evidence) as UNCONFIRMED rows: official-register
  confirmation was NOT obtained, so their sectors are not asserted.
- `as_of` is the evidence vintage per row (2026-10-30 carried rows,
  2026-11-03 added rows), not the file-write date; the adoption stamp is in
  each row's `source` field.

## What 4A did NOT do

No consumer wired (4B), no classifier deleted (4B), no CI invariant / live
gate (4C), no orphan-page decisions (4C), no dividend tests (4C). The
remaining UNCONFIRMED rows (87) are closed only by a NEPSE official-register
extract or an explicit owner decision — never by a name guess.

## Source of this adoption

Draft: `wt-charter-v41-master/data/reference/instruments.json` v1-draft (426
rows) — read-only source, never committed from that worktree. Adoption script
kept outside the repo at `~/workspace/charter-4a-work/build-adopted-master.py`.
