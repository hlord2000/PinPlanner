// --- DEVICETREE GENERATION ---

import state from "./state.js";
import {
  getMcuSupportsFLPR as getMcuSupportsFLPRFromManifest,
  getMcuSupportsFLPRXIP as getMcuSupportsFLPRXIPFromManifest,
  getMcuSupportsNonSecure as getMcuSupportsNonSecureFromManifest,
} from "./mcu-manifest.js";
import { parsePinName } from "./utils.js";

export function getMcuSupportsNonSecure(mcuId) {
  return getMcuSupportsNonSecureFromManifest(state.mcuManifest, mcuId);
}

export function getMcuSupportsFLPR(mcuId) {
  return getMcuSupportsFLPRFromManifest(state.mcuManifest, mcuId);
}

export function getMcuSupportsFLPRXIP(mcuId) {
  return getMcuSupportsFLPRXIPFromManifest(state.mcuManifest, mcuId);
}

function usesReservedFlprCpuappUart30(mcu) {
  return mcu === "nrf54l15" || mcu === "nrf54lm20a";
}

function getFixedNsTfmSecureUartId(mcu) {
  if (mcu === "nrf54lv10a") {
    return "UARTE20";
  }

  if (mcu === "nrf54l10" || mcu === "nrf54l15" || mcu === "nrf54lm20a") {
    return "UARTE30";
  }

  return null;
}

function getFallbackConsoleUartId(reservedUartIds = []) {
  if (!state.deviceTreeTemplates) {
    return null;
  }

  const reservedSet = new Set(reservedUartIds.filter(Boolean));
  const selectedUartIds = new Set(
    state.selectedPeripherals
      .filter((peripheral) => peripheral.type === "UART")
      .map((peripheral) => peripheral.id),
  );
  const preferredFallbackIds = ["UARTE21", "UARTE20", "UARTE00"];

  for (const uartId of preferredFallbackIds) {
    if (
      selectedUartIds.has(uartId) &&
      !reservedSet.has(uartId) &&
      state.deviceTreeTemplates[uartId]?.dtNodeName
    ) {
      return uartId;
    }
  }

  const fallbackPeripheral = state.selectedPeripherals.find(
    (peripheral) =>
      peripheral.type === "UART" &&
      !reservedSet.has(peripheral.id) &&
      state.deviceTreeTemplates[peripheral.id]?.dtNodeName,
  );
  return fallbackPeripheral ? fallbackPeripheral.id : null;
}

function getReservedBoardConsoleUartId(mcu) {
  if (!state.consoleUart) {
    return null;
  }

  const fixedNsTfmSecureUartId = getFixedNsTfmSecureUartId(mcu);
  if (
    getMcuSupportsNonSecure(mcu) &&
    fixedNsTfmSecureUartId &&
    state.consoleUart === fixedNsTfmSecureUartId
  ) {
    return state.consoleUart;
  }

  if (
    getMcuSupportsFLPR(mcu) &&
    usesReservedFlprCpuappUart30(mcu) &&
    state.consoleUart === "UARTE30"
  ) {
    return state.consoleUart;
  }

  return null;
}

function getEffectiveConsoleUartId(mcu) {
  if (!state.consoleUart) {
    return null;
  }

  const reservedConsoleUartId = getReservedBoardConsoleUartId(mcu);
  if (!reservedConsoleUartId) {
    return state.consoleUart;
  }

  return getFallbackConsoleUartId([reservedConsoleUartId]);
}

function getConsoleRoutingNote(mcu) {
  const reservedConsoleUartId = getReservedBoardConsoleUartId(mcu);
  if (!reservedConsoleUartId) {
    return null;
  }

  const reasons = [];
  const fixedNsTfmSecureUartId = getFixedNsTfmSecureUartId(mcu);

  if (
    getMcuSupportsNonSecure(mcu) &&
    reservedConsoleUartId === fixedNsTfmSecureUartId
  ) {
    reasons.push(
      `cpuapp/ns builds reserve ${reservedConsoleUartId} for TF-M secure UART wiring from nRF Connect SDK main`,
    );
  }

  if (
    getMcuSupportsFLPR(mcu) &&
    usesReservedFlprCpuappUart30(mcu) &&
    reservedConsoleUartId === "UARTE30"
  ) {
    reasons.push(
      `${reservedConsoleUartId} is also reserved in the CPUAPP launcher image for FLPR builds`,
    );
  }

  const effectiveConsoleUartId = getEffectiveConsoleUartId(mcu);
  const mcuLabel = mcu.toUpperCase().replace("NRF", "nRF");
  const reasonText =
    reasons.length > 0
      ? reasons.join("; ")
      : `${reservedConsoleUartId} cannot serve every exported target`;

  if (effectiveConsoleUartId) {
    return `${mcuLabel} ${reasonText}. Exported board files use ${effectiveConsoleUartId} as the board-wide UART console so all exported targets stay buildable.`;
  }

  return `${mcuLabel} ${reasonText}. Exported board files leave UART console disabled because no other enabled UART can serve every exported target.`;
}

function formatCommentBlock(note) {
  return `${note}`
    .split(" ")
    .reduce(
      (lines, word) => {
        const currentLine = lines[lines.length - 1];
        if (`${currentLine} ${word}`.trim().length > 72) {
          lines.push(`# ${word}`);
        } else {
          lines[lines.length - 1] = `${currentLine} ${word}`.trimEnd();
        }
        return lines;
      },
      ["#"],
    )
    .join("\n");
}

