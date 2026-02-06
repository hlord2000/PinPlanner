#!/usr/bin/env node

/**
 * CI Script: Generate Test Boards
 *
 * For each MCU in manifest.json, generates multiple board configurations
 * with different peripheral combinations to test all devicetree code paths.
 *
 * Configurations: minimal (UART), spi_i2c, pwm_adc, full (all peripherals)
 * For FLPR-supporting MCUs, UARTE30 is automatically added.
 *
 * Board name: test_board_<mcu>_<config>, vendor: test
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const MCUS_DIR = resolve(ROOT, "mcus");
const OUTPUT_DIR = resolve(__dirname, "output", "boards");

let exitCode = 0;

// -----------------------------------------------------------------------
// Test Configuration Matrix
// -----------------------------------------------------------------------

/**
 * Each config specifies which peripherals to enable.
 * For FLPR-supporting MCUs, UARTE30 is automatically added.
 */
const TEST_CONFIGS = {
  minimal: ["HFXO", "UARTE20"],
  spi_i2c: ["HFXO", "UARTE20", "SPIM/SPIS21", "TWIM/TWIS22"],
  pwm_adc: ["HFXO", "UARTE20", "PWM20", "PWM21", "SAADC", "NFCT"],
  full: [
    "HFXO",
    "LFXO",
    "UARTE20",
    "SPIM/SPIS21",
    "TWIM/TWIS22",
    "PWM20",
    "SAADC",
    "NFCT",
  ],
};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Map MCU names to their Zephyr DTSI base names.
 * Some MCUs have engineering sample suffixes in their DTSI filenames.
 */
function getMcuDtsiBaseName(mcu) {
  const dtsiNameMap = {
    nrf54lm20a: "nrf54lm20a_enga",
  };
  return dtsiNameMap[mcu] || mcu;
}

/**
 * Some MCUs have revision suffixes in their Zephyr SOC Kconfig symbols.
 * e.g. nrf54lm20a uses SOC_NRF54LM20A_ENGA_CPUAPP instead of SOC_NRF54LM20A_CPUAPP.
 */
function getMcuSocName(mcu) {
  const socNameMap = {
    nrf54lm20a: "NRF54LM20A_ENGA",
  };
  return socNameMap[mcu] || mcu.toUpperCase();
}

/**
 * Some peripheral IDs don't match template keys (e.g. SAADC -> ADC).
 */
const TEMPLATE_KEY_MAP = { SAADC: "ADC" };

function getTemplateKey(peripheralId) {
  return TEMPLATE_KEY_MAP[peripheralId] || peripheralId;
}

