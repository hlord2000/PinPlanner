// --- SELECTED PERIPHERALS LIST ---

import state from "../state.js";
import { removePeripheral, editPeripheral } from "../peripherals.js";

export function updateSelectedPeripheralsList() {
  const selectedList = document.getElementById("selectedList");
  selectedList.innerHTML = "";

  if (state.selectedPeripherals.length === 0) {
    selectedList.innerHTML =
      '<li class="empty-message">No peripherals selected yet.</li>';
    return;
  }

  // Remove duplicates (safety check)
  const uniquePeripherals = [];
  const seenIds = new Set();
  state.selectedPeripherals.forEach((p) => {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      uniquePeripherals.push(p);
    }
  });

  if (uniquePeripherals.length !== state.selectedPeripherals.length) {
    state.selectedPeripherals.length = 0;
    uniquePeripherals.forEach((p) => state.selectedPeripherals.push(p));
  }

  state.selectedPeripherals.forEach((p) => {
    const item = document.createElement("li");
    item.className = "selected-item";

    let details;
    if (p.type === "GPIO") {
      const activeLabel =
        p.activeState === "active-low" ? "active-low" : "active-high";
      details = `${p.pin} (${activeLabel})`;
    } else if (p.config && p.config.loadCapacitors) {
      const capLabel =
        p.config.loadCapacitors === "internal" ? "Internal" : "External";
      if (p.config.loadCapacitors === "external") {
        details = `${capLabel} caps`;
      } else {
        const capValue = (p.config.loadCapacitanceFemtofarad / 1000).toFixed(
          p.id === "HFXO" ? 2 : 1,
        );
        details = `${capLabel} caps, ${capValue} pF`;
      }

      const oscData = state.mcuData.socPeripherals.find((sp) => sp.id === p.id);
      if (oscData && oscData.signals && oscData.signals.length > 0) {
        const pins = oscData.signals
          .filter((s) => s.allowedGpio && s.allowedGpio.length > 0)
          .map((s) => s.allowedGpio[0])
          .join(", ");
        if (pins) {
          details += ` (${pins})`;
        }
      }
    } else {
      details =
        Object.entries(p.pinFunctions || {})
          .map(([pin, func]) => `${pin}: ${func}`)
          .join(", ") || "Auto-assigned";

      if (p.config && p.config.disableRx) {
        details += " [RX disabled]";
      }

      if (
        p.config &&
        p.config.extraCsGpios &&
        p.config.extraCsGpios.length > 0
      ) {
        details += ` [+${p.config.extraCsGpios.length} CS: ${p.config.extraCsGpios.join(", ")}]`;
      }
    }

    const removeBtn =
      p.id === "HFXO"
        ? ""
        : `<button class="remove-btn" data-id="${p.id}">Remove</button>`;

    let displayName = p.type === "GPIO" ? `GPIO: ${p.label}` : p.id;
    if (
      p.config &&
      p.config.note &&
      ["SPI", "I2C", "UART"].includes(p.peripheral?.type)
    ) {
      displayName += `: ${p.config.note}`;
    }

    item.innerHTML = `
            <div><strong>${displayName}</strong><div>${details}</div></div>
            ${removeBtn}
        `;

    if (p.id !== "HFXO") {
      item.querySelector(".remove-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        removePeripheral(p.id);
      });
    }

    item.addEventListener("click", () => editPeripheral(p.id));
    selectedList.appendChild(item);
  });
}
