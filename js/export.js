// --- BOARD DEFINITION EXPORT ---

import state from "./state.js";
import { isDevkitMode, getDevkitConfig } from "./devkit-loader.js";
import {
  getMcuSupportsNonSecure,
  getMcuSupportsFLPR,
  getMcuSupportsFLPRXIP,
  generateBoardYml,
  generateBoardCmake,
  generateKconfigDefconfig,
  generateKconfigBoard,
  generateCommonDtsi,
  generateCpuappCommonDtsi,
  generatePinctrlFile,
  generateMainDts,
  generateYamlCapabilities,
  generateDefconfig,
  generateReadme,
  generateKconfigTrustZone,
  generateNSDts,
  generateFLPRDts,
  generateFLPRYaml,
  generateFLPRDefconfig,
  generateFLPRXIPDts,
  generatePinctrlForPeripheral,
  generatePeripheralNode,
} from "./devicetree.js";
import { getDevicetreeExportUnsupportedReason } from "./mcu-manifest.js";
import { parsePinName } from "./utils.js";
import { showToast } from "./ui/notifications.js";

export function updateExportButtonState() {
  const exportButton = document.getElementById("exportDeviceTreeBtn");
  const mcuSelector = document.getElementById("mcuSelector");
  const packageSelector = document.getElementById("packageSelector");

  if (!exportButton || !mcuSelector || !packageSelector) {
    return;
  }

  const mcu = mcuSelector.value;
  const pkg = packageSelector.value;
  const unsupportedMessage =
    mcu && pkg ? getDevicetreeExportUnsupportedMessage(mcu, pkg) : null;

  exportButton.disabled = Boolean(unsupportedMessage);
  exportButton.title = unsupportedMessage || "";
}

export function openBoardInfoModal() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  const unsupportedMessage = getDevicetreeExportUnsupportedMessage(mcu, pkg);
  if (unsupportedMessage) {
    alert(unsupportedMessage);
    return;
  }

  if (state.selectedPeripherals.length === 0) {
    alert("No peripherals selected. Please select peripherals first.");
    return;
  }

  // In devkit mode, generate overlay instead
  if (isDevkitMode()) {
    exportOverlay();
    return;
  }

  setupBoardNameValidation();
  document.getElementById("boardInfoModal").style.display = "block";
  document.getElementById("boardInfoError").style.display = "none";
}

function getDevicetreeExportUnsupportedMessage(mcu, pkg) {
  const reason = getDevicetreeExportUnsupportedReason(
    state.mcuManifest,
    mcu,
    pkg,
  );
  if (!reason) {
    return null;
  }

  if (/^devicetree export not supported/i.test(reason)) {
    return reason;
  }

  return `DeviceTree export not supported for ${mcu}/${pkg}.\n${reason}`;
}

function setupBoardNameValidation() {
  const boardNameInput = document.getElementById("boardNameInput");
  const boardVendorInput = document.getElementById("boardVendorInput");

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

  boardNameInput.addEventListener("input", () =>
    validateInput(boardNameInput, boardNameError),
  );
  boardVendorInput.addEventListener("input", () =>
    validateInput(boardVendorInput, vendorError),
  );
}

export function closeBoardInfoModal() {
  document.getElementById("boardInfoModal").style.display = "none";
}

function validateBoardName(name) {
  return /^[a-z0-9_]+$/.test(name);
}

export async function confirmBoardInfoAndGenerate() {
  const boardName = document.getElementById("boardNameInput").value.trim();
  const fullName = document.getElementById("boardFullNameInput").value.trim();
  const vendor =
    document.getElementById("boardVendorInput").value.trim() || "custom";
  const revision = document.getElementById("boardRevisionInput").value.trim();
  const description = document
    .getElementById("boardDescriptionInput")
    .value.trim();

  const errorElement = document.getElementById("boardInfoError");

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

  state.boardInfo = {
    name: boardName,
    fullName: fullName,
    vendor: vendor,
    revision: revision,
    description: description,
  };

  closeBoardInfoModal();
  await exportBoardDefinition();
}

export async function exportBoardDefinition() {
  const mcu = document.getElementById("mcuSelector").value;
  const pkg = document.getElementById("packageSelector").value;
  const unsupportedMessage = getDevicetreeExportUnsupportedMessage(mcu, pkg);

  if (unsupportedMessage) {
    alert(unsupportedMessage);
    return;
  }

  if (!state.deviceTreeTemplates) {
    const { loadDeviceTreeTemplates } = await import("./mcu-loader.js");
    state.deviceTreeTemplates = await loadDeviceTreeTemplates(mcu, pkg);
    if (!state.deviceTreeTemplates) {
      alert("DeviceTree templates not available for this MCU yet.");
      return;
    }
  }

  try {
    const files = await generateBoardFiles(mcu, pkg);
    await downloadBoardAsZip(files, state.boardInfo.name);
    showToast("Board definition exported successfully!", "info");
  } catch (error) {
    console.error("Board definition generation failed:", error);
    alert(`Failed to generate board definition: ${error.message}`);
  }
}

