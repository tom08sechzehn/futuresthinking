#!/usr/bin/env node
/**
 * tools/validate.mjs — CI-Gate-Validator für futuresthinking.eu .future-Funde.
 *
 * Lädt schema/v1.0/future.schema.json, globt funde/*.future (ohne _TEMPLATE),
 * parst das YAML-Frontmatter und validiert jeden Fund gegen das Schema
 * (ajv + ajv-formats). Zusätzlich werden die Regeln geprüft, die reines
 * JSON-Schema NICHT kann:
 *   (a) Beipackzettel-Länge 280–600 in Unicode-CODE-POINTS (nicht UTF-16-Units)
 *   (b) FK-Auflösung: verweist_auf / remix_von zeigen auf existierende objekt_id
 *   (c) Slug ↔ Jahr: objekt_id beginnt mit fundjahr
 *   (d) objekt_id == Dateiname (ohne .future)
 *   (e) objekt_id-Dedup (kein doppelter Slug)
 *
 * Exit-Code 1 bei jedem Fehler. Erfolg => "✓ N Funde valide".
 *
 * npm-Deps (package.json schreibt Mack): ajv, ajv-formats, yaml.
 * Node >= 20 (für fs.globSync / import attributes nicht nötig; reines fs).
 *
 * Self-Test:  node tools/validate.mjs --selftest
 *   prüft, dass tests/fixtures/valid.future grün und invalid.future rot ist.
 */

// Draft-2020-12-faehiger Ajv-Build (kennt das 2020-12-Meta-Schema, das das
// future.schema.json via $schema deklariert). Liegt im selben "ajv"-Paket.
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SCHEMA_PATH = join(REPO, "schema", "v1.0", "future.schema.json");
const FUNDE_DIR = join(REPO, "funde");

const ENUM = {
  wahrscheinlichkeit: ["moeglich", "plausibel", "wahrscheinlich"],
  wuenschbarkeit: ["wuenschenswert", "neutral", "nicht"],
};

/** Liest YAML-Frontmatter aus einer .future-Datei.
 *  Ein optionaler Markdown-Body nach einem schließenden `---` wird verworfen
 *  (NICHT-normativ). Frontmatter ohne `---`-Klammerung wird komplett als YAML
 *  geparst (so liegen die Seeds vor). */
function readFrontmatter(file) {
  const raw = readFileSync(file, "utf8");
  const text = raw.replace(/^﻿/, "");
  // Variante mit ---...--- Klammerung
  const fenced = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n[\s\S]*)?$/);
  const yamlBlock = fenced ? fenced[1] : text;
  return parseYaml(yamlBlock) ?? {};
}

/** Findet alle Fund-Dateien (funde/*.future), ohne _TEMPLATE.future. */
function findFundFiles() {
  if (!existsSync(FUNDE_DIR)) return [];
  return readdirSync(FUNDE_DIR)
    .filter((n) => n.endsWith(".future") && !n.startsWith("_"))
    .map((n) => join(FUNDE_DIR, n))
    .sort();
}

function buildValidator() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

/** Validiert einen geparsten Fund. Gibt ein Array Fehlermeldungen zurück
 *  (leer = valide). `file` nur für Meldungen, `ids` ist das Set aller
 *  objekt_id im Repo (für FK-Auflösung). */