function getConsoleRoutingComment(mcu) {
  const note = getConsoleRoutingNote(mcu);
  if (!note) {
    return "";
  }

  return formatCommentBlock(note);
}

// Helper: get the DT node name for the exported board console UART
function getConsoleUartNodeName(mcu) {
  const consoleUartId = getEffectiveConsoleUartId(mcu);
  if (!consoleUartId || !state.deviceTreeTemplates) return null;
  const template = state.deviceTreeTemplates[consoleUartId];
  return template ? template.dtNodeName : null;
}

function omitsFlprConsoleForRamHeadroom(mcu) {
  return mcu === "nrf54l05";
}

function getFlprConsoleUartNodeName(mcu) {
  if (omitsFlprConsoleForRamHeadroom(mcu)) {
    return null;
  }

  return getConsoleUartNodeName(mcu);
}

function getFlprConsoleHeadroomNote(mcu) {
  if (!state.consoleUart || !omitsFlprConsoleForRamHeadroom(mcu)) {
    return null;
  }

  return "nRF54L05 FLPR builds drop the board-wide UART console in generated cpuflpr targets to stay within the 24 KB FLPR RAM budget on nRF Connect SDK main. CPUAPP targets keep the selected UART console.";
}

function getFlprConsoleHeadroomComment(mcu) {
  const note = getFlprConsoleHeadroomNote(mcu);
  return note ? formatCommentBlock(note) : "";
}

function getNsTfmSecureUartNodeName(mcu) {
  if (getFixedNsTfmSecureUartId(mcu)) {
    return null;
  }

  return getConsoleUartNodeName(mcu);
}

function usesFixedNsTfmSecureUartRouting(mcu) {
  return getFixedNsTfmSecureUartId(mcu) !== null;
}

function getConsoleTfmSecureUartChoice(mcu) {
  const consoleNodeName = getNsTfmSecureUartNodeName(mcu);
  if (!consoleNodeName) {
    return null;
  }

  const match = consoleNodeName.match(/^uart(\d+)$/);
  return match ? `TFM_SECURE_UART${match[1]}` : null;
}

// Some MCUs have revision suffixes in their Zephyr DTSI filenames
function getMcuDtsiBaseName(mcu) {
  return mcu;
}

// Some MCUs have revision suffixes in their Zephyr SOC Kconfig symbols
// e.g. nrf54lm20a uses SOC_NRF54LM20A_ENGA_CPUAPP instead of SOC_NRF54LM20A_CPUAPP
function getMcuSocName(mcu) {
  return mcu.toUpperCase();
}

function currentPackageHasPort2Pins() {
  return Array.isArray(state.mcuData?.pins)
    ? state.mcuData.pins.some((pin) => /^P2\./.test(pin.name))
    : true;
}

function getFlprBuildLayout(mcu) {
  if (mcu === "nrf54l05") {
    return {
      mode: "native",
      flashKb: 30,
      ramKb: 24,
    };
  }

  if (mcu === "nrf54l10") {
    return {
      mode: "native",
      flashKb: 62,
      ramKb: 48,
    };
  }

  if (mcu === "nrf54lv10a") {
    return {
      mode: "native",
      flashKb: 64,
      ramKb: 64,
      xipFlashKb: 64,
      xipRamKb: 64,
      xipSramBase: "0x2001fc00",
    };
  }

  return {
    mode: "override",
    flashKb: 96,
    ramKb: 96,
    sramBase: "0x20028000",
    xipFlashKb: 96,
    xipRamKb: 68,
    xipSramBase: "0x2002f000",
  };
}

function getFlprPartitionManagerSramConfig(mcu) {
  if (mcu === "nrf54l05") {
    return {
      base: "0x20012000",
      size: "0x6000",
    };
  }

  if (mcu === "nrf54l10") {
    return {
      base: "0x20024000",
      size: "0xc000",
    };
  }

  return null;
}

function requiresDisabledVprLauncher(mcu) {
  return mcu === "nrf54l05" || mcu === "nrf54l10";
}

function generateCpuappPartitionSection(mcu) {
  if (mcu === "nrf54l05") {
    return `#include <nordic/${mcu}_partition.dtsi>`;
  }

  if (mcu === "nrf54lv10a") {
    return `&cpuapp_rram {
\tpartitions {
\t\tcompatible = "fixed-partitions";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tboot_partition: partition@0 {
\t\t\tlabel = "mcuboot";
\t\t\t/* FPROTECT allows maximum size of 62k */
\t\t\treg = <0x0 DT_SIZE_K(62)>;
\t\t};

\t\tslot0_partition: partition@10000 {
\t\t\tlabel = "image-0";
\t\t\treg = <0x10000 DT_SIZE_K(212)>;
\t\t};

\t\tslot1_partition: partition@7a000 {
\t\t\tlabel = "image-1";
\t\t\treg = <0x7a000 DT_SIZE_K(212)>;
\t\t};

\t\tstorage_partition: partition@e4000 {
\t\t\tlabel = "storage";
\t\t\treg = <0xe4000 DT_SIZE_K(36)>;
\t\t};
\t};
};`;
  }

  return `#include <vendor/nordic/${mcu}_cpuapp_partition.dtsi>`;
}

function getNsPartitionInclude(mcu) {
  if (mcu === "nrf54lv10a") {
    return `#include <nordic/${mcu}_cpuapp_ns_partition.dtsi>`;
  }

  return `#include <vendor/nordic/${mcu}_cpuapp_ns_partition.dtsi>`;
}

