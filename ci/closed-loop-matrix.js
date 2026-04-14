#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
  getDevicetreeExportUnsupportedReason,
  getMcuSupportsFLPR,
  getMcuSupportsFLPRXIP,
  getMcuSupportsNonSecure,
} from "../js/mcu-manifest.js";
import { loadResolvedPackageData } from "./package-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(__dirname, "output", "closed-loop");
const MANIFEST_PATH = resolve(ROOT, "mcus", "manifest.json");

const TEMPLATE_KEY_MAP = {
  SAADC: "ADC",
};

const OSCILLATOR_DEFAULTS = {
  HFXO: {
    loadCapacitors: "internal",
    loadCapacitanceFemtofarad: 15000,
  },
  LFXO: {
    loadCapacitors: "internal",
    loadCapacitanceFemtofarad: 15000,
  },
};

function getTemplateKey(peripheralId) {
  return TEMPLATE_KEY_MAP[peripheralId] || peripheralId;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function sanitizeIdentifier(value) {
  return value.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function getPackageShortName(pkgFile) {
  return sanitizeIdentifier(pkgFile.split("-")[0]);
}

function parsePinName(pinName) {
  const match = /^P(\d+)\.(\d+)$/.exec(pinName);
  if (!match) {
    return null;
  }

  return {
    port: Number.parseInt(match[1], 10),
    pin: Number.parseInt(match[2], 10),
  };
}

function sortPinsByName(a, b) {
  const aParsed = parsePinName(a.name);
  const bParsed = parsePinName(b.name);

  if (!aParsed || !bParsed) {
    return a.name.localeCompare(b.name);
  }

  if (aParsed.port !== bParsed.port) {
    return aParsed.port - bParsed.port;
  }

  return aParsed.pin - bParsed.pin;
}

function getCandidatePins(signal, packageData) {
  const gpioPins = (packageData.pins || [])
    .filter((pin) => Array.isArray(pin.functions))
    .sort(sortPinsByName);

  const candidates = [];
  const seen = new Set();

  for (const allowed of signal.allowedGpio || []) {
    const matches = gpioPins.filter((pin) => {
      if (signal.requiresClockCapablePin && !pin.isClockCapable) {
        return false;
      }

      if (allowed.endsWith("*")) {
        if (!pin.functions.includes("Digital I/O")) {
          return false;
        }
        return pin.name.startsWith(`${allowed.slice(0, -1)}.`);
      }

      return pin.name === allowed;
    });

    for (const pin of matches) {
      if (!seen.has(pin.name)) {
        seen.add(pin.name);
        candidates.push(pin);
      }
    }
  }

  return candidates;
}

function findAvailablePin(signal, packageData, usedPins) {
  const candidates = getCandidatePins(signal, packageData);
  return candidates.find((pin) => !usedPins.has(pin.name)) || null;
}

function reserveAddress(peripheral, usedAddresses) {
  if (!peripheral.baseAddress) {
    return true;
  }

  if (usedAddresses.has(peripheral.baseAddress)) {
    return false;
  }

  usedAddresses.add(peripheral.baseAddress);
  return true;
}

function buildOscillatorState(id, configOverride = {}) {
  return {
    id,
    type: "OSCILLATOR",
    description:
      id === "HFXO"
        ? "High Frequency Crystal Oscillator"
        : "Low Frequency Crystal Oscillator",
    config: {
      ...OSCILLATOR_DEFAULTS[id],
      ...configOverride,
    },
    pinFunctions: {},
  };
}

function buildGpioEntries(packageData, usedPins, count, prefix) {
  const gpioPins = (packageData.pins || [])
    .filter(
      (pin) =>
        Array.isArray(pin.functions) && pin.functions.includes("Digital I/O"),
    )
    .sort(sortPinsByName);

  const entries = [];

  for (const pin of gpioPins) {
    if (usedPins.has(pin.name)) {
      continue;
    }

    const index = entries.length;
    const label = `${prefix}${index}`;
    entries.push({
      id: `GPIO_${label.toUpperCase()}`,
      type: "GPIO",
      label,
      pin: pin.name,
      activeState: index % 2 === 0 ? "active-high" : "active-low",
    });
    usedPins.add(pin.name);

    if (entries.length >= count) {
      break;
    }
  }

  return entries;
}

function allocatePeripheralState(
  peripheral,
  packageData,
  usedPins,
  usedAddresses,
  options = {},
) {
  if (!reserveAddress(peripheral, usedAddresses)) {
    return null;
  }

  const pinFunctions = {};
  const pendingPins = [];

  for (const signal of peripheral.signals || []) {
    if (!signal.allowedGpio || signal.allowedGpio.length === 0) {
      continue;
    }

    if (options.disableRx === true && signal.name === "RXD") {
      continue;
    }

    if (!signal.isMandatory && options.includeOptionalSignals !== true) {
      continue;
    }

    const candidate = findAvailablePin(
      signal,
      packageData,
      new Set([...usedPins, ...pendingPins]),
    );

    if (!candidate) {
      if (signal.isMandatory) {
        if (peripheral.baseAddress) {
          usedAddresses.delete(peripheral.baseAddress);
        }
        return null;
      }
      continue;
    }

    pinFunctions[candidate.name] = signal.name;
    pendingPins.push(candidate.name);
  }

  for (const pin of pendingPins) {
    usedPins.add(pin);
  }

  if (options.requireAssignedPins === true && pendingPins.length === 0) {
    if (peripheral.baseAddress) {
      usedAddresses.delete(peripheral.baseAddress);
    }
    return null;
  }

  const entry = {
    id: peripheral.id,
    type: peripheral.type,
    peripheral,
    pinFunctions,
  };

  if (options.disableRx === true) {
    entry.config = {
      ...(entry.config || {}),
      disableRx: true,
    };
  }

  if (Array.isArray(options.extraCsGpios) && options.extraCsGpios.length > 0) {
    entry.config = {
      ...(entry.config || {}),
      extraCsGpios: options.extraCsGpios,
    };
  }

  if (typeof options.note === "string" && options.note.trim()) {
    entry.config = {
      ...(entry.config || {}),
      note: options.note.trim(),
    };
  }

  return entry;
}

function allocateExtraGpios(packageData, usedPins, count) {
  return buildGpioEntries(packageData, usedPins, count, "cs")
    .map((entry) => entry.pin)
    .slice(0, count);
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBoardInfo(mcuId, pkgFile, scenarioName) {
  const pkgShort = getPackageShortName(pkgFile);
  const boardName = sanitizeIdentifier(
    `site_${mcuId}_${pkgShort}_${scenarioName}`,
  );

  return {
    name: boardName,
    fullName: `Site Export ${mcuId.toUpperCase()} ${pkgShort.toUpperCase()} ${scenarioName.replace(/_/g, " ")}`,
    vendor: "test",
    revision: "1.0.0",
    description: `Closed-loop exported board for ${mcuId}/${pkgFile} (${scenarioName})`,
  };
}

function getPeripheralTemplate(templates, peripheralId) {
  return templates[getTemplateKey(peripheralId)] || null;
}

function affectsBoardDefinition(peripheral, templates) {
  if (
    peripheral.type === "GPIO" ||
    peripheral.id === "HFXO" ||
    peripheral.id === "LFXO"
  ) {
    return true;
  }

  return Boolean(getPeripheralTemplate(templates, peripheral.id));
}

function buildBoardSignature(scenario, templates) {
  const payload = {
    mcu: scenario.mcuId,
    package: scenario.packageFile,
    consoleUart: scenario.consoleUart,
    selectedPeripherals: scenario.selectedPeripherals
      .filter((peripheral) => affectsBoardDefinition(peripheral, templates))
      .map((peripheral) => {
        if (peripheral.type === "GPIO") {
          return {
            id: peripheral.id,
            type: peripheral.type,
            label: peripheral.label,
            pin: peripheral.pin,
            activeState: peripheral.activeState,
          };
        }

        return {
          id: peripheral.id,
          type: peripheral.type,
          pinFunctions: peripheral.pinFunctions || {},
          config: peripheral.config || {},
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  return JSON.stringify(payload);
}

function getSupportedTargets(manifest, mcuId) {
  const targets = [`${mcuId}/cpuapp`];

  if (getMcuSupportsNonSecure(manifest, mcuId)) {
    targets.push(`${mcuId}/cpuapp/ns`);
  }

  if (getMcuSupportsFLPR(manifest, mcuId)) {
    targets.push(`${mcuId}/cpuflpr`);
    if (getMcuSupportsFLPRXIP(manifest, mcuId)) {
      targets.push(`${mcuId}/cpuflpr/xip`);
    }
  }

  return targets;
}

function createScenario({
  manifest,
  mcuId,
  pkgFile,
  templates,
  scenarioName,
  selectedPeripherals,
  consoleUart = null,
  coveragePeripherals = [],
  coverageConfigs = [],
  build = true,
  buildReason = null,
}) {
  return {
    scenarioName,
    mcuId,
    packageFile: pkgFile,
    boardInfo: createBoardInfo(mcuId, pkgFile, scenarioName),
    selectedPeripherals: cloneSerializable(selectedPeripherals),
    consoleUart,
    coverage: {
      peripherals: [...new Set(coveragePeripherals)].sort(),
      configs: [...new Set(coverageConfigs)].sort(),
    },
    build,
    buildReason,
    targets: getSupportedTargets(manifest, mcuId),
  };
}

function buildScenarioSet({
  manifest,
  mcuId,
  pkgFile,
  packageData,
  templates,
  scenarioName,
  peripheralSpecs,
  hfxoConfig,
  lfxoConfig = null,
  gpioCount = 0,
  gpioPrefix = "gpio",
  consoleStrategy = "none",
}) {
  const usedPins = new Set();
  const usedAddresses = new Set();
  const selectedPeripherals = [];
  const coveredPeripherals = [];
  const coverageConfigs = [];
  const missedPeripherals = [];

  selectedPeripherals.push(buildOscillatorState("HFXO", hfxoConfig));
  coveredPeripherals.push("HFXO");

  if (hfxoConfig && hfxoConfig.loadCapacitors === "external") {
    coverageConfigs.push("HFXO:external_caps");
  } else {
    coverageConfigs.push("HFXO:internal_caps");
  }

  if (lfxoConfig) {
    selectedPeripherals.push(buildOscillatorState("LFXO", lfxoConfig));
    coveredPeripherals.push("LFXO");
    if (lfxoConfig.loadCapacitors === "external") {
      coverageConfigs.push("LFXO:external_caps");
    } else {
      coverageConfigs.push("LFXO:internal_caps");
    }
  }

  for (const spec of peripheralSpecs) {
    const template = getPeripheralTemplate(templates, spec.peripheral.id);
    const extraCsGpios =
      spec.extraCsCount && spec.extraCsCount > 0
        ? allocateExtraGpios(packageData, usedPins, spec.extraCsCount)
        : [];

    const entry = allocatePeripheralState(
      spec.peripheral,
      packageData,
      usedPins,
      usedAddresses,
      {
        includeOptionalSignals: spec.includeOptionalSignals === true,
        disableRx: spec.disableRx === true,
        requireAssignedPins: Boolean(template && !template.noPinctrl),
        extraCsGpios,
        note: spec.note,
      },
    );

    if (!entry) {
      missedPeripherals.push(spec.peripheral.id);
      continue;
    }

    if (spec.disableRx === true) {
      coverageConfigs.push(`${spec.peripheral.id}:disable_rx`);
    }

    if (extraCsGpios.length > 0) {
      coverageConfigs.push(`${spec.peripheral.id}:extra_cs`);
    }

    selectedPeripherals.push(entry);
    coveredPeripherals.push(spec.peripheral.id);
  }

  if (gpioCount > 0) {
    const gpios = buildGpioEntries(
      packageData,
      usedPins,
      gpioCount,
      gpioPrefix,
    );
    selectedPeripherals.push(...gpios);
    if (gpios.length > 0) {
      coverageConfigs.push("GPIO:active_high");
    }
    if (gpios.length > 1) {
      coverageConfigs.push("GPIO:active_low");
    }
  }

  let consoleUart = null;
  const selectedUarts = selectedPeripherals.filter(
    (peripheral) =>
      getPeripheralTemplate(templates, peripheral.id)?.type === "UART",
  );

  if (consoleStrategy === "last-uart" && selectedUarts.length > 0) {
    consoleUart = selectedUarts[selectedUarts.length - 1].id;
    coverageConfigs.push("console:selected_uart");
  } else if (consoleStrategy === "none") {
    coverageConfigs.push("console:rtt");
  }

  return {
    scenario: createScenario({
      manifest,
      mcuId,
      pkgFile,
      templates,
      scenarioName,
      selectedPeripherals,
      consoleUart,
      coveragePeripherals: coveredPeripherals,
      coverageConfigs,
    }),
    missedPeripherals,
  };
}

function buildSinglePeripheralScenario({
  manifest,
  mcuId,
  pkgFile,
  packageData,
  templates,
  peripheral,
  build,
  disableRx = false,
  extraCsCount = 0,
}) {
  const { scenario, missedPeripherals } = buildScenarioSet({
    manifest,
    mcuId,
    pkgFile,
    packageData,
    templates,
    scenarioName: `single_${sanitizeIdentifier(peripheral.id.toLowerCase())}`,
    peripheralSpecs: [
      {
        peripheral,
        includeOptionalSignals: true,
        disableRx,
        extraCsCount,
      },
    ],
    hfxoConfig: {},
    consoleStrategy: peripheral.type === "UART" ? "last-uart" : "none",
  });

  if (missedPeripherals.length > 0) {
    throw new Error(
      `Unable to allocate standalone scenario for ${mcuId}/${pkgFile} ${peripheral.id}`,
    );
  }

  scenario.build = build;
  scenario.buildReason = build
    ? null
    : "Selection does not change generated board files";
  return scenario;
}

function collectPeripheralsByFilter(packageData, filter) {
  return (packageData.socPeripherals || []).filter(filter);
}

function finalizeScenarioBuildFlags(scenarios, templates) {
  const seenSignatures = new Set();

  for (const scenario of scenarios) {
    if (!scenario.build) {
      continue;
    }

    const signature = buildBoardSignature(scenario, templates);
    if (seenSignatures.has(signature)) {
      scenario.build = false;
      scenario.buildReason = "Duplicate board definition output";
      continue;
    }

    seenSignatures.add(signature);
  }
}

function assertPackageCoverage(
  mcuId,
  pkgFile,
  packageData,
  templates,
  scenarios,
) {
  const coveredPeripherals = new Set();
  const coveredConfigs = new Set();

  for (const scenario of scenarios) {
    for (const peripheralId of scenario.coverage.peripherals) {
      coveredPeripherals.add(peripheralId);
    }
    for (const configId of scenario.coverage.configs) {
      coveredConfigs.add(configId);
    }
  }

  const expectedTemplatedPeripherals = new Set(["HFXO"]);

  for (const peripheral of packageData.socPeripherals || []) {
    if (getPeripheralTemplate(templates, peripheral.id)) {
      expectedTemplatedPeripherals.add(peripheral.id);
    }
  }

  if (
    collectPeripheralsByFilter(
      packageData,
      (peripheral) => peripheral.id === "LFXO",
    ).length > 0
  ) {
    expectedTemplatedPeripherals.add("LFXO");
  }

  for (const peripheralId of expectedTemplatedPeripherals) {
    if (!coveredPeripherals.has(peripheralId)) {
      throw new Error(
        `Coverage gap for ${mcuId}/${pkgFile}: ${peripheralId} is never exercised`,
      );
    }
  }

  const hasUart =
    collectPeripheralsByFilter(
      packageData,
      (peripheral) =>
        getPeripheralTemplate(templates, peripheral.id)?.type === "UART",
    ).length > 0;
  const hasSpi =
    collectPeripheralsByFilter(
      packageData,
      (peripheral) =>
        getPeripheralTemplate(templates, peripheral.id)?.type === "SPI",
    ).length > 0;
  const hasLfxo =
    collectPeripheralsByFilter(
      packageData,
      (peripheral) => peripheral.id === "LFXO",
    ).length > 0;

  const requiredConfigs = [
    "console:rtt",
    "HFXO:internal_caps",
    "HFXO:external_caps",
  ];
  if (hasUart) {
    requiredConfigs.push("console:selected_uart");
    requiredConfigs.push(
      `${collectPeripheralsByFilter(packageData, (peripheral) => peripheral.type === "UART")[0].id}:disable_rx`,
    );
  }
  if (hasSpi) {
    requiredConfigs.push(
      `${collectPeripheralsByFilter(packageData, (peripheral) => peripheral.type === "SPI")[0].id}:extra_cs`,
    );
  }
  if (hasLfxo) {
    requiredConfigs.push("LFXO:internal_caps");
    requiredConfigs.push("LFXO:external_caps");
  }

  for (const configId of requiredConfigs) {
    if (!coveredConfigs.has(configId)) {
      throw new Error(
        `Coverage gap for ${mcuId}/${pkgFile}: missing config coverage ${configId}`,
      );
    }
  }
}

function buildPackageScenarioMatrix(manifest, mcu, pkgFile) {
  const packagePath = resolve(ROOT, "mcus", mcu.id, `${pkgFile}.json`);
  const templatesPath = resolve(
    ROOT,
    "mcus",
    mcu.id,
    "devicetree-templates.json",
  );
  const packageData = loadResolvedPackageData(packagePath);
  const templateData = readJson(templatesPath);
  const templates = templateData.templates || {};

  const scenarios = [];
  const templatedPeripherals = collectPeripheralsByFilter(
    packageData,
    (peripheral) => Boolean(getPeripheralTemplate(templates, peripheral.id)),
  );
  const untemplatedPeripherals = collectPeripheralsByFilter(
    packageData,
    (peripheral) => !getPeripheralTemplate(templates, peripheral.id),
  );

  const uartPeripherals = templatedPeripherals.filter(
    (peripheral) =>
      getPeripheralTemplate(templates, peripheral.id)?.type === "UART",
  );
  const spiPeripherals = templatedPeripherals.filter(
    (peripheral) =>
      getPeripheralTemplate(templates, peripheral.id)?.type === "SPI",
  );
  const i2cPeripherals = templatedPeripherals.filter(
    (peripheral) =>
      getPeripheralTemplate(templates, peripheral.id)?.type === "I2C",
  );
  const mixedPeripherals = [
    ...templatedPeripherals.filter(
      (peripheral) =>
        !["UART", "SPI", "I2C"].includes(
          getPeripheralTemplate(templates, peripheral.id)?.type || "",
        ),
    ),
    ...untemplatedPeripherals,
  ];

  const baseline = buildScenarioSet({
    manifest,
    mcuId: mcu.id,
    pkgFile,
    packageData,
    templates,
    scenarioName: "rtt_baseline",
    peripheralSpecs: [],
    hfxoConfig: {},
    consoleStrategy: "none",
  });
  scenarios.push(baseline.scenario);

  if (uartPeripherals.length > 0) {
    const uartScenario = buildScenarioSet({
      manifest,
      mcuId: mcu.id,
      pkgFile,
      packageData,
      templates,
      scenarioName: "uart_console",
      peripheralSpecs: uartPeripherals.map((peripheral, index) => ({
        peripheral,
        includeOptionalSignals: true,
        disableRx: index === 0,
      })),
      hfxoConfig: {},
      gpioCount: 1,
      gpioPrefix: "uart_gpio",
      consoleStrategy: "last-uart",
    });
    scenarios.push(uartScenario.scenario);

    for (const missingPeripheralId of uartScenario.missedPeripherals) {
      const missingPeripheral = uartPeripherals.find(
        (peripheral) => peripheral.id === missingPeripheralId,
      );
      scenarios.push(
        buildSinglePeripheralScenario({
          manifest,
          mcuId: mcu.id,
          pkgFile,
          packageData,
          templates,
          peripheral: missingPeripheral,
          build: true,
          disableRx: missingPeripheralId === uartPeripherals[0].id,
        }),
      );
    }
  }

  if (spiPeripherals.length > 0) {
    const spiScenario = buildScenarioSet({
      manifest,
      mcuId: mcu.id,
      pkgFile,
      packageData,
      templates,
      scenarioName: "spi_bus",
      peripheralSpecs: spiPeripherals.map((peripheral, index) => ({
        peripheral,
        includeOptionalSignals: true,
        extraCsCount: index === 0 ? 2 : 0,
      })),
      hfxoConfig: {},
      consoleStrategy: "none",
    });
    scenarios.push(spiScenario.scenario);

    for (const missingPeripheralId of spiScenario.missedPeripherals) {
      const missingPeripheral = spiPeripherals.find(
        (peripheral) => peripheral.id === missingPeripheralId,
      );
      scenarios.push(
        buildSinglePeripheralScenario({
          manifest,
          mcuId: mcu.id,
          pkgFile,
          packageData,
          templates,
          peripheral: missingPeripheral,
          build: true,
          extraCsCount: missingPeripheralId === spiPeripherals[0].id ? 2 : 0,
        }),
      );
    }
  }

  if (i2cPeripherals.length > 0) {
    const i2cScenario = buildScenarioSet({
      manifest,
      mcuId: mcu.id,
      pkgFile,
      packageData,
      templates,
      scenarioName: "i2c_bus",
      peripheralSpecs: i2cPeripherals.map((peripheral) => ({
        peripheral,
        includeOptionalSignals: true,
      })),
      hfxoConfig: {},
      consoleStrategy: "none",
    });
    scenarios.push(i2cScenario.scenario);

    for (const missingPeripheralId of i2cScenario.missedPeripherals) {
      const missingPeripheral = i2cPeripherals.find(
        (peripheral) => peripheral.id === missingPeripheralId,
      );
      scenarios.push(
        buildSinglePeripheralScenario({
          manifest,
          mcuId: mcu.id,
          pkgFile,
          packageData,
          templates,
          peripheral: missingPeripheral,
          build: true,
        }),
      );
    }
  }

  const mixedScenario = buildScenarioSet({
    manifest,
    mcuId: mcu.id,
    pkgFile,
    packageData,
    templates,
    scenarioName: "mixed_features",
    peripheralSpecs: mixedPeripherals.map((peripheral) => ({
      peripheral,
      includeOptionalSignals: true,
    })),
    hfxoConfig: {},
    lfxoConfig: {
      loadCapacitors: "internal",
      loadCapacitanceFemtofarad: 15000,
    },
    gpioCount: 2,
    gpioPrefix: "feature_gpio",
    consoleStrategy: "none",
  });
  scenarios.push(mixedScenario.scenario);

  for (const missingPeripheralId of mixedScenario.missedPeripherals) {
    const missingPeripheral = mixedPeripherals.find(
      (peripheral) => peripheral.id === missingPeripheralId,
    );
    scenarios.push(
      buildSinglePeripheralScenario({
        manifest,
        mcuId: mcu.id,
        pkgFile,
        packageData,
        templates,
        peripheral: missingPeripheral,
        build: Boolean(getPeripheralTemplate(templates, missingPeripheral.id)),
      }),
    );
  }

  const externalOscillatorScenario = buildScenarioSet({
    manifest,
    mcuId: mcu.id,
    pkgFile,
    packageData,
    templates,
    scenarioName: "oscillator_external",
    peripheralSpecs:
      uartPeripherals.length > 0
        ? [
            {
              peripheral: uartPeripherals[0],
              includeOptionalSignals: true,
            },
          ]
        : [],
    hfxoConfig: {
      loadCapacitors: "external",
    },
    lfxoConfig:
      collectPeripheralsByFilter(
        packageData,
        (peripheral) => peripheral.id === "LFXO",
      ).length > 0
        ? {
            loadCapacitors: "external",
          }
        : null,
    consoleStrategy: uartPeripherals.length > 0 ? "last-uart" : "none",
  });
  scenarios.push(externalOscillatorScenario.scenario);

  finalizeScenarioBuildFlags(scenarios, templates);
  assertPackageCoverage(mcu.id, pkgFile, packageData, templates, scenarios);

  return {
    packageData,
    templates,
    scenarios,
  };
}

export function generateClosedLoopMatrix() {
  const manifest = readJson(MANIFEST_PATH);
  const entries = [];
  let exportScenarioCount = 0;
  let buildScenarioCount = 0;

  for (const mcu of manifest.mcus || []) {
    for (const pkg of mcu.packages || []) {
      const unsupportedReason = getDevicetreeExportUnsupportedReason(
        manifest,
        mcu.id,
        pkg.file,
      );

      if (unsupportedReason) {
        entries.push({
          mcuId: mcu.id,
          packageFile: pkg.file,
          exportSupported: false,
          unsupportedReason,
          scenarios: [],
        });
        continue;
      }

      const { scenarios } = buildPackageScenarioMatrix(manifest, mcu, pkg.file);
      exportScenarioCount += scenarios.length;
      buildScenarioCount += scenarios.filter(
        (scenario) => scenario.build,
      ).length;

      entries.push({
        mcuId: mcu.id,
        packageFile: pkg.file,
        exportSupported: true,
        scenarios,
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    exportScenarioCount,
    buildScenarioCount,
    entries,
  };
}

function writeMatrixToDisk(matrix) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = resolve(OUTPUT_DIR, "matrix.json");
  writeFileSync(outputPath, `${JSON.stringify(matrix, null, 2)}\n`);
  return outputPath;
}

async function main() {
  const matrix = generateClosedLoopMatrix();
  const outputPath = writeMatrixToDisk(matrix);

  console.log(
    `Closed-loop matrix written to ${outputPath}\n` +
      `  Export scenarios: ${matrix.exportScenarioCount}\n` +
      `  Distinct build scenarios: ${matrix.buildScenarioCount}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
