// --- GLOBAL STATE ---
let mcuManifest = {}; // Holds the content of manifest.json
let mcuData = {}; // Holds data for the currently selected MCU package
let selectedPeripherals = [];
let usedPins = {};
let usedAddresses = {}; // Track used address spaces
let currentPeripheral = null;
let tempSelectedPins = {}; // Used for storing pin selections temporarily during modal dialog

// --- INITIALIZATION ---
document.addEventListener("DOMContentLoaded", function () {
  console.log("Initializing nRF54L Pin Planner...");

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

  // Add scroll-wheel selection to dropdowns
  enableScrollWheelSelection("mcuSelector");
  enableScrollWheelSelection("packageSelector");

  // Initial data load and package population
  initializeApp();
});

function enableScrollWheelSelection(selectorId) {
  const selector = document.getElementById(selectorId);
  if (!selector) return;
  enableScrollWheelSelectionForElement(selector);
}

function enableScrollWheelSelectionForElement(selector) {
  if (!selector) return;

  selector.addEventListener(
    "wheel",
    function (event) {
      // Prevent the page from scrolling
      event.preventDefault();

      const direction = Math.sign(event.deltaY);
      const currentIndex = selector.selectedIndex;
      const numOptions = selector.options.length;

      if (numOptions === 0) return;

      // Find the next enabled option in the scroll direction
      let nextIndex = currentIndex + direction;

      // Keep moving in the direction until we find an enabled option or reach the end
      while (nextIndex >= 0 && nextIndex < numOptions) {
        const option = selector.options[nextIndex];
        // Skip disabled options and empty value options (like "-- Select Pin --")
        if (!option.disabled && option.value !== "") {
          break;
        }
        nextIndex += direction;
      }

      // Clamp to valid range and only change if we found a valid option
      nextIndex = Math.max(0, Math.min(nextIndex, numOptions - 1));

      if (nextIndex !== currentIndex && !selector.options[nextIndex].disabled) {
        selector.selectedIndex = nextIndex;
        // Dispatch a change event to trigger the application's logic
        selector.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { passive: false },
  ); // passive: false is required to use preventDefault
}

async function initializeApp() {
  try {
    const response = await fetch("mcus/manifest.json");
    if (!response.ok) throw new Error("Manifest file not found.");
    mcuManifest = await response.json();
    populateMcuSelector();
  } catch (error) {
    console.error("Failed to initialize application:", error);
    alert(
      "Could not load MCU manifest. The application may not function correctly.",
    );
  }
}

function populateMcuSelector() {
  const mcuSelector = document.getElementById("mcuSelector");
  mcuSelector.innerHTML = "";
  mcuManifest.mcus.forEach((mcu) => {
    const option = document.createElement("option");
    option.value = mcu.id;
    option.textContent = mcu.name;
    option.dataset.packages = JSON.stringify(mcu.packages);
    mcuSelector.appendChild(option);
  });
  handleMcuChange();
}

// --- DATA LOADING AND UI REFRESH ---

async function handleMcuChange() {
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
    reinitializeView(true); // No packages, clear view
  }
}

async function handlePackageChange() {
  await loadCurrentMcuData();
}

async function loadCurrentMcuData() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  if (mcu && pkg) {
    await loadMCUData(mcu, pkg);
  }
}

async function loadMCUData(mcu, pkg) {
  const path = `mcus/${mcu}/${pkg}.json`;
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`File not found or invalid: ${path}`);
    }
    mcuData = await response.json();
    console.log(`Loaded data for ${mcuData.partInfo.partNumber}`);

    // Load devicetree templates for this MCU
    deviceTreeTemplates = await loadDeviceTreeTemplates(mcu);

    reinitializeView();
  } catch (error) {
    console.error("Error loading MCU data:", error);
    alert(`Could not load data for ${mcu} - ${pkg}.\n${error.message}`);
    reinitializeView(true); // Clear the view on error
  }
}

function reinitializeView(clearOnly = false) {
  resetState();

  if (clearOnly || !mcuData.partInfo) {
    document.getElementById("chipTitleDisplay").textContent = "No MCU Loaded";
    organizePeripherals();
    createPinLayout();
    updateSelectedPeripheralsList();
    updatePinDisplay();
    return;
  }

  // Add oscillators to peripheral list
  addOscillatorsToPeripherals();

  // Auto-select HFXO with default configuration
  autoSelectHFXO();

  document.getElementById("chipTitleDisplay").textContent =
    `${mcuData.partInfo.packageType} Pin Layout`;
  organizePeripherals();
  createPinLayout();

  loadStateFromLocalStorage();

  // Ensure HFXO is always selected after loading state (and remove duplicates)
  const hfxoCount = selectedPeripherals.filter((p) => p.id === "HFXO").length;
  if (hfxoCount === 0) {
    // No HFXO found, add it
    const hfxo = mcuData.socPeripherals.find((p) => p.id === "HFXO");
    if (hfxo) {
      selectedPeripherals.push({
        id: "HFXO",
        description: hfxo.description,
        config: { ...hfxo.config },
      });
    }
  } else if (hfxoCount > 1) {
    // Multiple HFXO found, keep only the first one
    const firstHfxo = selectedPeripherals.find((p) => p.id === "HFXO");
    // Remove all HFXO instances
    for (let i = selectedPeripherals.length - 1; i >= 0; i--) {
      if (selectedPeripherals[i].id === "HFXO") {
        selectedPeripherals.splice(i, 1);
      }
    }
    // Add back just one
    selectedPeripherals.push(firstHfxo);
  }

  organizePeripherals(); // Re-render to show HFXO as selected
  updateSelectedPeripheralsList();
  updatePinDisplay();
  console.log(
    "Initialization complete. Peripherals loaded:",
    mcuData.socPeripherals.length,
  );
}

// --- PERIPHERAL ORGANIZATION AND DISPLAY ---

