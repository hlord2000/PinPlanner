// --- GLOBAL STATE ---
let mcuManifest = {}; // Holds the content of manifest.json
let mcuData = {}; // Holds data for the currently selected MCU package
let selectedPeripherals = [];
let usedPins = {};
let usedAddresses = {}; // Track used address spaces
let currentPeripheral = null;
let tempSelectedPins = {}; // Used for storing pin selections temporarily during modal dialog

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', function() {
    console.log("Initializing nRF54L Pin Planner...");

    // Set up event listeners
    document.getElementById('mcuSelector').addEventListener('change', handleMcuChange);
    document.getElementById('packageSelector').addEventListener('change', handlePackageChange);
    document.getElementById('clearAllBtn').addEventListener('click', () => clearAllPeripherals(true));
    document.getElementById('exportBtn').addEventListener('click', exportConfiguration);
    document.getElementById('importBtn').addEventListener('click', openImportModal);
    document.getElementById('searchPeripherals').addEventListener('input', filterPeripherals);
    document.querySelector('#pinSelectionModal .close').addEventListener('click', closePinSelectionModal);
    document.getElementById('closeImportModal').addEventListener('click', closeImportModal);
    document.getElementById('cancelPinSelection').addEventListener('click', closePinSelectionModal);
    document.getElementById('confirmPinSelection').addEventListener('click', confirmPinSelection);
    document.getElementById('cancelImport').addEventListener('click', closeImportModal);
    document.getElementById('confirmImport').addEventListener('click', importConfiguration);

    document.querySelectorAll('.import-tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.import-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.import-tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(this.dataset.tab).classList.add('active');
            document.getElementById('importError').style.display = 'none';
        });
    });

    // Initial data load and package population
    initializeApp();
});

async function initializeApp() {
    try {
        const response = await fetch('mcus/manifest.json');
        if (!response.ok) throw new Error("Manifest file not found.");
        mcuManifest = await response.json();
        populateMcuSelector();
    } catch (error) {
        console.error("Failed to initialize application:", error);
        alert("Could not load MCU manifest. The application may not function correctly.");
    }
}

function populateMcuSelector() {
    const mcuSelector = document.getElementById('mcuSelector');
    mcuSelector.innerHTML = '';
    mcuManifest.mcus.forEach(mcu => {
        const option = document.createElement('option');
        option.value = mcu.id;
        option.textContent = mcu.name;
        option.dataset.packages = JSON.stringify(mcu.packages);
        mcuSelector.appendChild(option);
    });
    handleMcuChange();
}

// --- DATA LOADING AND UI REFRESH ---

function handleMcuChange() {
    const mcuSelector = document.getElementById('mcuSelector');
    const packageSelector = document.getElementById('packageSelector');
    const selectedMcuOption = mcuSelector.options[mcuSelector.selectedIndex];
    
    if (!selectedMcuOption) return;

    const packages = JSON.parse(selectedMcuOption.dataset.packages || '[]');
    packageSelector.innerHTML = '';

    if (packages.length > 0) {
        packages.forEach(pkg => {
            const option = document.createElement('option');
            option.value = pkg.file;
            option.textContent = pkg.name;
            packageSelector.appendChild(option);
        });
        loadCurrentMcuData();
    } else {
        reinitializeView(true); // No packages, clear view
    }
}

function handlePackageChange() {
    loadCurrentMcuData();
}

function loadCurrentMcuData() {
    const mcu = document.getElementById('mcuSelector').value;
    const pkg = document.getElementById('packageSelector').value;
    if (mcu && pkg) {
        loadMCUData(mcu, pkg);
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
        reinitializeView();
    } catch (error) {
        console.error("Error loading MCU data:", error);
        alert(`Could not load data for ${mcu} - ${pkg}.\n${error.message}`);
        reinitializeView(true); // Clear the view on error
    }
}

function reinitializeView(clearOnly = false) {
    clearAllPeripherals(false); // Clear without confirmation

    if (clearOnly || !mcuData.partInfo) {
        document.getElementById('chipTitleDisplay').textContent = 'No MCU Loaded';
        organizePeripherals();
        createPinLayout();
        return;
    }

    document.getElementById('chipTitleDisplay').textContent = `${mcuData.partInfo.packageType} Pin Layout`;
    organizePeripherals();
    createPinLayout();
    setHFXtalAsSystemRequirement();
    updatePinDisplay();
    console.log("Initialization complete. Peripherals loaded:", mcuData.socPeripherals.length);
}

