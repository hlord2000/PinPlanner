// --- ENTRY POINT ---

import {
  initializeApp,
  handleMcuChange,
  handlePackageChange,
} from "./mcu-loader.js";
import {
  filterPeripherals,
  closeOscillatorConfig,
  confirmOscillatorConfig,
} from "./peripherals.js";
import {
  closePinSelectionModal,
  confirmPinSelection,
  closeGpioModal,
  confirmGpioModal,
  addGpioTableRowPublic,
  addSpiCsGpio,
} from "./ui/modals.js";
import {
  openExportConfigModal,
  openImportConfigModal,
  handleImportConfigFile,
  closeImportExportModal,
  confirmImportExport,
} from "./ui/import-export.js";
import {
  openBoardInfoModal,
  closeBoardInfoModal,
  confirmBoardInfoAndGenerate,
} from "./export.js";
import { handleConsoleUartChange } from "./console-config.js";
import { loadDevkitConfig } from "./devkit-loader.js";
import { enableScrollWheelSelection } from "./utils.js";
import state from "./state.js";
import { resetState, saveStateToLocalStorage } from "./state.js";
import { organizePeripherals } from "./peripherals.js";
import { updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { updateConsoleConfig } from "./console-config.js";

document.addEventListener("DOMContentLoaded", function () {
  // Set up event listeners
  document
    .getElementById("mcuSelector")
    .addEventListener("change", handleMcuChange);
  document
    .getElementById("packageSelector")
    .addEventListener("change", handlePackageChange);
  document
    .getElementById("clearAllBtn")
    .addEventListener("click", clearAllPeripherals);
  document
    .getElementById("exportDeviceTreeBtn")
    .addEventListener("click", openBoardInfoModal);
  document
    .getElementById("searchPeripherals")
    .addEventListener("input", filterPeripherals);
  document
    .querySelector("#pinSelectionModal .close")
    .addEventListener("click", closePinSelectionModal);
  document
    .getElementById("cancelPinSelection")
    .addEventListener("click", closePinSelectionModal);
  document
    .getElementById("confirmPinSelection")
    .addEventListener("click", confirmPinSelection);
  document
    .getElementById("closeBoardInfoModal")
    .addEventListener("click", closeBoardInfoModal);
  document
    .getElementById("cancelBoardInfo")
    .addEventListener("click", closeBoardInfoModal);
  document
    .getElementById("confirmBoardInfo")
    .addEventListener("click", confirmBoardInfoAndGenerate);
  document
    .getElementById("closeOscillatorModal")
    .addEventListener("click", closeOscillatorConfig);
  document
    .getElementById("cancelOscillatorConfig")
    .addEventListener("click", closeOscillatorConfig);
  document
    .getElementById("confirmOscillatorConfig")
    .addEventListener("click", confirmOscillatorConfig);

  // Import/Export config listeners
  document
    .getElementById("exportConfigBtn")
    .addEventListener("click", openExportConfigModal);
  document
    .getElementById("importConfigBtn")
    .addEventListener("click", openImportConfigModal);
  document
    .getElementById("importConfigFile")
    .addEventListener("change", handleImportConfigFile);
  document
    .getElementById("closeImportExportModal")
    .addEventListener("click", closeImportExportModal);
  document
    .getElementById("cancelImportExport")
    .addEventListener("click", closeImportExportModal);
  document
    .getElementById("confirmImportExport")
    .addEventListener("click", confirmImportExport);

  // GPIO modal listeners
  document
    .getElementById("closeGpioModal")
    .addEventListener("click", closeGpioModal);
  document
    .getElementById("cancelGpioModal")
    .addEventListener("click", closeGpioModal);
  document
    .getElementById("confirmGpioModal")
    .addEventListener("click", confirmGpioModal);
  document
    .getElementById("addGpioRow")
    .addEventListener("click", addGpioTableRowPublic);
  document.getElementById("gpioModal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("gpioModal")) {
      closeGpioModal();
    }
  });

  // SPI CS GPIO button
  document
    .getElementById("addSpiCsGpioBtn")
    .addEventListener("click", addSpiCsGpio);

  // Console UART selector
  const consoleUartSelect = document.getElementById("consoleUartSelect");
  if (consoleUartSelect) {
    consoleUartSelect.addEventListener("change", handleConsoleUartChange);
  }

  // Devkit selector
  const devkitSelector = document.getElementById("devkitSelector");
  if (devkitSelector) {
    devkitSelector.addEventListener("change", (e) => {
      loadDevkitConfig(e.target.value);
    });
  }

  // --- THEME SWITCHER LOGIC ---
  const themeToggle = document.getElementById("theme-toggle");
  const body = document.body;

  const setTheme = (isDark) => {
    if (isDark) {
      body.classList.add("dark-mode");
      themeToggle.checked = true;
      localStorage.setItem("theme", "dark");
    } else {
      body.classList.remove("dark-mode");
      themeToggle.checked = false;
      localStorage.setItem("theme", "light");
    }
  };

  const savedTheme = localStorage.getItem("theme");
  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (savedTheme) {
    setTheme(savedTheme === "dark");
  } else {
    setTheme(prefersDark);
  }

  themeToggle.addEventListener("change", () => {
    setTheme(themeToggle.checked);
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      const currentTheme = localStorage.getItem("theme");
      if (!currentTheme) {
        setTheme(e.matches);
      }
    });

  // Scroll-wheel selection on dropdowns
  enableScrollWheelSelection("mcuSelector");
  enableScrollWheelSelection("packageSelector");

  // Initial data load
  initializeApp();
});

function clearAllPeripherals() {
  if (!confirm("Are you sure you want to clear all peripherals?")) {
    return;
  }
  resetState();
  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
  saveStateToLocalStorage();
}