function parsePinName(pinName) {
  const match = pinName.match(/P(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    port: parseInt(match[1]),
    pin: parseInt(match[2]),
    name: pinName,
  };
}

/**
 * Resolve an allowedGpio entry against the package's pin list.
 * Returns the first matching pin name (e.g. "P1.04") or null.
 * Handles wildcard patterns like "P1*" and specific pins like "P2.02".
 */
function resolveGpioToPin(allowedGpio, packagePins, usedPins) {
  for (const pattern of allowedGpio) {
    if (pattern.endsWith("*")) {
      // Wildcard: match any pin in the port
      const portPrefix = pattern.slice(0, -1); // e.g. "P1"
      for (const pin of packagePins) {
        if (
          pin.name.startsWith(portPrefix + ".") &&
          pin.defaultType === "io" &&
          !usedPins.has(pin.name)
        ) {
          return pin.name;
        }
      }
    } else {
      // Specific pin
      const pinObj = packagePins.find(
        (p) => p.name === pattern && !usedPins.has(p.name),
      );
      if (pinObj) {
        return pattern;
      }
    }
  }
  return null;
}

/**
 * Generic peripheral state builder.
 * Finds the peripheral in packageData.socPeripherals by ID, looks up its template,
 * iterates signals and resolves GPIO pins. For SPI peripherals, also assigns the
 * CS out-of-band signal for cs-gpios generation.
 * Returns { id, type, peripheral, pinFunctions, config, _usedPins } or null.
 */
function buildPeripheralState(peripheralId, packageData, templates, usedPins) {
  const peripheral = packageData.socPeripherals.find(
    (p) => p.id === peripheralId,
  );
  if (!peripheral) return null;

  const template = templates[getTemplateKey(peripheralId)];
  if (!template) return null;

  // For noPinctrl peripherals (ADC, NFCT), just enable them
  if (template.noPinctrl) {
    return {
      id: peripheralId,
      type: peripheral.type,
      peripheral,
      pinFunctions: {},
      config: {},
      _usedPins: new Set(usedPins),
    };
  }

  const localUsedPins = new Set(usedPins);
  const pinFunctions = {};

  for (const signal of peripheral.signals) {
    if (!signal.allowedGpio || signal.allowedGpio.length === 0) continue;

    // Skip out-of-band signals (handled separately below)
    if (
      template.outOfBandSignals &&
      template.outOfBandSignals.includes(signal.name)
    ) {
      continue;
    }

    // For SPI, always treat CS as out-of-band (cs-gpios, not pinctrl)
    if (template.type === "SPI" && signal.name === "CS") continue;

    // Only assign pins for signals in signalMappings
    if (!template.signalMappings[signal.name]) continue;

    const pin = resolveGpioToPin(
      signal.allowedGpio,
      packageData.pins,
      localUsedPins,
    );
    if (pin) {
      pinFunctions[pin] = signal.name;
      localUsedPins.add(pin);
    } else if (signal.isMandatory) {
      console.warn(
        `  WARNING: Could not find available pin for mandatory signal ${signal.name} on ${peripheralId}`,
      );
    }
  }

  // For SPI, assign the CS signal for cs-gpios (always out-of-band)
  if (template.type === "SPI") {
    const csSignal = peripheral.signals.find((s) => s.name === "CS");
    if (csSignal && csSignal.allowedGpio) {
      const csPin = resolveGpioToPin(
        csSignal.allowedGpio,
        packageData.pins,
        localUsedPins,
      );
      if (csPin) {
        pinFunctions[csPin] = "CS";
        localUsedPins.add(csPin);
      }
    }
  }

  if (Object.keys(pinFunctions).length === 0) return null;

  return {
    id: peripheralId,
    type: peripheral.type,
    peripheral,
    pinFunctions,
    config: {},
    _usedPins: localUsedPins,
  };
}

/**
 * Build synthetic HFXO state.
 */
function buildHfxoState() {
  return {
    id: "HFXO",
    type: "OSCILLATOR",
    config: {
      loadCapacitors: "internal",
      loadCapacitanceFemtofarad: 15000,
    },
    pinFunctions: {},
  };
}

/**
 * Build synthetic LFXO state.
 */
function buildLfxoState() {
  return {
    id: "LFXO",
    type: "OSCILLATOR",
    config: {
      loadCapacitors: "internal",
      loadCapacitanceFemtofarad: 17000,
    },
    pinFunctions: {},
  };
}

// -----------------------------------------------------------------------
// Board file generation functions (simplified from script.js)
// -----------------------------------------------------------------------

function generateBoardYml(boardName, mcu, supportsNS, supportsFLPR) {
  let socSection = `  socs:
    - name: ${mcu}`;

  if (supportsNS || supportsFLPR) {
    socSection += `
      variants:`;
    if (supportsFLPR) {
      socSection += `
        - name: xip
          cpucluster: cpuflpr`;
    }
    if (supportsNS) {
      socSection += `
        - name: ns
          cpucluster: cpuapp`;
    }
  }

  let boardsList = `${boardName}/${mcu}/cpuapp`;
  if (supportsNS) {
    boardsList += `
              - ${boardName}/${mcu}/cpuapp/ns`;
  }
  if (supportsFLPR) {
    boardsList += `
              - ${boardName}/${mcu}/cpuflpr
              - ${boardName}/${mcu}/cpuflpr/xip`;
  }

  return `board:
  name: ${boardName}
  full_name: Test Board ${mcu.toUpperCase()}
  vendor: test
${socSection}
runners:
  run_once:
    '--recover':
      - runners:
          - nrfjprog
          - nrfutil
        run: first
        groups:
          - boards:
              - ${boardsList}
    '--erase':
      - runners:
          - nrfjprog
          - jlink
          - nrfutil
        run: first
        groups:
          - boards:
              - ${boardsList}
    '--reset':
      - runners:
          - nrfjprog
          - jlink
          - nrfutil
        run: last
        groups:
          - boards:
              - ${boardsList}
`;
}

function generateBoardCmake(boardName, mcu, supportsNS, supportsFLPR) {
  const mcuUpper = mcu.toUpperCase();
  const boardNameUpper = boardName.toUpperCase();

  let content = `# Copyright (c) 2024 Nordic Semiconductor ASA
# SPDX-License-Identifier: Apache-2.0

if(CONFIG_SOC_${mcuUpper}_CPUAPP)
\tboard_runner_args(jlink "--device=nRF${mcuUpper.substring(3)}_M33" "--speed=4000")
`;

  if (supportsFLPR) {
    if (mcu === "nrf54l15") {
      content += `elseif(CONFIG_SOC_${mcuUpper}_CPUFLPR)
\tboard_runner_args(jlink "--device=nRF${mcuUpper.substring(3)}_RV32")
`;
    } else {
      content += `elseif(CONFIG_SOC_${mcuUpper}_CPUFLPR)
\tset(JLINKSCRIPTFILE \${CMAKE_CURRENT_LIST_DIR}/support/${mcu}_cpuflpr.JLinkScript)
\tboard_runner_args(jlink "--device=RISC-V" "--speed=4000" "-if SW" "--tool-opt=-jlinkscriptfile \${JLINKSCRIPTFILE}")
`;
    }
  }

  content += `endif()

`;

  if (supportsNS) {
    content += `if(CONFIG_BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS)
\tset(TFM_PUBLIC_KEY_FORMAT "full")
endif()

if(CONFIG_TFM_FLASH_MERGED_BINARY)
\tset_property(TARGET runners_yaml_props_target PROPERTY hex_file tfm_merged.hex)
endif()

`;
  }

  content += `include(\${ZEPHYR_BASE}/boards/common/nrfutil.board.cmake)
include(\${ZEPHYR_BASE}/boards/common/jlink.board.cmake)
`;

  return content;
}

function generateKconfigDefconfig(boardName, mcu, supportsNS) {
  const boardNameUpper = boardName.toUpperCase();
  const mcuUpper = mcu.toUpperCase();

  let content = `# Copyright (c) 2024 Nordic Semiconductor ASA
# SPDX-License-Identifier: Apache-2.0

config HW_STACK_PROTECTION
\tdefault ARCH_HAS_STACK_PROTECTION

if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP

config ROM_START_OFFSET
\tdefault 0 if PARTITION_MANAGER_ENABLED
\tdefault 0x800 if BOOTLOADER_MCUBOOT

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP
`;

  if (supportsNS) {
    content += `
if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

config BOARD_${boardNameUpper}
\tselect USE_DT_CODE_PARTITION if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

config HAS_BT_CTLR
\tdefault BT

# By default, if we build for a Non-Secure version of the board,
# enable building with TF-M as the Secure Execution Environment.
config BUILD_WITH_TFM
\tdefault y

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS
`;
  }

  return content;
}

function generateKconfigBoard(boardName, mcu, supportsNS, supportsFLPR) {
  const boardNameUpper = boardName.toUpperCase();
  const mcuUpper = mcu.toUpperCase();
  const socBase = getMcuSocName(mcu);

  let selectCondition = `BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP`;
  if (supportsNS) {
    selectCondition += ` || BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS`;
  }

  let content = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

config BOARD_${boardNameUpper}
\tselect SOC_${socBase}_CPUAPP if ${selectCondition}
`;

  if (supportsFLPR) {
    content += `\tselect SOC_${socBase}_CPUFLPR if BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR || \\
\t\t\t\t\t    BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR_XIP
`;
  }

  return content;
}

function generateKconfigTrustZone(boardName, mcu) {
  const boardNameUpper = boardName.toUpperCase();
  const mcuUpper = mcu.toUpperCase();
  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# Test Board ${mcu.toUpperCase()} board configuration

if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

DT_NRF_MPC := $(dt_nodelabel_path,nrf_mpc)

config NRF_TRUSTZONE_FLASH_REGION_SIZE
\thex
\tdefault $(dt_node_int_prop_hex,$(DT_NRF_MPC),override-granularity)
\thelp
\t  This defines the flash region size from the TrustZone perspective.

config NRF_TRUSTZONE_RAM_REGION_SIZE
\thex
\tdefault $(dt_node_int_prop_hex,$(DT_NRF_MPC),override-granularity)
\thelp
\t  This defines the RAM region size from the TrustZone perspective.

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS
`;
}

function generatePinctrlFile(boardName, mcu, peripherals, templates) {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 * SPDX-License-Identifier: Apache-2.0
 */

&pinctrl {
`;

  for (const p of peripherals) {
    const template = templates[getTemplateKey(p.id)];
    if (!template || template.noPinctrl) continue;

    const pinctrlName = template.pinctrlBaseName;
    const outputSignals = [];
    const inputSignals = [];

    for (const [pinName, signalName] of Object.entries(p.pinFunctions)) {
      const pinInfo = parsePinName(pinName);
      if (!pinInfo) continue;

      const dtSignalName = template.signalMappings[signalName];
      if (!dtSignalName) continue;

      const signal = p.peripheral
        ? p.peripheral.signals.find((s) => s.name === signalName)
        : null;
      if (signal && signal.direction === "input") {
        inputSignals.push({ pinInfo, dtSignalName });
      } else {
        outputSignals.push({ pinInfo, dtSignalName });
      }
    }

    const allSignals = [...outputSignals, ...inputSignals];
    if (allSignals.length === 0) continue;

    // Default state
    content += `\n\t/omit-if-no-ref/ ${pinctrlName}_default: ${pinctrlName}_default {\n`;
    if (outputSignals.length > 0) {
      content += `\t\tgroup1 {\n\t\t\tpsels = `;
      content += outputSignals
        .map(
          (s) =>
            `<NRF_PSEL(${s.dtSignalName}, ${s.pinInfo.port}, ${s.pinInfo.pin})>`,
        )
        .join(",\n\t\t\t\t");
      content += `;\n\t\t};\n`;
    }
    if (inputSignals.length > 0) {
      content += `\n\t\tgroup2 {\n\t\t\tpsels = `;
      content += inputSignals
        .map(
          (s) =>
            `<NRF_PSEL(${s.dtSignalName}, ${s.pinInfo.port}, ${s.pinInfo.pin})>`,
        )
        .join(",\n\t\t\t\t");
      content += `;\n\t\t\tbias-pull-up;\n\t\t};\n`;
    }
    content += `\t};\n`;

    // Sleep state
    content += `\n\t/omit-if-no-ref/ ${pinctrlName}_sleep: ${pinctrlName}_sleep {\n`;
    content += `\t\tgroup1 {\n\t\t\tpsels = `;
    content += allSignals
      .map(
        (s) =>
          `<NRF_PSEL(${s.dtSignalName}, ${s.pinInfo.port}, ${s.pinInfo.pin})>`,
      )
      .join(",\n\t\t\t\t");
    content += `;\n\t\t\tlow-power-enable;\n\t\t};\n`;
    content += `\t};\n`;
  }

  content += "};\n";
  return content;
}

function generateCommonDtsi(boardName, mcu, peripherals, templates) {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${boardName}_${mcu}-pinctrl.dtsi"

`;

  for (const p of peripherals) {
    if (p.config && p.config.loadCapacitors) continue;
    if (p.type === "GPIO") continue;

    const template = templates[getTemplateKey(p.id)];
    if (!template) continue;

    const nodeName = template.dtNodeName;
    const pinctrlName = template.pinctrlBaseName;

    content += `\n&${nodeName} {\n`;
    // uart30 should NOT have status = "okay" in common DTSI;
    // the FLPR DTS will enable it.
    if (p.id !== "UARTE30") {
      content += `\tstatus = "okay";\n`;
    }

    if (!template.noPinctrl && pinctrlName) {
      content += `\tpinctrl-0 = <&${pinctrlName}_default>;\n`;
      content += `\tpinctrl-1 = <&${pinctrlName}_sleep>;\n`;
      content += `\tpinctrl-names = "default", "sleep";\n`;
    }

    if (template.type === "UART") {
      content += `\tcurrent-speed = <115200>;\n`;
    }

    if (template.type === "SPI") {
      const csEntry = Object.entries(p.pinFunctions).find(
        ([, sig]) => sig === "CS",
      );
      if (csEntry) {
        const csPinInfo = parsePinName(csEntry[0]);
        if (csPinInfo) {
          content += `\tcs-gpios = <&gpio${csPinInfo.port} ${csPinInfo.pin} GPIO_ACTIVE_LOW>;\n`;
        }
      }
    }

    if (template.type === "I2C") {
      content += `\tclock-frequency = <I2C_BITRATE_STANDARD>;\n`;
    }

    content += `};\n`;
  }

  return content;
}

function generateCpuappCommonDtsi(boardName, mcu, peripherals, templates) {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* This file is common to the secure and non-secure domain */

#include "${boardName}_common.dtsi"

/ {
\tchosen {
`;

  // Add UART console if available
  let hasUart = false;
  for (const p of peripherals) {
    const template = templates[getTemplateKey(p.id)];
    if (
      template &&
      template.dtNodeName &&
      template.type === "UART" &&
      !hasUart
    ) {
      content += `\t\tzephyr,console = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,shell-uart = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,uart-mcumgr = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,bt-mon-uart = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,bt-c2h-uart = &${template.dtNodeName};\n`;
      hasUart = true;
    }
  }

  content += `\t\tzephyr,flash-controller = &rram_controller;
\t\tzephyr,flash = &cpuapp_rram;
\t\tzephyr,ieee802154 = &ieee802154;
\t\tzephyr,boot-mode = &boot_mode0;
\t};
};

&cpuapp_sram {
\tstatus = "okay";
};

&hfxo {
\tload-capacitors = "internal";
\tload-capacitance-femtofarad = <15000>;
};
`;

  // Add LFXO node if present in peripherals
  const lfxo = peripherals.find((p) => p.id === "LFXO");
  if (lfxo) {
    const lfxoCap = lfxo.config.loadCapacitanceFemtofarad || 17000;
    const lfxoCapType = lfxo.config.loadCapacitors || "internal";
    content += `
&lfxo {
\tload-capacitors = "${lfxoCapType}";
\tload-capacitance-femtofarad = <${lfxoCap}>;
};
`;
  }

  content += `
&regulators {
\tstatus = "okay";
};

&vregmain {
\tstatus = "okay";
\tregulator-initial-mode = <NRF5X_REG_MODE_DCDC>;
};

&grtc {
\towned-channels = <0 1 2 3 4 5 6 7 8 9 10 11>;
\t/* Channels 7-11 reserved for Zero Latency IRQs, 3-4 for FLPR */
\tchild-owned-channels = <3 4 7 8 9 10 11>;
\tstatus = "okay";
};

&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

&gpio2 {
\tstatus = "okay";
};

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};

&radio {
\tstatus = "okay";
};

&ieee802154 {
\tstatus = "okay";
};

&temp {
\tstatus = "okay";
};

&clock {
\tstatus = "okay";
};

&gpregret1 {
\tstatus = "okay";

\tboot_mode0: boot_mode@0 {
\t\tcompatible = "zephyr,retention";
\t\tstatus = "okay";
\t\treg = <0x0 0x1>;
\t};
};
`;

  return content;
}

function generateMainDts(boardName, mcu, supportsNS) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const dtsiBase = getMcuDtsiBaseName(mcu);
  // nrf54l05 uses a simpler partition file without _cpuapp_ prefix
  const useSimplePartition = mcu === "nrf54l05";
  const partitionInclude = useSimplePartition
    ? `#include <nordic/${mcu}_partition.dtsi>`
    : `#include <vendor/nordic/${mcu}_cpuapp_partition.dtsi>`;
  return `/dts-v1/;

#include <nordic/${dtsiBase}_cpuapp.dtsi>
#include "${mcu}_cpuapp_common.dtsi"

/ {
\tcompatible = "test,${boardName}-${mcu}-cpuapp";
\tmodel = "Test Board ${mcuUpper} Application MCU";

\tchosen {
\t\tzephyr,code-partition = &slot0_partition;
\t\tzephyr,sram = &cpuapp_sram;
\t};
};

/* Include default memory partition configuration file */
${partitionInclude}
`;
}

function generateYaml(boardName, mcu, isNonSecure, peripherals) {
  const identifier = isNonSecure
    ? `${boardName}/${mcu}/cpuapp/ns`
    : `${boardName}/${mcu}/cpuapp`;
  const name = isNonSecure
    ? `Test Board ${mcu.toUpperCase()}-Non-Secure`
    : `Test Board ${mcu.toUpperCase()}`;
  const ram = isNonSecure ? 256 : 188;
  const flash = isNonSecure ? 1524 : 1428;

  // Dynamically build supported list from peripherals
  const supported = new Set(["gpio", "watchdog"]);
  if (peripherals) {
    for (const p of peripherals) {
      if (p.type === "UART" || (p.id && p.id.startsWith("UARTE")))
        supported.add("uart");
      if (p.type === "SPI" || (p.id && p.id.startsWith("SPIM")))
        supported.add("spi");
      if (
        p.type === "TWI" ||
        p.type === "I2C" ||
        (p.id && p.id.startsWith("TWIM"))
      )
        supported.add("i2c");
      if (p.type === "PWM" || (p.id && p.id.startsWith("PWM")))
        supported.add("pwm");
      if (p.type === "SAADC" || p.type === "ADC") supported.add("adc");
      if (p.type === "NFCT") supported.add("nfct");
    }
  }
  const supportedList = [...supported]
    .sort()
    .map((s) => `  - ${s}`)
    .join("\n");

  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

identifier: ${identifier}
name: ${name}
type: mcu
arch: arm
toolchain:
  - gnuarmemb
  - zephyr
sysbuild: true
ram: ${ram}
flash: ${flash}
supported:
${supportedList}
vendor: test
`;
}

function generateDefconfig(isNonSecure, mcu, hasLfxo) {
  if (isNonSecure) {
    return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# Enable MPU
CONFIG_ARM_MPU=y
CONFIG_NULL_POINTER_EXCEPTION_DETECTION_NONE=y

# Enable TrustZone-M
CONFIG_ARM_TRUSTZONE_M=y

# This Board implies building Non-Secure firmware
CONFIG_TRUSTED_EXECUTION_NONSECURE=y

# Use devicetree code partition for TF-M
CONFIG_USE_DT_CODE_PARTITION=y

# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

# Enable GPIO
CONFIG_GPIO=y

# Don't enable the cache in the non-secure image as it is a
# secure-only peripheral on 54l
CONFIG_CACHE_MANAGEMENT=n
CONFIG_EXTERNAL_CACHE=n

# Start SYSCOUNTER on driver init
CONFIG_NRF_GRTC_START_SYSCOUNTER=y

# Disable TFM BL2 since it is not supported
CONFIG_TFM_BL2=n

# Support for silence logging is not supported at the moment
CONFIG_TFM_LOG_LEVEL_SILENCE=n

# The oscillators are configured as secure and cannot be configured
# from the non secure application directly. This needs to be set
# otherwise nrfx will try to configure them, resulting in a bus
# fault.
CONFIG_NRF_SKIP_CLOCK_CONFIG=y
`;
  }

  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

# Enable GPIO
CONFIG_GPIO=y

# Enable MPU
CONFIG_ARM_MPU=y
`;

  // nrf54lm20a-specific hardware configs
  if (mcu === "nrf54lm20a") {
    config += `
# MPU-based null-pointer dereferencing detection cannot
# be applied as the (0x0 - 0x400) is unmapped for this target.
CONFIG_NULL_POINTER_EXCEPTION_DETECTION_NONE=y

# Enable Cache
CONFIG_CACHE_MANAGEMENT=y
CONFIG_EXTERNAL_CACHE=y

# Start SYSCOUNTER on driver init
CONFIG_NRF_GRTC_START_SYSCOUNTER=y
`;
  } else if (!hasLfxo) {
    // nrf54l05/10/15 use RC oscillator for low-frequency clock when no LFXO
    config += `
# Use RC oscillator for low-frequency clock
CONFIG_CLOCK_CONTROL_NRF_K32SRC_RC=y
`;
  }

  return config;
}

function generateNSDts(boardName, mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const dtsiBase = getMcuDtsiBaseName(mcu);

  // MCUs that have a dedicated _cpuapp_ns.dtsi file in Zephyr
  const hasNsDtsi = mcu === "nrf54l15" || mcu === "nrf54l10";

  let nsIncludes;
  if (hasNsDtsi) {
    nsIncludes = `#include <arm/nordic/${dtsiBase}_cpuapp_ns.dtsi>
#include "${mcu}_cpuapp_common.dtsi"`;
  } else {
    nsIncludes = `#include "${mcu}_cpuapp_common.dtsi"`;
  }

  // TF-M always uses uart30 - disable it in NS builds
  let peripheralDisableSection = `
&uart30 {
\t/* Disable so that TF-M can use this UART */
\tstatus = "disabled";
};
`;

  // nrf54lm20a also needs BT controller disabled in NS
  if (mcu === "nrf54lm20a") {
    peripheralDisableSection = `
&bt_hci_controller {
\tstatus = "disabled";
};

&uart30 {
\t/* Disable so that TF-M can use this UART */
\tstatus = "disabled";
};
`;
  }

  return `/dts-v1/;

#define USE_NON_SECURE_ADDRESS_MAP 1

${nsIncludes}

/ {
\tcompatible = "test,${boardName}-${mcu}-cpuapp";
\tmodel = "Test Board ${mcuUpper} Application MCU";

\tchosen {
\t\tzephyr,code-partition = &slot0_ns_partition;
\t\tzephyr,sram = &sram0_ns;
\t\tzephyr,entropy = &psa_rng;
\t};

\t/delete-node/ rng;

\tpsa_rng: psa-rng {
\t\tstatus = "okay";
\t};
};
${peripheralDisableSection}
/* Include default memory partition configuration file */
#include <vendor/nordic/${mcu}_cpuapp_ns_partition.dtsi>
`;
}