function addOscillatorsToPeripherals() {
  if (!mcuData.socPeripherals) {
    mcuData.socPeripherals = [];
  }

  // Find existing LFXO (might be defined with checkbox uiHint)
  const lfxoIndex = mcuData.socPeripherals.findIndex((p) => p.id === "LFXO");

  if (lfxoIndex !== -1) {
    // LFXO exists - convert it to oscillator type
    const lfxo = mcuData.socPeripherals[lfxoIndex];
    lfxo.uiHint = "oscillator";
    lfxo.optional = true;
    if (!lfxo.config) {
      lfxo.config = {
        loadCapacitors: "internal",
        loadCapacitanceFemtofarad: 15000,
      };
    }
  } else {
    // Add LFXO as optional oscillator
    mcuData.socPeripherals.push({
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

  // Find or add HFXO
  const hfxoIndex = mcuData.socPeripherals.findIndex((p) => p.id === "HFXO");

  if (hfxoIndex !== -1) {
    // HFXO exists - convert it to oscillator type
    const hfxo = mcuData.socPeripherals[hfxoIndex];
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
    // Add HFXO as required oscillator
    mcuData.socPeripherals.push({
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

function autoSelectHFXO() {
  // Remove any existing HFXO first (prevent duplicates)
  const existingIndex = selectedPeripherals.findIndex((p) => p.id === "HFXO");
  if (existingIndex !== -1) {
    selectedPeripherals.splice(existingIndex, 1);
  }

  const hfxo = mcuData.socPeripherals.find((p) => p.id === "HFXO");
  if (hfxo) {
    selectedPeripherals.push({
      id: "HFXO",
      description: hfxo.description,
      config: { ...hfxo.config },
    });
    updateSelectedPeripheralsList();
  }
}

function organizePeripherals() {
  const peripheralsListContainer = document.getElementById("peripherals-list");
  if (!peripheralsListContainer) return;
  peripheralsListContainer.innerHTML = "";

  if (!mcuData.socPeripherals) return;

  const checkboxPeripherals = [];
  const oscillators = [];
  const singleInstancePeripherals = [];
  const multiInstanceGroups = {};

  // First, separate out checkbox peripherals, oscillators, and group the rest
  mcuData.socPeripherals.forEach((p) => {
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

  // Now separate single from multi-instance from the groups
  for (const baseName in multiInstanceGroups) {
    if (multiInstanceGroups[baseName].length === 1) {
      singleInstancePeripherals.push(multiInstanceGroups[baseName][0]);
      delete multiInstanceGroups[baseName];
    }
  }

  // Sort the lists alphabetically
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

    // Check if oscillator is selected
    const isSelected = selectedPeripherals.some((sp) => sp.id === p.id);
    if (isSelected) {
      btn.classList.add("selected");
    }

    // HFXO is always present, show as configured
    if (p.id === "HFXO") {
      btn.textContent = `${p.description} (Configure)`;
      btn.addEventListener("click", () => openOscillatorConfig(p));
    } else {
      // LFXO is optional - always opens config modal
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
  addGpioBtn.addEventListener("click", openGpioModal);
  gpioSection.appendChild(addGpioBtn);

  peripheralsListContainer.appendChild(gpioSection);
}

function handlePeripheralClick(peripheral) {
  const isSelected = selectedPeripherals.some((p) => p.id === peripheral.id);
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

// --- PIN LAYOUT AND DETAILS ---

function createPinElement(pinInfo) {
  const pinElement = document.createElement("div");
  pinElement.className = "pin";
  pinElement.dataset.number = pinInfo.packagePinId;
  pinElement.dataset.name = pinInfo.name;
  pinElement.textContent = pinInfo.packagePinId;

  if (pinInfo.isClockCapable) pinElement.classList.add("clock");
  const specialTypes = [
    "power_positive",
    "power_ground",
    "debug",
    "crystal_hf",
    "crystal_lf",
    "rf_antenna",
  ];
  if (specialTypes.includes(pinInfo.defaultType)) {
    pinElement.classList.add(pinInfo.defaultType.replace("_", "-"));
  }

  pinElement.addEventListener("click", () => showPinDetails(pinInfo));
  return pinElement;
}

function createPinLayout() {
  const chipContainer = document.querySelector(".chip-container");
  chipContainer.innerHTML = "";
  if (!mcuData.renderConfig || !mcuData.pins) return;

  const chipBody = document.createElement("div");
  chipBody.className = "chip-body";
  chipContainer.appendChild(chipBody);

  const strategy = mcuData.renderConfig.layoutStrategy;
  const padding = mcuData.renderConfig.canvasDefaults?.padding || 20;
  const containerSize = 400;

  if (strategy.layoutType === "quadPerimeter") {
    const pinsBySide = {
      left: mcuData.pins
        .filter((p) => p.side === "left")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
      bottom: mcuData.pins
        .filter((p) => p.side === "bottom")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
      right: mcuData.pins
        .filter((p) => p.side === "right")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
      top: mcuData.pins
        .filter((p) => p.side === "top")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
    };

    const activeArea = containerSize - 2 * padding;

    const placePins = (side, pins) => {
      const len = pins.length;
      if (len === 0) return;
      const spacing = activeArea / (len + 1);

      pins.forEach((pinInfo, index) => {
        const pinElement = createPinElement(pinInfo);
        const pos = padding + (index + 1) * spacing;

        switch (side) {
          case "left":
            pinElement.style.left = "0px";
            pinElement.style.top = pos + "px";
            pinElement.style.transform = "translate(-50%, -50%)";
            break;
          case "bottom":
            pinElement.style.bottom = "0px";
            pinElement.style.left = pos + "px";
            pinElement.style.transform = "translate(-50%, 50%)";
            break;
          case "right":
            pinElement.style.right = "0px";
            pinElement.style.top = containerSize - pos + "px";
            pinElement.style.transform = "translate(50%, -50%)";
            break;
          case "top":
            pinElement.style.top = "0px";
            pinElement.style.left = containerSize - pos + "px";
            pinElement.style.transform = "translate(-50%, -50%)";
            break;
        }
        chipContainer.appendChild(pinElement);
      });
    };

    placePins("left", pinsBySide.left);
    placePins("bottom", pinsBySide.bottom);
    placePins("right", pinsBySide.right);
    placePins("top", pinsBySide.top);
  } else if (strategy.layoutType === "gridMatrix") {
    const { rowLabels, columnLabels } = strategy;
    const activeArea = containerSize - 2 * padding;

    // Handle cases with a single row or column to avoid division by zero
    const cellWidth =
      columnLabels.length > 1
        ? activeArea / (columnLabels.length - 1)
        : activeArea;
    const cellHeight =
      rowLabels.length > 1 ? activeArea / (rowLabels.length - 1) : activeArea;

    const pinMap = new Map(mcuData.pins.map((p) => [p.gridCoordinates, p]));

    for (let r = 0; r < rowLabels.length; r++) {
      for (let c = 0; c < columnLabels.length; c++) {
        const coord = `${rowLabels[r]}${columnLabels[c]}`;

        if (pinMap.has(coord)) {
          const pinInfo = pinMap.get(coord);
          const pinElement = createPinElement(pinInfo);

          pinElement.style.position = "absolute";
          // For a single item, center it. Otherwise, distribute along the axis.
          const leftPos =
            columnLabels.length > 1
              ? c * cellWidth + padding
              : containerSize / 2;
          const topPos =
            rowLabels.length > 1 ? r * cellHeight + padding : containerSize / 2;

          pinElement.style.top = `${topPos}px`;
          pinElement.style.left = `${leftPos}px`;
          pinElement.style.transform = "translate(-50%, -50%)";

          chipContainer.appendChild(pinElement);
        }
      }
    }
  }
}

function showPinDetails(pinInfo) {
  const detailsElement = document.getElementById("pinDetails");

  let usedByHtml = "";
  if (usedPins[pinInfo.name]) {
    const usage = usedPins[pinInfo.name];
    usedByHtml = `
            <tr>
                <td>Used by</td>
                <td>${usage.peripheral} (${usage.function})</td>
            </tr>
        `;
  }

  const functions = pinInfo.functions || [];
  const functionsHtml =
    functions.length > 0
      ? `<tr>
               <td>Functions</td>
               <td>${functions.join("<br>")}</td>
           </tr>`
      : "";

  detailsElement.innerHTML = `
        <h3>${pinInfo.name} (Pin ${pinInfo.packagePinId})</h3>
        <table class="pin-details-table">
            <tbody>
                <tr>
                    <td>Type</td>
                    <td>${pinInfo.defaultType}</td>
                </tr>
                ${pinInfo.isClockCapable ? "<tr><td>Attribute</td><td>Clock capable</td></tr>" : ""}
                ${usedByHtml}
                ${functionsHtml}
            </tbody>
        </table>
    `;
}

// --- STATE MANAGEMENT ---

function resetState() {
  selectedPeripherals = [];
  usedPins = {};
  usedAddresses = {};
  document
    .querySelectorAll('input[type="checkbox"][data-peripheral-id]')
    .forEach((cb) => {
      cb.checked = false;
    });
  if (mcuData.pins) {
    setHFXtalAsSystemRequirement();
  }
}

function clearAllPeripherals() {
  if (!confirm("Are you sure you want to clear all peripherals?")) {
    return;
  }
  resetState();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  saveStateToLocalStorage();
}

// --- PERSISTENCE ---

function getPersistenceKey() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  if (!mcu || !pkg) return null;
  return `pinPlannerConfig-${mcu}-${pkg}`;
}

function saveStateToLocalStorage() {
  const key = getPersistenceKey();
  if (!key) return;

  const config = {
    selectedPeripherals: selectedPeripherals.map((p) => ({
      id: p.id,
      pinFunctions: p.pinFunctions,
    })),
  };
  localStorage.setItem(key, JSON.stringify(config));
  console.log(`State saved for ${key}`);
}

function applyConfig(config) {
  if (!config || !config.selectedPeripherals) return;

  for (const p_config of config.selectedPeripherals) {
    const p_data = mcuData.socPeripherals.find((p) => p.id === p_config.id);
    if (p_data) {
      // Handle oscillators
      if (p_data.uiHint === "oscillator") {
        selectedPeripherals.push({
          id: p_data.id,
          description: p_data.description,
          config: p_config.config || p_data.config,
        });
        // Mark oscillator pins as used if they have signals
        if (p_data.signals && p_data.signals.length > 0) {
          p_data.signals.forEach((s) => {
            if (s.allowedGpio && s.allowedGpio.length > 0) {
              const pinName = s.allowedGpio[0];
              usedPins[pinName] = {
                peripheral: p_data.id,
                function: s.name,
                required: s.isMandatory || true,
              };
            }
          });
        }
      }
      // Handle simple checkbox peripherals
      else if (p_data.uiHint === "checkbox") {
        const checkbox = document.getElementById(
          `${p_data.id.toLowerCase()}-checkbox`,
        );
        if (checkbox) checkbox.checked = true;

        const pinFunctions = {};
        p_data.signals.forEach((s) => {
          const pinName = s.allowedGpio[0];
          usedPins[pinName] = {
            peripheral: p_data.id,
            function: s.name,
            required: true,
          };
          pinFunctions[pinName] = s.name;
        });
        selectedPeripherals.push({
          id: p_data.id,
          peripheral: p_data,
          pinFunctions,
        });
      } else {
        // Handle modal-based peripherals
        selectedPeripherals.push({
          id: p_data.id,
          peripheral: p_data,
          pinFunctions: p_config.pinFunctions,
        });
        for (const pinName in p_config.pinFunctions) {
          const signal = p_data.signals.find(
            (s) => s.name === p_config.pinFunctions[pinName],
          );
          usedPins[pinName] = {
            peripheral: p_data.id,
            function: p_config.pinFunctions[pinName],
            required: signal ? signal.isMandatory : false,
          };
        }
        if (p_data.baseAddress) {
          usedAddresses[p_data.baseAddress] = p_data.id;
        }
      }
    }
  }
}

function loadStateFromLocalStorage() {
  const key = getPersistenceKey();
  if (!key) return;

  const savedState = localStorage.getItem(key);
  if (!savedState) {
    console.log(`No saved state found for ${key}`);
    return;
  }

  try {
    const config = JSON.parse(savedState);
    applyConfig(config);
    console.log(`State loaded for ${key}`);
  } catch (error) {
    console.error("Failed to load or parse saved state:", error);
    localStorage.removeItem(key);
  }
}

function setHFXtalAsSystemRequirement() {
  if (!mcuData.pins) return;
  const hfxtalPins = mcuData.pins.filter((p) => p.defaultType === "crystal_hf");
  if (hfxtalPins.length === 2) {
    usedPins[hfxtalPins[0].name] = {
      peripheral: "32MHz Crystal",
      function: "XC1",
      isSystem: true,
    };
    usedPins[hfxtalPins[1].name] = {
      peripheral: "32MHz Crystal",
      function: "XC2",
      isSystem: true,
    };
  }
}

function toggleSimplePeripheral(event) {
  const checkbox = event.target;
  const peripheralId = checkbox.dataset.peripheralId;
  const peripheral = mcuData.socPeripherals.find((p) => p.id === peripheralId);

  if (!peripheral) {
    console.error(
      `Peripheral with ID '${peripheralId}' not found in socPeripherals.`,
    );
    return;
  }

  const pinNames = peripheral.signals.map((s) => s.allowedGpio[0]);

  if (checkbox.checked) {
    if (pinNames.some((pin) => usedPins[pin])) {
      alert(
        `One or more pins for ${peripheral.description} are already in use.`,
      );
      checkbox.checked = false;
      return;
    }
    const pinFunctions = {};
    peripheral.signals.forEach((s) => {
      const pinName = s.allowedGpio[0];
      usedPins[pinName] = {
        peripheral: peripheral.id,
        function: s.name,
        required: true,
      };
      pinFunctions[pinName] = s.name;
    });
    selectedPeripherals.push({ id: peripheral.id, peripheral, pinFunctions });
  } else {
    pinNames.forEach((pin) => delete usedPins[pin]);
    const index = selectedPeripherals.findIndex((p) => p.id === peripheral.id);
    if (index !== -1) selectedPeripherals.splice(index, 1);
  }
  updateSelectedPeripheralsList();
  updatePinDisplay();
  saveStateToLocalStorage();
}

// --- PIN SELECTION MODAL ---

function openPinSelectionModal(
  peripheral,
  existingPins = {},
  existingConfig = {},
) {
  currentPeripheral = peripheral;
  tempSelectedPins = { ...existingPins }; // Pre-populate if editing

  document.getElementById("modalTitle").textContent =
    `Select Pins for ${peripheral.id}`;
  populatePinSelectionTable(peripheral);

  // Show/hide UART config section based on peripheral type
  const uartConfigSection = document.getElementById("uartConfigSection");
  const uartDisableRxCheckbox = document.getElementById("uartDisableRx");
  if (peripheral.type === "UART") {
    uartConfigSection.style.display = "block";
    uartDisableRxCheckbox.checked = existingConfig.disableRx || false;
    // Add event listener to update RXD required status
    uartDisableRxCheckbox.onchange = updateRxdRequiredStatus;
    // Update initial state
    updateRxdRequiredStatus();
  } else {
    uartConfigSection.style.display = "none";
    uartDisableRxCheckbox.checked = false;
    uartDisableRxCheckbox.onchange = null;
  }

  // Show/hide SPI config section based on peripheral type
  const spiConfigSection = document.getElementById("spiConfigSection");
  if (peripheral.type === "SPI") {
    spiConfigSection.style.display = "block";
    initSpiCsGpioList(existingConfig.extraCsGpios || []);
  } else {
    spiConfigSection.style.display = "none";
  }

  document.getElementById("pinSelectionModal").style.display = "block";
}

function closePinSelectionModal() {
  document.getElementById("pinSelectionModal").style.display = "none";
  currentPeripheral = null;
  tempSelectedPins = {};
}

function updateRxdRequiredStatus() {
  const disableRxChecked = document.getElementById("uartDisableRx").checked;
  const tableBody = document.getElementById("pinSelectionTableBody");
  const rows = tableBody.querySelectorAll("tr");

  rows.forEach((row) => {
    const functionCell = row.querySelector("td:first-child");
    const requiredCell = row.querySelector("td:nth-child(2)");
    if (functionCell && requiredCell && functionCell.textContent === "RXD") {
      requiredCell.textContent = disableRxChecked ? "No" : "Yes";
    }
  });
}

// --- SPI CS GPIO MANAGEMENT ---

let tempSpiCsGpios = [];

function initSpiCsGpioList(existingCsGpios) {
  tempSpiCsGpios = [...existingCsGpios];
  renderSpiCsGpioList();
}

function renderSpiCsGpioList() {
  const container = document.getElementById("spiCsGpioList");
  container.innerHTML = "";

  tempSpiCsGpios.forEach((gpio, index) => {
    // Get list of other CS GPIOs (exclude current one from the exclude list)
    const otherCsGpios = tempSpiCsGpios.filter((g, i) => i !== index && g);

    const row = document.createElement("div");
    row.style.cssText =
      "display: flex; align-items: center; gap: 10px; margin-bottom: 8px;";
    row.innerHTML = `
      <select data-cs-index="${index}" style="flex: 1;">
        ${getGpioPinOptions(gpio, true, otherCsGpios)}
      </select>
      <button type="button" class="remove-cs-btn" data-cs-index="${index}" style="padding: 4px 8px;">Remove</button>
    `;
    container.appendChild(row);
  });

  // Attach event listeners
  container.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", (e) => {
      const index = parseInt(e.target.dataset.csIndex);
      tempSpiCsGpios[index] = e.target.value;
      // Re-render to update disabled states
      renderSpiCsGpioList();
    });
    enableScrollWheelSelectionForElement(select);
  });

  container.querySelectorAll(".remove-cs-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const index = parseInt(e.target.dataset.csIndex);
      tempSpiCsGpios.splice(index, 1);
      renderSpiCsGpioList();
    });
  });
}

function getGpioPinOptions(selectedPin, filterUsed = false, excludePins = []) {
  if (!mcuData.pins) return '<option value="">-- Select GPIO --</option>';

  const gpioPins = mcuData.pins
    .filter(
      (pin) =>
        Array.isArray(pin.functions) && pin.functions.includes("Digital I/O"),
    )
    .sort((a, b) => {
      const aMatch = a.name.match(/P(\d+)\.(\d+)/);
      const bMatch = b.name.match(/P(\d+)\.(\d+)/);
      if (!aMatch || !bMatch) return a.name.localeCompare(b.name);
      const aPort = parseInt(aMatch[1]);
      const bPort = parseInt(bMatch[1]);
      const aPin = parseInt(aMatch[2]);
      const bPin = parseInt(bMatch[2]);
      if (aPort !== bPort) return aPort - bPort;
      return aPin - bPin;
    });

  let options = '<option value="">-- Select GPIO --</option>';
  gpioPins.forEach((pin) => {
    const isSelected = pin.name === selectedPin;

    // Check if pin should be disabled
    let isDisabled = false;
    if (filterUsed && !isSelected) {
      // Check if used by other peripherals
      if (usedPins[pin.name]) {
        isDisabled = true;
      }
      // Check if used by pins selected in the current modal
      if (tempSelectedPins[pin.name]) {
        isDisabled = true;
      }
      // Check if in the exclude list (other CS pins in the same list)
      if (excludePins.includes(pin.name)) {
        isDisabled = true;
      }
    }

    options += `<option value="${pin.name}" ${isSelected ? "selected" : ""} ${isDisabled ? "disabled" : ""}>${pin.name}${isDisabled ? " (in use)" : ""}</option>`;
  });
  return options;
}

function addSpiCsGpio() {
  tempSpiCsGpios.push("");
  renderSpiCsGpioList();
}

// Set up SPI CS GPIO add button listener
document
  .getElementById("addSpiCsGpioBtn")
  .addEventListener("click", addSpiCsGpio);

// --- GPIO PIN ALLOCATION ---

let currentGpioEdit = null; // Track if we're editing an existing GPIO

function openGpioModal(existingGpio = null) {
  currentGpioEdit = existingGpio;

  const titleEl = document.getElementById("gpioModalTitle");
  const labelInput = document.getElementById("gpioLabelInput");
  const pinSelect = document.getElementById("gpioPinSelect");
  const activeStateSelect = document.getElementById("gpioActiveStateSelect");
  const errorEl = document.getElementById("gpioError");

  // Set title based on edit/add mode
  titleEl.textContent = existingGpio ? "Edit GPIO Pin" : "Add GPIO Pin";

  // Populate pin dropdown (filter used pins)
  pinSelect.innerHTML = getGpioPinOptions(
    existingGpio ? existingGpio.pin : "",
    true,
  );
  enableScrollWheelSelectionForElement(pinSelect);

  // Set values if editing
  if (existingGpio) {
    labelInput.value = existingGpio.label;
    activeStateSelect.value = existingGpio.activeState || "active-high";
  } else {
    labelInput.value = "";
    activeStateSelect.value = "active-high";
  }

  errorEl.style.display = "none";
  document.getElementById("gpioModal").style.display = "block";
}

function closeGpioModal() {
  document.getElementById("gpioModal").style.display = "none";
  currentGpioEdit = null;
}

function confirmGpioModal() {
  const labelInput = document.getElementById("gpioLabelInput");
  const pinSelect = document.getElementById("gpioPinSelect");
  const activeStateSelect = document.getElementById("gpioActiveStateSelect");
  const errorEl = document.getElementById("gpioError");

  const label = labelInput.value.trim().toLowerCase();
  const pin = pinSelect.value;
  const activeState = activeStateSelect.value;

  // Validate label
  if (!label) {
    errorEl.textContent = "Label is required";
    errorEl.style.display = "block";
    return;
  }

  if (!/^[a-z0-9_]+$/.test(label)) {
    errorEl.textContent =
      "Label must contain only lowercase letters, numbers, and underscores";
    errorEl.style.display = "block";
    return;
  }

  // Check for duplicate label (excluding current edit)
  const duplicateLabel = selectedPeripherals.find(
    (p) =>
      p.type === "GPIO" &&
      p.label === label &&
      (!currentGpioEdit || p.id !== currentGpioEdit.id),
  );
  if (duplicateLabel) {
    errorEl.textContent = "A GPIO with this label already exists";
    errorEl.style.display = "block";
    return;
  }

  // Validate pin selection
  if (!pin) {
    errorEl.textContent = "Please select a GPIO pin";
    errorEl.style.display = "block";
    return;
  }

  // Check if pin is already used (excluding current edit)
  if (
    usedPins[pin] &&
    (!currentGpioEdit || usedPins[pin].peripheral !== currentGpioEdit.id)
  ) {
    errorEl.textContent = `Pin ${pin} is already used by ${usedPins[pin].peripheral}`;
    errorEl.style.display = "block";
    return;
  }

  // Remove old GPIO if editing
  if (currentGpioEdit) {
    const oldIndex = selectedPeripherals.findIndex(
      (p) => p.id === currentGpioEdit.id,
    );
    if (oldIndex !== -1) {
      delete usedPins[currentGpioEdit.pin];
      selectedPeripherals.splice(oldIndex, 1);
    }
  }

  // Generate unique ID for GPIO
  const gpioId = `GPIO_${label.toUpperCase()}`;

  // Add new GPIO to selected peripherals
  selectedPeripherals.push({
    id: gpioId,
    type: "GPIO",
    label: label,
    pin: pin,
    activeState: activeState,
  });

  // Mark pin as used
  usedPins[pin] = {
    peripheral: gpioId,
    function: "GPIO",
    required: true,
  };

  updateSelectedPeripheralsList();
  updatePinDisplay();
  closeGpioModal();
  saveStateToLocalStorage();
}

// Set up GPIO modal event listeners
document
  .getElementById("closeGpioModal")
  .addEventListener("click", closeGpioModal);
document
  .getElementById("cancelGpioModal")
  .addEventListener("click", closeGpioModal);
document
  .getElementById("confirmGpioModal")
  .addEventListener("click", confirmGpioModal);
document.getElementById("gpioModal").addEventListener("click", (e) => {
  if (e.target === document.getElementById("gpioModal")) {
    closeGpioModal();
  }
});

function populatePinSelectionTable(peripheral) {
  const tableBody = document.getElementById("pinSelectionTableBody");
  tableBody.innerHTML = "";

  peripheral.signals.forEach((signal) => {
    const row = document.createElement("tr");
    const allPossiblePins = getPinsForSignal(signal);

    let selectionHtml;
    if (allPossiblePins.length === 1 && signal.allowedGpio.length === 1) {
      const pin = allPossiblePins[0];
      selectionHtml = `<label><input type="checkbox" data-signal="${signal.name}" data-pin="${pin.name}"> ${pin.name}</label>`;
    } else {
      let optionsHtml = '<option value="">-- Select Pin --</option>';
      allPossiblePins.forEach((pin) => {
        // Show all pins - updateModalPinAvailability() will handle disabling used ones
        const isSelected = tempSelectedPins[pin.name] === signal.name;
        optionsHtml += `<option value="${pin.name}" ${isSelected ? "selected" : ""}>${pin.name}${pin.isClockCapable ? " (Clock)" : ""}</option>`;
      });
      selectionHtml = `<select data-signal="${signal.name}" ${signal.isMandatory ? "required" : ""}>${optionsHtml}</select>`;
    }

    row.innerHTML = `
            <td>${signal.name}</td>
            <td>${signal.isMandatory ? "Yes" : "No"}</td>
            <td>${selectionHtml}</td>
            <td>${signal.description || ""}</td>
        `;
    tableBody.appendChild(row);
  });

  tableBody
    .querySelectorAll('select, input[type="checkbox"]')
    .forEach((input) => {
      input.addEventListener("change", handlePinSelectionChange);
    });

  // Add scroll-wheel selection to dropdowns in the modal
  tableBody.querySelectorAll("select").forEach((select) => {
    enableScrollWheelSelectionForElement(select);
  });

  updateModalPinAvailability(); // Set initial disabled states
}

function handlePinSelectionChange(event) {
  const input = event.target;
  const signalName = input.dataset.signal;

  // Clear the old pin for this signal, if any
  Object.keys(tempSelectedPins).forEach((pin) => {
    if (tempSelectedPins[pin] === signalName) {
      delete tempSelectedPins[pin];
    }
  });

  // Set the new pin
  if (input.type === "checkbox") {
    if (input.checked) {
      tempSelectedPins[input.dataset.pin] = signalName;
    }
  } else {
    // Dropdown
    if (input.value) {
      tempSelectedPins[input.value] = signalName;
    }
  }

  updateModalPinAvailability();
}

function updateModalPinAvailability() {
  const selects = document.querySelectorAll("#pinSelectionTableBody select");
  const checkboxes = document.querySelectorAll(
    '#pinSelectionTableBody input[type="checkbox"]',
  );

  const pinsSelectedInModal = Object.keys(tempSelectedPins);

  // Update dropdowns
  selects.forEach((select) => {
    const signalForThisSelect = select.dataset.signal;
    for (const option of select.options) {
      const pinName = option.value;
      if (!pinName) continue;

      const isUsedByOtherPeripheral =
        usedPins[pinName] &&
        usedPins[pinName].peripheral !== currentPeripheral.id;
      const isUsedInThisModal =
        pinsSelectedInModal.includes(pinName) &&
        tempSelectedPins[pinName] !== signalForThisSelect;

      option.disabled = isUsedByOtherPeripheral || isUsedInThisModal;
    }
  });

  // Update checkboxes
  checkboxes.forEach((checkbox) => {
    const pinName = checkbox.dataset.pin;
    const signalForThisCheckbox = checkbox.dataset.signal;

    const isUsedByOtherPeripheral =
      usedPins[pinName] &&
      usedPins[pinName].peripheral !== currentPeripheral.id;
    const isUsedInThisModal =
      pinsSelectedInModal.includes(pinName) &&
      tempSelectedPins[pinName] !== signalForThisCheckbox;

    checkbox.disabled = isUsedByOtherPeripheral || isUsedInThisModal;
  });
}

function getPinsForSignal(signal) {
  if (!mcuData.pins) return [];
  const pins = mcuData.pins.filter((pin) => {
    if (!Array.isArray(pin.functions) || !pin.functions.includes("Digital I/O"))
      return false;
    if (signal.requiresClockCapablePin && !pin.isClockCapable) return false;
    return signal.allowedGpio.some((allowed) =>
      allowed.endsWith("*")
        ? pin.port === allowed.slice(0, -1)
        : pin.name === allowed,
    );
  });

  // Sort pins in ascending order: P0.00, P0.01, ..., P1.00, P1.01, ..., P2.00, etc.
  return pins.sort((a, b) => {
    const aMatch = a.name.match(/P(\d+)\.(\d+)/);
    const bMatch = b.name.match(/P(\d+)\.(\d+)/);

    if (!aMatch || !bMatch) return a.name.localeCompare(b.name);

    const aPort = parseInt(aMatch[1]);
    const bPort = parseInt(bMatch[1]);
    const aPin = parseInt(aMatch[2]);
    const bPin = parseInt(bMatch[2]);

    // First sort by port, then by pin number
    if (aPort !== bPort) return aPort - bPort;
    return aPin - bPin;
  });
}

function confirmPinSelection() {
  // Check if Disable RX is checked for UART - if so, RXD is not mandatory
  const disableRxChecked =
    currentPeripheral.type === "UART" &&
    document.getElementById("uartDisableRx").checked;

  const missingSignals = currentPeripheral.signals.filter((s) => {
    // Skip RXD requirement if Disable RX is checked
    if (disableRxChecked && s.name === "RXD") return false;
    return s.isMandatory && !Object.values(tempSelectedPins).includes(s.name);
  });

  if (missingSignals.length > 0) {
    alert(
      `Please select pins for mandatory functions: ${missingSignals.map((s) => s.name).join(", ")}`,
    );
    return;
  }

  for (const pinName in tempSelectedPins) {
    if (
      usedPins[pinName] &&
      usedPins[pinName].peripheral !== currentPeripheral.id
    ) {
      alert(
        `Pin ${pinName} is already used by ${usedPins[pinName].peripheral}.`,
      );
      return;
    }
  }

  const existingIndex = selectedPeripherals.findIndex(
    (p) => p.id === currentPeripheral.id,
  );
  if (existingIndex !== -1) {
    const oldPeripheral = selectedPeripherals[existingIndex];
    for (const pinName in oldPeripheral.pinFunctions) {
      delete usedPins[pinName];
    }
    selectedPeripherals.splice(existingIndex, 1);
  }

  // Build peripheral entry with optional config
  const peripheralEntry = {
    id: currentPeripheral.id,
    peripheral: currentPeripheral,
    pinFunctions: { ...tempSelectedPins },
  };

  // Add UART-specific config if applicable
  if (currentPeripheral.type === "UART") {
    const disableRx = document.getElementById("uartDisableRx").checked;
    if (disableRx) {
      peripheralEntry.config = { disableRx: true };
    }
  }

  // Add SPI-specific config if applicable
  if (currentPeripheral.type === "SPI") {
    const validCsGpios = tempSpiCsGpios.filter(
      (gpio) => gpio && gpio.trim() !== "",
    );
    if (validCsGpios.length > 0) {
      peripheralEntry.config = peripheralEntry.config || {};
      peripheralEntry.config.extraCsGpios = validCsGpios;
    }
  }

  selectedPeripherals.push(peripheralEntry);

  for (const pinName in tempSelectedPins) {
    usedPins[pinName] = {
      peripheral: currentPeripheral.id,
      function: tempSelectedPins[pinName],
      required: currentPeripheral.signals.find(
        (s) => s.name === tempSelectedPins[pinName],
      ).isMandatory,
    };
  }
  if (currentPeripheral.baseAddress) {
    usedAddresses[currentPeripheral.baseAddress] = currentPeripheral.id;
  }

  updateSelectedPeripheralsList();
  updatePinDisplay();
  closePinSelectionModal();
  saveStateToLocalStorage();
}

// --- OSCILLATOR CONFIGURATION ---

let currentOscillator = null;

function openOscillatorConfig(oscillator) {
  currentOscillator = oscillator;

  document.getElementById("oscillatorModalTitle").textContent =
    `Configure ${oscillator.description}`;

  // Get current config if oscillator is already selected
  const existingConfig = selectedPeripherals.find(
    (p) => p.id === oscillator.id,
  );
  const config = existingConfig ? existingConfig.config : oscillator.config;

  // Set radio buttons
  const internalRadio = document.getElementById("oscillatorCapInternal");
  const externalRadio = document.getElementById("oscillatorCapExternal");

  internalRadio.checked = config.loadCapacitors === "internal";
  externalRadio.checked = config.loadCapacitors === "external";

  // Populate load capacitance dropdown based on oscillator type
  const loadCapSelect = document.getElementById("oscillatorLoadCapacitance");
  loadCapSelect.innerHTML = "";

  const template = deviceTreeTemplates
    ? deviceTreeTemplates[oscillator.id]
    : null;
  let min, max, step;

  if (template && template.loadCapacitanceRange) {
    min = template.loadCapacitanceRange.min;
    max = template.loadCapacitanceRange.max;
    step = template.loadCapacitanceRange.step;
  } else {
    // Default ranges
    if (oscillator.id === "LFXO") {
      min = 4000;
      max = 18000;
      step = 500;
    } else {
      // HFXO
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

  // Enable scroll wheel selection on the dropdown
  enableScrollWheelSelectionForElement(loadCapSelect);

  // Set up event listeners for capacitor radio buttons
  const toggleLoadCapacitance = () => {
    const isInternal = internalRadio.checked;
    loadCapSelect.disabled = !isInternal;
  };

  internalRadio.onchange = toggleLoadCapacitance;
  externalRadio.onchange = toggleLoadCapacitance;

  // Initial state
  toggleLoadCapacitance();

  document.getElementById("oscillatorConfigModal").style.display = "block";
}

function closeOscillatorConfig() {
  document.getElementById("oscillatorConfigModal").style.display = "none";
  currentOscillator = null;
}

function confirmOscillatorConfig() {
  if (!currentOscillator) return;

  const loadCapacitors = document.querySelector(
    'input[name="oscillatorCapacitors"]:checked',
  ).value;

  const config = {
    loadCapacitors,
  };

  // Only include load capacitance if internal
  if (loadCapacitors === "internal") {
    config.loadCapacitanceFemtofarad = parseInt(
      document.getElementById("oscillatorLoadCapacitance").value,
    );
  }

  // Remove ALL existing instances of this oscillator (prevent duplicates)
  let removed = false;
  do {
    const existingIndex = selectedPeripherals.findIndex(
      (p) => p.id === currentOscillator.id,
    );
    if (existingIndex !== -1) {
      selectedPeripherals.splice(existingIndex, 1);
      removed = true;
    } else {
      removed = false;
    }
  } while (removed);

  // Clear pins used by this oscillator
  if (currentOscillator.signals && currentOscillator.signals.length > 0) {
    currentOscillator.signals.forEach((s) => {
      if (s.allowedGpio && s.allowedGpio.length > 0) {
        const pinName = s.allowedGpio[0];
        if (
          usedPins[pinName] &&
          usedPins[pinName].peripheral === currentOscillator.id
        ) {
          delete usedPins[pinName];
        }
      }
    });
  }

  // Add oscillator with configuration
  selectedPeripherals.push({
    id: currentOscillator.id,
    description: currentOscillator.description,
    config,
  });

  // Mark oscillator pins as used
  if (currentOscillator.signals && currentOscillator.signals.length > 0) {
    currentOscillator.signals.forEach((s) => {
      if (s.allowedGpio && s.allowedGpio.length > 0) {
        const pinName = s.allowedGpio[0];
        usedPins[pinName] = {
          peripheral: currentOscillator.id,
          function: s.name,
          required: s.isMandatory || true,
        };
      }
    });
  }

  updateSelectedPeripheralsList();
  organizePeripherals(); // Refresh to update button text
  updatePinDisplay(); // Update pin display to show pins as used
  closeOscillatorConfig();
  saveStateToLocalStorage();
}

// --- UI UPDATES ---

function updateSelectedPeripheralsList() {
  const selectedList = document.getElementById("selectedList");
  selectedList.innerHTML = "";

  if (selectedPeripherals.length === 0) {
    selectedList.innerHTML =
      '<li class="empty-message">No peripherals selected yet.</li>';
    return;
  }

  // Remove duplicates (safety check)
  const uniquePeripherals = [];
  const seenIds = new Set();
  selectedPeripherals.forEach((p) => {
    if (!seenIds.has(p.id)) {
      seenIds.add(p.id);
      uniquePeripherals.push(p);
    }
  });

  // Update the actual array if we found duplicates
  if (uniquePeripherals.length !== selectedPeripherals.length) {
    selectedPeripherals.length = 0;
    uniquePeripherals.forEach((p) => selectedPeripherals.push(p));
  }

  selectedPeripherals.forEach((p) => {
    const item = document.createElement("li");
    item.className = "selected-item";

    let details;
    if (p.type === "GPIO") {
      // GPIO pin - show pin and active state
      const activeLabel =
        p.activeState === "active-low" ? "active-low" : "active-high";
      details = `${p.pin} (${activeLabel})`;
    } else if (p.config && p.config.loadCapacitors) {
      // Oscillator - show configuration
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

      // Add pin info for oscillators with signals (like LFXO)
      const oscData = mcuData.socPeripherals.find((sp) => sp.id === p.id);
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
      // Regular peripheral - show pin assignments
      details =
        Object.entries(p.pinFunctions || {})
          .map(([pin, func]) => `${pin}: ${func}`)
          .join(", ") || "Auto-assigned";

      // Add UART config info if applicable
      if (p.config && p.config.disableRx) {
        details += " [RX disabled]";
      }

      // Add SPI extra CS GPIOs info if applicable
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

    // Use label for GPIO pins, id for everything else
    const displayName = p.type === "GPIO" ? `GPIO: ${p.label}` : p.id;

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

function updatePinDisplay() {
  document.querySelectorAll(".pin").forEach((pinElement) => {
    const pinName = pinElement.dataset.name;
    pinElement.classList.remove("used", "required", "system");
    if (usedPins[pinName]) {
      pinElement.classList.add("used");
      if (usedPins[pinName].required) pinElement.classList.add("required");
      if (usedPins[pinName].isSystem) pinElement.classList.add("system");
    }
  });
  updatePeripheralConflictUI();
}

function updatePeripheralConflictUI() {
  document.querySelectorAll("[data-id]").forEach((el) => {
    const id = el.dataset.id;
    if (!mcuData.socPeripherals) return;
    const p = mcuData.socPeripherals.find((p) => p.id === id);
    if (
      p &&
      hasAddressConflict(p) &&
      !selectedPeripherals.some((sp) => sp.id === id)
    ) {
      el.classList.add("disabled");
    } else {
      el.classList.remove("disabled");
    }
  });
}

function hasAddressConflict(peripheral) {
  return peripheral.baseAddress && usedAddresses[peripheral.baseAddress];
}

function removePeripheral(id) {
  const index = selectedPeripherals.findIndex((p) => p.id === id);
  if (index === -1) return;

  const peripheral = selectedPeripherals[index];
  const peripheralData = mcuData.socPeripherals.find((p) => p.id === id);

  // For checkbox-based (simple) peripherals, uncheck the box
  const checkbox = document.getElementById(`${id.toLowerCase()}-checkbox`);
  if (checkbox) {
    checkbox.checked = false;
  }

  // Handle GPIO pins
  if (peripheral.type === "GPIO") {
    if (peripheral.pin && usedPins[peripheral.pin]) {
      delete usedPins[peripheral.pin];
    }
  }
  // Handle oscillators - clear their signal pins
  else if (peripheralData && peripheralData.uiHint === "oscillator") {
    if (peripheralData.signals && peripheralData.signals.length > 0) {
      peripheralData.signals.forEach((s) => {
        if (s.allowedGpio && s.allowedGpio.length > 0) {
          const pinName = s.allowedGpio[0];
          if (usedPins[pinName] && usedPins[pinName].peripheral === id) {
            delete usedPins[pinName];
          }
        }
      });
    }
  } else {
    // Handle regular peripherals with pinFunctions
    for (const pinName in peripheral.pinFunctions) {
      delete usedPins[pinName];
    }
  }

  if (peripheral.peripheral && peripheral.peripheral.baseAddress) {
    delete usedAddresses[peripheral.peripheral.baseAddress];
  }
  selectedPeripherals.splice(index, 1);

  updateSelectedPeripheralsList();
  organizePeripherals(); // Re-render to update button states
  updatePinDisplay();
  saveStateToLocalStorage();
}

function editPeripheral(id) {
  // Handle GPIO pins
  const gpioPeripheral = selectedPeripherals.find(
    (p) => p.id === id && p.type === "GPIO",
  );
  if (gpioPeripheral) {
    openGpioModal(gpioPeripheral);
    return;
  }

  const peripheralData = mcuData.socPeripherals.find((p) => p.id === id);
  if (!peripheralData) return;

  // Handle oscillators
  if (peripheralData.uiHint === "oscillator") {
    openOscillatorConfig(peripheralData);
    return;
  }

  // Checkbox peripherals are not editable via modal
  if (peripheralData.uiHint === "checkbox") {
    return;
  }

  const selected = selectedPeripherals.find((p) => p.id === id);
  if (!selected) return;
  openPinSelectionModal(
    selected.peripheral,
    selected.pinFunctions,
    selected.config || {},
  );
}

// --- BOARD DEFINITION EXPORT ---

let deviceTreeTemplates = null; // Will be loaded per-MCU
let boardInfo = null; // Stores board metadata from user input

async function loadDeviceTreeTemplates(mcuId) {
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

// Helper function to parse pin names like "P1.05" into {port: 1, pin: 5}
function parsePinName(pinName) {
  const match = pinName.match(/P(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    port: parseInt(match[1]),
    pin: parseInt(match[2]),
    name: pinName,
  };
}

function openBoardInfoModal() {
  if (selectedPeripherals.length === 0) {
    alert("No peripherals selected. Please select peripherals first.");
    return;
  }

  // Set up inline validation for board name fields
  setupBoardNameValidation();

  document.getElementById("boardInfoModal").style.display = "block";
  document.getElementById("boardInfoError").style.display = "none";
}

function setupBoardNameValidation() {
  const boardNameInput = document.getElementById("boardNameInput");
  const boardVendorInput = document.getElementById("boardVendorInput");

  // Create or get validation error elements
  let boardNameError = document.getElementById("boardNameInputError");
  if (!boardNameError) {
    boardNameError = document.createElement("small");
    boardNameError.id = "boardNameInputError";
    boardNameError.style.color = "var(--error-color)";
    boardNameError.style.display = "none";
    boardNameError.style.marginTop = "4px";
    boardNameInput.parentElement.appendChild(boardNameError);
  }

  let vendorError = document.getElementById("boardVendorInputError");
  if (!vendorError) {
    vendorError = document.createElement("small");
    vendorError.id = "boardVendorInputError";
    vendorError.style.color = "var(--error-color)";
    vendorError.style.display = "none";
    vendorError.style.marginTop = "4px";
    boardVendorInput.parentElement.appendChild(vendorError);
  }

  // Validation function
  const validateInput = (input, errorElement) => {
    const pattern = /^[a-z0-9_]+$/;
    const value = input.value.trim();

    if (value && !pattern.test(value)) {
      errorElement.textContent =
        "Only lowercase letters, numbers, and underscores allowed";
      errorElement.style.display = "block";
      input.style.borderColor = "var(--error-color)";
      return false;
    } else {
      errorElement.style.display = "none";
      input.style.borderColor = "var(--border-color)";
      return true;
    }
  };

  // Add event listeners
  boardNameInput.addEventListener("input", () =>
    validateInput(boardNameInput, boardNameError),
  );
  boardVendorInput.addEventListener("input", () =>
    validateInput(boardVendorInput, vendorError),
  );
}

function closeBoardInfoModal() {
  document.getElementById("boardInfoModal").style.display = "none";
}

function validateBoardName(name) {
  return /^[a-z0-9_]+$/.test(name);
}

async function confirmBoardInfoAndGenerate() {
  const boardName = document.getElementById("boardNameInput").value.trim();
  const fullName = document.getElementById("boardFullNameInput").value.trim();
  const vendor =
    document.getElementById("boardVendorInput").value.trim() || "custom";
  const revision = document.getElementById("boardRevisionInput").value.trim();
  const description = document
    .getElementById("boardDescriptionInput")
    .value.trim();

  const errorElement = document.getElementById("boardInfoError");

  // Validation
  if (!boardName) {
    errorElement.textContent = "Board name is required.";
    errorElement.style.display = "block";
    return;
  }

  if (!validateBoardName(boardName)) {
    errorElement.textContent =
      "Board name must contain only lowercase letters, numbers, and underscores.";
    errorElement.style.display = "block";
    return;
  }

  if (!fullName) {
    errorElement.textContent = "Full board name is required.";
    errorElement.style.display = "block";
    return;
  }

  if (vendor && !validateBoardName(vendor)) {
    errorElement.textContent =
      "Vendor name must contain only lowercase letters, numbers, and underscores.";
    errorElement.style.display = "block";
    return;
  }

  // Store board info
  boardInfo = {
    name: boardName,
    fullName: fullName,
    vendor: vendor,
    revision: revision,
    description: description,
  };

  closeBoardInfoModal();
  await exportBoardDefinition();
}

async function exportBoardDefinition() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;

  // Load templates if not already loaded
  if (!deviceTreeTemplates) {
    deviceTreeTemplates = await loadDeviceTreeTemplates(mcu);
    if (!deviceTreeTemplates) {
      alert("DeviceTree templates not available for this MCU yet.");
      return;
    }
  }

  try {
    // Generate all board files
    const files = await generateBoardFiles(mcu, pkg);
    await downloadBoardAsZip(files, boardInfo.name);
  } catch (error) {
    console.error("Board definition generation failed:", error);
    alert(`Failed to generate board definition: ${error.message}`);
  }
}

function getMcuSupportsNonSecure(mcuId) {
  const mcuInfo = mcuManifest.mcus.find((m) => m.id === mcuId);
  return mcuInfo ? mcuInfo.supportsNonSecure === true : false;
}

function getMcuSupportsFLPR(mcuId) {
  const mcuInfo = mcuManifest.mcus.find((m) => m.id === mcuId);
  return mcuInfo ? mcuInfo.supportsFLPR === true : false;
}

async function generateBoardFiles(mcu, pkg) {
  const supportsNS = getMcuSupportsNonSecure(mcu);
  const supportsFLPR = getMcuSupportsFLPR(mcu);
  const files = {};

  files["board.yml"] = generateBoardYml(mcu, supportsNS, supportsFLPR);
  files["board.cmake"] = generateBoardCmake(mcu, supportsNS, supportsFLPR);
  files["Kconfig.defconfig"] = generateKconfigDefconfig(mcu, supportsNS);
  files[`Kconfig.${boardInfo.name}`] = generateKconfigBoard(mcu, supportsNS);
  files[`${boardInfo.name}_common.dtsi`] = generateCommonDtsi(mcu);
  files[`${mcu}_cpuapp_common.dtsi`] = generateCpuappCommonDtsi(mcu);
  files[`${boardInfo.name}_${mcu}-pinctrl.dtsi`] = generatePinctrlFile();
  files[`${boardInfo.name}_${mcu}_cpuapp.dts`] = generateMainDts(mcu);
  files[`${boardInfo.name}_${mcu}_cpuapp.yaml`] = generateYamlCapabilities(
    mcu,
    false,
  );
  files[`${boardInfo.name}_${mcu}_cpuapp_defconfig`] = generateDefconfig(false);
  files["README.md"] = generateReadme(mcu, pkg, supportsNS, supportsFLPR);

  // Generate NS-specific files if MCU supports TrustZone-M
  if (supportsNS) {
    files["Kconfig"] = generateKconfigTrustZone(mcu);
    files[`${boardInfo.name}_${mcu}_cpuapp_ns.dts`] = generateNSDts(mcu);
    files[`${boardInfo.name}_${mcu}_cpuapp_ns.yaml`] = generateYamlCapabilities(
      mcu,
      true,
    );
    files[`${boardInfo.name}_${mcu}_cpuapp_ns_defconfig`] =
      generateDefconfig(true);
  }

  // Generate FLPR-specific files if MCU supports FLPR
  if (supportsFLPR) {
    files[`${boardInfo.name}_${mcu}_cpuflpr.dts`] = generateFLPRDts(mcu);
    files[`${boardInfo.name}_${mcu}_cpuflpr.yaml`] = generateFLPRYaml(
      mcu,
      false,
    );
    files[`${boardInfo.name}_${mcu}_cpuflpr_defconfig`] =
      generateFLPRDefconfig(false);
    files[`${boardInfo.name}_${mcu}_cpuflpr_xip.dts`] = generateFLPRXIPDts(mcu);
    files[`${boardInfo.name}_${mcu}_cpuflpr_xip.yaml`] = generateFLPRYaml(
      mcu,
      true,
    );
    files[`${boardInfo.name}_${mcu}_cpuflpr_xip_defconfig`] =
      generateFLPRDefconfig(true);
  }

  return files;
}

function generateBoardYml(mcu, supportsNS, supportsFLPR) {
  const socName = mcu.replace("nrf", "");

  let socSection = `  socs:
    - name: ${mcu}`;

  // Add variants if needed
  if (supportsNS || supportsFLPR) {
    socSection += `
      variants:`;
    if (supportsFLPR) {
      socSection += `
        - name: xip
          cpucluster: cpuflpr`;
    }
    if (supportsNS) {
      socSection += `
        - name: ns
          cpucluster: cpuapp`;
    }
  }

  let boardsList = `${boardInfo.name}/${mcu}/cpuapp`;
  if (supportsNS) {
    boardsList += `
              - ${boardInfo.name}/${mcu}/cpuapp/ns`;
  }
  if (supportsFLPR) {
    boardsList += `
              - ${boardInfo.name}/${mcu}/cpuflpr
              - ${boardInfo.name}/${mcu}/cpuflpr/xip`;
  }

  return `board:
  name: ${boardInfo.name}
  full_name: ${boardInfo.fullName}
  vendor: ${boardInfo.vendor}
${socSection}
runners:
  run_once:
    '--recover':
      - runners:
          - nrfjprog
          - nrfutil
        run: first
        groups:
          - boards:
              - ${boardsList}
    '--erase':
      - runners:
          - nrfjprog
          - jlink
          - nrfutil
        run: first
        groups:
          - boards:
              - ${boardsList}
    '--reset':
      - runners:
          - nrfjprog
          - jlink
          - nrfutil
        run: last
        groups:
          - boards:
              - ${boardsList}
`;
}

function generateBoardCmake(mcu, supportsNS, supportsFLPR) {
  const mcuUpper = mcu.toUpperCase();
  const boardNameUpper = boardInfo.name.toUpperCase();

  let content = `# Copyright (c) 2024 Nordic Semiconductor ASA
# SPDX-License-Identifier: Apache-2.0

if(CONFIG_SOC_${mcuUpper}_CPUAPP)
\tboard_runner_args(jlink "--device=nRF${mcuUpper.substring(3)}_M33" "--speed=4000")
`;

  if (supportsFLPR) {
    if (mcu === "nrf54l15") {
      content += `elseif(CONFIG_SOC_${mcuUpper}_CPUFLPR)
\tboard_runner_args(jlink "--device=nRF${mcuUpper.substring(3)}_RV32")
`;
    } else {
      // L05 and L10 need a JLink script
      content += `elseif(CONFIG_SOC_${mcuUpper}_CPUFLPR)
\tset(JLINKSCRIPTFILE \${CMAKE_CURRENT_LIST_DIR}/support/${mcu}_cpuflpr.JLinkScript)
\tboard_runner_args(jlink "--device=RISC-V" "--speed=4000" "-if SW" "--tool-opt=-jlinkscriptfile \${JLINKSCRIPTFILE}")
`;
    }
  }

  content += `endif()

`;

  if (supportsNS) {
    content += `if(CONFIG_BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS)
\tset(TFM_PUBLIC_KEY_FORMAT "full")
endif()

if(CONFIG_TFM_FLASH_MERGED_BINARY)
\tset_property(TARGET runners_yaml_props_target PROPERTY hex_file tfm_merged.hex)
endif()

`;
  }

  content += `include(\${ZEPHYR_BASE}/boards/common/nrfutil.board.cmake)
include(\${ZEPHYR_BASE}/boards/common/jlink.board.cmake)
`;

  return content;
}

function generateKconfigTrustZone(mcu) {
  const boardNameUpper = boardInfo.name.toUpperCase();
  const mcuUpper = mcu.toUpperCase();
  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# ${boardInfo.fullName} board configuration

if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

DT_NRF_MPC := $(dt_nodelabel_path,nrf_mpc)

config NRF_TRUSTZONE_FLASH_REGION_SIZE
\thex
\tdefault $(dt_node_int_prop_hex,$(DT_NRF_MPC),override-granularity)
\thelp
\t  This defines the flash region size from the TrustZone perspective.
\t  It is used when configuring the TrustZone and when setting alignments
\t  requirements for the partitions.
\t  This abstraction allows us to configure TrustZone without depending
\t  on peripheral-specific symbols.

config NRF_TRUSTZONE_RAM_REGION_SIZE
\thex
\tdefault $(dt_node_int_prop_hex,$(DT_NRF_MPC),override-granularity)
\thelp
\t  This defines the RAM region size from the TrustZone perspective.
\t  It is used when configuring the TrustZone and when setting alignments
\t  requirements for the partitions.
\t  This abstraction allows us to configure TrustZone without depending
\t  on peripheral specific symbols.

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS
`;
}

function generateKconfigDefconfig(mcu, supportsNS) {
  const boardNameUpper = boardInfo.name.toUpperCase();
  const mcuUpper = mcu.toUpperCase();

  let content = `# Copyright (c) 2024 Nordic Semiconductor ASA
# SPDX-License-Identifier: Apache-2.0

config HW_STACK_PROTECTION
\tdefault ARCH_HAS_STACK_PROTECTION

if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP

config ROM_START_OFFSET
\tdefault 0 if PARTITION_MANAGER_ENABLED
\tdefault 0x800 if BOOTLOADER_MCUBOOT

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP
`;

  if (supportsNS) {
    content += `
if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

config BOARD_${boardNameUpper}
\tselect USE_DT_CODE_PARTITION if BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS

config BT_CTLR
\tdefault BT

# By default, if we build for a Non-Secure version of the board,
# enable building with TF-M as the Secure Execution Environment.
config BUILD_WITH_TFM
\tdefault y

endif # BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS
`;
  }

  return content;
}

function generateKconfigBoard(mcu, supportsNS) {
  const boardNameUpper = boardInfo.name.toUpperCase();
  const mcuUpper = mcu.toUpperCase();

  let selectCondition = `BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP`;
  if (supportsNS) {
    selectCondition += ` || BOARD_${boardNameUpper}_${mcuUpper}_CPUAPP_NS`;
  }

  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

config BOARD_${boardNameUpper}
\tselect SOC_${mcuUpper}_CPUAPP if ${selectCondition}
`;
}

function generatePinctrlFile() {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 * SPDX-License-Identifier: Apache-2.0
 */

&pinctrl {
`;

  selectedPeripherals.forEach((p) => {
    const template = deviceTreeTemplates[p.id];
    if (!template) {
      console.warn(`No template found for ${p.id}`);
      return;
    }

    // Generate pinctrl configurations
    content += generatePinctrlForPeripheral(p, template);
  });

  content += "};\n";
  return content;
}

function generateCommonDtsi(mcu) {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${boardInfo.name}_${mcu}-pinctrl.dtsi"

`;

  // Generate peripheral node configurations with pinctrl and status
  // Skip oscillators - they go in cpuapp_common.dtsi instead
  // Skip GPIO pins - they are handled separately
  selectedPeripherals.forEach((p) => {
    // Skip oscillators (LFXO, HFXO) and GPIO pins
    if (p.config && p.config.loadCapacitors) return;
    if (p.type === "GPIO") return;

    const template = deviceTreeTemplates[p.id];
    if (!template) return;
    content += generatePeripheralNode(p, template);
  });

  // Generate GPIO pin nodes
  const gpioPins = selectedPeripherals.filter((p) => p.type === "GPIO");
  if (gpioPins.length > 0) {
    content += generateGpioNodes(gpioPins);
  }

  return content;
}

function generateGpioNodes(gpioPins) {
  let content = "\n/ {\n";

  gpioPins.forEach((gpio) => {
    const pinInfo = parsePinName(gpio.pin);
    if (!pinInfo) return;

    const activeFlag =
      gpio.activeState === "active-low"
        ? "GPIO_ACTIVE_LOW"
        : "GPIO_ACTIVE_HIGH";

    content += `\t${gpio.label}: ${gpio.label} {\n`;
    content += `\t\tgpios = <&gpio${pinInfo.port} ${pinInfo.pin} ${activeFlag}>;\n`;
    content += `\t};\n`;
  });

  content += "};\n";
  return content;
}

function generateCpuappCommonDtsi(mcu) {
  let content = `/*
 * Copyright (c) 2024 Nordic Semiconductor ASA
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* This file is common to the secure and non-secure domain */

#include "${boardInfo.name}_common.dtsi"

/ {
\tchosen {
`;

  // Add console/uart aliases in chosen section if UART is selected
  let hasUart = false;
  selectedPeripherals.forEach((p) => {
    const template = deviceTreeTemplates[p.id];
    if (
      template &&
      template.dtNodeName &&
      template.type === "UART" &&
      !hasUart
    ) {
      content += `\t\tzephyr,console = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,shell-uart = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,uart-mcumgr = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,bt-mon-uart = &${template.dtNodeName};\n`;
      content += `\t\tzephyr,bt-c2h-uart = &${template.dtNodeName};\n`;
      hasUart = true;
    }
  });

  content += `\t\tzephyr,flash-controller = &rram_controller;
\t\tzephyr,flash = &cpuapp_rram;
\t\tzephyr,ieee802154 = &ieee802154;
\t\tzephyr,boot-mode = &boot_mode0;
\t};
};

&cpuapp_sram {
\tstatus = "okay";
};
`;

  // Add LFXO configuration if enabled
  const lfxo = selectedPeripherals.find((p) => p.id === "LFXO");
  if (lfxo && lfxo.config) {
    content += `
&lfxo {
\tload-capacitors = "${lfxo.config.loadCapacitors}";`;
    if (
      lfxo.config.loadCapacitors === "internal" &&
      lfxo.config.loadCapacitanceFemtofarad
    ) {
      content += `
\tload-capacitance-femtofarad = <${lfxo.config.loadCapacitanceFemtofarad}>;`;
    }
    content += `
};
`;
  }

  // Add HFXO configuration (always present)
  const hfxo = selectedPeripherals.find((p) => p.id === "HFXO");
  const hfxoConfig =
    hfxo && hfxo.config
      ? hfxo.config
      : { loadCapacitors: "internal", loadCapacitanceFemtofarad: 15000 };
  content += `
&hfxo {
\tload-capacitors = "${hfxoConfig.loadCapacitors}";`;
  if (
    hfxoConfig.loadCapacitors === "internal" &&
    hfxoConfig.loadCapacitanceFemtofarad
  ) {
    content += `
\tload-capacitance-femtofarad = <${hfxoConfig.loadCapacitanceFemtofarad}>;`;
  }
  content += `
};
`;

  content += `
&regulators {
\tstatus = "okay";
};

&vregmain {
\tstatus = "okay";
\tregulator-initial-mode = <NRF5X_REG_MODE_DCDC>;
};

&grtc {
\towned-channels = <0 1 2 3 4 5 6 7 8 9 10 11>;
\t/* Channels 7-11 reserved for Zero Latency IRQs, 3-4 for FLPR */
\tchild-owned-channels = <3 4 7 8 9 10 11>;
\tstatus = "okay";
};

&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

&gpio2 {
\tstatus = "okay";
};

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};

&radio {
\tstatus = "okay";
};

&ieee802154 {
\tstatus = "okay";
};

&temp {
\tstatus = "okay";
};

&clock {
\tstatus = "okay";
};

&gpregret1 {
\tstatus = "okay";

\tboot_mode0: boot_mode@0 {
\t\tcompatible = "zephyr,retention";
\t\tstatus = "okay";
\t\treg = <0x0 0x1>;
\t};
};
`;

  // Check if NFC pins are not being used as NFC
  let nfcUsed = false;
  selectedPeripherals.forEach((p) => {
    const template = deviceTreeTemplates[p.id];
    if (template && template.type === "NFCT") {
      nfcUsed = true;
    }
  });

  // If NFCT is not enabled, configure UICR to use NFC pins as GPIO
  if (!nfcUsed) {
    content += `
&uicr {
\tnfct-pins-as-gpios;
};
`;
  }

  return content;
}

function generateMainDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  return `/dts-v1/;

#include <nordic/${mcu}_cpuapp.dtsi>
#include "${mcu}_cpuapp_common.dtsi"

/ {
\tcompatible = "${boardInfo.vendor},${boardInfo.name}-${mcu}-cpuapp";
\tmodel = "${boardInfo.fullName} ${mcuUpper} Application MCU";

\tchosen {
\t\tzephyr,code-partition = &slot0_partition;
\t\tzephyr,sram = &cpuapp_sram;
\t};
};

/* Include default memory partition configuration file */
#include <nordic/${mcu}_partition.dtsi>
`;
}

function generateYamlCapabilities(mcu, isNonSecure) {
  const supportedFeatures = new Set();

  selectedPeripherals.forEach((p) => {
    const template = deviceTreeTemplates[p.id];
    if (template) {
      switch (template.type) {
        case "UART":
          supportedFeatures.add("uart");
          break;
        case "SPI":
          supportedFeatures.add("spi");
          break;
        case "I2C":
          supportedFeatures.add("i2c");
          break;
        case "PWM":
          supportedFeatures.add("pwm");
          break;
        case "ADC":
          supportedFeatures.add("adc");
          break;
        case "NFCT":
          supportedFeatures.add("nfc");
          break;
      }
    }
  });

  // Always add these
  supportedFeatures.add("gpio");
  supportedFeatures.add("watchdog");

  const featuresArray = Array.from(supportedFeatures).sort();

  const identifier = isNonSecure
    ? `${boardInfo.name}/${mcu}/cpuapp/ns`
    : `${boardInfo.name}/${mcu}/cpuapp`;
  const name = isNonSecure
    ? `${boardInfo.fullName}-Non-Secure`
    : boardInfo.fullName;
  const ram = isNonSecure ? 256 : 188;
  const flash = isNonSecure ? 1524 : 1428;

  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

identifier: ${identifier}
name: ${name}
type: mcu
arch: arm
toolchain:
  - gnuarmemb
  - zephyr
sysbuild: true
ram: ${ram}
flash: ${flash}
supported:
${featuresArray.map((f) => `  - ${f}`).join("\n")}
vendor: ${boardInfo.vendor}
`;
}

function generateDefconfig(isNonSecure) {
  let config = `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

`;

  if (isNonSecure) {
    // NS-specific configuration
    config += `CONFIG_ARM_MPU=y
CONFIG_HW_STACK_PROTECTION=y
CONFIG_NULL_POINTER_EXCEPTION_DETECTION_NONE=y
CONFIG_ARM_TRUSTZONE_M=y

# This Board implies building Non-Secure firmware
CONFIG_TRUSTED_EXECUTION_NONSECURE=y

# Don't enable the cache in the non-secure image as it is a
# secure-only peripheral on 54l
CONFIG_CACHE_MANAGEMENT=n
CONFIG_EXTERNAL_CACHE=n

CONFIG_UART_CONSOLE=y
CONFIG_CONSOLE=y
CONFIG_SERIAL=y
CONFIG_GPIO=y

# Start SYSCOUNTER on driver init
CONFIG_NRF_GRTC_START_SYSCOUNTER=y

# Disable TFM BL2 since it is not supported
CONFIG_TFM_BL2=n

# Support for silence logging is not supported at the moment
CONFIG_TFM_LOG_LEVEL_SILENCE=n

# The oscillators are configured as secure and cannot be configured
# from the non secure application directly. This needs to be set
# otherwise nrfx will try to configure them, resulting in a bus
# fault.
CONFIG_SOC_NRF54LX_SKIP_CLOCK_CONFIG=y
`;
  } else {
    // Regular secure build configuration
    const hasUart = selectedPeripherals.some((p) => {
      const template = deviceTreeTemplates[p.id];
      return template && template.type === "UART";
    });

    if (hasUart) {
      config += `# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

`;
    }

    config += `# Enable GPIO
CONFIG_GPIO=y

# Enable MPU
CONFIG_ARM_MPU=y

# Enable hardware stack protection
CONFIG_HW_STACK_PROTECTION=y
`;

    // Only add RC oscillator config if LFXO is not enabled
    const lfxoEnabled = selectedPeripherals.some((p) => p.id === "LFXO");
    if (!lfxoEnabled) {
      config += `
# Use RC oscillator for low-frequency clock
CONFIG_CLOCK_CONTROL_NRF_K32SRC_RC=y
`;
    }
  }

  return config;
}

function generateNSDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");

  // Find the UART used for console (if any) - TF-M will use it
  let uartNodeName = null;
  selectedPeripherals.forEach((p) => {
    const template = deviceTreeTemplates[p.id];
    if (
      template &&
      template.dtNodeName &&
      template.type === "UART" &&
      !uartNodeName
    ) {
      uartNodeName = template.dtNodeName;
    }
  });

  let uartDisableSection = "";
  if (uartNodeName) {
    uartDisableSection = `
&${uartNodeName} {
\t/* Disable so that TF-M can use this UART */
\tstatus = "disabled";

\tcurrent-speed = <115200>;
\tpinctrl-0 = <&${uartNodeName.replace(/uart/, "uart")}_default>;
\tpinctrl-1 = <&${uartNodeName.replace(/uart/, "uart")}_sleep>;
\tpinctrl-names = "default", "sleep";
};

`;
  }

  return `/dts-v1/;

#define USE_NON_SECURE_ADDRESS_MAP 1

#include <nordic/${mcu}_cpuapp.dtsi>
#include "${mcu}_cpuapp_common.dtsi"

/ {
\tcompatible = "${boardInfo.vendor},${boardInfo.name}-${mcu}-cpuapp";
\tmodel = "${boardInfo.fullName} ${mcuUpper} Application MCU";

\tchosen {
\t\tzephyr,code-partition = &slot0_ns_partition;
\t\tzephyr,sram = &sram0_ns;
\t\tzephyr,entropy = &psa_rng;
\t};

\t/delete-node/ rng;

\tpsa_rng: psa-rng {
\t\tstatus = "okay";
\t};
};

/ {
\t/*
\t * Default SRAM planning when building for ${mcuUpper} with ARM TrustZone-M support
\t * - Lowest 80 kB SRAM allocated to Secure image (sram0_s).
\t * - Upper 80 kB SRAM allocated to Non-Secure image (sram0_ns).
\t *
\t * ${mcuUpper} has 256 kB of volatile memory (SRAM) but the last 96kB are reserved for
\t * the FLPR MCU.
\t * This static layout needs to be the same with the upstream TF-M layout in the
\t * header flash_layout.h of the relevant platform. Any updates in the layout
\t * needs to happen both in the flash_layout.h and in this file at the same time.
\t */
\treserved-memory {
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;
\t\tranges;

\t\tsram0_s: image_s@20000000 {
\t\t\t/* Secure image memory */
\t\t\treg = <0x20000000 DT_SIZE_K(80)>;
\t\t};

\t\tsram0_ns: image_ns@20014000 {
\t\t\t/* Non-Secure image memory */
\t\t\treg = <0x20014000 DT_SIZE_K(80)>;
\t\t};
\t};
};

${uartDisableSection}/* Include default memory partition configuration file */
#include <nordic/${mcu}_ns_partition.dtsi>
`;
}

function generateFLPRDts(mcu) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  return `/dts-v1/;
#include <nordic/${mcu}_cpuflpr.dtsi>
#include "${boardInfo.name}_common.dtsi"

/ {
\tmodel = "${boardInfo.fullName} ${mcuUpper} FLPR MCU";
\tcompatible = "${boardInfo.vendor},${boardInfo.name}-${mcu}-cpuflpr";

\tchosen {
\t\tzephyr,console = &uart30;
\t\tzephyr,shell-uart = &uart30;
\t\tzephyr,code-partition = &cpuflpr_code_partition;
\t\tzephyr,flash = &cpuflpr_rram;
\t\tzephyr,sram = &cpuflpr_sram;
\t};
};

&cpuflpr_sram {
\tstatus = "okay";
\t/* size must be increased due to booting from SRAM */
\treg = <0x20028000 DT_SIZE_K(96)>;
\tranges = <0x0 0x20028000 0x18000>;
};

&cpuflpr_rram {
\tpartitions {
\t\tcompatible = "fixed-partitions";
\t\t#address-cells = <1>;
\t\t#size-cells = <1>;

\t\tcpuflpr_code_partition: partition@0 {
\t\t\tlabel = "image-0";
\t\t\treg = <0x0 DT_SIZE_K(96)>;
\t\t};
\t};
};

&grtc {
\towned-channels = <3 4>;
\tstatus = "okay";
};

&uart30 {
\tstatus = "okay";
};

&gpio0 {
\tstatus = "okay";
};

&gpio1 {
\tstatus = "okay";
};

&gpio2 {
\tstatus = "okay";
};

&gpiote20 {
\tstatus = "okay";
};

&gpiote30 {
\tstatus = "okay";
};
`;
}

function generateFLPRXIPDts(mcu) {
  return `/*
 * Copyright (c) 2025 Generated by nRF54L Pin Planner
 * SPDX-License-Identifier: Apache-2.0
 */

#include "${boardInfo.name}_${mcu}_cpuflpr.dts"

&cpuflpr_sram {
\treg = <0x2002f000 DT_SIZE_K(68)>;
\tranges = <0x0 0x2002f000 0x11000>;
};
`;
}

function generateFLPRYaml(mcu, isXIP) {
  const mcuUpper = mcu.toUpperCase().replace("NRF", "nRF");
  const identifier = isXIP
    ? `${boardInfo.name}/${mcu}/cpuflpr/xip`
    : `${boardInfo.name}/${mcu}/cpuflpr`;
  const name = isXIP
    ? `${boardInfo.fullName}-Fast-Lightweight-Peripheral-Processor (RRAM XIP)`
    : `${boardInfo.fullName}-Fast-Lightweight-Peripheral-Processor`;
  const ram = isXIP ? 68 : 96;

  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

identifier: ${identifier}
name: ${name}
type: mcu
arch: riscv
toolchain:
  - zephyr
sysbuild: true
ram: ${ram}
flash: 96
supported:
  - counter
  - gpio
  - i2c
  - spi
  - watchdog
`;
}

function generateFLPRDefconfig(isXIP) {
  return `# Copyright (c) 2025 Generated by nRF54L Pin Planner
# SPDX-License-Identifier: Apache-2.0

# Enable UART driver
CONFIG_SERIAL=y

# Enable console
CONFIG_CONSOLE=y
CONFIG_UART_CONSOLE=y

# Enable GPIO
CONFIG_GPIO=y

${isXIP ? "# Execute from RRAM\nCONFIG_XIP=y" : "# Execute from SRAM\nCONFIG_USE_DT_CODE_PARTITION=y\nCONFIG_XIP=n"}
`;
}

function generateReadme(mcu, pkg, supportsNS, supportsFLPR) {
  let readme = `# ${boardInfo.fullName}

**Generated by:** nRF54L Pin Planner
**MCU:** ${mcu.toUpperCase()}
**Package:** ${pkg}
${boardInfo.revision ? `**Revision:** ${boardInfo.revision}\n` : ""}${boardInfo.description ? `\n${boardInfo.description}\n` : ""}

## Usage

1. Copy this directory to your Zephyr boards directory:
   \`\`\`bash
   cp -r ${boardInfo.name} $ZEPHYR_BASE/boards/${boardInfo.vendor}/
   \`\`\`

2. Build your application for this board:
   \`\`\`bash
   west build -b ${boardInfo.name}/${mcu}/cpuapp samples/hello_world
   \`\`\`
`;

  if (supportsNS) {
    readme += `
   Or build for Non-Secure target with TF-M:
   \`\`\`bash
   west build -b ${boardInfo.name}/${mcu}/cpuapp/ns samples/hello_world
   \`\`\`
`;
  }

  if (supportsFLPR) {
    readme += `
   Or build for FLPR (Fast Lightweight Processor):
   \`\`\`bash
   west build -b ${boardInfo.name}/${mcu}/cpuflpr samples/hello_world
   \`\`\`

   Or build for FLPR with XIP (Execute In Place from RRAM):
   \`\`\`bash
   west build -b ${boardInfo.name}/${mcu}/cpuflpr/xip samples/hello_world
   \`\`\`
`;
  }

  readme += `
3. Flash to your device:
   \`\`\`bash
   west flash
   \`\`\`

## Selected Peripherals

${selectedPeripherals
  .map((p) => {
    if (p.config) {
      // Oscillator - show configuration
      const capLabel =
        p.config.loadCapacitors === "internal" ? "Internal" : "External";
      const oscData = mcuData.socPeripherals.find((sp) => sp.id === p.id);
      let info = `${capLabel} capacitors`;
      if (
        p.config.loadCapacitors === "internal" &&
        p.config.loadCapacitanceFemtofarad
      ) {
        info += `, ${(p.config.loadCapacitanceFemtofarad / 1000).toFixed(p.id === "HFXO" ? 2 : 1)} pF`;
      }
      if (oscData && oscData.signals && oscData.signals.length > 0) {
        const pins = oscData.signals
          .filter((s) => s.allowedGpio && s.allowedGpio.length > 0)
          .map((s) => s.allowedGpio[0])
          .join(", ");
        if (pins) {
          info += ` (${pins})`;
        }
      }
      return `- **${p.id}**: ${info}`;
    } else if (p.pinFunctions) {
      // Regular peripheral - show pin assignments
      const pins = Object.entries(p.pinFunctions)
        .map(([pin, func]) => `${pin}: ${func}`)
        .join(", ");
      return `- **${p.id}**: ${pins}`;
    } else {
      // No pin info available
      return `- **${p.id}**`;
    }
  })
  .join("\n")}

## Pin Configuration

See \`${boardInfo.name}_${mcu}-pinctrl.dtsi\` for complete pin mapping.

## Notes

- This is a generated board definition. Verify pin assignments match your hardware.
- Modify \`${boardInfo.name}_common.dtsi\` to add additional peripherals or features.
- Consult the [nRF Connect SDK documentation](https://docs.nordicsemi.com/) for more information.
`;
}

function generatePinctrlForPeripheral(peripheral, template) {
  // Skip pinctrl generation for peripherals that don't need it
  if (template.noPinctrl) {
    return "";
  }

  const pinctrlName = template.pinctrlBaseName;
  let content = `\n\t/omit-if-no-ref/ ${pinctrlName}_default: ${pinctrlName}_default {\n`;

  // Group pins by their characteristics (outputs vs inputs with pull-ups)
  const outputSignals = [];
  const inputSignals = [];

  for (const [pinName, signalName] of Object.entries(peripheral.pinFunctions)) {
    const pinInfo = parsePinName(pinName);
    if (!pinInfo) continue;

    const dtSignalName = template.signalMappings[signalName];
    if (!dtSignalName) {
      console.warn(
        `No DT mapping for signal ${signalName} in ${peripheral.id}`,
      );
      continue;
    }

    const signal = peripheral.peripheral.signals.find(
      (s) => s.name === signalName,
    );
    if (signal && signal.direction === "input") {
      inputSignals.push({ pinInfo, dtSignalName });
    } else {
      outputSignals.push({ pinInfo, dtSignalName });
    }
  }

  const allSignals = [...outputSignals, ...inputSignals];

  // Don't generate empty pinctrl blocks
  if (allSignals.length === 0) {
    console.warn(
      `No pins configured for ${peripheral.id}, skipping pinctrl generation`,
    );
    return "";
  }

  // Generate group1 (outputs and bidirectional)
  if (outputSignals.length > 0) {
    content += `\t\tgroup1 {\n\t\t\tpsels = `;
    content += outputSignals
      .map(
        (s) =>
          `<NRF_PSEL(${s.dtSignalName}, ${s.pinInfo.port}, ${s.pinInfo.pin})>`,
      )
      .join(",\n\t\t\t\t");
    content += `;\n\t\t};\n`;
  }

  // Generate group2 (inputs with pull-up)
  if (inputSignals.length > 0) {
    content += `\n\t\tgroup2 {\n\t\t\tpsels = `;
    content += inputSignals
      .map(
        (s) =>
          `<NRF_PSEL(${s.dtSignalName}, ${s.pinInfo.port}, ${s.pinInfo.pin})>`,
      )
      .join(",\n\t\t\t\t");
    content += `;\n\t\t\tbias-pull-up;\n\t\t};\n`;
  }

  content += `\t};\n`;

  // Generate sleep state
  content += `\n\t/omit-if-no-ref/ ${pinctrlName}_sleep: ${pinctrlName}_sleep {\n`;
  content += `\t\tgroup1 {\n\t\t\tpsels = `;

  content += allSignals
    .map(
      (s) =>
        `<NRF_PSEL(${s.dtSignalName}, ${s.pinInfo.port}, ${s.pinInfo.pin})>`,
    )
    .join(",\n\t\t\t\t");
  content += `;\n\t\t\tlow-power-enable;\n\t\t};\n`;
  content += `\t};\n`;

  return content;
}

function generatePeripheralNode(peripheral, template) {
  const nodeName = template.dtNodeName;
  const pinctrlName = template.pinctrlBaseName;

  let content = `\n&${nodeName} {\n`;
  content += `\tstatus = "okay";\n`;

  // Only add pinctrl if the peripheral needs it
  if (!template.noPinctrl && pinctrlName) {
    content += `\tpinctrl-0 = <&${pinctrlName}_default>;\n`;
    content += `\tpinctrl-1 = <&${pinctrlName}_sleep>;\n`;
    content += `\tpinctrl-names = "default", "sleep";\n`;
  }

  // Add type-specific properties
  switch (template.type) {
    case "UART":
      content += `\tcurrent-speed = <115200>;\n`;
      // Check for disable-rx config
      if (peripheral.config && peripheral.config.disableRx) {
        content += `\tdisable-rx;\n`;
      }
      break;
    case "SPI":
      // Check for out-of-band signals (CS, DCX) and add as comments
      if (template.outOfBandSignals) {
        template.outOfBandSignals.forEach((signal) => {
          const pin = Object.keys(peripheral.pinFunctions).find(
            (p) => peripheral.pinFunctions[p] === signal,
          );
          if (pin) {
            const pinInfo = parsePinName(pin);
            if (pinInfo) {
              content += `\t/* ${signal} pin: P${pinInfo.port}.${pinInfo.pin} */\n`;
            }
          }
        });
      }

      // Build cs-gpios array including primary CS and extra CS GPIOs
      const csGpioEntries = [];

      // Check if primary CS pin is selected
      const csPin = Object.keys(peripheral.pinFunctions).find(
        (pin) => peripheral.pinFunctions[pin] === "CS",
      );
      if (csPin) {
        const csPinInfo = parsePinName(csPin);
        if (csPinInfo) {
          csGpioEntries.push(
            `<&gpio${csPinInfo.port} ${csPinInfo.pin} GPIO_ACTIVE_LOW>`,
          );
        }
      }

      // Add extra CS GPIOs from config
      if (peripheral.config && peripheral.config.extraCsGpios) {
        peripheral.config.extraCsGpios.forEach((gpio) => {
          const pinInfo = parsePinName(gpio);
          if (pinInfo) {
            csGpioEntries.push(
              `<&gpio${pinInfo.port} ${pinInfo.pin} GPIO_ACTIVE_LOW>`,
            );
          }
        });
      }

      // Output cs-gpios if any
      if (csGpioEntries.length > 0) {
        if (csGpioEntries.length === 1) {
          content += `\tcs-gpios = ${csGpioEntries[0]};\n`;
        } else {
          content += `\tcs-gpios = ${csGpioEntries.join(",\n\t\t   ")};\n`;
        }
      }
      break;
    case "I2C":
      content += `\tclock-frequency = <I2C_BITRATE_STANDARD>;\n`;
      break;
  }

  content += `};\n`;
  return content;
}

async function downloadBoardAsZip(files, boardName) {
  // Load JSZip library dynamically if not already loaded
  if (typeof JSZip === "undefined") {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    await new Promise((resolve) => {
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }

  const zip = new JSZip();
  const boardFolder = zip.folder(boardName);

  // Use current date/time for all files to avoid CMake reconfiguration loops
  // Set to a stable past date to prevent future timestamps
  const stableDate = new Date(2024, 0, 1, 12, 0, 0); // Jan 1, 2024 12:00:00

  // Add all generated files to the board directory with stable timestamp
  for (const [filename, content] of Object.entries(files)) {
    boardFolder.file(filename, content, { date: stableDate });
  }

  // Generate and download the ZIP with proper options
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${boardName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function filterPeripherals() {
  const searchTerm = document
    .getElementById("searchPeripherals")
    .value.toLowerCase();
  const peripheralsList = document.getElementById("peripherals-list");

  // Query for all top-level peripheral display elements
  const items = peripheralsList.querySelectorAll(
    ".single-peripheral-btn, .accordion-item, .checkbox-group",
  );

  items.forEach((item) => {
    const text = item.textContent.toLowerCase();

    let tags = [];
    if (mcuData.socPeripherals) {
      if (item.matches(".single-peripheral-btn")) {
        const p = mcuData.socPeripherals.find((p) => p.id === item.dataset.id);
        if (p && p.tags) tags = p.tags;
      } else if (item.matches(".checkbox-group")) {
        const id = item.querySelector("[data-peripheral-id]").dataset
          .peripheralId;
        const p = mcuData.socPeripherals.find((p) => p.id === id);
        if (p && p.tags) tags = p.tags;
      } else if (item.matches(".accordion-item")) {
        item.querySelectorAll(".peripheral-item").forEach((pItem) => {
          const p = mcuData.socPeripherals.find(
            (p) => p.id === pItem.dataset.id,
          );
          if (p && p.tags) tags = tags.concat(p.tags);
        });
      }
    }
    const tagsText = tags.join(" ").toLowerCase();

    if (text.includes(searchTerm) || tagsText.includes(searchTerm)) {
      item.style.display = ""; // Show the item if it matches
    } else {
      item.style.display = "none"; // Hide the item if it doesn't match
    }
  });
}

// --- IMPORT/EXPORT CONFIGURATION ---

let pendingImportConfig = null;
let isExportMode = true;

function openExportConfigModal() {
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

function openImportConfigModal() {
  // Trigger file selection
  document.getElementById("importConfigFile").click();
}

function handleImportConfigFile(event) {
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
    // Reset the file input so the same file can be selected again
    event.target.value = "";
  };
  reader.readAsText(file);
}

function validateAndShowImportModal(config) {
  // Validate required fields
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

  // Add additional warning about overwriting
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

function closeImportExportModal() {
  const modal = document.getElementById("importExportInfoModal");
  modal.style.display = "none";
  pendingImportConfig = null;

  // Remove the overwrite warning if it exists
  const overwriteWarning = document.getElementById("importOverwriteWarning");
  if (overwriteWarning) {
    overwriteWarning.remove();
  }
}

function confirmImportExport() {
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
    selectedPeripherals: selectedPeripherals.map((p) => ({
      id: p.id,
      pinFunctions: p.pinFunctions,
      config: p.config,
    })),
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

  // Check if we need to switch MCU/package
  if (config.mcu !== currentMcu || config.package !== currentPkg) {
    // Switch to the target MCU first
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

    // Then switch to the target package
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

  // Clear current state and apply imported config
  clearAllPeripherals();

  // Apply the imported configuration
  applyConfig({
    selectedPeripherals: config.selectedPeripherals,
  });

  // Save to localStorage
  saveStateToLocalStorage();

  // Update UI - need to re-render peripherals list to show selected state
  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();

  console.log(
    `Configuration imported for ${config.mcu}/${config.package} with ${config.selectedPeripherals.length} peripherals`,
  );
}
