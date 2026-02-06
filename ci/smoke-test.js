#!/usr/bin/env node

/**
 * CI Script: Smoke Test
 *
 * Loads manifest, verifies each MCU has devicetree templates, verifies
 * each package JSON parses and has required fields (pins, socPeripherals,
 * renderConfig).
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const MCUS_DIR = resolve(ROOT, "mcus");

let exitCode = 0;
let checks = 0;
let passed = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    exitCode = 1;
    console.error(`  FAIL: ${label}${detail ? " - " + detail : ""}`);
  }
}

// -----------------------------------------------------------------------
// 1. Load and validate manifest.json
// -----------------------------------------------------------------------
console.log("=== Smoke Test ===\n");
console.log("--- Loading manifest.json ---\n");

const manifestPath = resolve(MCUS_DIR, "manifest.json");
check("manifest.json exists", existsSync(manifestPath));

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  check("manifest.json is valid JSON", true);
} catch (e) {
  check("manifest.json is valid JSON", false, e.message);
  console.error("\nCannot continue without a valid manifest. Aborting.");
  process.exit(1);
}

check("manifest has mcus array", Array.isArray(manifest.mcus));
check(
  "manifest has at least one MCU",
  manifest.mcus && manifest.mcus.length > 0,
);

// -----------------------------------------------------------------------
// 2. For each MCU, verify devicetree-templates.json exists and parses
// -----------------------------------------------------------------------
console.log("\n--- Checking devicetree templates ---\n");

for (const mcu of manifest.mcus) {
  const dtPath = resolve(MCUS_DIR, mcu.id, "devicetree-templates.json");

  check(
    `${mcu.id}: devicetree-templates.json exists`,
    existsSync(dtPath),
    `Missing at ${dtPath}`,
  );

  if (!existsSync(dtPath)) continue;

  let dtData;
  try {
    dtData = JSON.parse(readFileSync(dtPath, "utf-8"));
    check(`${mcu.id}: devicetree-templates.json is valid JSON`, true);
  } catch (e) {
    check(
      `${mcu.id}: devicetree-templates.json is valid JSON`,
      false,
      e.message,
    );
    continue;
  }

  check(
    `${mcu.id}: devicetree-templates has "templates" object`,
    dtData.templates && typeof dtData.templates === "object",
    'Missing or invalid "templates" key',
  );

  if (dtData.templates) {
    const templateCount = Object.keys(dtData.templates).length;
    check(
      `${mcu.id}: devicetree-templates has at least one template (found ${templateCount})`,
      templateCount > 0,
    );

    // Verify each template has required fields
    for (const [id, tmpl] of Object.entries(dtData.templates)) {
      check(
        `${mcu.id}: template "${id}" has dtNodeName`,
        typeof tmpl.dtNodeName === "string" || tmpl.dtNodeName === null,
        `dtNodeName is ${typeof tmpl.dtNodeName}`,
      );
      check(
        `${mcu.id}: template "${id}" has type`,
        typeof tmpl.type === "string",
        `type is ${typeof tmpl.type}`,
      );
      check(
        `${mcu.id}: template "${id}" has signalMappings`,
        tmpl.signalMappings && typeof tmpl.signalMappings === "object",
        `signalMappings is ${typeof tmpl.signalMappings}`,
      );
    }
  }
}

// -----------------------------------------------------------------------
// 3. For each MCU/package, verify the package JSON has required fields
// -----------------------------------------------------------------------
console.log("\n--- Checking package files ---\n");

for (const mcu of manifest.mcus) {
  for (const pkg of mcu.packages) {
    const pkgPath = resolve(MCUS_DIR, mcu.id, `${pkg.file}.json`);
    const label = `${mcu.id}/${pkg.file}`;

    if (!existsSync(pkgPath)) {
      check(`${label}: file exists`, false, `Missing at ${pkgPath}`);
      continue;
    }

    let data;
    try {
      data = JSON.parse(readFileSync(pkgPath, "utf-8"));
      check(`${label}: valid JSON`, true);
    } catch (e) {
      check(`${label}: valid JSON`, false, e.message);
      continue;
    }

    // Required top-level fields
    check(
      `${label}: has "pins" array`,
      Array.isArray(data.pins),
      `pins is ${typeof data.pins}`,
    );

    check(
      `${label}: has "socPeripherals" array`,
      Array.isArray(data.socPeripherals),
      `socPeripherals is ${typeof data.socPeripherals}`,
    );

    check(
      `${label}: has "renderConfig" object`,
      data.renderConfig && typeof data.renderConfig === "object",
      `renderConfig is ${typeof data.renderConfig}`,
    );

    // Verify pins array is non-empty and has structure
    if (Array.isArray(data.pins) && data.pins.length > 0) {
      check(
        `${label}: pins array is non-empty (${data.pins.length} pins)`,
        true,
      );

      const firstPin = data.pins[0];
      check(
        `${label}: first pin has packagePinId`,
        typeof firstPin.packagePinId === "string",
      );
      check(`${label}: first pin has name`, typeof firstPin.name === "string");
      check(
        `${label}: first pin has defaultType`,
        typeof firstPin.defaultType === "string",
      );
    } else {
      check(`${label}: pins array is non-empty`, false, "Empty pins array");
    }

    // Verify socPeripherals structure
    if (Array.isArray(data.socPeripherals) && data.socPeripherals.length > 0) {
      check(
        `${label}: socPeripherals is non-empty (${data.socPeripherals.length} peripherals)`,
        true,
      );

      for (const periph of data.socPeripherals) {
        check(
          `${label}: peripheral "${periph.id}" has id`,
          typeof periph.id === "string",
        );
        check(
          `${label}: peripheral "${periph.id}" has type`,
          typeof periph.type === "string",
        );
        check(
          `${label}: peripheral "${periph.id}" has signals array`,
          Array.isArray(periph.signals),
        );
      }
    } else {
      check(
        `${label}: socPeripherals is non-empty`,
        false,
        "Empty socPeripherals",
      );
    }

    // Verify renderConfig structure
    if (data.renderConfig) {
      check(
        `${label}: renderConfig has canvasDefaults`,
        data.renderConfig.canvasDefaults &&
          typeof data.renderConfig.canvasDefaults === "object",
      );
      check(
        `${label}: renderConfig has chipBody`,
        data.renderConfig.chipBody &&
          typeof data.renderConfig.chipBody === "object",
      );
      check(
        `${label}: renderConfig has pinDefaults`,
        data.renderConfig.pinDefaults &&
          typeof data.renderConfig.pinDefaults === "object",
      );
      check(
        `${label}: renderConfig has layoutStrategy`,
        data.renderConfig.layoutStrategy &&
          typeof data.renderConfig.layoutStrategy === "object",
      );
    }

    // Verify socPeripherals signals reference GPIO pins that exist in the
    // package's pin list (for specific pin references, not port wildcards)
    if (Array.isArray(data.socPeripherals) && Array.isArray(data.pins)) {
      const pinNames = new Set(data.pins.map((p) => p.name));

      for (const periph of data.socPeripherals) {
        if (!periph.signals) continue;
        for (const signal of periph.signals) {
          if (!signal.allowedGpio) continue;
          for (const gpio of signal.allowedGpio) {
            // Only check specific pin references (P0.01), skip wildcards (P0*)
            if (gpio.includes("*")) continue;
            if (!pinNames.has(gpio)) {
              check(
                `${label}: ${periph.id}.${signal.name} allowedGpio "${gpio}" exists in pins`,
                false,
                `Pin "${gpio}" not found in package pin list`,
              );
            }
          }
        }
      }
    }
  }
}

// -----------------------------------------------------------------------
// 4. Cross-check: peripherals in package have matching devicetree templates
// -----------------------------------------------------------------------
console.log("\n--- Cross-checking peripherals vs devicetree templates ---\n");

for (const mcu of manifest.mcus) {
  const dtPath = resolve(MCUS_DIR, mcu.id, "devicetree-templates.json");
  if (!existsSync(dtPath)) continue;

  let dtData;
  try {
    dtData = JSON.parse(readFileSync(dtPath, "utf-8"));
  } catch {
    continue;
  }

  if (!dtData.templates) continue;

  // Check the first package for this MCU as a representative
  const firstPkg = mcu.packages[0];
  if (!firstPkg) continue;

  const pkgPath = resolve(MCUS_DIR, mcu.id, `${firstPkg.file}.json`);
  if (!existsSync(pkgPath)) continue;

  let pkgData;
  try {
    pkgData = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    continue;
  }

  if (!Array.isArray(pkgData.socPeripherals)) continue;

  const templateIds = new Set(Object.keys(dtData.templates));
  const peripheralIds = pkgData.socPeripherals.map((p) => p.id);

  for (const pId of peripheralIds) {
    // Not every peripheral needs a template (some may be checkbox-only),
    // but log it as info rather than a failure
    if (!templateIds.has(pId)) {
      console.log(
        `  INFO: ${mcu.id}: peripheral "${pId}" has no devicetree template (may be intentional)`,
      );
    }
  }
}

// -----------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------
console.log("\n=== Summary ===");
console.log(`Total checks: ${checks}`);
console.log(`Passed:       ${passed}`);
console.log(`Failed:       ${checks - passed}`);

if (exitCode !== 0) {
  console.log("\nSmoke test FAILED - see errors above.");
} else {
  console.log("\nAll smoke tests PASSED.");
}

process.exit(exitCode);
