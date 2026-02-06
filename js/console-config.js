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
    // No UARTs selected - show warning
    banner.className = "console-banner console-warning";
    banner.innerHTML =
      "<strong>No UART selected.</strong> RTT will be used for logging.";
    banner.style.display = "";
    selectorDiv.style.display = "none";
    state.consoleUart = null;
  } else if (selectedUarts.length === 1) {
    // Exactly one UART - auto-select
    const uart = selectedUarts[0];
    const template = state.deviceTreeTemplates[uart.id];
    state.consoleUart = uart.id;
    banner.className = "console-banner console-info";
    banner.innerHTML = `UART console enabled on <strong>&${template.dtNodeName}</strong>`;
    banner.style.display = "";
    selectorDiv.style.display = "none";
  } else {
    // Multiple UARTs - show selector
    banner.style.display = "none";
    selectorDiv.style.display = "";

    // Preserve current selection if still valid
    const currentValid = selectedUarts.some((u) => u.id === state.consoleUart);
    if (!currentValid) {
      state.consoleUart = selectedUarts[0].id;
    }

    select.innerHTML = "";
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
  state.consoleUart = event.target.value;
  saveStateToLocalStorage();
}