function generateFLPRDts(boardName, mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const dtsiBase = getMcuDtsiBaseName(mcu);
  return `/dts-v1/;
#include <nordic/${dtsiBase}_cpuflpr.dtsi>
#include "${boardName}_common.dtsi"

/delete-node/ &cpuflpr_sram;

/ {
\tmodel = "Test Board ${mcuUpper} FLPR MCU";
\tcompatible = "test,${boardName}-${mcu}-cpuflpr";

\tchosen {
\t\tzephyr,console = &uart30;
\t\tzephyr,shell-uart = &uart30;
\t\tzephyr,code-partition = &cpuflpr_code_partition;
\t\tzephyr,flash = &cpuflpr_rram;
\t\tzephyr,sram = &cpuflpr_sram;
\t};

\tcpuflpr_sram: memory@20028000 {
\t\tcompatible = "mmio-sram";
\t\t/* Size must be increased due to booting from SRAM */
\t\treg = <0x20028000 DT_SIZE_K(96)>;
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges = <0x0 0x20028000 0x18000>;
\t\tstatus = "okay";
\t};
};

&cpuflpr_rram {
\tpartitions {
\t\tcompatible = "fixed-partitions";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tcpuflpr_code_partition: partition@0 {
\t\t\tlabel = "image-0";
\t\t\treg = <0x0 DT_SIZE_K(96)>;
\t\t};
\t};
};

&grtc {
\towned-channels = <3 4>;
\tstatus = "okay";
};

&uart30 {
\tstatus = "okay";
};

&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

&gpio2 {
\tstatus = "okay";
};

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};
`;
}

