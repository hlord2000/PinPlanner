// --- PIN LAYOUT AND DETAILS ---

import state from "./state.js";

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

export function createPinLayout() {
  const chipContainer = document.querySelector(".chip-container");
  chipContainer.innerHTML = "";
  if (!state.mcuData.renderConfig || !state.mcuData.pins) return;

  const chipBody = document.createElement("div");
  chipBody.className = "chip-body";
  chipContainer.appendChild(chipBody);

  const strategy = state.mcuData.renderConfig.layoutStrategy;
  const padding = state.mcuData.renderConfig.canvasDefaults?.padding || 20;
  // Read actual container width for responsive layout
  const containerSize =
    Math.min(chipContainer.clientWidth, chipContainer.clientHeight) || 400;

  if (strategy.layoutType === "quadPerimeter") {
    const pinsBySide = {
      left: state.mcuData.pins
        .filter((p) => p.side === "left")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
      bottom: state.mcuData.pins
        .filter((p) => p.side === "bottom")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
      right: state.mcuData.pins
        .filter((p) => p.side === "right")
        .sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
      top: state.mcuData.pins
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

    const cellWidth =
      columnLabels.length > 1
        ? activeArea / (columnLabels.length - 1)
        : activeArea;
    const cellHeight =
      rowLabels.length > 1 ? activeArea / (rowLabels.length - 1) : activeArea;

    const pinMap = new Map(
      state.mcuData.pins.map((p) => [p.gridCoordinates, p]),
    );

    for (let r = 0; r < rowLabels.length; r++) {
      for (let c = 0; c < columnLabels.length; c++) {
        const coord = `${rowLabels[r]}${columnLabels[c]}`;

        if (pinMap.has(coord)) {
          const pinInfo = pinMap.get(coord);
          const pinElement = createPinElement(pinInfo);

          pinElement.style.position = "absolute";
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

export function showPinDetails(pinInfo) {
  const detailsElement = document.getElementById("pinDetails");

  let usedByHtml = "";
  if (state.usedPins[pinInfo.name]) {
    const usage = state.usedPins[pinInfo.name];
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

export function updatePinDisplay() {
  document.querySelectorAll(".pin").forEach((pinElement) => {
    const pinName = pinElement.dataset.name;
    pinElement.classList.remove(
      "used",
      "required",
      "system",
      "devkit-occupied",
    );
    if (state.usedPins[pinName]) {
      pinElement.classList.add("used");
      if (state.usedPins[pinName].required)
        pinElement.classList.add("required");
      if (state.usedPins[pinName].isSystem) pinElement.classList.add("system");
      if (state.usedPins[pinName].isDevkit)
        pinElement.classList.add("devkit-occupied");
    }
  });
  updatePeripheralConflictUI();
}

function updatePeripheralConflictUI() {
  document.querySelectorAll("[data-id]").forEach((el) => {
    const id = el.dataset.id;
    if (!state.mcuData.socPeripherals) return;
    const p = state.mcuData.socPeripherals.find((p) => p.id === id);
    if (
      p &&
      state.usedAddresses[p.baseAddress] &&
      p.baseAddress &&
      !state.selectedPeripherals.some((sp) => sp.id === id)
    ) {
      el.classList.add("disabled");
    } else {
      el.classList.remove("disabled");
    }
  });
}
