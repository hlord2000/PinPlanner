#!/usr/bin/env node

/**
 * CI Script: Validate MCU Schema
 *
 * Uses AJV to validate all mcus/<mcu>/<package>.json files against
 * mcus/mcuSchema.json. Cross-references manifest.json entries to ensure
 * all listed package files exist on disk.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const MCUS_DIR = resolve(ROOT, "mcus");

let exitCode = 0;
let totalFiles = 0;
let passedFiles = 0;

function error(msg) {
  console.error(`  ERROR: ${msg}`);
  exitCode = 1;
}

function info(msg) {
  console.log(`  ${msg}`);
}

// Load the JSON schema
const schemaPath = resolve(MCUS_DIR, "mcuSchema.json");
if (!existsSync(schemaPath)) {
  console.error(`Schema file not found: ${schemaPath}`);
  process.exit(1);
}
const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

// Load the manifest
const manifestPath = resolve(MCUS_DIR, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Manifest file not found: ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// Initialize AJV
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

console.log("=== MCU Schema Validation ===\n");

// 1. Cross-reference manifest entries: ensure every listed package file exists
console.log("--- Checking manifest.json references ---\n");

for (const mcu of manifest.mcus) {
  console.log(`MCU: ${mcu.id} (${mcu.name})`);

  if (!mcu.packages || mcu.packages.length === 0) {
    error(`MCU ${mcu.id} has no packages listed in manifest`);
    continue;
  }

  for (const pkg of mcu.packages) {
    const packageFilePath = resolve(MCUS_DIR, mcu.id, `${pkg.file}.json`);
    if (!existsSync(packageFilePath)) {
      error(
        `Package file missing: ${mcu.id}/${pkg.file}.json (listed in manifest)`,
      );
    } else {
      info(`OK: ${mcu.id}/${pkg.file}.json exists`);
    }
  }
  console.log();
}

// 2. Validate each package JSON file against the schema
console.log("--- Validating package files against mcuSchema.json ---\n");

for (const mcu of manifest.mcus) {
  for (const pkg of mcu.packages) {
    const packageFilePath = resolve(MCUS_DIR, mcu.id, `${pkg.file}.json`);
    if (!existsSync(packageFilePath)) {
      // Already reported above
      continue;
    }

    totalFiles++;
    const label = `${mcu.id}/${pkg.file}.json`;

    let data;
    try {
      data = JSON.parse(readFileSync(packageFilePath, "utf-8"));
    } catch (e) {
      error(`${label}: Failed to parse JSON - ${e.message}`);
      continue;
    }

    const valid = validate(data);
    if (valid) {
      info(`PASS: ${label}`);
      passedFiles++;
    } else {
      error(`FAIL: ${label}`);
      for (const err of validate.errors) {
        const path = err.instancePath || "(root)";
        console.error(`    - ${path}: ${err.message}`);
        if (err.params) {
          console.error(`      params: ${JSON.stringify(err.params)}`);
        }
      }
    }
  }
}

// 3. Additional structural checks
console.log("\n--- Additional structural checks ---\n");

for (const mcu of manifest.mcus) {
  for (const pkg of mcu.packages) {
    const packageFilePath = resolve(MCUS_DIR, mcu.id, `${pkg.file}.json`);
    if (!existsSync(packageFilePath)) continue;

    let data;
    try {
      data = JSON.parse(readFileSync(packageFilePath, "utf-8"));
    } catch {
      continue;
    }

    const label = `${mcu.id}/${pkg.file}.json`;

    // Check that pins array is non-empty
    if (!data.pins || data.pins.length === 0) {
      error(`${label}: pins array is empty`);
    }

    // Check that each pin has a unique packagePinId
    if (data.pins) {
      const pinIds = new Set();
      for (const pin of data.pins) {
        if (pinIds.has(pin.packagePinId)) {
          error(
            `${label}: Duplicate packagePinId "${pin.packagePinId}" in pins array`,
          );
        }
        pinIds.add(pin.packagePinId);
      }
    }

    // Check socPeripherals signal allowedGpio references valid port patterns
    if (data.socPeripherals) {
      for (const periph of data.socPeripherals) {
        if (!periph.signals) continue;
        for (const signal of periph.signals) {
          if (!signal.allowedGpio) continue;
          for (const gpio of signal.allowedGpio) {
            // Must match P<port>.<pin> or P<port>*
            if (!/^P\d+(\.\d{1,2}|\*)$/.test(gpio)) {
              error(
                `${label}: ${periph.id}.${signal.name} has invalid allowedGpio pattern "${gpio}"`,
              );
            }
          }
        }
      }
    }
  }
}

// Summary
console.log("\n=== Summary ===");
console.log(`Total package files checked: ${totalFiles}`);
console.log(`Passed schema validation:    ${passedFiles}`);
console.log(`Failed:                      ${totalFiles - passedFiles}`);

if (exitCode !== 0) {
  console.log("\nValidation FAILED - see errors above.");
} else {
  console.log("\nAll validations PASSED.");
}

process.exit(exitCode);