function generateFLPRXIPDts(boardName, mcu) {
  return `/*
 * Copyright (c) 2025 Generated by nRF54L Pin Planner
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${boardName}_${mcu}_cpuflpr.dts"

&cpuflpr_sram {
\treg = <0x2002f000 DT_SIZE_K(68)>;
\tranges = <0x0 0x2002f000 0x11000>;
};
`;
}

function generateFLPRYaml(boardName, mcu, isXIP) {
  const identifier = isXIP
    ? `${boardName}/${mcu}/cpuflpr/xip`
    : `${boardName}/${mcu}/cpuflpr`;
  const name = isXIP
    ? `Test Board ${mcu.toUpperCase()}-Fast-Lightweight-Peripheral-Processor (RRAM XIP)`
    : `Test Board ${mcu.toUpperCase()}-Fast-Lightweight-Peripheral-Processor`;
  const ram = isXIP ? 68 : 96;

  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

identifier: ${identifier}
name: ${name}
type: mcu
arch: riscv
toolchain:
  - zephyr
sysbuild: true
ram: ${ram}
flash: 96
supported:
  - counter
  - gpio
  - i2c
  - spi
  - watchdog
`;
}

function generateFLPRDefconfig(isXIP, mcu) {
  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

# Enable GPIO
CONFIG_GPIO=y

${isXIP ? "# Execute from RRAM\nCONFIG_XIP=y" : "CONFIG_USE_DT_CODE_PARTITION=y\n\n# Execute from SRAM\nCONFIG_XIP=n"}
`;

  // nrf54lm20a requires explicit ecall switching for RISC-V FLPR
  if (mcu === "nrf54lm20a") {
    config += `
CONFIG_RISCV_ALWAYS_SWITCH_THROUGH_ECALL=y
`;
  }

  return config;
}

