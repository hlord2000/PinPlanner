// --- DEVICETREE GENERATION ---

import state from "./state.js";
import { parsePinName } from "./utils.js";

export function getMcuSupportsNonSecure(mcuId) {
  const mcuInfo = state.mcuManifest.mcus.find((m) => m.id === mcuId);
  return mcuInfo ? mcuInfo.supportsNonSecure === true : false;
}

export function getMcuSupportsFLPR(mcuId) {
  const mcuInfo = state.mcuManifest.mcus.find((m) => m.id === mcuId);
  return mcuInfo ? mcuInfo.supportsFLPR === true : false;
}

// Helper: get the DT node name for the selected console UART
function getConsoleUartNodeName() {
  if (!state.consoleUart || !state.deviceTreeTemplates) return null;
  const template = state.deviceTreeTemplates[state.consoleUart];
  return template ? template.dtNodeName : null;
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
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* This file is common to the secure and non-secure domain */

#include "${state.boardInfo.name}_common.dtsi"

/ {
\tchosen {
`;

  // Use state.consoleUart instead of first-found UART
  const consoleNodeName = getConsoleUartNodeName();
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

  // Check NFC usage
  let nfcUsed = false;
  state.selectedPeripherals.forEach((p) => {
    const template = state.deviceTreeTemplates[p.id];
    if (template && template.type === "NFCT") {
      nfcUsed = true;
    }
  });

  if (!nfcUsed) {
    content += `
&uicr {
\tnfct-pins-as-gpios;
};
`;
  }

  return content;
}

export function generateMainDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  return `/dts-v1/;

#include <nordic/${mcu}_cpuapp.dtsi>
#include "${mcu}_cpuapp_common.dtsi"

/ {
\tcompatible = "${state.boardInfo.vendor},${state.boardInfo.name}-${mcu}-cpuapp";
\tmodel = "${state.boardInfo.fullName} ${mcuUpper} Application MCU";

\tchosen {
\t\tzephyr,code-partition = &slot0_partition;
\t\tzephyr,sram = &cpuapp_sram;
\t};
};

/* Include default memory partition configuration file */
#include <nordic/${mcu}_partition.dtsi>
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

export function generateDefconfig(isNonSecure) {
  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

`;

  if (isNonSecure) {
    config += `CONFIG_ARM_MPU=y
CONFIG_HW_STACK_PROTECTION=y
CONFIG_NULL_POINTER_EXCEPTION_DETECTION_NONE=y
CONFIG_ARM_TRUSTZONE_M=y

# This Board implies building Non-Secure firmware
CONFIG_TRUSTED_EXECUTION_NONSECURE=y

# Don't enable the cache in the non-secure image as it is a
# secure-only peripheral on 54l
CONFIG_CACHE_MANAGEMENT=n
CONFIG_EXTERNAL_CACHE=n

CONFIG_UART_CONSOLE=y
CONFIG_CONSOLE=y
CONFIG_SERIAL=y
CONFIG_GPIO=y

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
CONFIG_SOC_NRF54LX_SKIP_CLOCK_CONFIG=y
`;
  } else {
    // Use state.consoleUart to check if UART console is enabled
    const hasConsoleUart = state.consoleUart !== null;

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

# Enable hardware stack protection
CONFIG_HW_STACK_PROTECTION=y
`;

    const lfxoEnabled = state.selectedPeripherals.some((p) => p.id === "LFXO");
    if (!lfxoEnabled) {
      config += `
# Use RC oscillator for low-frequency clock
CONFIG_CLOCK_CONTROL_NRF_K32SRC_RC=y
`;
    }
  }

  return config;
}

export function generateNSDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");

  // Use state.consoleUart instead of first-found UART
  const uartNodeName = getConsoleUartNodeName();

  let uartDisableSection = "";
  if (uartNodeName) {
    uartDisableSection = `
&${uartNodeName} {
\t/* Disable so that TF-M can use this UART */
\tstatus = "disabled";

\tcurrent-speed = <115200>;
\tpinctrl-0 = <&${uartNodeName.replace(/uart/, "uart")}_default>;
\tpinctrl-1 = <&${uartNodeName.replace(/uart/, "uart")}_sleep>;
\tpinctrl-names = "default", "sleep";
};

`;
  }

  return `/dts-v1/;

#define USE_NON_SECURE_ADDRESS_MAP 1

#include <nordic/${mcu}_cpuapp.dtsi>
#include "${mcu}_cpuapp_common.dtsi"

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

/ {
\t/*
\t * Default SRAM planning when building for ${mcuUpper} with ARM TrustZone-M support
\t * - Lowest 80 kB SRAM allocated to Secure image (sram0_s).
\t * - Upper 80 kB SRAM allocated to Non-Secure image (sram0_ns).
\t *
\t * ${mcuUpper} has 256 kB of volatile memory (SRAM) but the last 96kB are reserved for
\t * the FLPR MCU.
\t * This static layout needs to be the same with the upstream TF-M layout in the
\t * header flash_layout.h of the relevant platform. Any updates in the layout
\t * needs to happen both in the flash_layout.h and in this file at the same time.
\t */
\treserved-memory {
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tsram0_s: image_s@20000000 {
\t\t\t/* Secure image memory */
\t\t\treg = <0x20000000 DT_SIZE_K(80)>;
\t\t};

\t\tsram0_ns: image_ns@20014000 {
\t\t\t/* Non-Secure image memory */
\t\t\treg = <0x20014000 DT_SIZE_K(80)>;
\t\t};
\t};
};

${uartDisableSection}/* Include default memory partition configuration file */
#include <nordic/${mcu}_ns_partition.dtsi>
`;
}

export function generateFLPRDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");

  // Use selected console UART instead of hardcoded uart30
  const consoleNodeName = getConsoleUartNodeName();
  let chosenUartLines = "";
  let uartStatusSection = "";

  if (consoleNodeName) {
    chosenUartLines = `\t\tzephyr,console = &${consoleNodeName};\n\t\tzephyr,shell-uart = &${consoleNodeName};\n`;
    uartStatusSection = `\n&${consoleNodeName} {\n\tstatus = "okay";\n};\n`;
  }

  return `/dts-v1/;
#include <nordic/${mcu}_cpuflpr.dtsi>
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
\t/* size must be increased due to booting from SRAM */
\treg = <0x20028000 DT_SIZE_K(96)>;
\tranges = <0x0 0x20028000 0x18000>;
};

&cpuflpr_rram {
\tpartitions {
\t\tcompatible = "fixed-partitions";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;

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
${uartStatusSection}
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

export function generateFLPRXIPDts(mcu) {
  return `/*
 * Copyright (c) 2025 Generated by nRF54L Pin Planner
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${state.boardInfo.name}_${mcu}_cpuflpr.dts"

&cpuflpr_sram {
\treg = <0x2002f000 DT_SIZE_K(68)>;
\tranges = <0x0 0x2002f000 0x11000>;
};
`;
}

export function generateFLPRYaml(mcu, isXIP) {
  const identifier = isXIP
    ? `${state.boardInfo.name}/${mcu}/cpuflpr/xip`
    : `${state.boardInfo.name}/${mcu}/cpuflpr`;
  const name = isXIP
    ? `${state.boardInfo.fullName}-Fast-Lightweight-Peripheral-Processor (RRAM XIP)`
    : `${state.boardInfo.fullName}-Fast-Lightweight-Peripheral-Processor`;
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

export function generateFLPRDefconfig(isXIP) {
  // Only enable UART configs if a console UART is selected
  const hasConsoleUart = state.consoleUart !== null;

  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

`;

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

${isXIP ? "# Execute from RRAM\nCONFIG_XIP=y" : "# Execute from SRAM\nCONFIG_USE_DT_CODE_PARTITION=y\nCONFIG_XIP=n"}
`;

  return config;
}

export function generateBoardYml(mcu, supportsNS, supportsFLPR) {
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

  let boardsList = `${state.boardInfo.name}/${mcu}/cpuapp`;
  if (supportsNS) {
    boardsList += `
              - ${state.boardInfo.name}/${mcu}/cpuapp/ns`;
  }
  if (supportsFLPR) {
    boardsList += `
              - ${state.boardInfo.name}/${mcu}/cpuflpr
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

config BT_CTLR
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

export function generateKconfigBoard(mcu, supportsNS) {
  const boardNameUpper = state.boardInfo.name.toUpperCase();
  const mcuUpper = mcu.toUpperCase();

  let selectCondition = `BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP`;
  if (supportsNS) {
    selectCondition += ` || BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS`;
  }

  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

config BOARD_${boardNameUpper}
\tselect SOC_${mcuUpper}_CPUAPP if ${selectCondition}
`;
}

export function generateReadme(mcu, pkg, supportsNS, supportsFLPR) {
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
   west build -b ${state.boardInfo.name}/${mcu}/cpuflpr samples/hello_world
   \`\`\`

   Or build for FLPR with XIP (Execute In Place from RRAM):
   \`\`\`bash
   west build -b ${state.boardInfo.name}/${mcu}/cpuflpr/xip samples/hello_world
   \`\`\`
`;
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
- Consult the [nRF Connect SDK documentation](https://docs.nordicsemi.com/) for more information.
`;

  return readme;
}

export function generatePinctrlForPeripheral(peripheral, template) {
  if (template.noPinctrl) {
    return "";
  }

  const pinctrlName = template.pinctrlBaseName;
  let content = `\n\t/omit-if-no-ref/ ${pinctrlName}_default: ${pinctrlName}_default {\n`;

  const outputSignals = [];
  const inputSignals = [];

  for (const [pinName, signalName] of Object.entries(peripheral.pinFunctions)) {
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

  if (!template.noPinctrl && pinctrlName) {
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
    case "I2C":
      content += `\tclock-frequency = <I2C_BITRATE_STANDARD>;\n`;
      break;
  }

  content += `};\n`;
  return content;
}
