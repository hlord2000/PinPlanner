// --- IMPORT/EXPORT CONFIGURATION ---

import state from "../state.js";
import {
  serializePeripheral,
  saveStateToLocalStorage,
  applyConfig,
  resetState,
} from "../state.js";
import { handleMcuChange, loadCurrentMcuData } from "../mcu-loader.js";
import { organizePeripherals } from "../peripherals.js";
import { updatePinDisplay } from "../pin-layout.js";
import { updateSelectedPeripheralsList } from "./selected-list.js";
import { updateConsoleConfig } from "../console-config.js";

let pendingImportConfig = null;
let isExportMode = true;

export function openExportConfigModal() {
  isExportMode = true;
  const modal = document.getElementById("importExportInfoModal");
  const title = document.getElementById("importExportModalTitle");
  const text = document.getElementById("importExportModalText");
  const bullet1 = document.getElementById("importExportBullet1");
  const bullet2 = document.getElementById("importExportBullet2");
  const bullet3 = document.getElementById("importExportBullet3");
  const warning = document.getElementById("importExportWarning");
  const warningText = document.getElementById("importExportWarningText");
  const confirmBtn = document.getElementById("confirmImportExport");

  title.textContent = "Export Configuration";
  text.textContent =
    "This will export your current pin configuration for the selected MCU/package to a JSON file. You can use this file to:";
  bullet1.textContent = "Share configurations with team members";
  bullet2.textContent = "Back up your pin assignments";
  bullet3.textContent =
    "Restore configurations on a different browser or computer";
  warning.style.backgroundColor = "#fff3cd";
  warning.style.color = "#856404";
  warning.style.borderColor = "#ffeeba";
  warningText.textContent =
    "The exported file is specific to the currently selected MCU and package.";
  confirmBtn.textContent = "Export";

  modal.style.display = "block";
}

export function openImportConfigModal() {
  document.getElementById("importConfigFile").click();
}

export function handleImportConfigFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const config = JSON.parse(e.target.result);
      validateAndShowImportModal(config);
    } catch (error) {
      alert("Invalid JSON file: " + error.message);
    }
    event.target.value = "";
  };
  reader.readAsText(file);
}

function validateAndShowImportModal(config) {
  if (!config.mcu || !config.package || !config.selectedPeripherals) {
    alert(
      "Invalid configuration file. Missing required fields (mcu, package, or selectedPeripherals).",
    );
    return;
  }

  pendingImportConfig = config;
  isExportMode = false;

  const modal = document.getElementById("importExportInfoModal");
  const title = document.getElementById("importExportModalTitle");
  const text = document.getElementById("importExportModalText");
  const bullet1 = document.getElementById("importExportBullet1");
  const bullet2 = document.getElementById("importExportBullet2");
  const bullet3 = document.getElementById("importExportBullet3");
  const warning = document.getElementById("importExportWarning");
  const warningText = document.getElementById("importExportWarningText");
  const confirmBtn = document.getElementById("confirmImportExport");

  const currentMcu = document.getElementById("mcuSelector").value;
  const currentPkg = document.getElementById("packageSelector").value;

  const isDifferentPart =
    config.mcu !== currentMcu || config.package !== currentPkg;

  title.textContent = "Import Configuration";
  text.textContent = `This will import a pin configuration from the file. The configuration is for:`;
  bullet1.innerHTML = `<strong>MCU:</strong> ${config.mcu}`;
  bullet2.innerHTML = `<strong>Package:</strong> ${config.package}`;
  bullet3.innerHTML = `<strong>Peripherals:</strong> ${config.selectedPeripherals.length} configured`;

  if (isDifferentPart) {
    warning.style.backgroundColor = "#fff3cd";
    warning.style.color = "#856404";
    warning.style.borderColor = "#ffeeba";
    warningText.innerHTML = `<strong>Note:</strong> This configuration is for a different MCU/package than currently selected. Importing will switch to <strong>${config.mcu}</strong> with package <strong>${config.package}</strong>.`;
  } else {
    warning.style.backgroundColor = "#d4edda";
    warning.style.color = "#155724";
    warning.style.borderColor = "#c3e6cb";
    warningText.innerHTML = `This configuration matches your currently selected MCU and package.`;
  }

  confirmBtn.textContent = "Import";

  const existingWarning = document.getElementById("importOverwriteWarning");
  if (!existingWarning) {
    const overwriteWarning = document.createElement("div");
    overwriteWarning.id = "importOverwriteWarning";
    overwriteWarning.style.cssText =
      "background-color: #f8d7da; color: #721c24; padding: 10px; border: 1px solid #f5c6cb; border-radius: 5px; margin-top: 10px;";
    overwriteWarning.innerHTML =
      "<strong>Warning:</strong> Importing will replace your current configuration and overwrite any saved data for this MCU/package.";
    warning.parentNode.insertBefore(overwriteWarning, warning.nextSibling);
  }

  modal.style.display = "block";
}

export function closeImportExportModal() {
  const modal = document.getElementById("importExportInfoModal");
  modal.style.display = "none";
  pendingImportConfig = null;

  const overwriteWarning = document.getElementById("importOverwriteWarning");
  if (overwriteWarning) {
    overwriteWarning.remove();
  }
}

export function confirmImportExport() {
  if (isExportMode) {
    exportConfig();
  } else {
    importConfig();
  }
  closeImportExportModal();
}

function exportConfig() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;

  if (!mcu || !pkg) {
    alert("Please select an MCU and package first.");
    return;
  }

  const config = {
    version: 1,
    exportDate: new Date().toISOString(),
    mcu: mcu,
    package: pkg,
    selectedPeripherals: state.selectedPeripherals.map(serializePeripheral),
  };

  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `pinplanner-${mcu}-${pkg}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importConfig() {
  if (!pendingImportConfig) return;

  const config = pendingImportConfig;
  const currentMcu = document.getElementById("mcuSelector").value;
  const currentPkg = document.getElementById("packageSelector").value;

  if (config.mcu !== currentMcu || config.package !== currentPkg) {
    const mcuSelector = document.getElementById("mcuSelector");
    const mcuOption = Array.from(mcuSelector.options).find(
      (opt) => opt.value === config.mcu,
    );

    if (!mcuOption) {
      alert(`MCU "${config.mcu}" not found in available options.`);
      return;
    }

    mcuSelector.value = config.mcu;
    await handleMcuChange();

    const packageSelector = document.getElementById("packageSelector");
    const pkgOption = Array.from(packageSelector.options).find(
      (opt) => opt.value === config.package,
    );

    if (!pkgOption) {
      alert(`Package "${config.package}" not found for MCU "${config.mcu}".`);
      return;
    }

    packageSelector.value = config.package;
    await loadCurrentMcuData();
  }

  // Clear - but skip confirm dialog
  resetState();
  state.selectedPeripherals = [];

  applyConfig({
    selectedPeripherals: config.selectedPeripherals,
  });

  saveStateToLocalStorage();

  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
}