// -----------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------

console.log("=== Generate Test Boards ===\n");

// Load manifest
const manifestPath = resolve(MCUS_DIR, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// Clean and create output directory
mkdirSync(OUTPUT_DIR, { recursive: true });

const SKIP_MCUS = ["nrf54lv10a"]; // No DTSI files in current Zephyr tree
let totalBoards = 0;

for (const mcu of manifest.mcus) {
  const mcuId = mcu.id;
  const supportsNS = mcu.supportsNonSecure === true;
  const supportsFLPR = mcu.supportsFLPR === true;

  if (SKIP_MCUS.includes(mcuId)) {
    console.log(`\nSkipping ${mcuId}: no Zephyr DTSI support`);
    continue;
  }

  console.log(`\n--- MCU: ${mcuId} ---`);
  console.log(`  Supports NS: ${supportsNS}, FLPR: ${supportsFLPR}`);

  // Use first package for this MCU
  if (!mcu.packages || mcu.packages.length === 0) {
    console.error(`  ERROR: No packages for ${mcuId}`);
    exitCode = 1;
    continue;
  }

  const pkg = mcu.packages[0];
  const pkgPath = resolve(MCUS_DIR, mcuId, `${pkg.file}.json`);
  const dtPath = resolve(MCUS_DIR, mcuId, "devicetree-templates.json");

  if (!existsSync(pkgPath)) {
    console.error(`  ERROR: Package file not found: ${pkgPath}`);
    exitCode = 1;
    continue;
  }
  if (!existsSync(dtPath)) {
    console.error(`  ERROR: Devicetree templates not found: ${dtPath}`);
    exitCode = 1;
    continue;
  }

  const packageData = JSON.parse(readFileSync(pkgPath, "utf-8"));
  const dtData = JSON.parse(readFileSync(dtPath, "utf-8"));
  const templates = dtData.templates;

  // Generate boards for each test configuration
  for (const [configName, peripheralIds] of Object.entries(TEST_CONFIGS)) {
    const boardName = `test_board_${mcuId}_${configName}`;
    const usedPins = new Set();
    const peripherals = [];
    let skipConfig = false;
    const hasLfxo = peripheralIds.includes("LFXO");

    console.log(`\n  Config: ${configName} -> ${boardName}`);

    for (const pId of peripheralIds) {
      if (pId === "HFXO") {
        peripherals.push(buildHfxoState());
        continue;
      }
      if (pId === "LFXO") {
        peripherals.push(buildLfxoState());
        continue;
      }

      const state = buildPeripheralState(pId, packageData, templates, usedPins);
      if (!state) {
        console.log(
          `    Skipping config ${configName}: ${pId} unavailable for ${mcuId}`,
        );
        skipConfig = true;
        break;
      }
      peripherals.push(state);
      // Accumulate used pins
      for (const pin of state._usedPins) usedPins.add(pin);

      const pinCount = Object.keys(state.pinFunctions).length;
      if (pinCount > 0) {
        console.log(`    ${pId} pins: ${JSON.stringify(state.pinFunctions)}`);
      } else {
        console.log(`    ${pId}: enabled (no pinctrl)`);
      }
    }

    if (skipConfig) continue;

    // Add UARTE30 for FLPR console if MCU supports FLPR
    if (supportsFLPR) {
      const uart30 = buildPeripheralState(
        "UARTE30",
        packageData,
        templates,
        usedPins,
      );
      if (uart30) {
        peripherals.push(uart30);
        for (const pin of uart30._usedPins) usedPins.add(pin);
        console.log(
          `    UARTE30 (FLPR) pins: ${JSON.stringify(uart30.pinFunctions)}`,
        );
      } else {
        console.warn(`    WARNING: Could not configure UARTE30 for ${mcuId}`);
      }
    }

    // Generate all board files
    const files = {};

    files["board.yml"] = generateBoardYml(
      boardName,
      mcuId,
      supportsNS,
      supportsFLPR,
    );
    files["board.cmake"] = generateBoardCmake(
      boardName,
      mcuId,
      supportsNS,
      supportsFLPR,
    );
    files["Kconfig.defconfig"] = generateKconfigDefconfig(
      boardName,
      mcuId,
      supportsNS,
    );
    files[`Kconfig.${boardName}`] = generateKconfigBoard(
      boardName,
      mcuId,
      supportsNS,
      supportsFLPR,
    );
    files[`${boardName}_common.dtsi`] = generateCommonDtsi(
      boardName,
      mcuId,
      peripherals,
      templates,
    );
    files[`${mcuId}_cpuapp_common.dtsi`] = generateCpuappCommonDtsi(
      boardName,
      mcuId,
      peripherals,
      templates,
    );
    files[`${boardName}_${mcuId}-pinctrl.dtsi`] = generatePinctrlFile(
      boardName,
      mcuId,
      peripherals,
      templates,
    );
    files[`${boardName}_${mcuId}_cpuapp.dts`] = generateMainDts(
      boardName,
      mcuId,
      supportsNS,
    );
    files[`${boardName}_${mcuId}_cpuapp.yaml`] = generateYaml(
      boardName,
      mcuId,
      false,
      peripherals,
    );
    files[`${boardName}_${mcuId}_cpuapp_defconfig`] = generateDefconfig(
      false,
      mcuId,
      hasLfxo,
    );

    // NS-specific files
    if (supportsNS) {
      files["Kconfig"] = generateKconfigTrustZone(boardName, mcuId);
      files[`${boardName}_${mcuId}_cpuapp_ns.dts`] = generateNSDts(
        boardName,
        mcuId,
      );
      files[`${boardName}_${mcuId}_cpuapp_ns.yaml`] = generateYaml(
        boardName,
        mcuId,
        true,
        peripherals,
      );
      files[`${boardName}_${mcuId}_cpuapp_ns_defconfig`] = generateDefconfig(
        true,
        mcuId,
        hasLfxo,
      );
    }

    // FLPR-specific files
    if (supportsFLPR) {
      files[`${boardName}_${mcuId}_cpuflpr.dts`] = generateFLPRDts(
        boardName,
        mcuId,
      );
      files[`${boardName}_${mcuId}_cpuflpr.yaml`] = generateFLPRYaml(
        boardName,
        mcuId,
        false,
      );
      files[`${boardName}_${mcuId}_cpuflpr_defconfig`] = generateFLPRDefconfig(
        false,
        mcuId,
      );
      files[`${boardName}_${mcuId}_cpuflpr_xip.dts`] = generateFLPRXIPDts(
        boardName,
        mcuId,
      );
      files[`${boardName}_${mcuId}_cpuflpr_xip.yaml`] = generateFLPRYaml(
        boardName,
        mcuId,
        true,
      );
      files[`${boardName}_${mcuId}_cpuflpr_xip_defconfig`] =
        generateFLPRDefconfig(true, mcuId);
    }

    // Write all files to output directory
    const boardDir = resolve(OUTPUT_DIR, boardName);
    mkdirSync(boardDir, { recursive: true });

    let fileCount = 0;
    for (const [filename, content] of Object.entries(files)) {
      const filePath = resolve(boardDir, filename);
      writeFileSync(filePath, content, "utf-8");
      fileCount++;
    }

    console.log(`    Generated ${fileCount} files in ${boardDir}`);
    totalBoards++;
  }
}

// Summary
console.log("\n=== Summary ===");
console.log(`MCUs processed: ${manifest.mcus.length}`);
console.log(`Board configs generated: ${totalBoards}`);

if (exitCode !== 0) {
  console.log("\nGeneration completed with ERRORS.");
} else {
  console.log("\nAll test boards generated successfully.");
}

process.exit(exitCode);
