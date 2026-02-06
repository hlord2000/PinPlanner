// --- DEVKIT CONFIGURATION LOADING ---

import state from "./state.js";
import { applyConfig, saveStateToLocalStorage, resetState } from "./state.js";
import { reinitializeView, handleMcuChange } from "./mcu-loader.js";
import { organizePeripherals } from "./peripherals.js";
import { updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { updateConsoleConfig } from "./console-config.js";
import { showToast } from "./ui/notifications.js";

export async function loadDevkitConfig(boardName) {
  if (!boardName) {
    // Reset to custom board mode
    state.devkitConfig = null;
    const notice = document.querySelector(".devkit-eval-notice");
    if (notice) notice.style.display = "none";
    const versionEl = document.getElementById("devkitZephyrVersion");
    if (versionEl) versionEl.style.display = "none";
    return;
  }

  try {
    const response = await fetch(`devkits/${boardName}.json`);
    if (!response.ok) {
      throw new Error(`Devkit config not found: ${boardName}`);
    }
    const devkitData = await response.json();
    state.devkitConfig = devkitData;

    // Show evaluation notice and version
    const notice = document.querySelector(".devkit-eval-notice");
    if (notice) notice.style.display = "";
    const versionEl = document.getElementById("devkitZephyrVersion");
    if (versionEl) {
      versionEl.textContent = `Based on Zephyr v${devkitData.zephyrVersion}`;
      versionEl.style.display = "";
    }

    // Auto-select matching MCU/package if needed
    if (devkitData.supportedMcus && devkitData.supportedMcus.length > 0) {
      const mcuSelector = document.getElementById("mcuSelector");
      const currentMcu = mcuSelector.value;
      if (!devkitData.supportedMcus.includes(currentMcu)) {
        mcuSelector.value = devkitData.supportedMcus[0];
        await handleMcuChange();
      }
    }

    if (devkitData.package) {
      const packageSelector = document.getElementById("packageSelector");
      const pkgOption = Array.from(packageSelector.options).find(
        (opt) => opt.value === devkitData.package,
      );
      if (pkgOption && packageSelector.value !== devkitData.package) {
        packageSelector.value = devkitData.package;
        // Trigger reload
        const { loadCurrentMcuData } = await import("./mcu-loader.js");
        await loadCurrentMcuData();
      }
    }

    // Apply devkit peripherals
    applyDevkitConfig(devkitData);

    showToast(`Loaded ${devkitData.description} configuration`, "info");
  } catch (error) {
    console.error("Failed to load devkit config:", error);
    showToast(`Failed to load devkit config: ${error.message}`, "warning");
    state.devkitConfig = null;
  }
}

function applyDevkitConfig(devkitData) {
  // Build a config object compatible with applyConfig
  const peripheralConfigs = [];

  if (devkitData.peripherals) {
    devkitData.peripherals.forEach((p) => {
      const pinFunctions = {};
      if (p.signals) {
        Object.entries(p.signals).forEach(([signalName, pinName]) => {
          pinFunctions[pinName] = signalName;
        });
      }
      peripheralConfigs.push({
        id: p.id,
        pinFunctions,
      });

      // Set console UART
      if (p.isConsole) {
        state.consoleUart = p.id;
      }
    });
  }

  // Apply oscillator configs
  if (devkitData.oscillators) {
    if (devkitData.oscillators.hfxo) {
      peripheralConfigs.push({
        id: "HFXO",
        config: devkitData.oscillators.hfxo,
      });
    }
    if (devkitData.oscillators.lfxo) {
      peripheralConfigs.push({
        id: "LFXO",
        config: devkitData.oscillators.lfxo,
      });
    }
  }

  applyConfig({ selectedPeripherals: peripheralConfigs });

  // Mark devkit GPIO pins
  if (devkitData.gpios) {
    devkitData.gpios.forEach((gpio) => {
      state.selectedPeripherals.push({
        id: `GPIO_${gpio.label.toUpperCase()}`,
        type: "GPIO",
        label: gpio.label,
        pin: gpio.pin,
        activeState: gpio.activeState,
      });
      state.usedPins[gpio.pin] = {
        peripheral: `GPIO_${gpio.label.toUpperCase()}`,
        function: "GPIO",
        required: true,
        isDevkit: true,
      };
    });
  }

  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
  saveStateToLocalStorage();
}

export function isDevkitMode() {
  return state.devkitConfig !== null;
}

export function getDevkitConfig() {
  return state.devkitConfig;
}
