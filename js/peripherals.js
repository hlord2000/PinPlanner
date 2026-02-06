// --- PERIPHERAL ORGANIZATION AND DISPLAY ---

import state from "./state.js";
import { hasAddressConflict, saveStateToLocalStorage } from "./state.js";
import { updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { openPinSelectionModal } from "./ui/modals.js";
import { updateConsoleConfig } from "./console-config.js";
import { enableScrollWheelSelectionForElement } from "./utils.js";

export function addOscillatorsToPeripherals() {
  if (!state.mcuData.socPeripherals) {
    state.mcuData.socPeripherals = [];
  }

  const lfxoIndex = state.mcuData.socPeripherals.findIndex(
    (p) => p.id === "LFXO",
  );

  if (lfxoIndex !== -1) {
    const lfxo = state.mcuData.socPeripherals[lfxoIndex];
    lfxo.uiHint = "oscillator";
    lfxo.optional = true;
    if (!lfxo.config) {
      lfxo.config = {
        loadCapacitors: "internal",
        loadCapacitanceFemtofarad: 15000,
      };
    }
  } else {
    state.mcuData.socPeripherals.push({
      id: "LFXO",
      description: "Low Frequency Crystal Oscillator",
      uiHint: "oscillator",
      optional: true,
      signals: [],
      config: {
        loadCapacitors: "internal",
        loadCapacitanceFemtofarad: 15000,
      },
    });
  }

  const hfxoIndex = state.mcuData.socPeripherals.findIndex(
    (p) => p.id === "HFXO",
  );

  if (hfxoIndex !== -1) {
    const hfxo = state.mcuData.socPeripherals[hfxoIndex];
    hfxo.uiHint = "oscillator";
    hfxo.optional = false;
    hfxo.alwaysPresent = true;
    if (!hfxo.config) {
      hfxo.config = {
        loadCapacitors: "internal",
        loadCapacitanceFemtofarad: 15000,
      };
    }
  } else {
    state.mcuData.socPeripherals.push({
      id: "HFXO",
      description: "High Frequency Crystal Oscillator",
      uiHint: "oscillator",
      optional: false,
      alwaysPresent: true,
      signals: [],
      config: {
        loadCapacitors: "internal",
        loadCapacitanceFemtofarad: 15000,
      },
    });
  }
}

export function autoSelectHFXO() {
  const existingIndex = state.selectedPeripherals.findIndex(
    (p) => p.id === "HFXO",
  );
  if (existingIndex !== -1) {
    state.selectedPeripherals.splice(existingIndex, 1);
  }

  const hfxo = state.mcuData.socPeripherals.find((p) => p.id === "HFXO");
  if (hfxo) {
    state.selectedPeripherals.push({
      id: "HFXO",
      description: hfxo.description,
      config: { ...hfxo.config },
    });
    updateSelectedPeripheralsList();
  }
}

export function organizePeripherals() {
  const peripheralsListContainer = document.getElementById("peripherals-list");
  if (!peripheralsListContainer) return;
  peripheralsListContainer.innerHTML = "";

  if (!state.mcuData.socPeripherals) return;

  const checkboxPeripherals = [];
  const oscillators = [];
  const singleInstancePeripherals = [];
  const multiInstanceGroups = {};

  state.mcuData.socPeripherals.forEach((p) => {
    if (p.uiHint === "oscillator") {
      oscillators.push(p);
    } else if (p.uiHint === "checkbox") {
      checkboxPeripherals.push(p);
    } else {
      const baseName = p.id.replace(/\d+$/, "");
      if (!multiInstanceGroups[baseName]) {
        multiInstanceGroups[baseName] = [];
      }
      multiInstanceGroups[baseName].push(p);
    }
  });

  for (const baseName in multiInstanceGroups) {
    if (multiInstanceGroups[baseName].length === 1) {
      singleInstancePeripherals.push(multiInstanceGroups[baseName][0]);
      delete multiInstanceGroups[baseName];
    }
  }

  oscillators.sort((a, b) => a.id.localeCompare(b.id));
  checkboxPeripherals.sort((a, b) => a.id.localeCompare(b.id));
  singleInstancePeripherals.sort((a, b) => a.id.localeCompare(b.id));
  const sortedMultiInstanceKeys = Object.keys(multiInstanceGroups).sort();

  // Render oscillators
  oscillators.forEach((p) => {
    const oscGroup = document.createElement("div");
    oscGroup.className = "oscillator-group";
    oscGroup.style.marginBottom = "10px";

    const btn = document.createElement("button");
    btn.className = "single-peripheral-btn";
    btn.dataset.id = p.id;
    btn.style.width = "100%";

    const isSelected = state.selectedPeripherals.some((sp) => sp.id === p.id);
    if (isSelected) {
      btn.classList.add("selected");
    }

    if (p.id === "HFXO") {
      btn.textContent = `${p.description} (Configure)`;
      btn.addEventListener("click", () => openOscillatorConfig(p));
    } else {
      btn.textContent = isSelected
        ? `${p.description} (Configure)`
        : `${p.description} (Add)`;
      btn.addEventListener("click", () => openOscillatorConfig(p));
    }

    oscGroup.appendChild(btn);
    peripheralsListContainer.appendChild(oscGroup);
  });

  // Render checkbox peripherals
  checkboxPeripherals.forEach((p) => {
    const checkboxGroup = document.createElement("div");
    checkboxGroup.className = "checkbox-group";

    const label = document.createElement("label");
    label.className = "checkbox-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `${p.id.toLowerCase()}-checkbox`;
    checkbox.dataset.peripheralId = p.id;
    checkbox.addEventListener("change", toggleSimplePeripheral);

    const span = document.createElement("span");
    span.textContent = p.description;

    label.appendChild(checkbox);
    label.appendChild(span);

    const description = document.createElement("div");
    description.className = "checkbox-description";
    description.textContent = `Uses ${p.signals.map((s) => s.allowedGpio.join("/")).join(", ")}`;

    checkboxGroup.appendChild(label);
    checkboxGroup.appendChild(description);
    peripheralsListContainer.appendChild(checkboxGroup);
  });

  // Render single-instance peripherals
  singleInstancePeripherals.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "single-peripheral-btn";
    btn.dataset.id = p.id;
    btn.textContent = `${p.id} (${p.type})`;
    btn.addEventListener("click", () => handlePeripheralClick(p));
    peripheralsListContainer.appendChild(btn);
  });

  // Render multi-instance peripherals
  if (sortedMultiInstanceKeys.length > 0) {
    const accordionContainer = document.createElement("div");
    accordionContainer.className = "accordion";

    sortedMultiInstanceKeys.forEach((baseName) => {
      const peripherals = multiInstanceGroups[baseName];
      const accordionItem = document.createElement("div");
      accordionItem.className = "accordion-item";
      const header = document.createElement("div");
      header.className = "accordion-header";
      header.innerHTML = `<span>${baseName}</span><span class="expand-icon">▼</span>`;
      const content = document.createElement("div");
      content.className = "accordion-content";

      peripherals
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((p) => {
          const item = document.createElement("div");
          item.className = "peripheral-item";
          item.dataset.id = p.id;
          item.innerHTML = `<span>${p.id}</span>`;
          item.addEventListener("click", () => handlePeripheralClick(p));
          content.appendChild(item);
        });

      header.addEventListener("click", () => {
        const isActive = header.classList.toggle("active");
        content.style.display = isActive ? "block" : "none";
      });

      accordionItem.appendChild(header);
      accordionItem.appendChild(content);
      accordionContainer.appendChild(accordionItem);
    });
    peripheralsListContainer.appendChild(accordionContainer);
  }

  // Add GPIO allocation section
  const gpioSection = document.createElement("div");
  gpioSection.className = "gpio-section";
  gpioSection.style.marginTop = "20px";
  gpioSection.style.paddingTop = "20px";
  gpioSection.style.paddingBottom = "10px";
  gpioSection.style.borderTop = "1px solid var(--border-color)";

  const gpioHeader = document.createElement("h4");
  gpioHeader.textContent = "GPIO Pins";
  gpioHeader.style.marginBottom = "10px";
  gpioSection.appendChild(gpioHeader);

  const addGpioBtn = document.createElement("button");
  addGpioBtn.className = "single-peripheral-btn";
  addGpioBtn.textContent = "+ Add GPIO Pin";
  addGpioBtn.style.width = "100%";
  // Import on demand to avoid circular dependency
  addGpioBtn.addEventListener("click", () => {
    import("./ui/modals.js").then((m) => m.openGpioModal());
  });
  gpioSection.appendChild(addGpioBtn);

  peripheralsListContainer.appendChild(gpioSection);
}

