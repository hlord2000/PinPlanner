// --- GLOBAL STATE ---

const state = {
  mcuManifest: {},
  mcuData: {},
  selectedPeripherals: [],
  usedPins: {},
  usedAddresses: {},
  currentPeripheral: null,
  tempSelectedPins: {},
  deviceTreeTemplates: null,
  boardInfo: null,
  consoleUart: null, // Peripheral ID (e.g., "UARTE20") of selected console UART, or null for RTT
  devkitConfig: null, // Loaded devkit config, or null for custom board
  pmicConfig: null, // Selected PMIC configuration, or null when no PMIC is present
};

export default state;

// --- PERSISTENCE ---

const SELECTED_PART_PACKAGE_KEY = "pinPlannerSelectedPartPackage";

export function getSavedPartPackageSelection() {
  const savedSelection = localStorage.getItem(SELECTED_PART_PACKAGE_KEY);
  if (!savedSelection) return null;

  try {
    const selection = JSON.parse(savedSelection);
    if (
      !selection ||
      typeof selection.mcu !== "string" ||
      typeof selection.package !== "string"
    ) {
      localStorage.removeItem(SELECTED_PART_PACKAGE_KEY);
      return null;
    }

    return selection;
  } catch (error) {
    console.error("Failed to load saved MCU/package selection:", error);
    localStorage.removeItem(SELECTED_PART_PACKAGE_KEY);
    return null;
  }
}

export function savePartPackageSelection(mcu, pkg) {
  if (!mcu) return;

  localStorage.setItem(
    SELECTED_PART_PACKAGE_KEY,
    JSON.stringify({
      mcu,
      package: pkg || "",
    }),
  );
}

export function getPersistenceKey() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  if (!mcu || !pkg) return null;
  return `pinPlannerConfig-${mcu}-${pkg}`;
}

export function serializePeripheral(peripheral) {
  if (peripheral.type === "GPIO") {
    return {
      id: peripheral.id,
      type: peripheral.type,
      label: peripheral.label,
      pin: peripheral.pin,
      activeState: peripheral.activeState,
    };
  }

  return {
    id: peripheral.id,
    pinFunctions: peripheral.pinFunctions,
    config: peripheral.config,
  };
}

export function saveStateToLocalStorage() {
  const key = getPersistenceKey();
  if (!key) return;

  const config = {
    selectedPeripherals: state.selectedPeripherals.map(serializePeripheral),
    consoleUart: state.consoleUart,
    pmicConfig: state.pmicConfig,
  };
  localStorage.setItem(key, JSON.stringify(config));
}

function cloneConfig(config) {
  return config ? JSON.parse(JSON.stringify(config)) : null;
}

function markPmicPinsFromConfig(config) {
  if (!config) return;

  if (config.hostInterrupt?.enabled && config.hostInterrupt.hostPin) {
    state.usedPins[config.hostInterrupt.hostPin] = {
      peripheral: "PMIC",
      function: "HOST_INT",
      required: false,
    };
  }

  Object.entries(config.dvsGpios || {}).forEach(([channel, entry]) => {
    if (!entry.enabled || !entry.hostPin) return;

    state.usedPins[entry.hostPin] = {
      peripheral: "PMIC",
      function: `PMIC_GPIO${channel}`,
      required: false,
    };
  });
}

function clearPmicPins() {
  Object.entries(state.usedPins).forEach(([pinName, usage]) => {
    if (usage.peripheral === "PMIC") {
      delete state.usedPins[pinName];
    }
  });
}

