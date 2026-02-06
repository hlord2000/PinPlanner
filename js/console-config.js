// --- SERIAL CONSOLE UART SELECTION AND WARNINGS ---

import state from "./state.js";
import { saveStateToLocalStorage } from "./state.js";

export function updateConsoleConfig() {
  const section = document.getElementById("consoleConfigSection");
  if (!section) return;

  const banner = document.getElementById("consoleStatusBanner");
  const selectorDiv = document.getElementById("consoleSelector");
  const select = document.getElementById("consoleUartSelect");

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
  }
}

export function handleConsoleUartChange(event) {
  state.consoleUart = event.target.value || null;
  saveStateToLocalStorage();
}
