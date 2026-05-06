// --- PMIC DEFINITIONS ---

export const PMIC_DEFINITIONS = {
  npm1300: {
    id: "npm1300",
    name: "nPM1300",
    compatible: "nordic,npm1300",
    address: "0x6b",
    family: "npm13xx",
    packageOptions: ["QFN", "CSP"],
    headline: "Rechargeable Li-ion/Li-poly PMIC",
    blurb:
      "nPM1300 combines 32-800 mA battery charging, fuel-gauge telemetry, dual bucks, dual LDO/load switches, LEDs, GPIO, and watchdog support in a small package.",
    badges: [
      "32-800 mA charging",
      "Fuel gauge",
      "2 buck + 2 LDO",
      "3 LEDs",
      "Watchdog + hard reset",
    ],
    gpioCount: 5,
    ledCount: 3,
    regulators: [
      { id: "BUCK1", label: "Buck 1", defaultVoltage: 1800000, kind: "buck" },
      { id: "BUCK2", label: "Buck 2", defaultVoltage: 3300000, kind: "buck" },
      {
        id: "LDO1",
        label: "LDO/Load switch 1",
        defaultVoltage: 1800000,
        kind: "ldo",
      },
      {
        id: "LDO2",
        label: "LDO/Load switch 2",
        defaultVoltage: 1800000,
        kind: "ldo",
      },
    ],
    regulatorVoltage: { min: 1000000, max: 3300000, step: 100000 },
    charger: {
      current: { min: 32000, max: 800000, step: 2000, default: 150000 },
      termMicrovolt: {
        min: 4000000,
        max: 4450000,
        step: 50000,
        default: 4200000,
      },
      vbusLimitMicroamp: {
        min: 100000,
        max: 1500000,
        step: 100000,
        default: 500000,
      },
      dischargeLimits: [200000, 1000000],
      defaultDischargeLimit: 1000000,
      termCurrentPercent: [10, 20],
    },
    fuelGaugeModels: {
      kind: "secondary",
      default: "custom",
      note: "Use a Li-ion/Li-poly battery model generated with the nPM PowerUP app for accurate nRF Fuel Gauge results. The SDK nPM13xx fuel-gauge sample includes example battery_model.inc files for evaluation.",
      options: [
        {
          id: "custom",
          label: "Custom Li-ion/Li-poly model",
          detail: "Recommended for production. Generate with nPM PowerUP.",
        },
        {
          id: "sdk_sample",
          label: "SDK sample model",
          detail:
            "Example only: nrf/samples/pmic/native/npm13xx_fuel_gauge/src/battery_model.inc",
        },
        {
          id: "sdk_sample_20mah",
          label: "SDK sample 20 mAh model",
          detail:
            "Example only: nrf/samples/pmic/native/npm13xx_fuel_gauge/src/battery_model_20mAh.inc",
        },
      ],
    },
  },
  npm1304: {
    id: "npm1304",
    name: "nPM1304",
    compatible: "nordic,npm1304",
    address: "0x6b",
    family: "npm13xx",
    packageOptions: ["QFN", "CSP"],
    headline: "Compact rechargeable PMIC",
    blurb:
      "nPM1304 targets smaller rechargeable designs with 4-100 mA charging, fuel-gauge telemetry, dual bucks, dual LDO/load switches, LEDs, GPIO, and watchdog support.",
    badges: [
      "4-100 mA charging",
      "Fuel gauge",
      "2 buck + 2 LDO",
      "3 LEDs",
      "Watchdog + hard reset",
    ],
    gpioCount: 5,
    ledCount: 3,
    regulators: [
      { id: "BUCK1", label: "Buck 1", defaultVoltage: 1800000, kind: "buck" },
      { id: "BUCK2", label: "Buck 2", defaultVoltage: 3300000, kind: "buck" },
      {
        id: "LDO1",
        label: "LDO/Load switch 1",
        defaultVoltage: 1800000,
        kind: "ldo",
      },
      {
        id: "LDO2",
        label: "LDO/Load switch 2",
        defaultVoltage: 1800000,
        kind: "ldo",
      },
    ],
    regulatorVoltage: { min: 1000000, max: 3300000, step: 100000 },
    charger: {
      current: { min: 4000, max: 100000, step: 500, default: 4000 },
      termMicrovolt: {
        min: 4000000,
        max: 4650000,
        step: 50000,
        default: 4200000,
      },
      vbusLimitMicroamp: {
        min: 100000,
        max: 1500000,
        step: 100000,
        default: 500000,
      },
      dischargeLimits: [125000],
      defaultDischargeLimit: 125000,
      termCurrentPercent: [10, 5],
    },
    fuelGaugeModels: {
      kind: "secondary",
      default: "custom",
      note: "Use a Li-ion/Li-poly battery model generated with the nPM PowerUP app for accurate nRF Fuel Gauge results. The SDK nPM13xx fuel-gauge sample includes example battery_model.inc files for evaluation.",
      options: [
        {
          id: "custom",
          label: "Custom Li-ion/Li-poly model",
          detail: "Recommended for production. Generate with nPM PowerUP.",
        },
        {
          id: "sdk_sample",
          label: "SDK sample model",
          detail:
            "Example only: nrf/samples/pmic/native/npm13xx_fuel_gauge/src/battery_model.inc",
        },
        {
          id: "sdk_sample_20mah",
          label: "SDK sample 20 mAh model",
          detail:
            "Example only: nrf/samples/pmic/native/npm13xx_fuel_gauge/src/battery_model_20mAh.inc",
        },
      ],
    },
  },
  npm2100: {
    id: "npm2100",
    name: "nPM2100",
    compatible: "nordic,npm2100",
    address: "0x74",
    family: "npm2100",
    packageOptions: ["QFN", "CSP"],
    headline: "Primary-cell PMIC",
    blurb:
      "nPM2100 is for primary-cell designs, pairing boost regulation, an LDO/load switch, fuel-gauge telemetry, GPIO, and watchdog support in a small package.",
    badges: [
      "Primary cell",
      "Fuel gauge",
      "Boost + LDOSW",
      "2 GPIO",
      "Watchdog + hard reset",
    ],
    gpioCount: 2,
    ledCount: 0,
    regulators: [
      { id: "BOOST", label: "Boost", defaultVoltage: 3300000, kind: "boost" },
      {
        id: "LDOSW",
        label: "LDO/Load switch",
        defaultVoltage: 1800000,
        kind: "ldosw",
      },
    ],
    regulatorVoltage: {
      BOOST: { min: 1800000, max: 3300000, step: 50000 },
      LDOSW: { min: 800000, max: 3000000, step: 50000 },
    },
    fuelGaugeModels: {
      kind: "primary",
      default: "alkaline_aa",
      note: "nRF Fuel Gauge includes primary-cell battery profiles in nrfxlib/nrf_fuel_gauge/include/battery_models/primary_cell.",
      options: [
        {
          id: "alkaline_aa",
          label: "Alkaline AA",
          kconfig: "CONFIG_BATTERY_MODEL_ALKALINE_AA",
          include: "battery_models/primary_cell/AA_Alkaline.inc",
        },
        {
          id: "alkaline_aaa",
          label: "Alkaline AAA",
          kconfig: "CONFIG_BATTERY_MODEL_ALKALINE_AAA",
          include: "battery_models/primary_cell/AAA_Alkaline.inc",
        },
        {
          id: "alkaline_2saa",
          label: "2x alkaline AA in series",
          kconfig: "CONFIG_BATTERY_MODEL_ALKALINE_2SAA",
          include: "battery_models/primary_cell/2SAA_Alkaline.inc",
        },
        {
          id: "alkaline_2saaa",
          label: "2x alkaline AAA in series",
          kconfig: "CONFIG_BATTERY_MODEL_ALKALINE_2SAAA",
          include: "battery_models/primary_cell/2SAAA_Alkaline.inc",
        },
        {
          id: "alkaline_lr44",
          label: "Alkaline LR44 coin cell",
          kconfig: "CONFIG_BATTERY_MODEL_ALKALINE_LR44",
          include: "battery_models/primary_cell/LR44.inc",
        },
        {
          id: "lithium_cr2032",
          label: "Lithium CR2032 coin cell",
          kconfig: "CONFIG_BATTERY_MODEL_LITHIUM_CR2032",
          include: "battery_models/primary_cell/CR2032.inc",
        },
      ],
    },
  },
};

export function getPmicDefinition(id) {
  return PMIC_DEFINITIONS[id] || null;
}

export function isNpm13xx(definitionOrConfig) {
  const definition =
    definitionOrConfig && definitionOrConfig.family
      ? definitionOrConfig
      : getPmicDefinition(definitionOrConfig?.id);
  return definition?.family === "npm13xx";
}

export function getPmicBadgeText(config) {
  const definition = getPmicDefinition(config?.id);
  if (!definition) return "";

  const i2cLabel = config.i2cPeripheralId || "I2C not set";
  return `${definition.name} on ${i2cLabel}`;
}