export function generatePinctrlFile() {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 * SPDX-License-Identifier: Apache-2.0
 */

&pinctrl {
`;

  state.selectedPeripherals.forEach((p) => {
    const template = state.deviceTreeTemplates[p.id];
    if (!template) {
      return;
    }
    content += generatePinctrlForPeripheral(p, template);
  });

  content += "};\n";
  return content;
}

export function generateCommonDtsi(mcu) {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${state.boardInfo.name}_${mcu}-pinctrl.dtsi"

`;

  if (mcu === "nrf54lv10a") {
    content += `/ {
\taliases {
\t\twatchdog0 = &wdt31;
\t};

\tnrf_mpc: memory@50041000 {
\t\tcompatible = "nordic,nrf-mpc";
\t\treg = <0x50041000 0x1000>;
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\toverride-num = <5>;
\t\toverride-granularity = <4096>;
\t};
};

`;
  }

  state.selectedPeripherals.forEach((p) => {
    if (p.config && p.config.loadCapacitors) return;
    if (p.type === "GPIO") return;

    const template = state.deviceTreeTemplates[p.id];
    if (!template) return;
    content += generatePeripheralNode(p, template);
  });

  const gpioPins = state.selectedPeripherals.filter((p) => p.type === "GPIO");
  if (gpioPins.length > 0) {
    content += generateGpioNodes(gpioPins);
  }

  return content;
}

function generateGpioNodes(gpioPins) {
  let content = "\n/ {\n";

  gpioPins.forEach((gpio) => {
    if (!gpio.pin) {
      return;
    }

    const pinInfo = parsePinName(gpio.pin);
    if (!pinInfo) {
      return;
    }

    const activeFlag =
      gpio.activeState === "active-low"
        ? "GPIO_ACTIVE_LOW"
        : "GPIO_ACTIVE_HIGH";

    content += `\t${gpio.label}: ${gpio.label} {\n`;
    content += `\t\tgpios = <&gpio${pinInfo.port} ${pinInfo.pin} ${activeFlag}>;\n`;
    content += `\t};\n`;
  });

  content += "};\n";
  return content;
}

export function generateCpuappCommonDtsi(mcu) {
  const baseInclude =
    mcu === "nrf54lv10a" ? `#include <nordic/${mcu}_cpuapp.dtsi>\n` : "";

  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* This file is common to the secure and non-secure domain */

${baseInclude}#include "${state.boardInfo.name}_common.dtsi"

/ {
\tchosen {
`;

  // Use the exported board console UART instead of first-found UART
  const consoleNodeName = getConsoleUartNodeName(mcu);
  if (consoleNodeName) {
    content += `\t\tzephyr,console = &${consoleNodeName};\n`;
    content += `\t\tzephyr,shell-uart = &${consoleNodeName};\n`;
    content += `\t\tzephyr,uart-mcumgr = &${consoleNodeName};\n`;
    content += `\t\tzephyr,bt-mon-uart = &${consoleNodeName};\n`;
    content += `\t\tzephyr,bt-c2h-uart = &${consoleNodeName};\n`;
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
`;

  // Add LFXO configuration if enabled
  const lfxo = state.selectedPeripherals.find((p) => p.id === "LFXO");
  if (lfxo && lfxo.config) {
    content += `
&lfxo {
\tload-capacitors = "${lfxo.config.loadCapacitors}";`;
    if (
      lfxo.config.loadCapacitors === "internal" &&
      lfxo.config.loadCapacitanceFemtofarad
    ) {
      content += `
\tload-capacitance-femtofarad = <${lfxo.config.loadCapacitanceFemtofarad}>;`;
    }
    content += `
};
`;
  }

  // HFXO (always present)
  const hfxo = state.selectedPeripherals.find((p) => p.id === "HFXO");
  const hfxoConfig =
    hfxo && hfxo.config
      ? hfxo.config
      : { loadCapacitors: "internal", loadCapacitanceFemtofarad: 15000 };
  content += `
&hfxo {
\tload-capacitors = "${hfxoConfig.loadCapacitors}";`;
  if (
    hfxoConfig.loadCapacitors === "internal" &&
    hfxoConfig.loadCapacitanceFemtofarad
  ) {
    content += `
\tload-capacitance-femtofarad = <${hfxoConfig.loadCapacitanceFemtofarad}>;`;
  }
  content += `
};
`;

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

`;

  if (currentPackageHasPort2Pins()) {
    content += `
&gpio2 {
\tstatus = "okay";
};
`;
  }

  content += `

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

export function generateMainDts(mcu, supportsNS) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const dtsiBase = getMcuDtsiBaseName(mcu);
  const partitionSection = generateCpuappPartitionSection(mcu);
  const baseInclude =
    mcu === "nrf54lv10a" ? "" : `#include <nordic/${dtsiBase}_cpuapp.dtsi>\n`;
  return `/dts-v1/;

${baseInclude}#include "${mcu}_cpuapp_common.dtsi"

/ {
\tcompatible = "${state.boardInfo.vendor},${state.boardInfo.name}-${mcu}-cpuapp";
\tmodel = "${state.boardInfo.fullName} ${mcuUpper} Application MCU";

\tchosen {
\t\tzephyr,code-partition = &slot0_partition;
\t\tzephyr,sram = &cpuapp_sram;
\t};
};

/* Include default memory partition configuration file */
${partitionSection}
`;
}

export function generateYamlCapabilities(mcu, isNonSecure) {
  const supportedFeatures = new Set();

  state.selectedPeripherals.forEach((p) => {
    const template = state.deviceTreeTemplates[p.id];
    if (template) {
      switch (template.type) {
        case "UART":
          supportedFeatures.add("uart");
          break;
        case "SPI":
          supportedFeatures.add("spi");
          break;
        case "I2C":
          supportedFeatures.add("i2c");
          break;
        case "PWM":
          supportedFeatures.add("pwm");
          break;
        case "ADC":
          supportedFeatures.add("adc");
          break;
        case "NFCT":
          supportedFeatures.add("nfc");
          break;
      }
    }
  });

  supportedFeatures.add("gpio");
  supportedFeatures.add("watchdog");

  const featuresArray = Array.from(supportedFeatures).sort();

  const identifier = isNonSecure
    ? `${state.boardInfo.name}/${mcu}/cpuapp/ns`
    : `${state.boardInfo.name}/${mcu}/cpuapp`;
  const name = isNonSecure
    ? `${state.boardInfo.fullName}-Non-Secure`
    : state.boardInfo.fullName;
  const ram = isNonSecure ? 256 : 188;
  const flash = isNonSecure ? 1524 : 1428;

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
${featuresArray.map((f) => `  - ${f}`).join("\n")}
vendor: ${state.boardInfo.vendor}
`;
}

export function generateDefconfig(isNonSecure, mcu) {
  const hasConsoleUart = getEffectiveConsoleUartId(mcu) !== null;
  const consoleRoutingComment = getConsoleRoutingComment(mcu);

  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

`;

  if (isNonSecure) {
    const tfmSecureUartChoice = getConsoleTfmSecureUartChoice(mcu);

    config += `# Enable MPU
CONFIG_ARM_MPU=y
CONFIG_NULL_POINTER_EXCEPTION_DETECTION_NONE=y

# Enable TrustZone-M
CONFIG_ARM_TRUSTZONE_M=y

# This Board implies building Non-Secure firmware
CONFIG_TRUSTED_EXECUTION_NONSECURE=y

# Use devicetree code partition for TF-M
CONFIG_USE_DT_CODE_PARTITION=y
`;

    if (consoleRoutingComment) {
      config += `
${consoleRoutingComment}
`;
    }

    if (hasConsoleUart) {
      config += `
# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y
`;
    }

    config += `
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
`;

    if (hasConsoleUart && tfmSecureUartChoice) {
      config += `
# Use the selected UART instance for TF-M secure logging
CONFIG_TFM_LOG_LEVEL_SILENCE=n
CONFIG_TFM_SECURE_UART=y
CONFIG_${tfmSecureUartChoice}=y
`;
    } else if (hasConsoleUart && usesFixedNsTfmSecureUartRouting(mcu)) {
      const mcuLabel =
        mcu === "nrf54l10"
          ? "nRF54L10"
          : mcu === "nrf54lv10a"
            ? "nRF54LV10A"
            : mcu === "nrf54lm20a"
              ? "nRF54LM20A"
              : mcu === "nrf54l15"
                ? "nRF54L15"
                : mcu;
      config += `
# ${mcuLabel} TF-M secure UART selection is fixed inside the
# nRF Connect SDK TF-M CMake configuration.
# Pin Planner cannot override that from generated board files,
# so leave TF-M UART logging disabled in the export.
CONFIG_TFM_LOG_LEVEL_SILENCE=y
CONFIG_TFM_SECURE_UART=n
`;
    } else {
      config += `
# RTT-only boards do not expose a secure UART for TF-M logging
CONFIG_TFM_LOG_LEVEL_SILENCE=y
CONFIG_TFM_SECURE_UART=n
`;
    }

    config += `
# The oscillators are configured as secure and cannot be configured
# from the non secure application directly. This needs to be set
# otherwise nrfx will try to configure them, resulting in a bus
# fault.
CONFIG_NRF_SKIP_CLOCK_CONFIG=y
`;
  } else {
    if (consoleRoutingComment) {
      config += `${consoleRoutingComment}\n\n`;
    }

    if (hasConsoleUart) {
      config += `# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

`;
    }

    config += `# Enable GPIO
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
    } else {
      // nrf54l05/10/15 use RC oscillator when no LFXO configured
      const lfxoEnabled = state.selectedPeripherals.some(
        (p) => p.id === "LFXO",
      );
      if (!lfxoEnabled) {
        config += `
# Use RC oscillator for low-frequency clock
CONFIG_CLOCK_CONTROL_NRF_K32SRC_RC=y
`;
      }
    }
  }

  return config;
}

export function generateNSDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const dtsiBase = getMcuDtsiBaseName(mcu);
  const tfmSecureUartNodeName = getNsTfmSecureUartNodeName(mcu);

  // MCUs that have a dedicated _cpuapp_ns.dtsi file in Zephyr
  const hasNsDtsi = mcu === "nrf54l15" || mcu === "nrf54l10";

  // NS header: some MCUs have a dedicated _cpuapp_ns.dtsi, others just
  // use the common DTSI with USE_NON_SECURE_ADDRESS_MAP define
  let nsIncludes;
  if (hasNsDtsi) {
    nsIncludes = `#include <arm/nordic/${dtsiBase}_cpuapp_ns.dtsi>
#include "${mcu}_cpuapp_common.dtsi"`;
  } else if (mcu === "nrf54lm20a") {
    nsIncludes = `#include <nordic/${dtsiBase}_cpuapp.dtsi>
#include "${mcu}_cpuapp_common.dtsi"`;
  } else {
    nsIncludes = `#include "${mcu}_cpuapp_common.dtsi"`;
  }

  let peripheralDisableSection = "";

  if (tfmSecureUartNodeName) {
    peripheralDisableSection += `
&${tfmSecureUartNodeName} {
\t/* Disable so that TF-M can use this UART */
\tstatus = "disabled";
};
`;
  }

  // nrf54lm20a also needs BT controller disabled in NS
  if (mcu === "nrf54lm20a") {
    peripheralDisableSection = `
&bt_hci_controller {
\tstatus = "disabled";
};
${peripheralDisableSection}`;
  }

  return `/dts-v1/;

#define USE_NON_SECURE_ADDRESS_MAP 1

${nsIncludes}

/ {
\tcompatible = "${state.boardInfo.vendor},${state.boardInfo.name}-${mcu}-cpuapp";
\tmodel = "${state.boardInfo.fullName} ${mcuUpper} Application MCU";

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
${getNsPartitionInclude(mcu)}
`;
}

export function generateFLPRDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const flprLayout = getFlprBuildLayout(mcu);

  // Use the exported board console UART instead of hardcoded uart30
  const consoleNodeName = getFlprConsoleUartNodeName(mcu);
  let chosenUartLines = "";
  let uartStatusSection = "";

  if (consoleNodeName) {
    chosenUartLines = `\t\tzephyr,console = &${consoleNodeName};\n\t\tzephyr,shell-uart = &${consoleNodeName};\n`;
    uartStatusSection = `\n&${consoleNodeName} {\n\tstatus = "okay";\n};\n`;
  }

  if (mcu === "nrf54lv10a") {
    let content = `/dts-v1/;
#include <nordic/${getMcuDtsiBaseName(mcu)}_cpuflpr.dtsi>
#include "${state.boardInfo.name}_common.dtsi"

/ {
\tmodel = "${state.boardInfo.fullName} ${mcuUpper} FLPR MCU";
\tcompatible = "${state.boardInfo.vendor},${state.boardInfo.name}-${mcu}-cpuflpr";

\tchosen {
${chosenUartLines}\t\tzephyr,code-partition = &cpuflpr_code_partition;
\t\tzephyr,flash = &cpuflpr_rram;
\t\tzephyr,sram = &cpuflpr_sram;
\t};
};

&cpuflpr_sram {
\tstatus = "okay";
};

&cpuflpr_rram {
\tpartitions {
\t\tcompatible = "fixed-partitions";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tcpuflpr_code_partition: partition@0 {
\t\t\tlabel = "image-0";
\t\t\treg = <0x0 DT_SIZE_K(64)>;
\t\t};
\t};
};

&grtc {
\towned-channels = <3 4>;
\tstatus = "okay";
};
${uartStatusSection}
&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};
`;

    return content;
  }

  if (flprLayout.mode === "native") {
    return `/dts-v1/;
#include <nordic/${getMcuDtsiBaseName(mcu)}_cpuflpr.dtsi>
#include "${state.boardInfo.name}_common.dtsi"

/ {
\tmodel = "${state.boardInfo.fullName} ${mcuUpper} FLPR MCU";
\tcompatible = "${state.boardInfo.vendor},${state.boardInfo.name}-${mcu}-cpuflpr";

\tchosen {
${chosenUartLines}\t\tzephyr,code-partition = &cpuflpr_code_partition;
\t\tzephyr,flash = &cpuflpr_rram;
\t\tzephyr,sram = &cpuflpr_sram;
\t};
};

&cpuflpr_sram {
\tstatus = "okay";
};

&cpuflpr_rram {
\tpartitions {
\t\tcompatible = "fixed-partitions";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tcpuflpr_code_partition: partition@0 {
\t\t\tlabel = "image-0";
\t\t\treg = <0x0 DT_SIZE_K(${flprLayout.flashKb})>;
\t\t};
\t};
};

&grtc {
\towned-channels = <3 4>;
\tstatus = "okay";
};
${uartStatusSection}
&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

${currentPackageHasPort2Pins() ? `\n&gpio2 {\n\tstatus = "okay";\n};\n` : ""}

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};
`;
  }

  return `/dts-v1/;
#include <nordic/${getMcuDtsiBaseName(mcu)}_cpuflpr.dtsi>
#include "${state.boardInfo.name}_common.dtsi"

/delete-node/ &cpuflpr_sram;

/ {
\tmodel = "${state.boardInfo.fullName} ${mcuUpper} FLPR MCU";
\tcompatible = "${state.boardInfo.vendor},${state.boardInfo.name}-${mcu}-cpuflpr";

\tchosen {
${chosenUartLines}\t\tzephyr,code-partition = &cpuflpr_code_partition;
\t\tzephyr,flash = &cpuflpr_rram;
\t\tzephyr,sram = &cpuflpr_sram;
\t};

\tcpuflpr_sram: memory@${flprLayout.sramBase.slice(2)} {
\t\tcompatible = "mmio-sram";
\t\t/* Size must be increased due to booting from SRAM */
\t\treg = <${flprLayout.sramBase} DT_SIZE_K(${flprLayout.ramKb})>;
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges = <0x0 ${flprLayout.sramBase} ${flprLayout.ramKb * 1024}>;
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
\t\t\treg = <0x0 DT_SIZE_K(${flprLayout.flashKb})>;
\t\t};
\t};
};

&grtc {
\towned-channels = <3 4>;
\tstatus = "okay";
};
${uartStatusSection}
&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

${currentPackageHasPort2Pins() ? `\n&gpio2 {\n\tstatus = "okay";\n};\n` : ""}

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};
`;
}

export function generateFLPRXIPDts(mcu) {
  const flprLayout = getFlprBuildLayout(mcu);

  return `/*
 * Copyright (c) 2025 Generated by nRF54L Pin Planner
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${state.boardInfo.name}_${mcu}_cpuflpr.dts"

&cpuflpr_sram {
\treg = <${flprLayout.xipSramBase} DT_SIZE_K(${flprLayout.xipRamKb})>;
\tranges = <0x0 ${flprLayout.xipSramBase} ${flprLayout.xipRamKb * 1024}>;
};
`;
}

export function generateFLPRYaml(mcu, isXIP) {
  const flprLayout = getFlprBuildLayout(mcu);
  const identifier = isXIP
    ? `${state.boardInfo.name}/${mcu}/cpuflpr/xip`
    : `${state.boardInfo.name}/${mcu}/cpuflpr`;
  const name = isXIP
    ? `${state.boardInfo.fullName}-Fast-Lightweight-Peripheral-Processor (RRAM XIP)`
    : `${state.boardInfo.fullName}-Fast-Lightweight-Peripheral-Processor`;
  const ram = isXIP ? flprLayout.xipRamKb : flprLayout.ramKb;
  const flash = isXIP ? flprLayout.xipFlashKb : flprLayout.flashKb;

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
flash: ${flash}
supported:
  - counter
  - gpio
  - i2c
  - spi
  - watchdog
`;
}

export function generateFLPRDefconfig(isXIP, mcu) {
  // Only enable UART configs if the exported board resolves a console UART
  const hasConsoleUart = getFlprConsoleUartNodeName(mcu) !== null;
  const consoleRoutingComment = getConsoleRoutingComment(mcu);
  const flprConsoleHeadroomComment = getFlprConsoleHeadroomComment(mcu);

  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

`;

  if (consoleRoutingComment) {
    config += `${consoleRoutingComment}\n\n`;
  }

  if (flprConsoleHeadroomComment) {
    config += `${flprConsoleHeadroomComment}\n\n`;
  }

  if (hasConsoleUart) {
    config += `# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

`;
  }

  config += `# Enable GPIO
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

export function generateBoardYml(mcu, supportsNS, supportsFLPR) {
  const supportsFLPRXIP = supportsFLPR && getMcuSupportsFLPRXIP(mcu);
  let socSection = `  socs:
    - name: ${mcu}`;

  if (supportsNS || supportsFLPRXIP) {
    socSection += `
      variants:`;
    if (supportsFLPRXIP) {
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

  let boardsList = `${state.boardInfo.name}/${mcu}/cpuapp`;
  if (supportsNS) {
    boardsList += `
              - ${state.boardInfo.name}/${mcu}/cpuapp/ns`;
  }
  if (supportsFLPR) {
    boardsList += `
              - ${state.boardInfo.name}/${mcu}/cpuflpr`;
  }
  if (supportsFLPRXIP) {
    boardsList += `
              - ${state.boardInfo.name}/${mcu}/cpuflpr/xip`;
  }

  return `board:
  name: ${state.boardInfo.name}
  full_name: ${state.boardInfo.fullName}
  vendor: ${state.boardInfo.vendor}
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

export function generateBoardCmake(mcu, supportsNS, supportsFLPR) {
  const mcuUpper = mcu.toUpperCase();
  const boardNameUpper = state.boardInfo.name.toUpperCase();

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

export function generateKconfigTrustZone(mcu) {
  const boardNameUpper = state.boardInfo.name.toUpperCase();
  const mcuUpper = mcu.toUpperCase();
  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# ${state.boardInfo.fullName} board configuration

if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

DT_NRF_MPC := $(dt_nodelabel_path,nrf_mpc)

config NRF_TRUSTZONE_FLASH_REGION_SIZE
\thex
\tdefault $(dt_node_int_prop_hex,$(DT_NRF_MPC),override-granularity)
\thelp
\t  This defines the flash region size from the TrustZone perspective.
\t  It is used when configuring the TrustZone and when setting alignments
\t  requirements for the partitions.
\t  This abstraction allows us to configure TrustZone without depending
\t  on peripheral-specific symbols.

config NRF_TRUSTZONE_RAM_REGION_SIZE
\thex
\tdefault $(dt_node_int_prop_hex,$(DT_NRF_MPC),override-granularity)
\thelp
\t  This defines the RAM region size from the TrustZone perspective.
\t  It is used when configuring the TrustZone and when setting alignments
\t  requirements for the partitions.
\t  This abstraction allows us to configure TrustZone without depending
\t  on peripheral specific symbols.

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS
`;
}

export function generateKconfigDefconfig(mcu, supportsNS) {
  const boardNameUpper = state.boardInfo.name.toUpperCase();
  const mcuUpper = mcu.toUpperCase();
  const flprPmSramConfig = getFlprPartitionManagerSramConfig(mcu);

  let content = `# Copyright (c) 2024 Nordic Semiconductor ASA
# SPDX-License-Identifier: Apache-2.0
`;

  if (mcu === "nrf54lv10a") {
    content += `
config SOC_NRF54LX_SKIP_GLITCHDETECTOR_DISABLE
\tdefault y

config NRF_RRAM_WRITE_BUFFER_SIZE
\tdefault 16
`;
  }

  content += `

config HW_STACK_PROTECTION
\tdefault ARCH_HAS_STACK_PROTECTION

if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP

config ROM_START_OFFSET
\tdefault 0 if PARTITION_MANAGER_ENABLED
\tdefault 0x800 if BOOTLOADER_MCUBOOT

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP
`;

  if (flprPmSramConfig) {
    content += `

if BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR

config PM_SRAM_BASE
\tdefault ${flprPmSramConfig.base}

config PM_SRAM_SIZE
\tdefault ${flprPmSramConfig.size}

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR
`;
  }

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

export function generateKconfigBoard(mcu, supportsNS, supportsFLPR) {
  const boardNameUpper = state.boardInfo.name.toUpperCase();
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
    const flprSelectors = getMcuSupportsFLPRXIP(mcu)
      ? `BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR || \\
\t\t\t\t\t    BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR_XIP`
      : `BOARD_${boardNameUpper}_${mcuUpper}_CPUFLPR`;
    content += `\tselect SOC_${socBase}_CPUFLPR if ${flprSelectors}
`;
  }

  return content;
}

export function generateReadme(mcu, pkg, supportsNS, supportsFLPR) {
  const hasSpiDcxSelection = state.selectedPeripherals.some((p) =>
    Object.values(p.pinFunctions || {}).includes("DCX"),
  );
  const consoleRoutingNote = getConsoleRoutingNote(mcu);
  const flprConsoleHeadroomNote = getFlprConsoleHeadroomNote(mcu);
  const tfmCmakeNote =
    supportsNS &&
    usesFixedNsTfmSecureUartRouting(mcu) &&
    state.consoleUart !== null
      ? `For \`cpuapp/ns\` builds on ${
          mcu === "nrf54l10"
            ? "nRF54L10"
            : mcu === "nrf54lv10a"
              ? "nRF54LV10A"
              : mcu === "nrf54lm20a"
                ? "nRF54LM20A"
                : "nRF54L15"
        }, TF-M secure UART routing is chosen by nRF Connect SDK TF-M CMake. Pin Planner cannot override that from the generator, so TF-M UART logging stays disabled in the exported board files.`
      : "Review any TF-M, partition-manager, or board-runner settings required by your NCS version.";
  const supportsFLPRXIP = supportsFLPR && getMcuSupportsFLPRXIP(mcu);
  const flprBuildArgs = requiresDisabledVprLauncher(mcu)
    ? " -- -DSB_CONFIG_VPR_LAUNCHER=n"
    : "";

  let readme = `# ${state.boardInfo.fullName}

**Generated by:** nRF54L Pin Planner
**MCU:** ${mcu.toUpperCase()}
**Package:** ${pkg}
${state.boardInfo.revision ? `**Revision:** ${state.boardInfo.revision}\n` : ""}${state.boardInfo.description ? `\n${state.boardInfo.description}\n` : ""}

## Usage

1. Copy this directory to your Zephyr boards directory:
   \`\`\`bash
   cp -r ${state.boardInfo.name} $ZEPHYR_BASE/boards/${state.boardInfo.vendor}/
   \`\`\`

2. Build your application for this board:
   \`\`\`bash
   west build -b ${state.boardInfo.name}/${mcu}/cpuapp samples/hello_world
   \`\`\`
`;

  if (supportsNS) {
    readme += `
   Or build for Non-Secure target with TF-M:
   \`\`\`bash
   west build -b ${state.boardInfo.name}/${mcu}/cpuapp/ns samples/hello_world
   \`\`\`
`;
  }

  if (supportsFLPR) {
    readme += `
   Or build for FLPR (Fast Lightweight Processor):
   \`\`\`bash
   west build -b ${state.boardInfo.name}/${mcu}/cpuflpr samples/hello_world${flprBuildArgs}
   \`\`\`
`;
    if (supportsFLPRXIP) {
      readme += `

   Or build for FLPR with XIP (Execute In Place from RRAM):
   \`\`\`bash
   west build -b ${state.boardInfo.name}/${mcu}/cpuflpr/xip samples/hello_world
   \`\`\`
`;
    }
  }

  readme += `
3. Flash to your device:
   \`\`\`bash
   west flash
   \`\`\`

## Selected Peripherals

${state.selectedPeripherals
  .map((p) => {
    if (p.config) {
      const capLabel =
        p.config.loadCapacitors === "internal" ? "Internal" : "External";
      const oscData = state.mcuData.socPeripherals.find((sp) => sp.id === p.id);
      let info = `${capLabel} capacitors`;
      if (
        p.config.loadCapacitors === "internal" &&
        p.config.loadCapacitanceFemtofarad
      ) {
        info += `, ${(p.config.loadCapacitanceFemtofarad / 1000).toFixed(p.id === "HFXO" ? 2 : 1)} pF`;
      }
      if (oscData && oscData.signals && oscData.signals.length > 0) {
        const pins = oscData.signals
          .filter((s) => s.allowedGpio && s.allowedGpio.length > 0)
          .map((s) => s.allowedGpio[0])
          .join(", ");
        if (pins) {
          info += ` (${pins})`;
        }
      }
      return `- **${p.id}**: ${info}`;
    } else if (p.pinFunctions) {
      const pins = Object.entries(p.pinFunctions)
        .map(([pin, func]) => `${pin}: ${func}`)
        .join(", ");
      return `- **${p.id}**: ${pins}`;
    } else {
      return `- **${p.id}**`;
    }
  })
  .join("\n")}

## Pin Configuration

See \`${state.boardInfo.name}_${mcu}-pinctrl.dtsi\` for complete pin mapping.

## Notes

- This is a generated board definition. Verify pin assignments match your hardware.
- Modify \`${state.boardInfo.name}_common.dtsi\` to add additional peripherals or features.
- ${
    consoleRoutingNote ||
    "When you select a UART console, the exported board files keep one board-wide console choice that works across every generated target."
  }
- ${flprConsoleHeadroomNote || tfmCmakeNote}
- ${
    hasSpiDcxSelection
      ? "Selected SPI `DCX` pins are not described by Zephyr's generic board-level SPIM bindings. The generated board files keep the SPI controller buildable and leave `DCX` for an application or shield overlay."
      : "Add any application-specific SPI chip-select or display-control overlays required by your design."
  }
- ${
    requiresDisabledVprLauncher(mcu)
      ? "For nRF54L05 and nRF54L10 FLPR builds against nRF Connect SDK main, build custom FLPR board targets with `-DSB_CONFIG_VPR_LAUNCHER=n`. NCS main does not ship a matching VPR launcher snippet for these generated custom boards, and Pin Planner cannot supply that sysbuild CMake wiring from board files alone."
      : "Use the default VPR launcher flow for FLPR targets unless your application provides its own multi-image sysbuild setup."
  }
- Consult the [nRF Connect SDK documentation](https://docs.nordicsemi.com/) for more information.
`;

  return readme;
}

export function generatePinctrlForPeripheral(peripheral, template) {
  if (template.noPinctrl || template.type === "RADIO") {
    return "";
  }

  const pinctrlName = template.pinctrlBaseName;
  let content = `\n\t/omit-if-no-ref/ ${pinctrlName}_default: ${pinctrlName}_default {\n`;

  const outputSignals = [];
  const inputSignals = [];

  for (const [pinName, signalName] of Object.entries(peripheral.pinFunctions)) {
    if (
      template.type === "SPI" &&
      !["SCK", "SDO", "SDI"].includes(signalName)
    ) {
      continue;
    }

    const pinInfo = parsePinName(pinName);
    if (!pinInfo) continue;

    const dtSignalName = template.signalMappings[signalName];
    if (!dtSignalName) {
      continue;
    }

    const signal = peripheral.peripheral.signals.find(
      (s) => s.name === signalName,
    );
    if (signal && signal.direction === "input") {
      inputSignals.push({ pinInfo, dtSignalName });
    } else {
      outputSignals.push({ pinInfo, dtSignalName });
    }
  }

  const allSignals = [...outputSignals, ...inputSignals];

  if (allSignals.length === 0) {
    return "";
  }

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

  return content;
}

export function generatePeripheralNode(peripheral, template) {
  const nodeName = template.dtNodeName;
  const pinctrlName = template.pinctrlBaseName;

  let content = `\n&${nodeName} {\n`;
  content += `\tstatus = "okay";\n`;

  if (!template.noPinctrl && template.type !== "RADIO" && pinctrlName) {
    content += `\tpinctrl-0 = <&${pinctrlName}_default>;\n`;
    content += `\tpinctrl-1 = <&${pinctrlName}_sleep>;\n`;
    content += `\tpinctrl-names = "default", "sleep";\n`;
  }

  switch (template.type) {
    case "UART":
      content += `\tcurrent-speed = <115200>;\n`;
      if (peripheral.config && peripheral.config.disableRx) {
        content += `\tdisable-rx;\n`;
      }
      break;
    case "SPI":
      const dcxPin = Object.keys(peripheral.pinFunctions).find(
        (pin) => peripheral.pinFunctions[pin] === "DCX",
      );
      if (dcxPin) {
        const dcxPinInfo = parsePinName(dcxPin);
        if (dcxPinInfo) {
          content += `\t/* DCX pin: P${dcxPinInfo.port}.${dcxPinInfo.pin} (application or shield overlay required) */\n`;
        }
      }

      if (template.outOfBandSignals) {
        template.outOfBandSignals.forEach((signal) => {
          const pin = Object.keys(peripheral.pinFunctions).find(
            (p) => peripheral.pinFunctions[p] === signal,
          );
          if (pin) {
            const pinInfo = parsePinName(pin);
            if (pinInfo) {
              content += `\t/* ${signal} pin: P${pinInfo.port}.${pinInfo.pin} */\n`;
            }
          }
        });
      }

      const csGpioEntries = [];

      const csPin = Object.keys(peripheral.pinFunctions).find(
        (pin) => peripheral.pinFunctions[pin] === "CS",
      );
      if (csPin) {
        const csPinInfo = parsePinName(csPin);
        if (csPinInfo) {
          csGpioEntries.push(
            `<&gpio${csPinInfo.port} ${csPinInfo.pin} GPIO_ACTIVE_LOW>`,
          );
        }
      }

      if (peripheral.config && peripheral.config.extraCsGpios) {
        peripheral.config.extraCsGpios.forEach((gpio) => {
          const pinInfo = parsePinName(gpio);
          if (pinInfo) {
            csGpioEntries.push(
              `<&gpio${pinInfo.port} ${pinInfo.pin} GPIO_ACTIVE_LOW>`,
            );
          }
        });
      }

      if (csGpioEntries.length > 0) {
        if (csGpioEntries.length === 1) {
          content += `\tcs-gpios = ${csGpioEntries[0]};\n`;
        } else {
          content += `\tcs-gpios = ${csGpioEntries.join(",\n\t\t   ")};\n`;
        }
      }
      break;
    case "RADIO":
      Object.entries(peripheral.pinFunctions).forEach(([pin, signal]) => {
        const match = signal.match(/^RADIO\[(\d+)\]$/);
        const pinInfo = parsePinName(pin);
        if (!match || !pinInfo) {
          return;
        }

        content += `\tdfegpio${match[1]}-gpios = <&gpio${pinInfo.port} ${pinInfo.pin} 0>;\n`;
      });
      break;
    case "I2C":
      content += `\tclock-frequency = <I2C_BITRATE_STANDARD>;\n`;
      break;
  }

  content += `};\n`;
  return content;
}
