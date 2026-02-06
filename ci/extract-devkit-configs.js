#!/usr/bin/env node

/**
 * CI Script: Extract DevKit Configurations
 *
 * Parses Zephyr board DTS/DTSI files and extracts pin assignments into JSON.
 *
 * Usage:
 *   npm run extract-devkits -- --zephyr-path=/path/to/zephyr
 *
 * Parsing strategy (regex-based):
 *   1. Parse pinctrl DTSI for NRF_PSEL macros
 *   2. Parse common DTSI for gpios assignments
 *   3. Parse cpuapp common for chosen section
 *
 * Output: JSON files written to ci/output/devkit-configs/
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from "fs";
import { resolve, dirname, basename, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_DIR = resolve(__dirname, "output", "devkit-configs");

// -----------------------------------------------------------------------
// Argument parsing
// -----------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};

  for (const arg of args) {
    if (arg.startsWith("--zephyr-path=")) {
      opts.zephyrPath = arg.split("=").slice(1).join("=");
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node extract-devkit-configs.js --zephyr-path=/path/to/zephyr

Options:
  --zephyr-path=<path>  Path to the Zephyr RTOS source tree (required)
  --help, -h            Show this help message

This script scans Zephyr board directories for nRF54L-series devkit
board definitions and extracts pin configurations into JSON files.

Output is written to ci/output/devkit-configs/
`);
      process.exit(0);
    }
  }

  if (!opts.zephyrPath) {
    console.error(
      "ERROR: --zephyr-path is required.\n" +
        "Usage: node extract-devkit-configs.js --zephyr-path=/path/to/zephyr",
    );
    process.exit(1);
  }

  return opts;
}

// -----------------------------------------------------------------------
// File discovery
// -----------------------------------------------------------------------

/**
 * Find nRF54L-related board directories in the Zephyr tree.
 * Looks in boards/nordic/ and boards/arm/ for directories containing
 * nrf54l in their name or board.yml referencing nrf54l.
 */
function findNrf54lBoards(zephyrPath) {
  const boards = [];
  const searchDirs = [
    resolve(zephyrPath, "boards", "nordic"),
    resolve(zephyrPath, "boards", "arm"),
  ];

  for (const searchDir of searchDirs) {
    if (!existsSync(searchDir)) continue;

    const entries = readdirSync(searchDir);
    for (const entry of entries) {
      const boardDir = join(searchDir, entry);
      if (!statSync(boardDir).isDirectory()) continue;

      // Check if this board is nRF54L-related
      const boardYml = join(boardDir, "board.yml");
      if (existsSync(boardYml)) {
        const content = readFileSync(boardYml, "utf-8");
        if (content.includes("nrf54l")) {
          boards.push({
            name: entry,
            path: boardDir,
          });
          continue;
        }
      }

      // Also check by directory name
      if (entry.includes("nrf54l")) {
        boards.push({
          name: entry,
          path: boardDir,
        });
      }
    }
  }

  return boards;
}

/**
 * Find all DTSI/DTS files in a board directory.
 */
function findDtsFiles(boardDir) {
  const files = {
    pinctrl: [],
    commonDtsi: [],
    cpuappCommon: [],
    dts: [],
    all: [],
  };

  if (!existsSync(boardDir)) return files;

  const entries = readdirSync(boardDir);
  for (const entry of entries) {
    const fullPath = join(boardDir, entry);
    if (!statSync(fullPath).isFile()) continue;

    if (entry.endsWith("-pinctrl.dtsi")) {
      files.pinctrl.push(fullPath);
    } else if (entry.includes("cpuapp_common") && entry.endsWith(".dtsi")) {
      files.cpuappCommon.push(fullPath);
    } else if (entry.endsWith("_common.dtsi")) {
      files.commonDtsi.push(fullPath);
    } else if (entry.endsWith(".dts")) {
      files.dts.push(fullPath);
    }

    if (entry.endsWith(".dts") || entry.endsWith(".dtsi")) {
      files.all.push(fullPath);
    }
  }

  return files;
}

// -----------------------------------------------------------------------
// Parsing functions
// -----------------------------------------------------------------------

/**
 * Parse NRF_PSEL macros from pinctrl DTSI files.
 *
 * Matches patterns like:
 *   <NRF_PSEL(UART_TX, 1, 4)>
 *   <NRF_PSEL(SPIM_SCK, 2, 1)>
 *
 * Returns an array of { signal, port, pin, pinctrlNode, state }
 */