function checkRecord(file, data, validate, ids, opts = {}) {
  const errs = [];
  const name = basename(file);

  // 0) Schema
  if (!validate(data)) {
    for (const e of validate.errors ?? []) {
      errs.push(`schema: ${e.instancePath || "/"} ${e.message}`);
    }
  }

  // (d) objekt_id == Dateiname
  // Im Self-Test übersprungen: Fixtures heißen bewusst valid/invalid.future.
  if (!opts.skipFilenameCheck && data.objekt_id && name !== `${data.objekt_id}.future`) {
    errs.push(`Dateiname != objekt_id (erwartet ${data.objekt_id}.future)`);
  }

  // (c) Slug ↔ Jahr
  if (data.objekt_id && data.fundjahr != null) {
    const slugYear = String(data.objekt_id).split("-")[0];
    if (slugYear !== String(data.fundjahr)) {
      errs.push(`Slug-Jahr (${slugYear}) != fundjahr (${data.fundjahr})`);
    }
  }

  // (a) Beipackzettel-Länge in Code-Points
  if (typeof data.beipackzettel === "string") {
    const cp = [...data.beipackzettel.trim()].length;
    if (cp < 280 || cp > 600) {
      errs.push(`beipackzettel ${cp} Code-Points (erlaubt 280–600)`);
    }
  }

  // (b) FK-Auflösung
  for (const fk of ["verweist_auf", "remix_von"]) {
    const target = data[fk];
    if (target != null && target !== "") {
      if (target === data.objekt_id) {
        errs.push(`${fk} zeigt auf sich selbst (${target})`);
      } else if (!ids.has(target)) {
        errs.push(`dangling ${fk}: ${target} (keine solche objekt_id im Repo)`);
      }
    }
  }

  return errs;
}

function runValidation() {
  const validate = buildValidator();
  const files = findFundFiles();

  const records = files.map((f) => ({ f, data: readFrontmatter(f) }));

  // Dedup-Vorbereitung + ids-Set
  const seen = new Map(); // objekt_id -> file
  const ids = new Set();
  const dupErrors = [];
  for (const { f, data } of records) {
    const id = data.objekt_id;
    if (!id) continue;
    if (seen.has(id)) {
      dupErrors.push(
        `${basename(f)}: doppelte objekt_id "${id}" (auch ${basename(seen.get(id))})`
      );
    } else {
      seen.set(id, f);
    }
    ids.add(id);
  }

  let failed = 0;
  for (const { f, data } of records) {
    const errs = checkRecord(f, data, validate, ids);
    if (errs.length) {
      failed++;
      console.error(`✗ ${basename(f)}`);
      for (const e of errs) console.error(`    - ${e}`);
    }
  }
  for (const e of dupErrors) {
    failed++;
    console.error(`✗ ${e}`);
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed} Fehler in ${files.length} Funden.`);
    process.exit(1);
  }
  console.log(`✓ ${files.length} Funde valide`);
}

function runSelfTest() {
  const validate = buildValidator();
  const fixturesDir = join(REPO, "tests", "fixtures");
  const cases = [
    { file: join(fixturesDir, "valid.future"), expectValid: true },
    { file: join(fixturesDir, "invalid.future"), expectValid: false },
  ];
  let failed = 0;
  for (const { file, expectValid } of cases) {
    if (!existsSync(file)) {
      console.error(`✗ Self-Test: Fixture fehlt: ${file}`);
      failed++;
      continue;
    }
    const data = readFrontmatter(file);
    // ids-Set für die FK-Auflösung der Fixture: nur ihre eigene id +
    // ein Stub-Eintrag, damit gültige FKs in der valid-Fixture auflösen.
    const ids = new Set([data.objekt_id, "2041-stub-referenz-ziel"]);
    const errs = checkRecord(file, data, validate, ids, { skipFilenameCheck: true });
    const isValid = errs.length === 0;
    if (isValid === expectValid) {
      console.log(
        `✓ Self-Test ${basename(file)}: ${isValid ? "valide" : "ungültig"} (erwartet)`
      );
    } else {
      failed++;
      console.error(
        `✗ Self-Test ${basename(file)}: erwartet ${
          expectValid ? "valide" : "ungültig"
        }, war ${isValid ? "valide" : "ungültig"}`
      );
      for (const e of errs) console.error(`    - ${e}`);
    }
  }
  if (failed > 0) {
    console.error(`\n✗ Self-Test fehlgeschlagen (${failed}).`);
    process.exit(1);
  }
  console.log("✓ Schema-Self-Test bestanden");
}

const args = process.argv.slice(2);
if (args.includes("--selftest")) {
  runSelfTest();
} else {
  runValidation();
}