// --- PERIPHERAL ORGANIZATION AND DISPLAY ---

function organizePeripherals() {
    const peripheralsListContainer = document.getElementById('peripherals-list');
    if (!peripheralsListContainer) return;
    peripheralsListContainer.innerHTML = '';

    if (!mcuData.socPeripherals) return;

    const checkboxPeripherals = [];
    const singleInstancePeripherals = [];
    const multiInstanceGroups = {};

    // First, separate out checkbox peripherals and group the rest
    mcuData.socPeripherals.forEach(p => {
        if (p.uiHint === 'checkbox') {
            checkboxPeripherals.push(p);
        } else {
            const baseName = p.id.replace(/\d+$/, '');
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
    checkboxPeripherals.sort((a, b) => a.id.localeCompare(b.id));
    singleInstancePeripherals.sort((a, b) => a.id.localeCompare(b.id));
    const sortedMultiInstanceKeys = Object.keys(multiInstanceGroups).sort();

    // Render checkbox peripherals
    checkboxPeripherals.forEach(p => {
        const checkboxGroup = document.createElement('div');
        checkboxGroup.className = 'checkbox-group';
        
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${p.id.toLowerCase()}-checkbox`;
        checkbox.dataset.peripheralId = p.id;
        checkbox.addEventListener('change', toggleSimplePeripheral);
        
        const span = document.createElement('span');
        span.textContent = p.description;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        
        const description = document.createElement('div');
        description.className = 'checkbox-description';
        description.textContent = `Uses ${p.signals.map(s => s.allowedGpio.join('/')).join(', ')}`;

        checkboxGroup.appendChild(label);
        checkboxGroup.appendChild(description);
        peripheralsListContainer.appendChild(checkboxGroup);
    });

    // Render single-instance peripherals
    singleInstancePeripherals.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'single-peripheral-btn';
        btn.dataset.id = p.id;
        btn.textContent = `${p.id} (${p.type})`;
        btn.addEventListener('click', () => handlePeripheralClick(p));
        peripheralsListContainer.appendChild(btn);
    });

    // Render multi-instance peripherals
    if (sortedMultiInstanceKeys.length > 0) {
        const accordionContainer = document.createElement('div');
        accordionContainer.className = 'accordion';
        
        sortedMultiInstanceKeys.forEach(baseName => {
            const peripherals = multiInstanceGroups[baseName];
            const accordionItem = document.createElement('div');
            accordionItem.className = 'accordion-item';
            const header = document.createElement('div');
            header.className = 'accordion-header';
            header.innerHTML = `<span>${baseName}</span><span class="expand-icon">▼</span>`;
            const content = document.createElement('div');
            content.className = 'accordion-content';

            peripherals.sort((a,b) => a.id.localeCompare(b.id)).forEach(p => {
                const item = document.createElement('div');
                item.className = 'peripheral-item';
                item.dataset.id = p.id;
                item.innerHTML = `<span>${p.id}</span>`;
                item.addEventListener('click', () => handlePeripheralClick(p));
                content.appendChild(item);
            });

            header.addEventListener('click', () => {
                const isActive = header.classList.toggle('active');
                content.style.display = isActive ? 'block' : 'none';
            });

            accordionItem.appendChild(header);
            accordionItem.appendChild(content);
            accordionContainer.appendChild(accordionItem);
        });
        peripheralsListContainer.appendChild(accordionContainer);
    }
}

function handlePeripheralClick(peripheral) {
    const isSelected = selectedPeripherals.some(p => p.id === peripheral.id);
    if (isSelected) {
        editPeripheral(peripheral.id);
    } else if (!hasAddressConflict(peripheral)) {
        openPinSelectionModal(peripheral);
    } else {
        alert(`Cannot select ${peripheral.id} because it shares the same address space (${peripheral.baseAddress}) with another selected peripheral.`);
    }
}


// --- PIN LAYOUT AND DETAILS ---

function createPinElement(pinInfo) {
    const pinElement = document.createElement('div');
    pinElement.className = 'pin';
    pinElement.dataset.number = pinInfo.packagePinId;
    pinElement.dataset.name = pinInfo.name;
    pinElement.textContent = pinInfo.packagePinId;

    if (pinInfo.isClockCapable) pinElement.classList.add('clock');
    const specialTypes = ['power_positive', 'power_ground', 'debug', 'crystal_hf', 'crystal_lf', 'rf_antenna'];
    if (specialTypes.includes(pinInfo.defaultType)) {
        pinElement.classList.add(pinInfo.defaultType.replace('_', '-'));
    }

    pinElement.addEventListener('click', () => showPinDetails(pinInfo));
    return pinElement;
}

function createPinLayout() {
    const chipContainer = document.querySelector('.chip-container');
    chipContainer.innerHTML = '';
    if (!mcuData.renderConfig || !mcuData.pins) return;

    const chipBody = document.createElement('div');
    chipBody.className = 'chip-body';
    chipContainer.appendChild(chipBody);

    const strategy = mcuData.renderConfig.layoutStrategy;

    if (strategy.layoutType === 'quadPerimeter') {
        const pinsBySide = {
            left: mcuData.pins.filter(p => p.side === 'left').sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
            bottom: mcuData.pins.filter(p => p.side === 'bottom').sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
            right: mcuData.pins.filter(p => p.side === 'right').sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
            top: mcuData.pins.filter(p => p.side === 'top').sort((a, b) => parseInt(a.packagePinId) - parseInt(b.packagePinId)),
        };

        const containerSize = 420;
        const margin = 20;
        const activeArea = containerSize - (2 * margin);

        const placePins = (side, pins) => {
            const len = pins.length;
            if (len === 0) return;
            const spacing = activeArea / (len + 1);

            pins.forEach((pinInfo, index) => {
                const pinElement = createPinElement(pinInfo);
                const pos = margin + (index + 1) * spacing;

                switch (side) {
                    case 'left':
                        pinElement.style.left = '0px';
                        pinElement.style.top = pos + 'px';
                        pinElement.style.transform = 'translate(-50%, -50%)';
                        break;
                    case 'bottom':
                        pinElement.style.bottom = '0px';
                        pinElement.style.left = pos + 'px';
                        pinElement.style.transform = 'translate(-50%, 50%)';
                        break;
                    case 'right':
                        pinElement.style.right = '0px';
                        pinElement.style.top = (containerSize - pos) + 'px';
                        pinElement.style.transform = 'translate(50%, -50%)';
                        break;
                    case 'top':
                        pinElement.style.top = '0px';
                        pinElement.style.left = (containerSize - pos) + 'px';
                        pinElement.style.transform = 'translate(-50%, -50%)';
                        break;
                }
                chipContainer.appendChild(pinElement);
            });
        };

        placePins('left', pinsBySide.left);
        placePins('bottom', pinsBySide.bottom);
        placePins('right', pinsBySide.right);
        placePins('top', pinsBySide.top);

    } else if (strategy.layoutType === 'gridMatrix') {
        const { rows, columns } = strategy;
        const containerSize = 420;
        const cellWidth = containerSize / columns;
        const cellHeight = containerSize / rows;

        const pinMap = new Map(mcuData.pins.map(p => [p.gridCoordinates, p]));

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                const rowLabel = String.fromCharCode('A'.charCodeAt(0) + r);
                const colLabel = c + 1;
                const coord = `${rowLabel}${colLabel}`;
                
                if (pinMap.has(coord)) {
                    const pinInfo = pinMap.get(coord);
                    const pinElement = createPinElement(pinInfo);
                    
                    pinElement.style.position = 'absolute';
                    pinElement.style.top = (r * cellHeight) + (cellHeight / 2) + 'px';
                    pinElement.style.left = (c * cellWidth) + (cellWidth / 2) + 'px';
                    pinElement.style.transform = 'translate(-50%, -50%)';
                    
                    chipContainer.appendChild(pinElement);
                }
            }
        }
    }
}

function showPinDetails(pinInfo) {
    const detailsElement = document.getElementById('pinDetails');
    let usedBy = '';
    if (usedPins[pinInfo.name]) {
        const usage = usedPins[pinInfo.name];
        usedBy = `<p><strong>Used by:</strong> ${usage.peripheral} (${usage.function})</p>`;
    }

    detailsElement.innerHTML = `
        <h3>${pinInfo.name} (Pin ${pinInfo.packagePinId})</h3>
        <p><strong>Type:</strong> ${pinInfo.defaultType}</p>
        ${pinInfo.isClockCapable ? '<p><strong>Clock capable</strong></p>' : ''}
        ${usedBy}
        <p><strong>Functions:</strong></p>
        <ul>${(pinInfo.functions || []).map(f => `<li>${f}</li>`).join('')}</ul>
    `;
}


// --- STATE MANAGEMENT ---

function clearAllPeripherals(askConfirmation) {
    if (askConfirmation && !confirm('Are you sure you want to clear all peripherals?')) {
        return;
    }
    selectedPeripherals = [];
    usedPins = {};
    usedAddresses = {};
    document.querySelectorAll('.simple-peripherals input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
    });
    if (mcuData.pins) {
        setHFXtalAsSystemRequirement(); // Re-apply system requirements
    }
    updateSelectedPeripheralsList();
    updatePinDisplay();
}

function setHFXtalAsSystemRequirement() {
    if (!mcuData.pins) return;
    const hfxtalPins = mcuData.pins.filter(p => p.defaultType === 'crystal_hf');
    if (hfxtalPins.length === 2) {
        usedPins[hfxtalPins[0].name] = { peripheral: "32MHz Crystal", function: "XC1", isSystem: true };
        usedPins[hfxtalPins[1].name] = { peripheral: "32MHz Crystal", function: "XC2", isSystem: true };
    }
}

function toggleSimplePeripheral(event) {
    const checkbox = event.target;
    const peripheralId = checkbox.dataset.peripheralId;
    const peripheral = mcuData.socPeripherals.find(p => p.id === peripheralId);

    if (!peripheral) {
        console.error(`Peripheral with ID '${peripheralId}' not found in socPeripherals.`);
        return;
    }

    const pinNames = peripheral.signals.map(s => s.allowedGpio[0]);

    if (checkbox.checked) {
        if (pinNames.some(pin => usedPins[pin])) {
            alert(`One or more pins for ${peripheral.description} are already in use.`);
            checkbox.checked = false;
            return;
        }
        const pinFunctions = {};
        peripheral.signals.forEach(s => {
            const pinName = s.allowedGpio[0];
            usedPins[pinName] = { peripheral: peripheral.id, function: s.name, required: true };
            pinFunctions[pinName] = s.name;
        });
        selectedPeripherals.push({ id: peripheral.id, peripheral, pinFunctions });
    } else {
        pinNames.forEach(pin => delete usedPins[pin]);
        const index = selectedPeripherals.findIndex(p => p.id === peripheral.id);
        if (index !== -1) selectedPeripherals.splice(index, 1);
    }
    updateSelectedPeripheralsList();
    updatePinDisplay();
}


// --- PIN SELECTION MODAL ---

function openPinSelectionModal(peripheral, existingPins = {}) {
    currentPeripheral = peripheral;
    tempSelectedPins = { ...existingPins }; // Pre-populate if editing

    document.getElementById('modalTitle').textContent = `Select Pins for ${peripheral.id}`;
    populatePinSelectionTable(peripheral);
    document.getElementById('pinSelectionModal').style.display = 'block';
}

function closePinSelectionModal() {
    document.getElementById('pinSelectionModal').style.display = 'none';
    currentPeripheral = null;
    tempSelectedPins = {};
}

function populatePinSelectionTable(peripheral) {
    const tableBody = document.getElementById('pinSelectionTableBody');
    tableBody.innerHTML = '';

    peripheral.signals.forEach(signal => {
        const row = document.createElement('tr');
        const allPossiblePins = getPinsForSignal(signal);

        let selectionHtml;
        if (allPossiblePins.length === 1 && signal.allowedGpio.length === 1) {
            const pin = allPossiblePins[0];
            const isUsedByOther = usedPins[pin.name] && usedPins[pin.name].peripheral !== peripheral.id;
            const isChecked = tempSelectedPins[pin.name] === signal.name;
            selectionHtml = `<label><input type="checkbox" data-signal="${signal.name}" data-pin="${pin.name}" ${isChecked ? 'checked' : ''} ${isUsedByOther ? 'disabled' : ''}> ${pin.name}`;
            if (isUsedByOther) {
                selectionHtml += ` <span class="pin-used-by">(Used by ${usedPins[pin.name].peripheral})</span>`;
            }
            selectionHtml += '</label>';
        } else {
            let optionsHtml = '<option value="">-- Select Pin --</option>';
            allPossiblePins.forEach(pin => {
                const isSelected = tempSelectedPins[pin.name] === signal.name;
                const isUsedByOther = usedPins[pin.name] && !isSelected;
                optionsHtml += `<option value="${pin.name}" ${isSelected ? 'selected' : ''} ${isUsedByOther ? 'disabled' : ''}>${pin.name}${isUsedByOther ? ` (Used by ${usedPins[pin.name].peripheral})` : (pin.isClockCapable ? ' (Clock)' : '')}</option>`;
            });
            selectionHtml = `<select data-signal="${signal.name}" ${signal.isMandatory ? 'required' : ''}>${optionsHtml}</select>`;
        }

        row.innerHTML = `
            <td>${signal.name}</td>
            <td>${signal.isMandatory ? 'Yes' : 'No'}</td>
            <td>${selectionHtml}</td>
            <td>${signal.description || ''}</td>
        `;
        tableBody.appendChild(row);
    });

    tableBody.querySelectorAll('select, input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', handlePinSelectionChange);
    });
}

function handlePinSelectionChange(event) {
    const input = event.target;
    const signalName = input.dataset.signal;

    if (input.type === 'checkbox') {
        const pinName = input.dataset.pin;
        if (input.checked) {
            if (usedPins[pinName] && usedPins[pinName].peripheral !== currentPeripheral.id) {
                alert(`${pinName} is already in use by ${usedPins[pinName].peripheral}.`);
                input.checked = false;
                return;
            }
            tempSelectedPins[pinName] = signalName;
        } else {
            delete tempSelectedPins[pinName];
        }
    } else { // Dropdown
        const newPinName = input.value;
        let oldPinName = null;
        for (const pin in tempSelectedPins) {
            if (tempSelectedPins[pin] === signalName) {
                oldPinName = pin;
                break;
            }
        }
        if (oldPinName) delete tempSelectedPins[oldPinName];
        if (newPinName) tempSelectedPins[newPinName] = signalName;
    }
}

function getPinsForSignal(signal) {
    if (!mcuData.pins) return [];
    return mcuData.pins.filter(pin => {
        if (pin.defaultType !== 'io') return false;
        if (signal.requiresClockCapablePin && !pin.isClockCapable) return false;
        return signal.allowedGpio.some(allowed => 
            allowed.endsWith('*') ? pin.port === allowed.slice(0, -1) : pin.name === allowed
        );
    });
}

function confirmPinSelection() {
    const missingSignals = currentPeripheral.signals
        .filter(s => s.isMandatory && !Object.values(tempSelectedPins).includes(s.name));

    if (missingSignals.length > 0) {
        alert(`Please select pins for mandatory functions: ${missingSignals.map(s => s.name).join(', ')}`);
        return;
    }

    for (const pinName in tempSelectedPins) {
        if (usedPins[pinName] && usedPins[pinName].peripheral !== currentPeripheral.id) {
            alert(`Pin ${pinName} is already used by ${usedPins[pinName].peripheral}.`);
            return;
        }
    }

    const existingIndex = selectedPeripherals.findIndex(p => p.id === currentPeripheral.id);
    if (existingIndex !== -1) {
        const oldPeripheral = selectedPeripherals[existingIndex];
        for (const pinName in oldPeripheral.pinFunctions) {
            delete usedPins[pinName];
        }
        selectedPeripherals.splice(existingIndex, 1);
    }

    selectedPeripherals.push({
        id: currentPeripheral.id,
        peripheral: currentPeripheral,
        pinFunctions: { ...tempSelectedPins }
    });

    for (const pinName in tempSelectedPins) {
        usedPins[pinName] = {
            peripheral: currentPeripheral.id,
            function: tempSelectedPins[pinName],
            required: currentPeripheral.signals.find(s => s.name === tempSelectedPins[pinName]).isMandatory
        };
    }
    if (currentPeripheral.baseAddress) {
        usedAddresses[currentPeripheral.baseAddress] = currentPeripheral.id;
    }

    updateSelectedPeripheralsList();
    updatePinDisplay();
    closePinSelectionModal();
}


// --- UI UPDATES ---

function updateSelectedPeripheralsList() {
    const selectedList = document.getElementById('selectedList');
    selectedList.innerHTML = '';

    if (selectedPeripherals.length === 0) {
        selectedList.innerHTML = '<li class="empty-message">No peripherals selected yet.</li>';
        return;
    }

    selectedPeripherals.forEach(p => {
        const item = document.createElement('li');
        item.className = 'selected-item';
        const pinList = Object.entries(p.pinFunctions).map(([pin, func]) => `${pin}: ${func}`).join(', ');
        item.innerHTML = `
            <div><strong>${p.id}</strong><div>${pinList}</div></div>
            <button class="remove-btn" data-id="${p.id}">Remove</button>
        `;
        item.querySelector('.remove-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            removePeripheral(p.id);
        });
        item.addEventListener('click', () => editPeripheral(p.id));
        selectedList.appendChild(item);
    });
}

function updatePinDisplay() {
    document.querySelectorAll('.pin').forEach(pinElement => {
        const pinName = pinElement.dataset.name;
        pinElement.classList.remove('used', 'required', 'system');
        if (usedPins[pinName]) {
            pinElement.classList.add('used');
            if (usedPins[pinName].required) pinElement.classList.add('required');
            if (usedPins[pinName].isSystem) pinElement.classList.add('system');
        }
    });
    updatePeripheralConflictUI();
}

function updatePeripheralConflictUI() {
    document.querySelectorAll('[data-id]').forEach(el => {
        const id = el.dataset.id;
        if (!mcuData.socPeripherals) return;
        const p = mcuData.socPeripherals.find(p => p.id === id);
        if (p && hasAddressConflict(p) && !selectedPeripherals.some(sp => sp.id === id)) {
            el.classList.add('disabled');
        } else {
            el.classList.remove('disabled');
        }
    });
}

function hasAddressConflict(peripheral) {
    return peripheral.baseAddress && usedAddresses[peripheral.baseAddress];
}

function removePeripheral(id) {
    const index = selectedPeripherals.findIndex(p => p.id === id);
    if (index === -1) return;

    const peripheral = selectedPeripherals[index];
    for (const pinName in peripheral.pinFunctions) {
        delete usedPins[pinName];
    }
    if (peripheral.peripheral.baseAddress) {
        delete usedAddresses[peripheral.peripheral.baseAddress];
    }
    selectedPeripherals.splice(index, 1);

    updateSelectedPeripheralsList();
    updatePinDisplay();
}

function editPeripheral(id) {
    const peripheral = selectedPeripherals.find(p => p.id === id);
    if (!peripheral) return;
    openPinSelectionModal(peripheral.peripheral, peripheral.pinFunctions);
}

// --- IMPORT/EXPORT ---

function exportConfiguration() {
    const mcu = document.getElementById('mcuSelector').value;
    const pkg = document.getElementById('packageSelector').value;
    const config = {
        mcu: mcu,
        package: pkg,
        selectedPeripherals: selectedPeripherals.map(p => ({ id: p.id, pinFunctions: p.pinFunctions }))
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nrf-pin-config-${mcu}-${pkg}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function openImportModal() {
    document.getElementById('importModal').style.display = 'block';
}

function closeImportModal() {
    document.getElementById('importModal').style.display = 'none';
}

function importConfiguration() {
    const fileInput = document.getElementById('importFileInput');
    const jsonInput = document.getElementById('importJsonInput').value;

    if (fileInput.files.length > 0) {
        const reader = new FileReader();
        reader.onload = (e) => processImportedJson(e.target.result);
        reader.readAsText(fileInput.files[0]);
    } else if (jsonInput) {
        processImportedJson(jsonInput);
    } else {
        document.getElementById('importError').textContent = 'Please select a file or paste JSON.';
        document.getElementById('importError').style.display = 'block';
    }
}

async function processImportedJson(json) {
    try {
        const config = JSON.parse(json);
        if (!config.mcu || !config.package || !config.selectedPeripherals) {
            throw new Error("Invalid configuration file.");
        }

        document.getElementById('mcuSelector').value = config.mcu;
        await handleMcuChange(); // This will update packages and load data
        document.getElementById('packageSelector').value = config.package;
        await loadCurrentMcuData();

        config.selectedPeripherals.forEach(p_config => {
            const p_data = mcuData.socPeripherals.find(p => p.id === p_config.id);
            if (p_data) {
                selectedPeripherals.push({ id: p_data.id, peripheral: p_data, pinFunctions: p_config.pinFunctions });
                for (const pinName in p_config.pinFunctions) {
                    usedPins[pinName] = { peripheral: p_data.id, function: p_config.pinFunctions[pinName] };
                }
                if (p_data.baseAddress) {
                    usedAddresses[p_data.baseAddress] = p_data.id;
                }
            }
        });

        updateSelectedPeripheralsList();
        updatePinDisplay();
        closeImportModal();
    } catch (error) {
        document.getElementById('importError').textContent = `Error: ${error.message}`;
        document.getElementById('importError').style.display = 'block';
    }
}

function filterPeripherals() {
    // This function can be expanded to search through the new data structure
}
