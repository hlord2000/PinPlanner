// --- MCU/PACKAGE LOADING AND INITIALIZATION ---

import state from "./state.js";
import {
  resetState,
  loadStateFromLocalStorage,
  saveStateToLocalStorage,
} from "./state.js";
import {
  organizePeripherals,
  addOscillatorsToPeripherals,
  autoSelectHFXO,
} from "./peripherals.js";
import { getDevicetreeExportUnsupportedReason } from "./mcu-manifest.js";
import { createPinLayout, updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { updateConsoleConfig } from "./console-config.js";
import { updateExportButtonState } from "./export.js";

function mergePackageData(baseData, overrideData) {
  const merged = {
    ...baseData,
    ...overrideData,
  };

  if (baseData.partInfo || overrideData.partInfo) {
    merged.partInfo = {
      ...(baseData.partInfo || {}),
      ...(overrideData.partInfo || {}),
    };
  }

  if (baseData.renderConfig || overrideData.renderConfig) {
    const baseRenderConfig = baseData.renderConfig || {};
    const overrideRenderConfig = overrideData.renderConfig || {};

    merged.renderConfig = {
      ...baseRenderConfig,
      ...overrideRenderConfig,
      canvasDefaults: {
        ...(baseRenderConfig.canvasDefaults || {}),
        ...(overrideRenderConfig.canvasDefaults || {}),
      },
      chipBody: {
        ...(baseRenderConfig.chipBody || {}),
        ...(overrideRenderConfig.chipBody || {}),
      },
      pinDefaults: {
        ...(baseRenderConfig.pinDefaults || {}),
        ...(overrideRenderConfig.pinDefaults || {}),
      },
      layoutStrategy: {
        ...(baseRenderConfig.layoutStrategy || {}),
        ...(overrideRenderConfig.layoutStrategy || {}),
      },
    };
  }

  delete merged.extends;
  return merged;
}

function normalizePackageData(packageData) {
  if (
    !Array.isArray(packageData.pins) ||
    !Array.isArray(packageData.socPeripherals)
  ) {
    return packageData;
  }

  const availablePins = new Set(packageData.pins.map((pin) => pin.name));

  return {
    ...packageData,
    socPeripherals: packageData.socPeripherals.map((peripheral) => ({
      ...peripheral,
      signals: Array.isArray(peripheral.signals)
        ? peripheral.signals.map((signal) => ({
            ...signal,
            allowedGpio: Array.isArray(signal.allowedGpio)
              ? signal.allowedGpio.filter(
                  (gpio) => gpio.endsWith("*") || availablePins.has(gpio),
                )
              : signal.allowedGpio,
          }))
        : peripheral.signals,
    })),
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`File not found or invalid: ${new URL(url).pathname}`);
  }

  return response.json();
}

async function loadResolvedPackageData(url, seen = new Set()) {
  const absoluteUrl = new URL(url, window.location.href).href;
  if (seen.has(absoluteUrl)) {
    throw new Error(
      `Circular package extends chain detected at ${absoluteUrl}`,
    );
  }

  seen.add(absoluteUrl);

  const data = await fetchJson(absoluteUrl);
  if (!data.extends) {
    return normalizePackageData(data);
  }

  const parentUrl = new URL(data.extends, absoluteUrl).href;
  const parentData = await loadResolvedPackageData(parentUrl, seen);
  return normalizePackageData(mergePackageData(parentData, data));
}

export async function initializeApp() {
  try {
    const response = await fetch("mcus/manifest.json");
    if (!response.ok) throw new Error("Manifest file not found.");
    state.mcuManifest = await response.json();
    populateMcuSelector();
  } catch (error) {
    console.error("Failed to initialize application:", error);
    alert(
      "Could not load MCU manifest. The application may not function correctly.",
    );
  }
}

