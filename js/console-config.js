// --- SERIAL CONSOLE UART SELECTION AND WARNINGS ---

import state from "./state.js";
import { saveStateToLocalStorage } from "./state.js";

function usesFixedNsTfmSecureUartRouting(mcu) {
  return (
    mcu === "nrf54l10" ||
    mcu === "nrf54lv10a" ||
    mcu === "nrf54lm20a" ||
    mcu === "nrf54l15"
  );
}

export function updateConsoleConfig() {
  const section = document.getElementById("consoleConfigSection");
  if (!section) return;

  const banner = document.getElementById("consoleStatusBanner");
  const selectorDiv = document.getElementById("consoleSelector");
  const select = document.getElementById("consoleUartSelect");
  const limitationNote = document.getElementById("consoleLimitationNote");
  const mcu = document.getElementById("mcuSelector")?.value;

  if (!state.deviceTreeTemplates) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";

  // Find all selected UARTs
  const selectedUarts = state.selectedPeripherals.filter((p) => {
    const template = state.deviceTreeTemplates[p.id];
    return template && template.type === "UART";
  });

  if (selectedUarts.length === 0) {
    // No UARTs selected - show info, hide selector
    banner.className = "console-banner console-info";
    banner.innerHTML = "No UART selected — Segger RTT will be used.";
    banner.style.display = "";
    selectorDiv.style.display = "none";
    if (limitationNote) {
      limitationNote.style.display = "none";
    }
    state.consoleUart = null;
  } else {
    // One or more UARTs - show dropdown with "None (RTT)" option
    banner.style.display = "none";
    selectorDiv.style.display = "";

    // Preserve current selection if still valid
    const currentValid =
      state.consoleUart === null ||
      selectedUarts.some((u) => u.id === state.consoleUart);
    if (!currentValid) {
      state.consoleUart = selectedUarts[0].id;
    }

    select.innerHTML = "";

    // "None" option for RTT
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "None (Segger RTT)";
    if (state.consoleUart === null) {
      noneOption.selected = true;
    }
    select.appendChild(noneOption);

    selectedUarts.forEach((uart) => {
      const template = state.deviceTreeTemplates[uart.id];
      const option = document.createElement("option");
      option.value = uart.id;
      option.textContent = `${uart.id} (&${template.dtNodeName})`;
      if (uart.id === state.consoleUart) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    if (limitationNote) {
      const showNsNote =
        usesFixedNsTfmSecureUartRouting(mcu) && state.consoleUart !== null;
      const mcuLabel =
        mcu === "nrf54l10"
          ? "nrf54l10"
          : mcu === "nrf54lv10a"
            ? "nrf54lv10a"
            : mcu === "nrf54lm20a"
              ? "nrf54lm20a"
              : mcu === "nrf54l15"
                ? "nrf54l15"
                : mcu;
      limitationNote.textContent = showNsNote
        ? `For ${mcuLabel} cpuapp/ns builds, TF-M secure UART selection comes from nRF Connect SDK TF-M CMake. Pin Planner cannot override it from generated board files, so TF-M UART logging stays disabled in the export.`
        : "";
      limitationNote.style.display = showNsNote ? "" : "none";
    }
  }
}

export function handleConsoleUartChange(event) {
  state.consoleUart = event.target.value || null;
  saveStateToLocalStorage();
  updateConsoleConfig();
}
