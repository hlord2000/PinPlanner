export function getMcuManifestEntry(manifest, mcuId) {
  if (!manifest || !Array.isArray(manifest.mcus)) {
    return null;
  }

  return manifest.mcus.find((mcu) => mcu.id === mcuId) || null;
}

export function getPackageManifestEntry(manifest, mcuId, pkgFile) {
  const mcu = getMcuManifestEntry(manifest, mcuId);
  if (!mcu || !Array.isArray(mcu.packages)) {
    return null;
  }

  return mcu.packages.find((pkg) => pkg.file === pkgFile) || null;
}

function normalizeUnsupportedReason(reason) {
  if (typeof reason !== "string") {
    return null;
  }

  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getMcuSupportsNonSecure(manifest, mcuId) {
  const mcu = getMcuManifestEntry(manifest, mcuId);
  return mcu ? mcu.supportsNonSecure === true : false;
}

export function getMcuSupportsFLPR(manifest, mcuId) {
  const mcu = getMcuManifestEntry(manifest, mcuId);
  return mcu ? mcu.supportsFLPR === true : false;
}

const FLPR_XIP_MCUS = new Set(["nrf54lv10a", "nrf54lm20a", "nrf54l15"]);

export function getMcuSupportsFLPRXIP(manifest, mcuId) {
  return getMcuSupportsFLPR(manifest, mcuId) && FLPR_XIP_MCUS.has(mcuId);
}

export function getDevicetreeExportUnsupportedReason(
  manifest,
  mcuId,
  pkgFile = null,
) {
  const packageEntry = pkgFile
    ? getPackageManifestEntry(manifest, mcuId, pkgFile)
    : null;
  const packageReason = normalizeUnsupportedReason(
    packageEntry?.devicetreeExportUnsupportedReason,
  );
  if (packageReason) {
    return packageReason;
  }

  const mcu = getMcuManifestEntry(manifest, mcuId);
  return normalizeUnsupportedReason(mcu?.devicetreeExportUnsupportedReason);
}

export function isDevicetreeExportSupported(manifest, mcuId, pkgFile = null) {
  return (
    getDevicetreeExportUnsupportedReason(manifest, mcuId, pkgFile) === null
  );
}

export function mcuHasSupportedDevicetreeExport(manifest, mcuId) {
  const mcu = getMcuManifestEntry(manifest, mcuId);
  if (!mcu) {
    return false;
  }

  if (!Array.isArray(mcu.packages) || mcu.packages.length === 0) {
    return isDevicetreeExportSupported(manifest, mcuId);
  }

  return mcu.packages.some((pkg) =>
    isDevicetreeExportSupported(manifest, mcuId, pkg.file),
  );
}