export async function generateBoardFiles(mcu, pkg) {
  const supportsNS = getMcuSupportsNonSecure(mcu);
  const supportsFLPR = getMcuSupportsFLPR(mcu);
  const supportsFLPRXIP = getMcuSupportsFLPRXIP(mcu);
  const files = {};

  files["board.yml"] = generateBoardYml(mcu, supportsNS, supportsFLPR);
  files["board.cmake"] = generateBoardCmake(mcu, supportsNS, supportsFLPR);
  files["Kconfig.defconfig"] = generateKconfigDefconfig(mcu, supportsNS);
  files[`Kconfig.${state.boardInfo.name}`] = generateKconfigBoard(
    mcu,
    supportsNS,
    supportsFLPR,
  );
  files[`${state.boardInfo.name}_common.dtsi`] = generateCommonDtsi(mcu);
  files[`${mcu}_cpuapp_common.dtsi`] = generateCpuappCommonDtsi(mcu);
  files[`${state.boardInfo.name}_${mcu}-pinctrl.dtsi`] = generatePinctrlFile();
  files[`${state.boardInfo.name}_${mcu}_cpuapp.dts`] = generateMainDts(
    mcu,
    supportsNS,
  );
  files[`${state.boardInfo.name}_${mcu}_cpuapp.yaml`] =
    generateYamlCapabilities(mcu, false);
  files[`${state.boardInfo.name}_${mcu}_cpuapp_defconfig`] = generateDefconfig(
    false,
    mcu,
  );
  files["README.md"] = generateReadme(mcu, pkg, supportsNS, supportsFLPR);

  if (supportsNS) {
    files["Kconfig"] = generateKconfigTrustZone(mcu);
    files[`${state.boardInfo.name}_${mcu}_cpuapp_ns.dts`] = generateNSDts(mcu);
    files[`${state.boardInfo.name}_${mcu}_cpuapp_ns.yaml`] =
      generateYamlCapabilities(mcu, true);
    files[`${state.boardInfo.name}_${mcu}_cpuapp_ns_defconfig`] =
      generateDefconfig(true, mcu);
  }

  if (supportsFLPR) {
    files[`${state.boardInfo.name}_${mcu}_cpuflpr.dts`] = generateFLPRDts(mcu);
    files[`${state.boardInfo.name}_${mcu}_cpuflpr.yaml`] = generateFLPRYaml(
      mcu,
      false,
    );
    files[`${state.boardInfo.name}_${mcu}_cpuflpr_defconfig`] =
      generateFLPRDefconfig(false, mcu);
    if (supportsFLPRXIP) {
      files[`${state.boardInfo.name}_${mcu}_cpuflpr_xip.dts`] =
        generateFLPRXIPDts(mcu);
      files[`${state.boardInfo.name}_${mcu}_cpuflpr_xip.yaml`] =
        generateFLPRYaml(mcu, true);
      files[`${state.boardInfo.name}_${mcu}_cpuflpr_xip_defconfig`] =
        generateFLPRDefconfig(true, mcu);
    }
  }

  return files;
}

async function ensureJsZipLoaded() {
  if (typeof JSZip === "undefined") {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    await new Promise((resolve) => {
      script.onload = resolve;
      document.head.appendChild(script);
    });
  }
}

export async function createBoardZipBlob(files, boardName) {
  await ensureJsZipLoaded();

  const zip = new JSZip();
  const boardFolder = zip.folder(boardName);

  const stableDate = new Date(2024, 0, 1, 12, 0, 0);

  for (const [filename, content] of Object.entries(files)) {
    boardFolder.file(filename, content, { date: stableDate });
  }

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  return blob;
}

export async function downloadBoardAsZip(files, boardName) {
  const blob = await createBoardZipBlob(files, boardName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${boardName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- OVERLAY EXPORT MODE ---

function exportOverlay() {
  const devkit = getDevkitConfig();
  if (!devkit) return;

  const mcu = document.getElementById("mcuSelector").value;

  let overlayContent = `/*
 * EVALUATION ONLY - Generated by nRF54L Pin Planner
 * Base board: ${devkit.board} (Zephyr v${devkit.zephyrVersion})
 *
 * This overlay is for evaluation and prototyping purposes.
 * Using overlays for pin reassignment is not recommended for
 * production use. For production, create a proper custom board
 * definition based on your hardware design.
 */

`;

  // Generate overlay nodes for peripherals that differ from devkit base
  const devkitPeripheralIds = new Set(
    (devkit.peripherals || []).map((p) => p.id),
  );

  state.selectedPeripherals.forEach((p) => {
    if (p.type === "GPIO") return;
    if (p.config && p.config.loadCapacitors) return;

    // Only emit nodes that are new (not in devkit base)
    if (!devkitPeripheralIds.has(p.id)) {
      const template = state.deviceTreeTemplates[p.id];
      if (template) {
        overlayContent += generatePeripheralNode(p, template);
      }
    }
  });

  // Check if we need a pinctrl overlay
  let pinctrlContent = "";
  state.selectedPeripherals.forEach((p) => {
    if (p.type === "GPIO") return;
    if (p.config && p.config.loadCapacitors) return;
    if (!devkitPeripheralIds.has(p.id)) {
      const template = state.deviceTreeTemplates[p.id];
      if (template) {
        pinctrlContent += generatePinctrlForPeripheral(p, template);
      }
    }
  });

  // Download overlay file
  const blob = new Blob([overlayContent], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${devkit.board}.overlay`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // If there's pinctrl content, also download pinctrl file
  if (pinctrlContent.trim()) {
    const pinctrlFull = `&pinctrl {\n${pinctrlContent}};\n`;
    const pinctrlBlob = new Blob([pinctrlFull], { type: "text/plain" });
    const pinctrlUrl = URL.createObjectURL(pinctrlBlob);
    const pinctrlA = document.createElement("a");
    pinctrlA.href = pinctrlUrl;
    pinctrlA.download = `${devkit.board}-pinctrl.dtsi`;
    document.body.appendChild(pinctrlA);
    pinctrlA.click();
    document.body.removeChild(pinctrlA);
    URL.revokeObjectURL(pinctrlUrl);
  }

  showToast("Overlay exported for evaluation", "info");
}