export function populateMcuSelector() {
  const mcuSelector = document.getElementById("mcuSelector");
  mcuSelector.innerHTML = "";
  state.mcuManifest.mcus.forEach((mcu) => {
    const option = document.createElement("option");
    option.value = mcu.id;
    option.textContent = mcu.name;
    option.dataset.packages = JSON.stringify(mcu.packages);
    mcuSelector.appendChild(option);
  });
  handleMcuChange();
}

export async function handleMcuChange() {
  const mcuSelector = document.getElementById("mcuSelector");
  const packageSelector = document.getElementById("packageSelector");
  const selectedMcuOption = mcuSelector.options[mcuSelector.selectedIndex];

  if (!selectedMcuOption) return;

  const packages = JSON.parse(selectedMcuOption.dataset.packages || "[]");
  packageSelector.innerHTML = "";

  if (packages.length > 0) {
    packages.forEach((pkg) => {
      const option = document.createElement("option");
      option.value = pkg.file;
      option.textContent = pkg.name;
      packageSelector.appendChild(option);
    });
    updateExportButtonState();
    await loadCurrentMcuData();
  } else {
    updateExportButtonState();
    reinitializeView(true);
  }
}

export async function handlePackageChange() {
  updateExportButtonState();
  await loadCurrentMcuData();
}

export async function loadCurrentMcuData() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  if (mcu && pkg) {
    await loadMCUData(mcu, pkg);
  }
}

export async function loadMCUData(mcu, pkg) {
  const path = `mcus/${mcu}/${pkg}.json`;
  try {
    state.mcuData = await loadResolvedPackageData(path);

    state.deviceTreeTemplates = await loadDeviceTreeTemplates(mcu, pkg);

    reinitializeView();
  } catch (error) {
    console.error("Error loading MCU data:", error);
    alert(`Could not load data for ${mcu} - ${pkg}.\n${error.message}`);
    reinitializeView(true);
  }
}

export async function loadDeviceTreeTemplates(mcuId, pkgId = null) {
  try {
    const response = await fetch(`mcus/${mcuId}/devicetree-templates.json`);
    if (!response.ok) {
      const unsupportedReason = getDevicetreeExportUnsupportedReason(
        state.mcuManifest,
        mcuId,
        pkgId,
      );
      if (!unsupportedReason) {
        console.warn(`No DeviceTree templates found for ${mcuId}`);
      }
      return null;
    }
    const data = await response.json();
    return data.templates;
  } catch (error) {
    console.error("Failed to load DeviceTree templates:", error);
    return null;
  }
}

export function reinitializeView(clearOnly = false) {
  resetState();

  if (clearOnly || !state.mcuData.partInfo) {
    document.getElementById("chipTitleDisplay").textContent = "No MCU Loaded";
    organizePeripherals();
    createPinLayout();
    updateSelectedPeripheralsList();
    updatePinDisplay();
    updateConsoleConfig();
    return;
  }

  addOscillatorsToPeripherals();
  autoSelectHFXO();

  document.getElementById("chipTitleDisplay").textContent =
    `${state.mcuData.partInfo.packageType} Pin Layout`;
  organizePeripherals();
  createPinLayout();

  loadStateFromLocalStorage();

  // Ensure HFXO is always selected after loading state (and remove duplicates)
  const hfxoCount = state.selectedPeripherals.filter(
    (p) => p.id === "HFXO",
  ).length;
  if (hfxoCount === 0) {
    const hfxo = state.mcuData.socPeripherals.find((p) => p.id === "HFXO");
    if (hfxo) {
      state.selectedPeripherals.push({
        id: "HFXO",
        description: hfxo.description,
        config: { ...hfxo.config },
      });
    }
  } else if (hfxoCount > 1) {
    const firstHfxo = state.selectedPeripherals.find((p) => p.id === "HFXO");
    for (let i = state.selectedPeripherals.length - 1; i >= 0; i--) {
      if (state.selectedPeripherals[i].id === "HFXO") {
        state.selectedPeripherals.splice(i, 1);
      }
    }
    state.selectedPeripherals.push(firstHfxo);
  }

  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
}