export function applyConfig(config) {
  if (!config) return;

  for (const p_config of config.selectedPeripherals || []) {
    if (p_config.type === "GPIO") {
      state.selectedPeripherals.push({
        id: p_config.id,
        type: p_config.type,
        label: p_config.label,
        pin: p_config.pin,
        activeState: p_config.activeState,
      });
      state.usedPins[p_config.pin] = {
        peripheral: p_config.id,
        function: "GPIO",
        required: true,
      };
      continue;
    }

    const p_data = state.mcuData.socPeripherals.find(
      (p) => p.id === p_config.id,
    );
    if (p_data) {
      if (p_data.uiHint === "oscillator") {
        state.selectedPeripherals.push({
          id: p_data.id,
          description: p_data.description,
          config: p_config.config || p_data.config,
        });
        if (p_data.signals && p_data.signals.length > 0) {
          p_data.signals.forEach((s) => {
            if (s.allowedGpio && s.allowedGpio.length > 0) {
              const pinName = s.allowedGpio[0];
              state.usedPins[pinName] = {
                peripheral: p_data.id,
                function: s.name,
                required: s.isMandatory || true,
              };
            }
          });
        }
      } else if (p_data.uiHint === "checkbox") {
        const checkbox = document.getElementById(
          `${p_data.id.toLowerCase()}-checkbox`,
        );
        if (checkbox) checkbox.checked = true;

        const pinFunctions = {};
        p_data.signals.forEach((s) => {
          const pinName = s.allowedGpio[0];
          state.usedPins[pinName] = {
            peripheral: p_data.id,
            function: s.name,
            required: true,
          };
          pinFunctions[pinName] = s.name;
        });
        state.selectedPeripherals.push({
          id: p_data.id,
          peripheral: p_data,
          pinFunctions,
        });
      } else {
        state.selectedPeripherals.push({
          id: p_data.id,
          peripheral: p_data,
          pinFunctions: p_config.pinFunctions,
          config: p_config.config || {},
        });
        for (const pinName in p_config.pinFunctions) {
          const signal = p_data.signals.find(
            (s) => s.name === p_config.pinFunctions[pinName],
          );
          state.usedPins[pinName] = {
            peripheral: p_data.id,
            function: p_config.pinFunctions[pinName],
            required: signal ? signal.isMandatory : false,
          };
        }
        if (p_data.baseAddress) {
          state.usedAddresses[p_data.baseAddress] = p_data.id;
        }
      }
    }
  }

  clearPmicPins();
  state.pmicConfig = cloneConfig(config.pmicConfig);
  markPmicPinsFromConfig(state.pmicConfig);
}

export function loadStateFromLocalStorage() {
  const key = getPersistenceKey();
  if (!key) return;

  const savedState = localStorage.getItem(key);
  if (!savedState) {
    return;
  }

  try {
    const config = JSON.parse(savedState);
    applyConfig(config);
    if (config.consoleUart) {
      state.consoleUart = config.consoleUart;
    }
  } catch (error) {
    console.error("Failed to load or parse saved state:", error);
    localStorage.removeItem(key);
  }
}

export function resetState() {
  state.selectedPeripherals = [];
  state.usedPins = {};
  state.usedAddresses = {};
  state.consoleUart = null;
  state.devkitConfig = null;
  state.pmicConfig = null;
  document
    .querySelectorAll('input[type="checkbox"][data-peripheral-id]')
    .forEach((cb) => {
      cb.checked = false;
    });
  if (state.mcuData.pins) {
    setHFXtalAsSystemRequirement();
  }
}

export function setHFXtalAsSystemRequirement() {
  if (!state.mcuData.pins) return;
  const hfxtalPins = state.mcuData.pins.filter(
    (p) => p.defaultType === "crystal_hf",
  );
  if (hfxtalPins.length === 2) {
    state.usedPins[hfxtalPins[0].name] = {
      peripheral: "32MHz Crystal",
      function: "XC1",
      isSystem: true,
    };
    state.usedPins[hfxtalPins[1].name] = {
      peripheral: "32MHz Crystal",
      function: "XC2",
      isSystem: true,
    };
  }
}

export function hasAddressConflict(peripheral) {
  return peripheral.baseAddress && state.usedAddresses[peripheral.baseAddress];
}
