#!/usr/bin/env node
/**
 * SEB Localized Tabletop Runner — Jing-Zhang AI Innovation Belt (v1.12 adoption)
 * Zero-dependency offline validator for the localized SEB criteria set.
 * Mirror of the upstream SEB tabletop-run pattern (lqqk7, CC BY-SA 4.0).
 *
 * Two independent check families:
 *   A. LOC-01..03  five-field scenario-slot completeness (12 slots + slot fixtures)
 *   B. LOC-04      pilot-readiness eight-field ledger honesty gate (96 entries + ledger fixtures)
 *
 * Run:  node seb-localized-tabletop-run.js
 * Exit 0 = all fixtures as expected and ledger complete. Exit 1 = failure. Exit 2 = spec incompatibility.
 * This proves only that the criteria are self-consistent and executable on the
 * fixtures; it does NOT prove any service is running, adopted, approved or
 * government-committed (see provenance.evidence_class = concept_only).
 */
"use strict";
const fs = require("fs");
const path = require("path");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, name), "utf8"));
}

const spec = load("seb-localized-spec.json");
const fixtures = load("seb-localized-fixtures.json").fixtures;
const ledger = load("pilot-readiness-ledger.json");
const ledgerFixtures = load("pilot-readiness-fixtures.json").fixtures;

// -- version compatibility check (localized derivative bumped to 0.2.0 with LOC-04) --
if (spec.version !== "0.2.0") {
  console.error("SPEC_VERSION_INCOMPATIBLE: expected 0.2.0, got " + spec.version);
  process.exit(2);
}

const REQUIRED = ["ai_off_path", "human_handoff", "gate_id", "operating_mode", "responsible_role"];
const SAME_SYSTEM_TOKENS = ["online", "线上", "self-service", "自助", "同系统", "线上办理", "网上"];
const GATE_BY_LEVEL = { "L0": "G0", "L1": "G1", "L2": "G2", "L3": "G3", "L4": "G3" };

function checkSlot(slot) {
  const problems = [];
  for (const f of REQUIRED) {
    const v = slot[f];
    if (typeof v !== "string" || v.trim() === "") {
      problems.push("MISSING_FIELD:" + f);
    }
  }
  const off = (slot.ai_off_path || "").toLowerCase();
  for (const tok of SAME_SYSTEM_TOKENS) {
    if (off.includes(tok.toLowerCase())) {
      problems.push("SAME_SYSTEM_PATH:" + tok);
      break;
    }
  }
  const lvl = slot.operating_mode;
  const expectedGate = GATE_BY_LEVEL[lvl];
  if (expectedGate && slot.gate_id !== expectedGate) {
    problems.push("GATE_MISMATCH:" + lvl + " requires " + expectedGate + " got " + slot.gate_id);
  }
  return problems;
}

// ---- LOC-04 : pilot-readiness ledger honesty gate -------------------------------
const LOC04 = (spec.localization_rules || []).find(r => r.rule_id === "LOC-04");
if (!LOC04) {
  console.error("LOC04_RULE_ABSENT: the eight-field ledger gate is missing from the spec");
  process.exit(2);
}
const MISSING_CODE = {
  known: "KNOWN_WITHOUT_EVIDENCE",
  proposed: "PROPOSED_WITHOUT_CONFIRMER",
  unknown: "UNKNOWN_NOT_FROZEN",
};
const DIGITS = /[0-9\uFF10-\uFF19]/;

function checkLedgerEntry(e) {
  const problems = [];
  if (!LOC04.required_fields.includes(e.field)) {
    problems.push("LEDGER_MISSING_FIELD:" + e.field);
  }
  if (!LOC04.allowed_status.includes(e.status)) {
    problems.push("LEDGER_BAD_STATUS:" + e.status);
  }
  for (const f of (LOC04.obligations[e.status] || [])) {
    const v = e[f];
    if (typeof v !== "string" || v.trim() === "") {
      problems.push(MISSING_CODE[e.status] + ":" + f);
    }
  }
  // freeze rule: an unknown field may name responsibility but never smuggle in a number
  if (LOC04.numeric_freeze_on_unknown && e.status === "unknown" && DIGITS.test(String(e.value || ""))) {
    problems.push("UNKNOWN_CARRIES_NUMBER");
  }
  return problems;
}