function parsePinctrlFile(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const results = [];

  // Match pinctrl node blocks like:
  //   uart20_default: uart20_default { ... };
  //   /omit-if-no-ref/ uart20_default: uart20_default { ... };
  const nodeRegex =
    /(?:\/omit-if-no-ref\/\s+)?(\w+):\s+\w+\s*\{([\s\S]*?)\n\t\};/g;
  let nodeMatch;

  while ((nodeMatch = nodeRegex.exec(content)) !== null) {
    const nodeName = nodeMatch[1];
    const nodeBody = nodeMatch[2];

    // Determine state (default or sleep) from the node name
    let state = "unknown";
    if (nodeName.includes("_default")) {
      state = "default";
    } else if (nodeName.includes("_sleep")) {
      state = "sleep";
    }

    // Extract the peripheral/pinctrl base name
    const pinctrlBase = nodeName.replace("_default", "").replace("_sleep", "");

    // Match NRF_PSEL macros within this node
    const pselRegex = /NRF_PSEL\(\s*(\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/g;
    let pselMatch;

    while ((pselMatch = pselRegex.exec(nodeBody)) !== null) {
      results.push({
        signal: pselMatch[1],
        port: parseInt(pselMatch[2]),
        pin: parseInt(pselMatch[3]),
        pinctrlNode: nodeName,
        pinctrlBase,
        state,
        gpio: `P${pselMatch[2]}.${pselMatch[3].padStart(2, "0")}`,
      });
    }
  }

  return results;
}

/**
 * Parse GPIO assignments from common DTSI files.
 *
 * Matches patterns like:
 *   gpios = <&gpio1 4 GPIO_ACTIVE_HIGH>;
 *   gpios = <&gpio0 11 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;
 *
 * Returns an array of { label, port, pin, flags }
 */
function parseGpioAssignments(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const results = [];

  // Match blocks like: led0: led_0 { gpios = <&gpio1 4 ...>; };
  // or more complex multi-line forms
  const blockRegex =
    /(\w+)\s*(?::\s*\w[\w-]*)?\s*\{[^}]*gpios\s*=\s*<&gpio(\d+)\s+(\d+)\s+([^>]+)>/g;
  let match;

  while ((match = blockRegex.exec(content)) !== null) {
    results.push({
      label: match[1],
      port: parseInt(match[2]),
      pin: parseInt(match[3]),
      flags: match[4].trim(),
      gpio: `P${match[2]}.${match[3].padStart(2, "0")}`,
    });
  }

  return results;
}

/**
 * Parse the chosen section from cpuapp common DTSI.
 *
 * Matches patterns like:
 *   zephyr,console = &uart20;
 *   zephyr,flash = &cpuapp_rram;
 *
 * Returns an object mapping chosen names to node references.
 */
function parseChosenSection(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const chosen = {};

  // Find the chosen block
  const chosenRegex = /chosen\s*\{([\s\S]*?)\};/g;
  let chosenMatch;

  while ((chosenMatch = chosenRegex.exec(content)) !== null) {
    const body = chosenMatch[1];
    const propRegex = /([\w,-]+)\s*=\s*&(\w+)/g;
    let propMatch;

    while ((propMatch = propRegex.exec(body)) !== null) {
      chosen[propMatch[1]] = propMatch[2];
    }
  }

  return chosen;
}

/**
 * Parse peripheral node status and pinctrl references from DTSI files.
 *
 * Matches patterns like:
 *   &uart20 {
 *     status = "okay";
 *     pinctrl-0 = <&uart20_default>;
 *     current-speed = <115200>;
 *   };
 *
 * Returns an array of { node, status, pinctrl, properties }
 */
function parsePeripheralNodes(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const results = [];

  // Match peripheral reference blocks like &uart20 { ... };
  const refNodeRegex = /&(\w+)\s*\{([\s\S]*?)\n\};/g;
  let match;

  while ((match = refNodeRegex.exec(content)) !== null) {
    const nodeName = match[1];
    const body = match[2];
    const node = { node: nodeName, properties: {} };

    // Extract status
    const statusMatch = body.match(/status\s*=\s*"(\w+)"/);
    if (statusMatch) {
      node.status = statusMatch[1];
    }

    // Extract pinctrl references
    const pinctrlRefs = [];
    const pinctrlRegex = /pinctrl-\d+\s*=\s*<&(\w+)>/g;
    let pcMatch;
    while ((pcMatch = pinctrlRegex.exec(body)) !== null) {
      pinctrlRefs.push(pcMatch[1]);
    }
    if (pinctrlRefs.length > 0) {
      node.pinctrl = pinctrlRefs;
    }

    // Extract current-speed
    const speedMatch = body.match(/current-speed\s*=\s*<(\d+)>/);
    if (speedMatch) {
      node.properties["current-speed"] = parseInt(speedMatch[1]);
    }

    // Extract load-capacitors
    const capMatch = body.match(/load-capacitors\s*=\s*"(\w+)"/);
    if (capMatch) {
      node.properties["load-capacitors"] = capMatch[1];
    }

    // Extract load-capacitance-femtofarad
    const capFfMatch = body.match(/load-capacitance-femtofarad\s*=\s*<(\d+)>/);
    if (capFfMatch) {
      node.properties["load-capacitance-femtofarad"] = parseInt(capFfMatch[1]);
    }

    results.push(node);
  }

  return results;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

const opts = parseArgs();
const zephyrPath = resolve(opts.zephyrPath);

if (!existsSync(zephyrPath)) {
  console.error(`ERROR: Zephyr path does not exist: ${zephyrPath}`);
  process.exit(1);
}

console.log("=== Extract DevKit Configurations ===\n");
console.log(`Zephyr path: ${zephyrPath}\n`);

// Find nRF54L boards
const boards = findNrf54lBoards(zephyrPath);

if (boards.length === 0) {
  console.log("No nRF54L-series boards found in the Zephyr tree.");
  console.log("Checked directories:");
  console.log(`  - ${resolve(zephyrPath, "boards", "nordic")}`);
  console.log(`  - ${resolve(zephyrPath, "boards", "arm")}`);
  process.exit(0);
}

console.log(`Found ${boards.length} nRF54L-related board(s):\n`);

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const board of boards) {
  console.log(`--- Board: ${board.name} ---`);
  console.log(`  Path: ${board.path}`);

  const dtsFiles = findDtsFiles(board.path);
  const extraction = {
    board: board.name,
    path: board.path,
    pinAssignments: [],
    gpioAssignments: [],
    chosen: {},
    peripherals: [],
  };

  // 1. Parse pinctrl files for NRF_PSEL macros
  for (const pinctrlFile of dtsFiles.pinctrl) {
    console.log(`  Parsing pinctrl: ${basename(pinctrlFile)}`);
    const pins = parsePinctrlFile(pinctrlFile);
    extraction.pinAssignments.push(
      ...pins.map((p) => ({ ...p, source: basename(pinctrlFile) })),
    );
  }

  // 2. Parse common DTSI files for GPIO assignments
  for (const commonFile of [...dtsFiles.commonDtsi, ...dtsFiles.cpuappCommon]) {
    console.log(`  Parsing common DTSI: ${basename(commonFile)}`);
    const gpios = parseGpioAssignments(commonFile);
    extraction.gpioAssignments.push(
      ...gpios.map((g) => ({ ...g, source: basename(commonFile) })),
    );

    // Also extract peripheral nodes
    const peripherals = parsePeripheralNodes(commonFile);
    extraction.peripherals.push(
      ...peripherals.map((p) => ({ ...p, source: basename(commonFile) })),
    );
  }

  // 3. Parse cpuapp common for chosen section
  for (const cpuappFile of dtsFiles.cpuappCommon) {
    console.log(`  Parsing chosen: ${basename(cpuappFile)}`);
    const chosen = parseChosenSection(cpuappFile);
    Object.assign(extraction.chosen, chosen);
  }

  // Also check DTS files for chosen sections
  for (const dtsFile of dtsFiles.dts) {
    const chosen = parseChosenSection(dtsFile);
    if (Object.keys(chosen).length > 0) {
      console.log(`  Parsing chosen from DTS: ${basename(dtsFile)}`);
      // Merge, but don't overwrite existing (cpuapp common takes precedence)
      for (const [k, v] of Object.entries(chosen)) {
        if (!extraction.chosen[k]) {
          extraction.chosen[k] = v;
        }
      }
    }
  }

  // Summary for this board
  console.log(`  Pin assignments found: ${extraction.pinAssignments.length}`);
  console.log(`  GPIO assignments found: ${extraction.gpioAssignments.length}`);
  console.log(`  Chosen entries: ${Object.keys(extraction.chosen).length}`);
  console.log(`  Peripheral nodes: ${extraction.peripherals.length}`);

  // Write output JSON
  const outputPath = resolve(OUTPUT_DIR, `${board.name}.json`);
  writeFileSync(outputPath, JSON.stringify(extraction, null, 2), "utf-8");
  console.log(`  Output written to: ${outputPath}\n`);
}

// Summary
console.log("=== Summary ===");
console.log(`Boards processed: ${boards.length}`);
console.log(`Output directory: ${OUTPUT_DIR}`);
console.log("\nExtraction complete.");