export function handlePeripheralClick(peripheral) {
  const isSelected = state.selectedPeripherals.some(
    (p) => p.id === peripheral.id,
  );
  if (isSelected) {
    editPeripheral(peripheral.id);
  } else if (!hasAddressConflict(peripheral)) {
    openPinSelectionModal(peripheral);
  } else {
    alert(
      `Cannot select ${peripheral.id} because it shares the same address space (${peripheral.baseAddress}) with another selected peripheral.`,
    );
  }
}

export function toggleSimplePeripheral(event) {
  const checkbox = event.target;
  const peripheralId = checkbox.dataset.peripheralId;
  const peripheral = state.mcuData.socPeripherals.find(
    (p) => p.id === peripheralId,
  );

  if (!peripheral) {
    console.error(
      `Peripheral with ID '${peripheralId}' not found in socPeripherals.`,
    );
    return;
  }

  const pinNames = peripheral.signals.map((s) => s.allowedGpio[0]);

  if (checkbox.checked) {
    if (pinNames.some((pin) => state.usedPins[pin])) {
      alert(
        `One or more pins for ${peripheral.description} are already in use.`,
      );
      checkbox.checked = false;
      return;
    }
    const pinFunctions = {};
    peripheral.signals.forEach((s) => {
      const pinName = s.allowedGpio[0];
      state.usedPins[pinName] = {
        peripheral: peripheral.id,
        function: s.name,
        required: true,
      };
      pinFunctions[pinName] = s.name;
    });
    state.selectedPeripherals.push({
      id: peripheral.id,
      peripheral,
      pinFunctions,
    });
  } else {
    pinNames.forEach((pin) => delete state.usedPins[pin]);
    const index = state.selectedPeripherals.findIndex(
      (p) => p.id === peripheral.id,
    );
    if (index !== -1) state.selectedPeripherals.splice(index, 1);
  }
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
  saveStateToLocalStorage();
}

