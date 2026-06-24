// --- LOCAL PART DESCRIPTION UPLOADS ---

import state from "./state.js";
import { getMcuManifestEntry } from "./mcu-manifest.js";
import { showToast } from "./ui/notifications.js";

const PACKAGE_DATA_KEYS = ["packageData", "partData", "mcuData", "part"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPackageData(value) {
  return (
    isObject(value) &&
    (isObject(value.partInfo) ||
      Array.isArray(value.pins) ||
      Array.isArray(value.socPeripherals) ||
      isObject(value.renderConfig) ||
      typeof value.extends === "string")
  );
}

function getString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/\.json$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fileBaseName(fileName) {
  return fileName.replace(/^.*[\\/]/, "").replace(/\.json$/i, "");
}

function normalizeIdentifier(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function inferMcuId(uploadedJson, packageData, selectedMcuId, manifest) {
  const explicitMcu = slugify(
    getString(
      uploadedJson.mcuId,
      uploadedJson.mcu,
      uploadedJson.targetMcu,
      packageData.mcuId,
      packageData.mcu,
    ),
  );

  if (explicitMcu) {
    return explicitMcu;
  }

  const partId = normalizeIdentifier(
    getString(
      packageData.partInfo?.partNumber,
      packageData.partInfo?.series,
      uploadedJson.partNumber,
    ),
  );

  if (partId && Array.isArray(manifest?.mcus)) {
    const matchedMcu = manifest.mcus.find((mcu) => {
      const id = normalizeIdentifier(mcu.id);
      const name = normalizeIdentifier(mcu.name);
      return (id && partId.startsWith(id)) || (name && partId.startsWith(name));
    });

    if (matchedMcu) {
      return matchedMcu.id;
    }
  }

  return selectedMcuId;
}

function inferPackageName(uploadedJson, packageData, fileName) {
  const packageMeta = isObject(uploadedJson.package)
    ? uploadedJson.package
    : {};
  const explicitName = getString(
    packageMeta.name,
    uploadedJson.packageName,
    uploadedJson.name,
  );

  if (explicitName) {
    return explicitName;
  }

  const packageType = getString(packageData.partInfo?.packageType);
  const sizeDescription = getString(packageData.partInfo?.sizeDescription);
  const sizeMatch = sizeDescription.match(
    /\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i,
  );

  if (packageType && sizeMatch) {
    return `${packageType} (${sizeMatch[1]}x${sizeMatch[2]})`;
  }

  return getString(
    packageType,
    packageData.partInfo?.partNumber,
    fileBaseName(fileName),
  );
}

function inferPackageId(uploadedJson, packageData, fileName) {
  const packageMeta = isObject(uploadedJson.package)
    ? uploadedJson.package
    : {};
  return getString(
    packageMeta.file,
    uploadedJson.packageId,
    uploadedJson.packageFile,
    uploadedJson.package,
    packageData.packageId,
    packageData.package,
    fileBaseName(fileName),
    packageData.partInfo?.partNumber,
  );
}

function extractPackageData(uploadedJson) {
  if (isPackageData(uploadedJson)) {
    return uploadedJson;
  }

  for (const key of PACKAGE_DATA_KEYS) {
    if (isPackageData(uploadedJson[key])) {
      return uploadedJson[key];
    }
  }

  throw new Error(
    "Part description must contain package data at the root or under packageData.",
  );
}

function validatePackageData(packageData) {
  if (!isObject(packageData)) {
    throw new Error("Part description must be a JSON object.");
  }

  if (typeof packageData.extends === "string" && packageData.extends.trim()) {
    return;
  }

  const missing = [];
  if (!isObject(packageData.partInfo)) missing.push("partInfo");
  if (!Array.isArray(packageData.pins)) missing.push("pins");
  if (!Array.isArray(packageData.socPeripherals))
    missing.push("socPeripherals");
  if (!isObject(packageData.renderConfig)) missing.push("renderConfig");

  if (missing.length > 0) {
    throw new Error(`Part description is missing: ${missing.join(", ")}.`);
  }
}

function makeLocalPackageId(rawPackageId, mcuEntry) {
  const baseId = slugify(rawPackageId) || "uploaded-part";
  const localBaseId = baseId.startsWith("local-") ? baseId : `local-${baseId}`;
  const existingPackage = mcuEntry.packages.find(
    (pkg) => pkg.file === localBaseId,
  );

  if (!existingPackage || existingPackage.isLocal) {
    return localBaseId;
  }

  let suffix = 2;
  while (
    mcuEntry.packages.some((pkg) => pkg.file === `${localBaseId}-${suffix}`)
  ) {
    suffix += 1;
  }
  return `${localBaseId}-${suffix}`;
}

export function createLocalPartRegistration(
  uploadedJson,
  fileName,
  selectedMcuId,
  manifest,
) {
  if (!isObject(uploadedJson)) {
    throw new Error("Part description must be a JSON object.");
  }

  const packageData = extractPackageData(uploadedJson);
  validatePackageData(packageData);

  const mcuId = inferMcuId(uploadedJson, packageData, selectedMcuId, manifest);
  const mcuEntry = getMcuManifestEntry(manifest, mcuId);

  if (!mcuEntry) {
    throw new Error(
      `MCU "${mcuId || "(unknown)"}" is not available in the public manifest.`,
    );
  }

  const rawPackageId = inferPackageId(uploadedJson, packageData, fileName);
  const packageId = makeLocalPackageId(rawPackageId, mcuEntry);
  const packageName = inferPackageName(uploadedJson, packageData, fileName);

  return {
    mcuId,
    packageId,
    packageName,
    packageData,
    sourceFileName: fileName,
  };
}

export function registerLocalPart(registration) {
  const mcuEntry = getMcuManifestEntry(state.mcuManifest, registration.mcuId);
  if (!mcuEntry) {
    throw new Error(`MCU "${registration.mcuId}" is not available.`);
  }

  if (!state.localParts[registration.mcuId]) {
    state.localParts[registration.mcuId] = {};
  }

  state.localParts[registration.mcuId][registration.packageId] = {
    name: registration.packageName,
    packageData: registration.packageData,
    sourceFileName: registration.sourceFileName,
  };

  const manifestPackage = {
    file: registration.packageId,
    name: registration.packageName,
    isLocal: true,
  };
  const existingIndex = mcuEntry.packages.findIndex(
    (pkg) => pkg.file === registration.packageId,
  );

  if (existingIndex >= 0) {
    mcuEntry.packages[existingIndex] = manifestPackage;
  } else {
    mcuEntry.packages.push(manifestPackage);
  }
}

export async function handlePartDescriptionUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const uploadedJson = JSON.parse(await file.text());
    const selectedMcuId = document.getElementById("mcuSelector")?.value || "";
    const registration = createLocalPartRegistration(
      uploadedJson,
      file.name,
      selectedMcuId,
      state.mcuManifest,
    );

    registerLocalPart(registration);

    const mcuSelector = document.getElementById("mcuSelector");
    if (
      !Array.from(mcuSelector.options).some(
        (option) => option.value === registration.mcuId,
      )
    ) {
      throw new Error(`MCU "${registration.mcuId}" is not available.`);
    }

    mcuSelector.value = registration.mcuId;
    const { handleMcuChange } = await import("./mcu-loader.js");
    const loaded = await handleMcuChange({
      packageToSelect: registration.packageId,
    });
    if (!loaded) return;

    showToast(`Local part loaded: ${registration.packageName}`, "info");
  } catch (error) {
    console.error("Failed to upload part description:", error);
    alert(`Could not upload part description.\n${error.message}`);
    showToast("Part description upload failed", "error");
  } finally {
    event.target.value = "";
  }
}
