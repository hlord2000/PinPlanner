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
import { createPinLayout, updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { updateConsoleConfig } from "./console-config.js";

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
    await loadCurrentMcuData();
  } else {
    reinitializeView(true);
  }
}

export async function handlePackageChange() {
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
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`File not found or invalid: ${path}`);
    }
    state.mcuData = await response.json();

    state.deviceTreeTemplates = await loadDeviceTreeTemplates(mcu);

    reinitializeView();
  } catch (error) {
    console.error("Error loading MCU data:", error);
    alert(`Could not load data for ${mcu} - ${pkg}.\n${error.message}`);
    reinitializeView(true);
  }
}

export async function loadDeviceTreeTemplates(mcuId) {
  try {
    const response = await fetch(`mcus/${mcuId}/devicetree-templates.json`);
    if (!response.ok) {
      console.warn(`No DeviceTree templates found for ${mcuId}`);
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