export function removePeripheral(id) {
  const index = state.selectedPeripherals.findIndex((p) => p.id === id);
  if (index === -1) return;

  const peripheral = state.selectedPeripherals[index];
  const peripheralData = state.mcuData.socPeripherals.find((p) => p.id === id);

  const checkbox = document.getElementById(`${id.toLowerCase()}-checkbox`);
  if (checkbox) {
    checkbox.checked = false;
  }

  if (peripheral.type === "GPIO") {
    if (peripheral.pin && state.usedPins[peripheral.pin]) {
      delete state.usedPins[peripheral.pin];
    }
  } else if (peripheralData && peripheralData.uiHint === "oscillator") {
    if (peripheralData.signals && peripheralData.signals.length > 0) {
      peripheralData.signals.forEach((s) => {
        if (s.allowedGpio && s.allowedGpio.length > 0) {
          const pinName = s.allowedGpio[0];
          if (
            state.usedPins[pinName] &&
            state.usedPins[pinName].peripheral === id
          ) {
            delete state.usedPins[pinName];
          }
        }
      });
    }
  } else {
    for (const pinName in peripheral.pinFunctions) {
      delete state.usedPins[pinName];
    }
  }

  if (peripheral.peripheral && peripheral.peripheral.baseAddress) {
    delete state.usedAddresses[peripheral.peripheral.baseAddress];
  }
  state.selectedPeripherals.splice(index, 1);

  updateSelectedPeripheralsList();
  organizePeripherals();
  updatePinDisplay();
  updateConsoleConfig();
  saveStateToLocalStorage();
}

export function editPeripheral(id) {
  const gpioPeripheral = state.selectedPeripherals.find(
    (p) => p.id === id && p.type === "GPIO",
  );
  if (gpioPeripheral) {
    import("./ui/modals.js").then((m) => m.openGpioModal());
    return;
  }

  const peripheralData = state.mcuData.socPeripherals.find((p) => p.id === id);
  if (!peripheralData) return;

  if (peripheralData.uiHint === "oscillator") {
    openOscillatorConfig(peripheralData);
    return;
  }

  if (peripheralData.uiHint === "checkbox") {
    return;
  }

  const selected = state.selectedPeripherals.find((p) => p.id === id);
  if (!selected) return;
  openPinSelectionModal(
    selected.peripheral,
    selected.pinFunctions,
    selected.config || {},
  );
}

export function filterPeripherals() {
  const searchTerm = document
    .getElementById("searchPeripherals")
    .value.toLowerCase();
  const peripheralsList = document.getElementById("peripherals-list");

  const items = peripheralsList.querySelectorAll(
    ".single-peripheral-btn, .accordion-item, .checkbox-group",
  );

  items.forEach((item) => {
    const text = item.textContent.toLowerCase();

    let tags = [];
    if (state.mcuData.socPeripherals) {
      if (item.matches(".single-peripheral-btn")) {
        const p = state.mcuData.socPeripherals.find(
          (p) => p.id === item.dataset.id,
        );
        if (p && p.tags) tags = p.tags;
      } else if (item.matches(".checkbox-group")) {
        const id = item.querySelector("[data-peripheral-id]").dataset
          .peripheralId;
        const p = state.mcuData.socPeripherals.find((p) => p.id === id);
        if (p && p.tags) tags = p.tags;
      } else if (item.matches(".accordion-item")) {
        item.querySelectorAll(".peripheral-item").forEach((pItem) => {
          const p = state.mcuData.socPeripherals.find(
            (p) => p.id === pItem.dataset.id,
          );
          if (p && p.tags) tags = tags.concat(p.tags);
        });
      }
    }
    const tagsText = tags.join(" ").toLowerCase();

    if (text.includes(searchTerm) || tagsText.includes(searchTerm)) {
      item.style.display = "";
    } else {
      item.style.display = "none";
    }
  });
}

