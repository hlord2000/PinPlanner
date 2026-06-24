// --- MCU/PACKAGE LOADING AND INITIALIZATION ---

import state from "./state.js";
import {
  resetState,
  loadStateFromLocalStorage,
  getSavedPartPackageSelection,
  savePartPackageSelection,
} from "./state.js";
import {
  organizePeripherals,
  addOscillatorsToPeripherals,
  autoSelectHFXO,
} from "./peripherals.js";
import {
  getDevicetreeExportUnsupportedReason,
  getMcuManifestEntry,
} from "./mcu-manifest.js";
import { createPinLayout, updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { updateConsoleConfig } from "./console-config.js";
import { updateExportButtonState } from "./export.js";
import { renderPmicPanel } from "./pmic.js";

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

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`File not found or invalid: ${new URL(url).pathname}`);
  }

  return response.json();
}

function getLocalPartPackage(mcu, pkg) {
  return state.localParts?.[mcu]?.[pkg] || null;
}

function resolvePublicPackageUrl(mcu, packageRef) {
  if (/^https?:\/\//i.test(packageRef)) {
    return packageRef;
  }

  if (packageRef.startsWith("mcus/") || packageRef.startsWith("/")) {
    return packageRef;
  }

  const packagePath = packageRef.endsWith(".json")
    ? packageRef
    : `${packageRef}.json`;
  return new URL(packagePath, new URL(`mcus/${mcu}/`, window.location.href))
    .href;
}

async function loadResolvedLocalPackageData(
  mcu,
  pkg,
  packageData,
  seen = new Set(),
) {
  const localKey = `${mcu}/${pkg}`;
  if (seen.has(localKey)) {
    throw new Error(`Circular package extends chain detected at ${localKey}`);
  }

  seen.add(localKey);

  const data = cloneObject(packageData);
  if (!data.extends) {
    return normalizePackageData(data);
  }

  const parentRef = data.extends;
  const parentPackageId = parentRef
    .replace(/^\.\/+/, "")
    .replace(/\.json$/, "");
  const localParent = getLocalPartPackage(mcu, parentPackageId);

  const parentData = localParent
    ? await loadResolvedLocalPackageData(
        mcu,
        parentPackageId,
        localParent.packageData,
        seen,
      )
    : await loadResolvedPackageData(resolvePublicPackageUrl(mcu, parentRef));

  return normalizePackageData(mergePackageData(parentData, data));
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
  const savedSelection = getSavedPartPackageSelection();
  mcuSelector.innerHTML = "";
  state.mcuManifest.mcus.forEach((mcu) => {
    const option = document.createElement("option");
    option.value = mcu.id;
    option.textContent = mcu.name;
    option.dataset.packages = JSON.stringify(mcu.packages);
    mcuSelector.appendChild(option);
  });

  if (
    savedSelection &&
    Array.from(mcuSelector.options).some(
      (option) => option.value === savedSelection.mcu,
    )
  ) {
    mcuSelector.value = savedSelection.mcu;
  }

  handleMcuChange({ restoreSavedPackage: true });
}

export async function handleMcuChange(options = {}) {
  const mcuSelector = document.getElementById("mcuSelector");
  const packageSelector = document.getElementById("packageSelector");
  const selectedMcuOption = mcuSelector.options[mcuSelector.selectedIndex];
  const selectedMcu = getMcuManifestEntry(state.mcuManifest, mcuSelector.value);
  const savedSelection =
    options.restoreSavedPackage === true
      ? getSavedPartPackageSelection()
      : null;

  if (!selectedMcuOption) return;

  const packages =
    selectedMcu?.packages ||
    JSON.parse(selectedMcuOption.dataset.packages || "[]");
  packageSelector.innerHTML = "";

  if (packages.length > 0) {
    packages.forEach((pkg) => {
      const option = document.createElement("option");
      option.value = pkg.file;
      option.textContent = pkg.isLocal ? `${pkg.name} [local]` : pkg.name;
      if (pkg.isLocal) {
        option.dataset.localPart = "true";
      }
      packageSelector.appendChild(option);
    });
    if (
      options.packageToSelect &&
      Array.from(packageSelector.options).some(
        (option) => option.value === options.packageToSelect,
      )
    ) {
      packageSelector.value = options.packageToSelect;
    } else if (
      savedSelection?.mcu === mcuSelector.value &&
      Array.from(packageSelector.options).some(
        (option) => option.value === savedSelection.package,
      )
    ) {
      packageSelector.value = savedSelection.package;
    }
    updateExportButtonState();
    return await loadCurrentMcuData();
  } else {
    savePartPackageSelection(mcuSelector.value, "");
    updateExportButtonState();
    reinitializeView(true);
    return false;
  }
}

export async function handlePackageChange() {
  updateExportButtonState();
  return await loadCurrentMcuData();
}

export async function loadCurrentMcuData() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  savePartPackageSelection(mcu, pkg);
  if (mcu && pkg) {
    return await loadMCUData(mcu, pkg);
  }
  return false;
}

export async function loadMCUData(mcu, pkg) {
  const localPart = getLocalPartPackage(mcu, pkg);
  const path = `mcus/${mcu}/${pkg}.json`;
  try {
    state.mcuData = localPart
      ? await loadResolvedLocalPackageData(mcu, pkg, localPart.packageData)
      : await loadResolvedPackageData(path);

    state.deviceTreeTemplates = await loadDeviceTreeTemplates(mcu, pkg);

    updateLocalPartStatus(mcu, pkg);
    reinitializeView();
    return true;
  } catch (error) {
    console.error("Error loading MCU data:", error);
    alert(`Could not load data for ${mcu} - ${pkg}.\n${error.message}`);
    updateLocalPartStatus(null, null);
    reinitializeView(true);
    return false;
  }
}

function updateLocalPartStatus(mcu, pkg) {
  const status = document.getElementById("localPartStatus");
  if (!status) return;

  const localPart = mcu && pkg ? getLocalPartPackage(mcu, pkg) : null;
  if (!localPart) {
    status.style.display = "none";
    status.textContent = "";
    return;
  }

  status.textContent = `Local part loaded: ${localPart.name}`;
  status.style.display = "block";
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
    renderPmicPanel();
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
  renderPmicPanel();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
}
