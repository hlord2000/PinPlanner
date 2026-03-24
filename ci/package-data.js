import { readFileSync } from "fs";
import { dirname, resolve } from "path";

export function mergePackageData(baseData, overrideData) {
  const merged = {
    ...baseData,
    ...overrideData,
  };

  if (baseData.partInfo || overrideData.partInfo) {
    merged.partInfo = {
      ...(baseData.partInfo || {}),
      ...(overrideData.partInfo || {}),
    };
  }

  if (baseData.renderConfig || overrideData.renderConfig) {
    const baseRenderConfig = baseData.renderConfig || {};
    const overrideRenderConfig = overrideData.renderConfig || {};

    merged.renderConfig = {
      ...baseRenderConfig,
      ...overrideRenderConfig,
      canvasDefaults: {
        ...(baseRenderConfig.canvasDefaults || {}),
        ...(overrideRenderConfig.canvasDefaults || {}),
      },
      chipBody: {
        ...(baseRenderConfig.chipBody || {}),
        ...(overrideRenderConfig.chipBody || {}),
      },
      pinDefaults: {
        ...(baseRenderConfig.pinDefaults || {}),
        ...(overrideRenderConfig.pinDefaults || {}),
      },
      layoutStrategy: {
        ...(baseRenderConfig.layoutStrategy || {}),
        ...(overrideRenderConfig.layoutStrategy || {}),
      },
    };
  }

  delete merged.extends;
  return merged;
}

function normalizePackageData(packageData) {
  if (
    !Array.isArray(packageData.pins) ||
    !Array.isArray(packageData.socPeripherals)
  ) {
    return packageData;
  }

  const availablePins = new Set(packageData.pins.map((pin) => pin.name));

  return {
    ...packageData,
    socPeripherals: packageData.socPeripherals.map((peripheral) => ({
      ...peripheral,
      signals: Array.isArray(peripheral.signals)
        ? peripheral.signals.map((signal) => ({
            ...signal,
            allowedGpio: Array.isArray(signal.allowedGpio)
              ? signal.allowedGpio.filter(
                  (gpio) => gpio.endsWith("*") || availablePins.has(gpio),
                )
              : signal.allowedGpio,
          }))
        : peripheral.signals,
    })),
  };
}

export function loadResolvedPackageData(packageFilePath, seen = new Set()) {
  const resolvedPath = resolve(packageFilePath);
  if (seen.has(resolvedPath)) {
    throw new Error(
      `Circular package extends chain detected at ${resolvedPath}`,
    );
  }

  seen.add(resolvedPath);

  const data = JSON.parse(readFileSync(resolvedPath, "utf-8"));
  if (!data.extends) {
    return normalizePackageData(data);
  }

  const parentPath = resolve(dirname(resolvedPath), data.extends);
  const parentData = loadResolvedPackageData(parentPath, seen);
  return normalizePackageData(mergePackageData(parentData, data));
}