function checkLedgerCompleteness() {
  const problems = [];
  const seen = new Map();
  for (const e of ledger.entries) {
    const k = e.slot_id + "|" + e.field;
    if (seen.has(k)) problems.push("LEDGER_DUPLICATE:" + k);
    seen.set(k, true);
  }
  for (const slot of spec.scenario_slots) {
    for (const f of LOC04.required_fields) {
      if (!seen.has(slot.slot_id + "|" + f)) {
        problems.push("LEDGER_UNDECLARED:" + slot.slot_id + "|" + f);
      }
    }
  }
  for (const e of ledger.entries) {
    const p = checkLedgerEntry(e);
    for (const x of p) problems.push(x + "@" + e.slot_id + "|" + e.field);
  }
  const tally = { known: 0, proposed: 0, unknown: 0 };
  for (const e of ledger.entries) tally[e.status] = (tally[e.status] || 0) + 1;
  for (const k of Object.keys(tally)) {
    if (ledger.counts[k] !== tally[k]) problems.push("LEDGER_COUNT_MISMATCH:" + k);
  }
  if (ledger.counts.entries !== ledger.entries.length) problems.push("LEDGER_COUNT_MISMATCH:entries");
  return problems;
}

let pass = 0, reject = 0, mismatch = 0;
for (const fx of fixtures) {
  const problems = checkSlot(fx.slot);
  const isExpectedPass = fx.expect === "pass" && problems.length === 0;
  const isExpectedReject = fx.expect === "reject" && problems.length > 0;
  if (isExpectedPass) { pass++; console.log("PASS " + fx.fixture_id); }
  else if (isExpectedReject) {
    reject++;
    console.log("REJECT " + fx.fixture_id + " (" + problems.join("; ") + ") expected=reject");
  } else {
    mismatch++;
    console.log("MISMATCH " + fx.fixture_id + " expected=" + fx.expect + " problems=" + (problems.join("; ") || "none"));
  }
}
console.log("--- LOC-01..03 slot fixtures ---");
console.log("fixtures=" + fixtures.length + " pass=" + pass + " reject=" + reject + " mismatch=" + mismatch);

let lpass = 0, lreject = 0, lmismatch = 0;
for (const fx of ledgerFixtures) {
  const problems = checkLedgerEntry(fx.entry);
  const isExpectedPass = fx.expect === "pass" && problems.length === 0;
  const isExpectedReject = fx.expect === "reject" && problems.length > 0;
  if (isExpectedPass) { lpass++; console.log("PASS " + fx.fixture_id); }
  else if (isExpectedReject) {
    lreject++;
    console.log("REJECT " + fx.fixture_id + " (" + problems.join("; ") + ") expected=reject");
  } else {
    lmismatch++;
    console.log("MISMATCH " + fx.fixture_id + " expected=" + fx.expect + " problems=" + (problems.join("; ") || "none"));
  }
}
const comp = checkLedgerCompleteness();
console.log("--- LOC-04 pilot-readiness ledger ---");
console.log("ledger_fixtures=" + ledgerFixtures.length + " pass=" + lpass + " reject=" + lreject + " mismatch=" + lmismatch);
console.log("ledger_entries=" + ledger.entries.length + " known=" + ledger.counts.known +
            " proposed=" + ledger.counts.proposed + " unknown=" + ledger.counts.unknown);
if (comp.length === 0) {
  console.log("PASS ledger-completeness (12 slots x 8 fields, no duplicate, counts consistent)");
} else {
  lmismatch++;
  console.log("MISMATCH ledger-completeness: " + comp.slice(0, 12).join("; "));
}

const totalMismatch = mismatch + lmismatch;
const totalCases = fixtures.length + ledgerFixtures.length + 1;
if (totalMismatch > 0 || (pass + reject) !== fixtures.length || (lpass + lreject) !== ledgerFixtures.length) {
  console.log("RESULT=FAIL");
  process.exit(1);
}
console.log("RESULT=PASS cases=" + totalCases);
process.exit(0);
