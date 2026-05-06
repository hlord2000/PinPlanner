// --- PMIC UI AND STATE MANAGEMENT ---

import state from "./state.js";
import { saveStateToLocalStorage } from "./state.js";
import { updatePinDisplay } from "./pin-layout.js";
import { updateSelectedPeripheralsList } from "./ui/selected-list.js";
import { organizePeripherals } from "./peripherals.js";
import { updateConsoleConfig } from "./console-config.js";
import { enableScrollWheelSelectionForElement } from "./utils.js";
import { PMIC_DEFINITIONS, getPmicDefinition, isNpm13xx } from "./pmic-data.js";

const PMIC_USED_PIN_OWNER = "PMIC";
const DEFAULT_THERMISTOR_OHMS = 10000;
const DEFAULT_THERMISTOR_BETA = 3380;

let tempPmicConfig = null;

function formatMilliamps(microamps) {
  const milliamps = microamps / 1000;
  return Number.isInteger(milliamps)
    ? `${milliamps} mA`
    : `${milliamps.toFixed(1)} mA`;
}

function formatVolts(microvolts) {
  return `${(microvolts / 1000000).toFixed(1)} V`;
}

function getI2cPeripherals() {
  if (!Array.isArray(state.mcuData?.socPeripherals)) {
    return [];
  }

  return state.mcuData.socPeripherals
    .filter((peripheral) => {
      const hasI2cSignals =
        Array.isArray(peripheral.signals) &&
        peripheral.signals.some((signal) => signal.name === "SCL") &&
        peripheral.signals.some((signal) => signal.name === "SDA");

      return (
        hasI2cSignals &&
        (peripheral.type === "TWI" ||
          peripheral.tags?.includes("I2C") ||
          state.deviceTreeTemplates?.[peripheral.id]?.type === "I2C")
      );
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function getI2cPeripheral(id) {
  return getI2cPeripherals().find((peripheral) => peripheral.id === id) || null;
}

function getSelectedI2cPeripheral(id) {
  return (
    state.selectedPeripherals.find(
      (peripheral) => peripheral.id === id && peripheral.peripheral,
    ) || null
  );
}

function getDefaultI2cPeripheralId(previousConfig = null) {
  if (previousConfig?.i2cPeripheralId) {
    return previousConfig.i2cPeripheralId;
  }

  const selectedI2c = state.selectedPeripherals.find((peripheral) =>
    getI2cPeripheral(peripheral.id),
  );
  if (selectedI2c) {
    return selectedI2c.id;
  }

  return getI2cPeripherals()[0]?.id || "";
}

function buildDefaultRegulators(definition, previousConfig = null) {
  const previousRegulators = previousConfig?.regulators || {};
  const regulators = {};

  definition.regulators.forEach((regulator, index) => {
    const previous = previousRegulators[regulator.id] || {};
    const enabledByDefault =
      definition.id === "npm2100"
        ? regulator.id === "BOOST"
        : regulator.id === "BUCK1" || regulator.id === "BUCK2";

    regulators[regulator.id] = {
      enabled: previous.enabled ?? enabledByDefault,
      voltageMicrovolt:
        previous.voltageMicrovolt || regulator.defaultVoltage || 1800000,
      boot: previous.boot || (enabledByDefault ? "boot-on" : "off"),
      mode:
        previous.mode ||
        (regulator.kind === "ldo"
          ? "ldo"
          : regulator.kind === "boost"
            ? "auto"
            : "auto"),
      gpioControl: {
        enable: {
          enabled: previous.gpioControl?.enable?.enabled || false,
          pmicGpio: previous.gpioControl?.enable?.pmicGpio || "",
          activeState:
            previous.gpioControl?.enable?.activeState || "active-high",
        },
        pwm: {
          enabled: previous.gpioControl?.pwm?.enabled || false,
          pmicGpio: previous.gpioControl?.pwm?.pmicGpio || "",
          activeState: previous.gpioControl?.pwm?.activeState || "active-low",
        },
        retention: {
          enabled: previous.gpioControl?.retention?.enabled || false,
          pmicGpio: previous.gpioControl?.retention?.pmicGpio || "",
          activeState:
            previous.gpioControl?.retention?.activeState || "active-high",
        },
        mode: {
          enabled: previous.gpioControl?.mode?.enabled || false,
          pmicGpio: previous.gpioControl?.mode?.pmicGpio || "",
          activeState: previous.gpioControl?.mode?.activeState || "active-low",
          forcedMode: previous.gpioControl?.mode?.forcedMode || "lp",
        },
      },
      activeDischarge: previous.activeDischarge || false,
    };
  });

  return regulators;
}

function buildDefaultDvsGpios(definition, previousConfig = null) {
  const previous = previousConfig?.dvsGpios || {};
  const pins = {};
  for (let i = 0; i < definition.gpioCount; i += 1) {
    pins[i] = {
      enabled: previous[i]?.enabled || false,
      hostPin: previous[i]?.hostPin || "",
      activeState: previous[i]?.activeState || "active-high",
    };
  }
  return pins;
}

function createDefaultPmicConfig(id, previousConfig = null) {
  const definition = getPmicDefinition(id);
  const previousForSamePart =
    previousConfig?.id === id || !previousConfig ? previousConfig : null;

  const config = {
    id,
    packageVariant:
      previousForSamePart?.packageVariant || definition.packageOptions[0],
    i2cPeripheralId: getDefaultI2cPeripheralId(previousConfig),
    i2cPinFunctions: { ...(previousConfig?.i2cPinFunctions || {}) },
    i2cOwned: Boolean(previousConfig?.i2cOwned),
    hostInterrupt: {
      enabled: previousForSamePart?.hostInterrupt?.enabled || false,
      hostPin: previousForSamePart?.hostInterrupt?.hostPin || "",
      activeState:
        previousForSamePart?.hostInterrupt?.activeState || "active-high",
      pmicPin:
        previousForSamePart?.hostInterrupt?.pmicPin ??
        (definition.family === "npm13xx" ? 3 : 0),
    },
    regulators: buildDefaultRegulators(definition, previousForSamePart),
    dvsGpios: buildDefaultDvsGpios(definition, previousForSamePart),
    gpioController: {
      enabled: previousForSamePart?.gpioController?.enabled ?? true,
    },
    watchdog: {
      enabled: previousForSamePart?.watchdog?.enabled ?? false,
    },
    fuelGauge: {
      enabled: previousForSamePart?.fuelGauge?.enabled ?? true,
      model:
        previousForSamePart?.fuelGauge?.model ||
        definition.fuelGaugeModels?.default ||
        "custom",
    },
  };

  if (isNpm13xx(definition)) {
    config.charger = {
      enabled: previousForSamePart?.charger?.enabled ?? true,
      chargingEnable: previousForSamePart?.charger?.chargingEnable ?? true,
      currentMicroamp:
        previousForSamePart?.charger?.currentMicroamp ||
        definition.charger.current.default,
      termMicrovolt:
        previousForSamePart?.charger?.termMicrovolt ||
        definition.charger.termMicrovolt.default,
      vbusLimitMicroamp:
        previousForSamePart?.charger?.vbusLimitMicroamp ||
        definition.charger.vbusLimitMicroamp.default,
      dischargeLimitMicroamp:
        previousForSamePart?.charger?.dischargeLimitMicroamp ||
        definition.charger.defaultDischargeLimit,
      termCurrentPercent:
        previousForSamePart?.charger?.termCurrentPercent ||
        definition.charger.termCurrentPercent[0],
      thermistorOhms:
        previousForSamePart?.charger?.thermistorOhms || DEFAULT_THERMISTOR_OHMS,
      thermistorBeta:
        previousForSamePart?.charger?.thermistorBeta || DEFAULT_THERMISTOR_BETA,
    };
    config.leds = {
      enabled: previousForSamePart?.leds?.enabled ?? true,
      modes: {
        led0: previousForSamePart?.leds?.modes?.led0 || "error",
        led1: previousForSamePart?.leds?.modes?.led1 || "charging",
        led2: previousForSamePart?.leds?.modes?.led2 || "host",
      },
    };
  }

  return config;
}

function getSignalPin(config, signalName) {
  return (
    Object.entries(config.i2cPinFunctions || {}).find(
      ([, signal]) => signal === signalName,
    )?.[0] || ""
  );
}

function sortGpioPins(pins) {
  return [...pins].sort((a, b) => {
    const aMatch = a.name.match(/P(\d+)\.(\d+)/);
    const bMatch = b.name.match(/P(\d+)\.(\d+)/);
    if (!aMatch || !bMatch) return a.name.localeCompare(b.name);

    const aPort = parseInt(aMatch[1]);
    const bPort = parseInt(bMatch[1]);
    const aPin = parseInt(aMatch[2]);
    const bPin = parseInt(bMatch[2]);
    return aPort === bPort ? aPin - bPin : aPort - bPort;
  });
}

function pinMatchesAllowedGpio(pin, allowedGpio) {
  return allowedGpio.endsWith("*")
    ? pin.port === allowedGpio.slice(0, -1)
    : pin.name === allowedGpio;
}

function getPinsForI2cSignal(peripheral, signalName) {
  const signal = peripheral?.signals?.find((s) => s.name === signalName);
  if (!signal || !Array.isArray(state.mcuData?.pins)) {
    return [];
  }

  const pins = state.mcuData.pins.filter((pin) => {
    if (!pin.functions?.includes("Digital I/O")) return false;
    if (signal.requiresClockCapablePin && !pin.isClockCapable) return false;

    return signal.allowedGpio.some((allowed) =>
      pinMatchesAllowedGpio(pin, allowed),
    );
  });

  return sortGpioPins(pins);
}

function getDigitalIoPins() {
  if (!Array.isArray(state.mcuData?.pins)) {
    return [];
  }

  return sortGpioPins(
    state.mcuData.pins.filter((pin) => pin.functions?.includes("Digital I/O")),
  );
}

function getGpiotePins() {
  if (
    !Array.isArray(state.mcuData?.pins) ||
    !Array.isArray(state.mcuData?.socPeripherals)
  ) {
    return [];
  }

  const allowedGpio = state.mcuData.socPeripherals
    .filter((peripheral) => peripheral.type === "GPIOTE")
    .flatMap((peripheral) => peripheral.signals || [])
    .flatMap((signal) => signal.allowedGpio || []);

  if (allowedGpio.length === 0) {
    return [];
  }

  return sortGpioPins(
    state.mcuData.pins.filter(
      (pin) =>
        pin.functions?.includes("Digital I/O") &&
        allowedGpio.some((allowed) => pinMatchesAllowedGpio(pin, allowed)),
    ),
  );
}

function isPinUsedByOther(pinName, allowedOwners = []) {
  const owner = state.usedPins[pinName]?.peripheral;
  return Boolean(owner && !allowedOwners.includes(owner));
}

function pinOptions(pins, selectedPin, allowedOwners = [], excludePins = []) {
  let html = '<option value="">-- Select pin --</option>';
  pins.forEach((pin) => {
    const isSelected = pin.name === selectedPin;
    const disabled =
      !isSelected &&
      (excludePins.includes(pin.name) ||
        isPinUsedByOther(pin.name, allowedOwners));
    html += `<option value="${pin.name}" ${isSelected ? "selected" : ""} ${disabled ? "disabled" : ""}>${pin.name}${pin.isClockCapable ? " (Clock)" : ""}${disabled ? " (in use)" : ""}</option>`;
  });
  return html;
}

function rangeOptions(range, selectedValue, formatter) {
  let html = "";
  for (let value = range.min; value <= range.max; value += range.step) {
    html += `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${formatter(value)}</option>`;
  }
  return html;
}

function regulatorVoltageOptions(definition, regulator, selectedValue) {
  const range =
    definition.id === "npm2100"
      ? definition.regulatorVoltage[regulator.id]
      : definition.regulatorVoltage;
  return rangeOptions(range, selectedValue, formatVolts);
}

function pmicGpioOptions(definition, selectedValue) {
  let html = '<option value="">-- PMIC GPIO --</option>';
  for (let i = 0; i < definition.gpioCount; i += 1) {
    html += `<option value="${i}" ${String(i) === String(selectedValue) ? "selected" : ""}>GPIO${i}</option>`;
  }
  return html;
}

function activeStateOptions(selectedValue) {
  return `
    <option value="active-high" ${selectedValue !== "active-low" ? "selected" : ""}>Active high</option>
    <option value="active-low" ${selectedValue === "active-low" ? "selected" : ""}>Active low</option>
  `;
}

function renderRegulatorGpioControl(definition, regulator, controlName, label) {
  const control =
    tempPmicConfig.regulators[regulator.id].gpioControl?.[controlName] || {};
  const forcedModeSelect =
    definition.id === "npm2100" && controlName === "mode"
      ? `<select data-regulator-control-forced-mode="${regulator.id}:${controlName}" ${control.enabled ? "" : "disabled"}>
          ${getNpm2100ForcedModeOptions(regulator, control.forcedMode)}
        </select>`
      : "";

  return `
    <div class="pmic-control-row">
      <label>
        <input type="checkbox" data-regulator-control-enabled="${regulator.id}:${controlName}" ${control.enabled ? "checked" : ""} />
        <span>${label}</span>
      </label>
      <select data-regulator-control-gpio="${regulator.id}:${controlName}" ${control.enabled ? "" : "disabled"}>
        ${pmicGpioOptions(definition, control.pmicGpio)}
      </select>
      <select data-regulator-control-active="${regulator.id}:${controlName}" ${control.enabled ? "" : "disabled"}>
        ${activeStateOptions(control.activeState)}
      </select>
      ${forcedModeSelect}
    </div>
  `;
}

function getNpm2100ForcedModeOptions(regulator, selectedValue) {
  const options =
    regulator.kind === "boost"
      ? [
          ["hp", "Force high power"],
          ["lp", "Force low power"],
          ["pass", "Force pass through"],
          ["nohp", "Force no high power"],
        ]
      : [
          ["hp", "Force high power"],
          ["ulp", "Force ULP"],
        ];

  return options
    .map(
      ([value, label]) =>
        `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}

function renderPmicCard(definition) {
  return `
    <button type="button" class="pmic-card" data-pmic-id="${definition.id}">
      <div class="pmic-card-top">
        <strong>${definition.name}</strong>
        <span>${definition.packageOptions.join(" / ")}</span>
      </div>
      <div class="pmic-card-headline">${definition.headline}</div>
      <div class="pmic-badges">
        ${definition.badges.map((badge) => `<span>${badge}</span>`).join("")}
      </div>
    </button>
  `;
}

export function renderPmicPanel() {
  const panel = document.getElementById("pmicPanel");
  if (!panel) return;

  const currentDefinition = getPmicDefinition(state.pmicConfig?.id);

  if (currentDefinition) {
    const regulatorCount = Object.values(
      state.pmicConfig.regulators || {},
    ).filter((regulator) => regulator.enabled).length;
    const fuelGaugeModel = currentDefinition.fuelGaugeModels?.options.find(
      (model) => model.id === state.pmicConfig.fuelGauge?.model,
    );
    const i2cPins = Object.entries(state.pmicConfig.i2cPinFunctions || {})
      .map(([pin, signal]) => `${signal}: ${pin}`)
      .join(", ");

    panel.innerHTML = `
      <div class="pmic-hero pmic-hero-selected">
        <div>
          <div class="pmic-eyebrow">Power plan</div>
          <h3>${currentDefinition.name} added</h3>
          <p>${currentDefinition.headline}</p>
        </div>
        <span class="pmic-chip">${state.pmicConfig.packageVariant}</span>
      </div>
      <div class="pmic-summary">
        <div><strong>I2C:</strong> ${state.pmicConfig.i2cPeripheralId || "Not set"}</div>
        <div><strong>Pins:</strong> ${i2cPins || "Using existing bus pins"}</div>
        <div><strong>Regulators:</strong> ${regulatorCount} enabled</div>
        <div><strong>Fuel gauge:</strong> ${
          state.pmicConfig.fuelGauge?.enabled
            ? fuelGaugeModel?.label || "enabled"
            : "disabled"
        }</div>
      </div>
      <div class="pmic-actions">
        <button type="button" id="editPmicBtn">Edit PMIC</button>
        <button type="button" id="removePmicBtn" class="secondary-btn">Remove</button>
      </div>
    `;

    panel.querySelector("#editPmicBtn").addEventListener("click", () => {
      openPmicModal(state.pmicConfig.id);
    });
    panel.querySelector("#removePmicBtn").addEventListener("click", () => {
      removePmicConfig();
    });
    return;
  }

  panel.innerHTML = `
    <div class="pmic-card-grid">
      ${Object.values(PMIC_DEFINITIONS).map(renderPmicCard).join("")}
    </div>
  `;

  panel.querySelectorAll("[data-pmic-id]").forEach((button) => {
    button.addEventListener("click", () =>
      openPmicModal(button.dataset.pmicId),
    );
  });
}

export function openPmicModal(modelId = null) {
  const requestedId = modelId || state.pmicConfig?.id || "npm1300";
  tempPmicConfig =
    state.pmicConfig?.id === requestedId
      ? createDefaultPmicConfig(requestedId, state.pmicConfig)
      : createDefaultPmicConfig(requestedId, tempPmicConfig);

  renderPmicModal();
  document.getElementById("pmicConfigModal").style.display = "flex";
}

export function closePmicModal() {
  document.getElementById("pmicConfigModal").style.display = "none";
  tempPmicConfig = null;
}

function renderPmicModal() {
  const definition = getPmicDefinition(tempPmicConfig.id);
  const body = document.getElementById("pmicModalBody");
  const title = document.getElementById("pmicModalTitle");
  title.textContent = `Configure ${definition.name}`;

  body.innerHTML = `
    <div class="pmic-modal-intro">
      <strong>${definition.name}</strong>
      <span>${definition.blurb}</span>
    </div>
    <div id="pmicError" class="validation-message" style="display: none"></div>

    <div class="pmic-form-grid">
      <div class="form-group">
        <label for="pmicModelSelect">PMIC</label>
        <select id="pmicModelSelect">
          ${Object.values(PMIC_DEFINITIONS)
            .map(
              (pmic) =>
                `<option value="${pmic.id}" ${pmic.id === definition.id ? "selected" : ""}>${pmic.name}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="form-group">
        <label for="pmicPackageSelect">Package</label>
        <select id="pmicPackageSelect">
          ${definition.packageOptions
            .map(
              (pkg) =>
                `<option value="${pkg}" ${pkg === tempPmicConfig.packageVariant ? "selected" : ""}>${pkg}</option>`,
            )
            .join("")}
        </select>
        <small>QFN and CSP are driver-equivalent here, but the board export records what is present.</small>
      </div>
    </div>

    ${renderI2cSection(definition)}
    ${renderHostInterruptSection(definition)}
    ${renderDvsGpioSection(definition)}
    ${renderRegulatorSection(definition)}
    ${isNpm13xx(definition) ? renderChargerSection(definition) : renderNpm2100FuelGaugeSection()}
    ${isNpm13xx(definition) ? renderLedSection(definition) : ""}
    ${renderPmicFeatureSection(definition)}
  `;

  wirePmicModalEvents();
}

function renderI2cSection() {
  const i2cPeripherals = getI2cPeripherals();
  const selectedI2c = getSelectedI2cPeripheral(tempPmicConfig.i2cPeripheralId);
  const selectedI2cIsPmicOwned = selectedI2c?.config?.pmicOwned === true;
  const i2cPeripheral = getI2cPeripheral(tempPmicConfig.i2cPeripheralId);
  const sclPin = getSignalPin(tempPmicConfig, "SCL");
  const sdaPin = getSignalPin(tempPmicConfig, "SDA");
  const canEditPins = !selectedI2c || selectedI2cIsPmicOwned;
  const allowedOwners = [tempPmicConfig.i2cPeripheralId];

  return `
    <section class="pmic-config-section">
      <h4>I2C connection</h4>
      <div class="pmic-form-grid">
        <div class="form-group">
          <label for="pmicI2cSelect">I2C peripheral</label>
          <select id="pmicI2cSelect">
            <option value="">-- Select I2C --</option>
            ${i2cPeripherals
              .map(
                (peripheral) =>
                  `<option value="${peripheral.id}" ${peripheral.id === tempPmicConfig.i2cPeripheralId ? "selected" : ""}>${peripheral.id}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label>I2C address</label>
          <input type="text" value="${getPmicDefinition(tempPmicConfig.id).address}" disabled />
        </div>
      </div>
      ${
        !i2cPeripheral
          ? `<div class="pmic-help">Select an I2C-capable peripheral first.</div>`
          : canEditPins
            ? `<div class="pmic-form-grid">
                <div class="form-group">
                  <label for="pmicSclPin">SCL pin</label>
                  <select id="pmicSclPin">
                    ${pinOptions(getPinsForI2cSignal(i2cPeripheral, "SCL"), sclPin, allowedOwners, [sdaPin].filter(Boolean))}
                  </select>
                </div>
                <div class="form-group">
                  <label for="pmicSdaPin">SDA pin</label>
                  <select id="pmicSdaPin">
                    ${pinOptions(getPinsForI2cSignal(i2cPeripheral, "SDA"), sdaPin, allowedOwners, [sclPin].filter(Boolean))}
                  </select>
                </div>
              </div>`
            : `<div class="pmic-help">Using existing ${selectedI2c.id} pins: ${Object.entries(
                selectedI2c.pinFunctions || {},
              )
                .map(([pin, signal]) => `${signal}: ${pin}`)
                .join(", ")}</div>`
      }
    </section>
  `;
}

function renderHostInterruptSection(definition) {
  const host = tempPmicConfig.hostInterrupt || {};
  const hostPins = getGpiotePins();
  const sclPin = getSignalPin(tempPmicConfig, "SCL");
  const sdaPin = getSignalPin(tempPmicConfig, "SDA");
  const pmicPins = Array.from(
    { length: definition.gpioCount },
    (_, index) => index,
  );

  return `
    <section class="pmic-config-section">
      <h4>Interrupt</h4>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicHostInterruptEnabled" ${host.enabled ? "checked" : ""} />
        Connect PMIC interrupt to host GPIO
      </label>
      <div class="pmic-form-grid">
        <div class="form-group">
          <label for="pmicHostPin">Host GPIO</label>
          <select id="pmicHostPin" ${host.enabled ? "" : "disabled"}>
            ${pinOptions(hostPins, host.hostPin || "", [PMIC_USED_PIN_OWNER], [sclPin, sdaPin].filter(Boolean))}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicPmicIntPin">PMIC INT pin</label>
          <select id="pmicPmicIntPin" ${host.enabled ? "" : "disabled"}>
            ${pmicPins
              .map(
                (pin) =>
                  `<option value="${pin}" ${pin === host.pmicPin ? "selected" : ""}>GPIO${pin}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicHostActiveState">Active state</label>
          <select id="pmicHostActiveState" ${host.enabled ? "" : "disabled"}>
            <option value="active-high" ${host.activeState !== "active-low" ? "selected" : ""}>Active high</option>
            <option value="active-low" ${host.activeState === "active-low" ? "selected" : ""}>Active low</option>
          </select>
        </div>
      </div>
    </section>
  `;
}

function renderDvsGpioSection(definition) {
  const hostPins = getDigitalIoPins();
  const sclPin = getSignalPin(tempPmicConfig, "SCL");
  const sdaPin = getSignalPin(tempPmicConfig, "SDA");
  const hostIntPin = tempPmicConfig.hostInterrupt?.hostPin || "";
  const usedByDvs = Object.values(tempPmicConfig.dvsGpios || {})
    .map((entry) => entry.hostPin)
    .filter(Boolean);
  const channels = Object.keys(tempPmicConfig.dvsGpios || {}).sort(
    (a, b) => Number(a) - Number(b),
  );

  return `
    <section class="pmic-config-section">
      <h4>Regulator GPIO control lines</h4>
      <div class="pmic-help">
        Optional host GPIOs connected to PMIC GPIO inputs. Use these when an application will drive PMIC DVS state to enable a regulator, force PWM/PFM behavior, or switch retention/load-switch control.
      </div>
      <div class="pmic-dvs-grid">
        ${channels
          .map((channel) => {
            const entry = tempPmicConfig.dvsGpios[channel];
            const excludedPins = [
              sclPin,
              sdaPin,
              hostIntPin,
              ...usedByDvs.filter((pin) => pin !== entry.hostPin),
            ].filter(Boolean);
            return `
              <div class="pmic-dvs-row">
                <label>
                  <input type="checkbox" data-dvs-enabled="${channel}" ${entry.enabled ? "checked" : ""} />
                  <span>PMIC GPIO${channel}</span>
                </label>
                <select data-dvs-host-pin="${channel}" ${entry.enabled ? "" : "disabled"}>
                  ${pinOptions(hostPins, entry.hostPin, [PMIC_USED_PIN_OWNER], excludedPins)}
                </select>
                <select data-dvs-active="${channel}" ${entry.enabled ? "" : "disabled"}>
                  ${activeStateOptions(entry.activeState)}
                </select>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderRegulatorSection(definition) {
  return `
    <section class="pmic-config-section">
      <h4>Regulators</h4>
      <div class="pmic-regulator-list">
        ${definition.regulators
          .map((regulator) => {
            const config = tempPmicConfig.regulators[regulator.id];
            const modeSelect =
              regulator.kind === "ldo"
                ? `<select data-regulator-mode="${regulator.id}">
                    <option value="ldo" ${config.mode === "ldo" ? "selected" : ""}>LDO mode</option>
                    <option value="ldsw" ${config.mode === "ldsw" ? "selected" : ""}>Load switch mode</option>
                  </select>`
                : regulator.kind === "buck"
                  ? `<select data-regulator-mode="${regulator.id}">
                    <option value="auto" ${config.mode === "auto" ? "selected" : ""}>Auto mode</option>
                    <option value="pwm" ${config.mode === "pwm" ? "selected" : ""}>Force PWM</option>
                    <option value="pfm" ${config.mode === "pfm" ? "selected" : ""}>Force PFM</option>
                  </select>`
                  : regulator.kind === "boost"
                    ? `<select data-regulator-mode="${regulator.id}">
                    <option value="auto" ${config.mode === "auto" ? "selected" : ""}>Auto mode</option>
                    <option value="hp" ${config.mode === "hp" ? "selected" : ""}>High power</option>
                    <option value="lp" ${config.mode === "lp" ? "selected" : ""}>Low power</option>
                    <option value="pass" ${config.mode === "pass" ? "selected" : ""}>Pass through</option>
                    <option value="nohp" ${config.mode === "nohp" ? "selected" : ""}>No high power</option>
                  </select>`
                    : regulator.kind === "ldosw"
                      ? `<select data-regulator-mode="${regulator.id}">
                    <option value="ldo-auto" ${config.mode === "ldo-auto" || config.mode === "auto" ? "selected" : ""}>LDO auto</option>
                    <option value="ldo-hp" ${config.mode === "ldo-hp" ? "selected" : ""}>LDO high power</option>
                    <option value="ldo-ulp" ${config.mode === "ldo-ulp" ? "selected" : ""}>LDO ultra-low power</option>
                    <option value="ldsw-auto" ${config.mode === "ldsw-auto" ? "selected" : ""}>Load switch auto</option>
                    <option value="ldsw-hp" ${config.mode === "ldsw-hp" ? "selected" : ""}>Load switch high power</option>
                    <option value="ldsw-ulp" ${config.mode === "ldsw-ulp" ? "selected" : ""}>Load switch ultra-low power</option>
                  </select>`
                      : "";
            const controlRows = isNpm13xx(definition)
              ? [
                  renderRegulatorGpioControl(
                    definition,
                    regulator,
                    "enable",
                    regulator.kind === "ldo"
                      ? "GPIO enable/load-switch control"
                      : "GPIO enable control",
                  ),
                  regulator.kind === "buck"
                    ? renderRegulatorGpioControl(
                        definition,
                        regulator,
                        "pwm",
                        "GPIO force PWM/PFM control",
                      )
                    : "",
                  regulator.kind === "buck"
                    ? renderRegulatorGpioControl(
                        definition,
                        regulator,
                        "retention",
                        "GPIO retention-voltage control",
                      )
                    : "",
                ].join("")
              : renderRegulatorGpioControl(
                  definition,
                  regulator,
                  "mode",
                  "PMIC GPIO mode control",
                );

            return `
              <div class="pmic-regulator-row">
                <div class="pmic-regulator-main">
                  <label>
                    <input type="checkbox" data-regulator-enabled="${regulator.id}" ${config.enabled ? "checked" : ""} ${
                      definition.id === "npm2100" && regulator.id === "BOOST"
                        ? "disabled"
                        : ""
                    } />
                    <span>${regulator.label}</span>
                  </label>
                  <select data-regulator-voltage="${regulator.id}">
                    ${regulatorVoltageOptions(definition, regulator, config.voltageMicrovolt)}
                  </select>
                  <select data-regulator-boot="${regulator.id}">
                    <option value="off" ${config.boot === "off" ? "selected" : ""}>Off at boot</option>
                    <option value="boot-on" ${config.boot === "boot-on" ? "selected" : ""}>Boot on</option>
                    <option value="always-on" ${config.boot === "always-on" ? "selected" : ""}>Always on</option>
                  </select>
                  ${modeSelect}
                  <label class="pmic-inline-check">
                    <input type="checkbox" data-regulator-active-discharge="${regulator.id}" ${config.activeDischarge ? "checked" : ""} />
                    Active discharge
                  </label>
                </div>
                <div class="pmic-regulator-controls">${controlRows}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

function renderChargerSection(definition) {
  const charger = tempPmicConfig.charger;
  const fuelGauge = tempPmicConfig.fuelGauge || {};
  return `
    <section class="pmic-config-section">
      <h4>Charger and fuel gauge</h4>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicChargerEnabled" ${charger.enabled ? "checked" : ""} />
        Add Zephyr charger sensor node
      </label>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicChargingEnable" ${charger.chargingEnable ? "checked" : ""} ${charger.enabled ? "" : "disabled"} />
        Enable battery charging
      </label>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicFuelGaugeEnabled" ${fuelGauge.enabled ? "checked" : ""} />
        Fuel-gauge telemetry available through the charger sensor
      </label>
      <div class="pmic-form-grid">
        <div class="form-group">
          <label for="pmicFuelGaugeModel">Fuel-gauge battery model</label>
          <select id="pmicFuelGaugeModel" ${fuelGauge.enabled ? "" : "disabled"}>
            ${definition.fuelGaugeModels.options
              .map(
                (model) =>
                  `<option value="${model.id}" ${model.id === fuelGauge.model ? "selected" : ""}>${model.label}</option>`,
              )
              .join("")}
          </select>
          <small>${definition.fuelGaugeModels.note}</small>
        </div>
      </div>
      <div class="pmic-form-grid">
        <div class="form-group">
          <label for="pmicChargeCurrent">Charge current</label>
          <select id="pmicChargeCurrent" ${charger.enabled ? "" : "disabled"}>
            ${rangeOptions(definition.charger.current, charger.currentMicroamp, formatMilliamps)}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicTermVoltage">Termination voltage</label>
          <select id="pmicTermVoltage" ${charger.enabled ? "" : "disabled"}>
            ${rangeOptions(definition.charger.termMicrovolt, charger.termMicrovolt, formatVolts)}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicVbusLimit">VBUS limit</label>
          <select id="pmicVbusLimit" ${charger.enabled ? "" : "disabled"}>
            ${rangeOptions(definition.charger.vbusLimitMicroamp, charger.vbusLimitMicroamp, formatMilliamps)}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicDischargeLimit">Discharge limit</label>
          <select id="pmicDischargeLimit" ${charger.enabled ? "" : "disabled"}>
            ${definition.charger.dischargeLimits
              .map(
                (limit) =>
                  `<option value="${limit}" ${limit === charger.dischargeLimitMicroamp ? "selected" : ""}>${formatMilliamps(limit)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicThermistorOhms">Thermistor</label>
          <select id="pmicThermistorOhms" ${charger.enabled ? "" : "disabled"}>
            ${[0, 10000, 47000, 100000]
              .map(
                (ohms) =>
                  `<option value="${ohms}" ${ohms === charger.thermistorOhms ? "selected" : ""}>${ohms === 0 ? "None" : `${ohms / 1000} kOhm`}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label for="pmicThermistorBeta">Thermistor beta</label>
          <input type="number" id="pmicThermistorBeta" value="${charger.thermistorBeta}" min="1" step="1" ${charger.enabled ? "" : "disabled"} />
        </div>
      </div>
    </section>
  `;
}

function renderNpm2100FuelGaugeSection() {
  const definition = getPmicDefinition(tempPmicConfig.id);
  const fuelGauge = tempPmicConfig.fuelGauge || {};
  return `
    <section class="pmic-config-section">
      <h4>Fuel gauge</h4>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicFuelGaugeEnabled" ${fuelGauge.enabled ? "checked" : ""} />
        Add nPM2100 VBAT sensor node
      </label>
      <div class="pmic-form-grid">
        <div class="form-group">
          <label for="pmicFuelGaugeModel">Primary-cell model</label>
          <select id="pmicFuelGaugeModel" ${fuelGauge.enabled ? "" : "disabled"}>
            ${definition.fuelGaugeModels.options
              .map(
                (model) =>
                  `<option value="${model.id}" ${model.id === fuelGauge.model ? "selected" : ""}>${model.label}</option>`,
              )
              .join("")}
          </select>
          <small>${definition.fuelGaugeModels.note}</small>
        </div>
      </div>
    </section>
  `;
}

function renderLedSection() {
  const leds = tempPmicConfig.leds;
  const modeOptions = (selected) =>
    ["error", "charging", "host"]
      .map(
        (mode) =>
          `<option value="${mode}" ${mode === selected ? "selected" : ""}>${mode}</option>`,
      )
      .join("");

  return `
    <section class="pmic-config-section">
      <h4>LED outputs</h4>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicLedsEnabled" ${leds.enabled ? "checked" : ""} />
        Add PMIC LED controller node
      </label>
      <div class="pmic-form-grid">
        <div class="form-group">
          <label for="pmicLed0Mode">LED0</label>
          <select id="pmicLed0Mode" ${leds.enabled ? "" : "disabled"}>${modeOptions(leds.modes.led0)}</select>
        </div>
        <div class="form-group">
          <label for="pmicLed1Mode">LED1</label>
          <select id="pmicLed1Mode" ${leds.enabled ? "" : "disabled"}>${modeOptions(leds.modes.led1)}</select>
        </div>
        <div class="form-group">
          <label for="pmicLed2Mode">LED2</label>
          <select id="pmicLed2Mode" ${leds.enabled ? "" : "disabled"}>${modeOptions(leds.modes.led2)}</select>
        </div>
      </div>
    </section>
  `;
}

function renderPmicFeatureSection(definition) {
  return `
    <section class="pmic-config-section">
      <h4>PMIC GPIO and watchdog</h4>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicGpioEnabled" ${tempPmicConfig.gpioController?.enabled ? "checked" : ""} />
        Add ${definition.gpioCount}-pin PMIC GPIO controller
      </label>
      <label class="pmic-checkbox-row">
        <input type="checkbox" id="pmicWatchdogEnabled" ${tempPmicConfig.watchdog?.enabled ? "checked" : ""} />
        Add PMIC watchdog node
      </label>
    </section>
  `;
}

function wirePmicModalEvents() {
  const selects = document.querySelectorAll("#pmicModalBody select");
  selects.forEach((select) => enableScrollWheelSelectionForElement(select));

  document.getElementById("pmicModelSelect").addEventListener("change", (e) => {
    tempPmicConfig = createDefaultPmicConfig(
      e.target.value,
      readPmicConfigFromForm(),
    );
    renderPmicModal();
  });

  document.getElementById("pmicI2cSelect").addEventListener("change", () => {
    tempPmicConfig = readPmicConfigFromForm();
    tempPmicConfig.i2cPinFunctions = {};
    renderPmicModal();
  });

  document
    .getElementById("pmicHostInterruptEnabled")
    .addEventListener("change", () => {
      tempPmicConfig = readPmicConfigFromForm();
      renderPmicModal();
    });

  const chargerEnabled = document.getElementById("pmicChargerEnabled");
  if (chargerEnabled) {
    chargerEnabled.addEventListener("change", () => {
      tempPmicConfig = readPmicConfigFromForm();
      renderPmicModal();
    });
  }

  const ledsEnabled = document.getElementById("pmicLedsEnabled");
  if (ledsEnabled) {
    ledsEnabled.addEventListener("change", () => {
      tempPmicConfig = readPmicConfigFromForm();
      renderPmicModal();
    });
  }

  const fuelGaugeEnabled = document.getElementById("pmicFuelGaugeEnabled");
  if (fuelGaugeEnabled) {
    fuelGaugeEnabled.addEventListener("change", () => {
      tempPmicConfig = readPmicConfigFromForm();
      renderPmicModal();
    });
  }

  document.querySelectorAll("[data-dvs-enabled]").forEach((input) => {
    input.addEventListener("change", () => {
      tempPmicConfig = readPmicConfigFromForm();
      renderPmicModal();
    });
  });

  document
    .querySelectorAll("[data-regulator-control-enabled]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        tempPmicConfig = readPmicConfigFromForm();
        renderPmicModal();
      });
    });
}

function readPmicConfigFromForm() {
  const id = document.getElementById("pmicModelSelect")?.value || "npm1300";
  const definition = getPmicDefinition(id);
  const config = createDefaultPmicConfig(id, tempPmicConfig);
  config.packageVariant =
    document.getElementById("pmicPackageSelect")?.value ||
    config.packageVariant;
  config.i2cPeripheralId =
    document.getElementById("pmicI2cSelect")?.value || "";

  const selectedI2c = getSelectedI2cPeripheral(config.i2cPeripheralId);
  if (selectedI2c && selectedI2c.config?.pmicOwned !== true) {
    config.i2cPinFunctions = { ...(selectedI2c.pinFunctions || {}) };
    config.i2cOwned = false;
  } else {
    const sclPin = document.getElementById("pmicSclPin")?.value || "";
    const sdaPin = document.getElementById("pmicSdaPin")?.value || "";
    config.i2cPinFunctions = {};
    if (sclPin) config.i2cPinFunctions[sclPin] = "SCL";
    if (sdaPin) config.i2cPinFunctions[sdaPin] = "SDA";
    config.i2cOwned = true;
  }

  config.hostInterrupt = {
    enabled:
      document.getElementById("pmicHostInterruptEnabled")?.checked || false,
    hostPin: document.getElementById("pmicHostPin")?.value || "",
    pmicPin: parseInt(document.getElementById("pmicPmicIntPin")?.value || "0"),
    activeState:
      document.getElementById("pmicHostActiveState")?.value || "active-high",
  };

  Object.keys(config.dvsGpios || {}).forEach((channel) => {
    config.dvsGpios[channel] = {
      enabled:
        document.querySelector(`[data-dvs-enabled="${channel}"]`)?.checked ||
        false,
      hostPin:
        document.querySelector(`[data-dvs-host-pin="${channel}"]`)?.value || "",
      activeState:
        document.querySelector(`[data-dvs-active="${channel}"]`)?.value ||
        "active-high",
    };
  });

  definition.regulators.forEach((regulator) => {
    const enabled = document.querySelector(
      `[data-regulator-enabled="${regulator.id}"]`,
    );
    const voltage = document.querySelector(
      `[data-regulator-voltage="${regulator.id}"]`,
    );
    const boot = document.querySelector(
      `[data-regulator-boot="${regulator.id}"]`,
    );
    const mode = document.querySelector(
      `[data-regulator-mode="${regulator.id}"]`,
    );
    const previous = config.regulators[regulator.id];
    const gpioControl = {
      enable: readRegulatorGpioControl(regulator.id, "enable", previous),
      pwm: readRegulatorGpioControl(regulator.id, "pwm", previous),
      retention: readRegulatorGpioControl(regulator.id, "retention", previous),
      mode: readRegulatorGpioControl(regulator.id, "mode", previous),
    };

    config.regulators[regulator.id] = {
      enabled:
        regulator.id === "BOOST" && definition.id === "npm2100"
          ? true
          : enabled?.checked || false,
      voltageMicrovolt: parseInt(voltage?.value || previous.voltageMicrovolt),
      boot: boot?.value || "off",
      mode: mode?.value || previous.mode || "auto",
      gpioControl,
      activeDischarge:
        document.querySelector(
          `[data-regulator-active-discharge="${regulator.id}"]`,
        )?.checked || false,
    };
  });

  config.gpioController = {
    enabled: document.getElementById("pmicGpioEnabled")?.checked || false,
  };
  config.watchdog = {
    enabled: document.getElementById("pmicWatchdogEnabled")?.checked || false,
  };
  config.fuelGauge = {
    enabled: document.getElementById("pmicFuelGaugeEnabled")?.checked || false,
    model:
      document.getElementById("pmicFuelGaugeModel")?.value ||
      definition.fuelGaugeModels?.default ||
      "custom",
  };

  if (isNpm13xx(definition)) {
    config.charger = {
      enabled: document.getElementById("pmicChargerEnabled")?.checked || false,
      chargingEnable:
        document.getElementById("pmicChargingEnable")?.checked || false,
      currentMicroamp: parseInt(
        document.getElementById("pmicChargeCurrent")?.value ||
          definition.charger.current.default,
      ),
      termMicrovolt: parseInt(
        document.getElementById("pmicTermVoltage")?.value ||
          definition.charger.termMicrovolt.default,
      ),
      vbusLimitMicroamp: parseInt(
        document.getElementById("pmicVbusLimit")?.value ||
          definition.charger.vbusLimitMicroamp.default,
      ),
      dischargeLimitMicroamp: parseInt(
        document.getElementById("pmicDischargeLimit")?.value ||
          definition.charger.defaultDischargeLimit,
      ),
      termCurrentPercent: config.charger.termCurrentPercent,
      thermistorOhms: parseInt(
        document.getElementById("pmicThermistorOhms")?.value ||
          DEFAULT_THERMISTOR_OHMS,
      ),
      thermistorBeta: parseInt(
        document.getElementById("pmicThermistorBeta")?.value ||
          DEFAULT_THERMISTOR_BETA,
      ),
    };
    config.leds = {
      enabled: document.getElementById("pmicLedsEnabled")?.checked || false,
      modes: {
        led0: document.getElementById("pmicLed0Mode")?.value || "error",
        led1: document.getElementById("pmicLed1Mode")?.value || "charging",
        led2: document.getElementById("pmicLed2Mode")?.value || "host",
      },
    };
  }

  return config;
}

function readRegulatorGpioControl(regulatorId, controlName, previousRegulator) {
  const key = `${regulatorId}:${controlName}`;
  const previous = previousRegulator?.gpioControl?.[controlName] || {};
  return {
    enabled:
      document.querySelector(`[data-regulator-control-enabled="${key}"]`)
        ?.checked || false,
    pmicGpio:
      document.querySelector(`[data-regulator-control-gpio="${key}"]`)?.value ||
      "",
    activeState:
      document.querySelector(`[data-regulator-control-active="${key}"]`)
        ?.value ||
      previous.activeState ||
      "active-high",
    forcedMode:
      document.querySelector(`[data-regulator-control-forced-mode="${key}"]`)
        ?.value ||
      previous.forcedMode ||
      "lp",
  };
}

function showPmicError(message) {
  const error = document.getElementById("pmicError");
  error.textContent = message;
  error.style.display = "block";
}

function validatePmicConfig(config) {
  const definition = getPmicDefinition(config.id);
  if (!config.i2cPeripheralId || !getI2cPeripheral(config.i2cPeripheralId)) {
    return "Select an I2C peripheral for the PMIC.";
  }

  const selectedI2c = getSelectedI2cPeripheral(config.i2cPeripheralId);
  const i2cPinsEditable =
    !selectedI2c || selectedI2c.config?.pmicOwned === true;
  const sclPin = getSignalPin(config, "SCL");
  const sdaPin = getSignalPin(config, "SDA");

  if (i2cPinsEditable) {
    if (!sclPin || !sdaPin) {
      return "Select both SCL and SDA pins for the PMIC I2C bus.";
    }
    if (sclPin === sdaPin) {
      return "SCL and SDA must use different pins.";
    }
    for (const pin of [sclPin, sdaPin]) {
      if (isPinUsedByOther(pin, [config.i2cPeripheralId])) {
        return `${pin} is already used by ${state.usedPins[pin].peripheral}.`;
      }
    }
  }

  const reservedPins = new Set([sclPin, sdaPin].filter(Boolean));

  if (config.hostInterrupt.enabled) {
    if (!config.hostInterrupt.hostPin) {
      return "Select a host GPIO for the PMIC interrupt.";
    }
    if (
      !getGpiotePins().some((pin) => pin.name === config.hostInterrupt.hostPin)
    ) {
      return "The PMIC interrupt host pin must support GPIOTE.";
    }
    if ([sclPin, sdaPin].includes(config.hostInterrupt.hostPin)) {
      return "The PMIC interrupt cannot share the I2C pins.";
    }
    if (isPinUsedByOther(config.hostInterrupt.hostPin, [PMIC_USED_PIN_OWNER])) {
      return `${config.hostInterrupt.hostPin} is already used by ${state.usedPins[config.hostInterrupt.hostPin].peripheral}.`;
    }
    reservedPins.add(config.hostInterrupt.hostPin);
  }

  const seenDvsHostPins = new Set();
  for (const [channel, entry] of Object.entries(config.dvsGpios || {})) {
    if (!entry.enabled) continue;

    if (!entry.hostPin) {
      return `Select a host GPIO for PMIC GPIO${channel}.`;
    }
    if (reservedPins.has(entry.hostPin)) {
      return `PMIC GPIO${channel} cannot share another PMIC or I2C pin.`;
    }
    if (seenDvsHostPins.has(entry.hostPin)) {
      return `${entry.hostPin} is already assigned to another PMIC GPIO control line.`;
    }
    if (isPinUsedByOther(entry.hostPin, [PMIC_USED_PIN_OWNER])) {
      return `${entry.hostPin} is already used by ${state.usedPins[entry.hostPin].peripheral}.`;
    }
    seenDvsHostPins.add(entry.hostPin);
  }

  for (const [regulatorId, regulator] of Object.entries(
    config.regulators || {},
  )) {
    const controls = regulator.gpioControl || {};
    for (const [controlName, control] of Object.entries(controls)) {
      if (!control.enabled) continue;

      if (control.pmicGpio === "") {
        return `${regulatorId} ${controlName} control needs a PMIC GPIO.`;
      }
      const channel = String(control.pmicGpio);
      if (!config.dvsGpios?.[channel]?.enabled) {
        return `${regulatorId} ${controlName} uses PMIC GPIO${channel}; enable its host control line above.`;
      }
    }
  }

  if (
    isNpm13xx(definition) &&
    config.fuelGauge?.enabled &&
    !config.charger?.enabled
  ) {
    return "The nPM13xx fuel gauge is exposed through the charger sensor node; enable the charger sensor node.";
  }

  return null;
}

function clearPmicHostPins() {
  Object.entries(state.usedPins).forEach(([pinName, usage]) => {
    if (usage.peripheral === PMIC_USED_PIN_OWNER) {
      delete state.usedPins[pinName];
    }
  });
}

function removeOwnedI2cPeripheral(config) {
  if (!config?.i2cPeripheralId) return;

  const index = state.selectedPeripherals.findIndex(
    (peripheral) =>
      peripheral.id === config.i2cPeripheralId &&
      peripheral.config?.pmicOwned === true,
  );
  if (index === -1) return;

  const peripheral = state.selectedPeripherals[index];
  Object.keys(peripheral.pinFunctions || {}).forEach((pinName) => {
    if (state.usedPins[pinName]?.peripheral === peripheral.id) {
      delete state.usedPins[pinName];
    }
  });
  if (peripheral.peripheral?.baseAddress) {
    delete state.usedAddresses[peripheral.peripheral.baseAddress];
  }
  state.selectedPeripherals.splice(index, 1);
}

function ensurePmicI2cPeripheral(config) {
  const existing = getSelectedI2cPeripheral(config.i2cPeripheralId);
  if (existing) {
    config.i2cOwned = existing.config?.pmicOwned === true;
    config.i2cPinFunctions = { ...(existing.pinFunctions || {}) };
    return;
  }

  const peripheral = getI2cPeripheral(config.i2cPeripheralId);
  if (!peripheral) return;

  state.selectedPeripherals.push({
    id: peripheral.id,
    peripheral,
    pinFunctions: { ...config.i2cPinFunctions },
    config: {
      note: `PMIC ${getPmicDefinition(config.id).name}`,
      pmicOwned: true,
    },
  });

  Object.entries(config.i2cPinFunctions).forEach(([pinName, signalName]) => {
    state.usedPins[pinName] = {
      peripheral: peripheral.id,
      function: signalName,
      required: true,
    };
  });

  if (peripheral.baseAddress) {
    state.usedAddresses[peripheral.baseAddress] = peripheral.id;
  }
  config.i2cOwned = true;
}

function markPmicHostPins(config) {
  if (config.hostInterrupt?.enabled && config.hostInterrupt.hostPin) {
    state.usedPins[config.hostInterrupt.hostPin] = {
      peripheral: PMIC_USED_PIN_OWNER,
      function: "HOST_INT",
      required: false,
    };
  }

  Object.entries(config.dvsGpios || {}).forEach(([channel, entry]) => {
    if (!entry.enabled || !entry.hostPin) return;

    state.usedPins[entry.hostPin] = {
      peripheral: PMIC_USED_PIN_OWNER,
      function: `PMIC_GPIO${channel}`,
      required: false,
    };
  });
}

export function confirmPmicConfig() {
  const config = readPmicConfigFromForm();
  const validationError = validatePmicConfig(config);
  if (validationError) {
    showPmicError(validationError);
    return;
  }

  clearPmicHostPins();
  removeOwnedI2cPeripheral(state.pmicConfig);
  ensurePmicI2cPeripheral(config);
  markPmicHostPins(config);

  state.pmicConfig = config;

  renderPmicPanel();
  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
  saveStateToLocalStorage();
  closePmicModal();
}

export function removePmicConfig() {
  clearPmicHostPins();
  removeOwnedI2cPeripheral(state.pmicConfig);
  state.pmicConfig = null;

  renderPmicPanel();
  organizePeripherals();
  updateSelectedPeripheralsList();
  updatePinDisplay();
  updateConsoleConfig();
  saveStateToLocalStorage();
}

export function handlePmicOwnedI2cRemoval(peripheralId) {
  if (state.pmicConfig?.i2cPeripheralId === peripheralId) {
    removePmicConfig();
    return true;
  }

  return false;
}