// --- OSCILLATOR CONFIGURATION ---

let currentOscillator = null;

export function openOscillatorConfig(oscillator) {
  currentOscillator = oscillator;

  document.getElementById("oscillatorModalTitle").textContent =
    `Configure ${oscillator.description}`;

  const existingConfig = state.selectedPeripherals.find(
    (p) => p.id === oscillator.id,
  );
  const config = existingConfig ? existingConfig.config : oscillator.config;

  const internalRadio = document.getElementById("oscillatorCapInternal");
  const externalRadio = document.getElementById("oscillatorCapExternal");

  internalRadio.checked = config.loadCapacitors === "internal";
  externalRadio.checked = config.loadCapacitors === "external";

  const loadCapSelect = document.getElementById("oscillatorLoadCapacitance");
  loadCapSelect.innerHTML = "";

  const template = state.deviceTreeTemplates
    ? state.deviceTreeTemplates[oscillator.id]
    : null;
  let min, max, step;

  if (template && template.loadCapacitanceRange) {
    min = template.loadCapacitanceRange.min;
    max = template.loadCapacitanceRange.max;
    step = template.loadCapacitanceRange.step;
  } else {
    if (oscillator.id === "LFXO") {
      min = 4000;
      max = 18000;
      step = 500;
    } else {
      min = 4000;
      max = 17000;
      step = 250;
    }
  }

  for (let i = min; i <= max; i += step) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `${(i / 1000).toFixed(step === 250 ? 2 : 1)} pF (${i} fF)`;
    if (
      config.loadCapacitanceFemtofarad &&
      i === config.loadCapacitanceFemtofarad
    ) {
      option.selected = true;
    }
    loadCapSelect.appendChild(option);
  }

  enableScrollWheelSelectionForElement(loadCapSelect);

  const toggleLoadCapacitance = () => {
    const isInternal = internalRadio.checked;
    loadCapSelect.disabled = !isInternal;
  };

  internalRadio.onchange = toggleLoadCapacitance;
  externalRadio.onchange = toggleLoadCapacitance;

  toggleLoadCapacitance();

  document.getElementById("oscillatorConfigModal").style.display = "block";
}

export function closeOscillatorConfig() {
  document.getElementById("oscillatorConfigModal").style.display = "none";
  currentOscillator = null;
}

export function confirmOscillatorConfig() {
  if (!currentOscillator) return;

  const loadCapacitors = document.querySelector(
    'input[name="oscillatorCapacitors"]:checked',
  ).value;

  const config = {
    loadCapacitors,
  };

  if (loadCapacitors === "internal") {
    config.loadCapacitanceFemtofarad = parseInt(
      document.getElementById("oscillatorLoadCapacitance").value,
    );
  }

  let removed = false;
  do {
    const existingIndex = state.selectedPeripherals.findIndex(
      (p) => p.id === currentOscillator.id,
    );
    if (existingIndex !== -1) {
      state.selectedPeripherals.splice(existingIndex, 1);
      removed = true;
    } else {
      removed = false;
    }
  } while (removed);

  if (currentOscillator.signals && currentOscillator.signals.length > 0) {
    currentOscillator.signals.forEach((s) => {
      if (s.allowedGpio && s.allowedGpio.length > 0) {
        const pinName = s.allowedGpio[0];
        if (
          state.usedPins[pinName] &&
          state.usedPins[pinName].peripheral === currentOscillator.id
        ) {
          delete state.usedPins[pinName];
        }
      }
    });
  }

  state.selectedPeripherals.push({
    id: currentOscillator.id,
    description: currentOscillator.description,
    config,
  });

  if (currentOscillator.signals && currentOscillator.signals.length > 0) {
    currentOscillator.signals.forEach((s) => {
      if (s.allowedGpio && s.allowedGpio.length > 0) {
        const pinName = s.allowedGpio[0];
        state.usedPins[pinName] = {
          peripheral: currentOscillator.id,
          function: s.name,
          required: s.isMandatory || true,
        };
      }
    });
  }

  updateSelectedPeripheralsList();
  organizePeripherals();
  updatePinDisplay();
  updateConsoleConfig();
  closeOscillatorConfig();
  saveStateToLocalStorage();
}
