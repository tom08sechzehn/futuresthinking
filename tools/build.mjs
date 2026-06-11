#!/usr/bin/env node
/**
 * tools/build.mjs — Build-Pipeline für futuresthinking.eu.
 *
 * Single Source of Truth ist funde/*.future. Dieses Skript:
 *   1) liest + VALIDIERT alle Funde (gleiches Schema wie tools/validate.mjs;
 *      bricht hart ab, wenn ein Fund ungültig ist — Gürtel + Hosenträger),
 *   2) erzeugt site/data/funds.json   — Array aller Funde, sortiert nach fundjahr
 *      (maschinenlesbarer Voll-Index für client-side-Suche / Lineage-Graph),
 *   3) erzeugt .well-known/futures-feed.json — JSON-Feed (Föderation), UNSIGNIERT,
 *      aber struktur-signaturbereit (signature: null + Ed25519-Kommentar),
 *   4) montiert public-build/ = Kopie von site/ + die generierten Daten
 *      (das ist das Deploy-Verzeichnis für Cloudflare Pages).
 *
 * Build-Zeit:
 *   - reproduzierbar, falls SOURCE_DATE_EPOCH gesetzt ist (Unix-Sekunden),
 *   - sonst aktuelle Systemzeit. Robust gekapselt (buildTimestamp()).
 *
 * npm-Deps: ajv, ajv-formats, yaml. Node >= 20 (cpSync, rmSync recursive).
 *
 * Aufruf:  node tools/build.mjs   (npm run build)
 */

// Draft-2020-12-fähiger Ajv-Build (LOAD-BEARING, Silas-Fund): der Default-Import
// "ajv" ist Draft-07 und kennt das 2020-12-Meta-Schema NICHT. Muss der 2020-Build sein.
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  cpSync,
} from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const SCHEMA_PATH = join(REPO, "schema", "v1.0", "future.schema.json");
const FUNDE_DIR = join(REPO, "funde");
const FUNDE_BILDER_DIR = join(FUNDE_DIR, "bilder");
const SITE_DIR = join(REPO, "site");
const SITE_DATA_DIR = join(SITE_DIR, "data");
const WELLKNOWN_DIR = join(REPO, ".well-known");
const PUBLIC_BUILD = join(REPO, "public-build");

const INSTANZ = "https://futuresthinking.eu";

/* ----------------------------------------------------------------------------
 * Frontmatter-Reader — identisch zur Logik in tools/validate.mjs (Silas),
 * damit Build und Validierung exakt dasselbe sehen.
 * -------------------------------------------------------------------------- */
function readFrontmatter(file) {
  const raw = readFileSync(file, "utf8");
  const text = raw.replace(/^﻿/, "");
  const fenced = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n[\s\S]*)?$/);
  const yamlBlock = fenced ? fenced[1] : text;
  return parseYaml(yamlBlock) ?? {};
}

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

/* ----------------------------------------------------------------------------
 * Build-Zeit: reproduzierbar via SOURCE_DATE_EPOCH, sonst Systemzeit.
 * -------------------------------------------------------------------------- */
function buildTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch && /^\d+$/.test(epoch.trim())) {
    const ms = Number(epoch.trim()) * 1000;
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

/* ----------------------------------------------------------------------------
 * Lädt + validiert alle Funde. Bricht hart ab, wenn einer ungültig ist.
 * (Schema-Validierung; die Cross-Field-Regeln deckt tools/validate.mjs ab,
 *  das im CI vor build.mjs läuft. Hier zusätzlich Schema als Sicherheitsnetz.)
 * -------------------------------------------------------------------------- */
function loadFunde() {
  const validate = buildValidator();
  const files = findFundFiles();
  const funde = [];
  const errors = [];

  for (const f of files) {
    const data = readFrontmatter(f);
    if (!validate(data)) {
      errors.push(
        `✗ ${basename(f)}: ` +
          (validate.errors ?? [])
            .map((e) => `${e.instancePath || "/"} ${e.message}`)
            .join("; ")
      );
      continue;
    }
    funde.push(data);
  }

  if (errors.length) {
    console.error("Build abgebrochen — ungültige Funde:");
    for (const e of errors) console.error("  " + e);
    process.exit(1);
  }

  // sortiert nach fundjahr (stabil, dann nach objekt_id für Determinismus)
  funde.sort((a, b) => {
    if (a.fundjahr !== b.fundjahr) return a.fundjahr - b.fundjahr;
    return String(a.objekt_id).localeCompare(String(b.objekt_id));
  });
  return funde;
}

/* ----------------------------------------------------------------------------
 * site/data/funds.json — Voll-Index (Array aller Funde, sortiert nach fundjahr).
 * -------------------------------------------------------------------------- */
function writeFundsJson(funde, generated) {
  mkdirSync(SITE_DATA_DIR, { recursive: true });
  const out = {
    schema_ref: "https://futuresthinking.eu/schema/1.0/future.schema.json",
    generiert: generated,
    anzahl: funde.length,
    funde,
  };
  const target = join(SITE_DATA_DIR, "funds.json");
  writeFileSync(target, JSON.stringify(out, null, 2) + "\n", "utf8");
  return target;
}

/* ----------------------------------------------------------------------------
 * .well-known/futures-feed.json — JSON-Feed (Föderation).
 * UNSIGNIERT: signature ist null; Struktur ist signaturbereit (Ed25519 später,
 * erst nach Key-Rotation, §8/§14 backend-architektur.md).
 * -------------------------------------------------------------------------- */
function writeFeed(funde, generated) {
  mkdirSync(WELLKNOWN_DIR, { recursive: true });
  const items = funde.map((d) => ({
    objekt_id: d.objekt_id,
    objektname: d.objektname,
    fundjahr: d.fundjahr,
    wahrscheinlichkeit: d.wahrscheinlichkeit,
    wuenschbarkeit: d.wuenschbarkeit,
    tonalitaet: d.tonalitaet ?? null,
    lizenz: d.lizenz,
    urheber: d.urheber ?? null,
    permalink: `${INSTANZ}/fund/${d.objekt_id}/`,
    remix_von: d.remix_von ?? null,
    verweist_auf: d.verweist_auf ?? null,
  }));

  const feed = {
    feed_version: "1.0",
    schema_ref: "https://futuresthinking.eu/schema/1.0/future.schema.json",
    instanz: INSTANZ,
    name: "futuresthinking.eu",
    lizenz_default: "CC-BY-NC-4.0",
    generiert: generated,
    anzahl: items.length,
    items,
    // Signatur NOCH NICHT scharf. Ed25519 erst nach Key-Rotation/Revoke-Verfahren
    // (Entscheidung §13.6 / §14 Black Swan). Struktur ist signaturbereit:
    // wenn scharfgeschaltet, wird hier { alg:"Ed25519", key_version:"v1",
    // value: base64(sig über kanonischen Body ohne dieses Feld) } gesetzt.
    signature: null,
  };

  const target = join(WELLKNOWN_DIR, "futures-feed.json");
  writeFileSync(target, JSON.stringify(feed, null, 2) + "\n", "utf8");
  return target;
}

/* ----------------------------------------------------------------------------
 * public-build/ = Kopie von site/ + die generierten Daten.
 * -------------------------------------------------------------------------- */
function assemblePublicBuild() {
  // sauberer Neubau
  if (existsSync(PUBLIC_BUILD)) rmSync(PUBLIC_BUILD, { recursive: true, force: true });
  mkdirSync(PUBLIC_BUILD, { recursive: true });

  // 1) site/ komplett (inkl. site/data/funds.json, das eben erzeugt wurde)
  cpSync(SITE_DIR, PUBLIC_BUILD, { recursive: true });

  // 2) .well-known/ in den Build hängen (statisch + Feed)
  if (existsSync(WELLKNOWN_DIR)) {
    cpSync(WELLKNOWN_DIR, join(PUBLIC_BUILD, ".well-known"), { recursive: true });
  }

  // 3) funde/bilder/ -> public-build/bilder/ (Fund-Bilder; SSOT bleibt funde/bilder/,
  //    die bild.src in den .future zeigt root-relativ auf "bilder/<slug>.<webp|png|svg>").
  if (existsSync(FUNDE_BILDER_DIR)) {
    cpSync(FUNDE_BILDER_DIR, join(PUBLIC_BUILD, "bilder"), { recursive: true });
  }

  return PUBLIC_BUILD;
}

/* -------------------------------------------------------------------------- */
function run() {
  const generated = buildTimestamp();
  const funde = loadFunde();

  const fundsJson = writeFundsJson(funde, generated);
  const feedJson = writeFeed(funde, generated);
  const out = assemblePublicBuild();

  const bildCount = existsSync(FUNDE_BILDER_DIR)
    ? readdirSync(FUNDE_BILDER_DIR).filter((n) => /\.(png|webp|svg)$/i.test(n)).length
    : 0;
  const withBild = funde.filter((f) => f.bild && f.bild.src).length;

  console.log(`✓ ${funde.length} Funde gebaut (Stand ${generated})`);
  console.log(`  • ${fundsJson.replace(REPO + "/", "").replace(REPO + "\\", "")}`);
  console.log(`  • ${feedJson.replace(REPO + "/", "").replace(REPO + "\\", "")} (unsigniert, signaturbereit)`);
  console.log(`  • bilder/ → public-build/bilder/ (${bildCount} Datei(en), ${withBild} Funde mit bild)`);
  console.log(`  • public-build/ montiert (Deploy-Verzeichnis)`);
}

run();
