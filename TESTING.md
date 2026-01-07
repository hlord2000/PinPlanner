# Pin Planner Testing Guide

This document provides a testing prompt for iterative testing of the nRF54L Pin Planner application using Playwright or manual browser testing.

## Prerequisites

1. Start a local development server:
   ```bash
   python -m http.server 8000
   # or
   npx http-server -p 8000
   ```

2. Navigate to `http://0.0.0.0:8000` or `http://localhost:8000`

---

## Automated Testing Prompt (for Claude Code with Playwright)

```
Using Playwright, navigate to 0.0.0.0:8000 and perform the following tests on the Pin Planner application:

### 1. Initial Load Verification
- Verify the page loads with default MCU (nRF54LV10A) and package (QFN-48)
- Confirm HFXO is pre-selected in the Selected peripherals list
- Verify the pin diagram renders with 48 pins

### 2. Pin Details Test
- Click on Pin 1 to view pin details
- Verify details panel shows pin name (P1.12), type, attributes, and functions

### 3. UART Peripheral Test
- Expand the UARTE accordion
- Click on UARTE20 to open pin selection modal
- Select P1.00 for TXD
- Verify P1.00 becomes disabled in RXD dropdown (conflict detection)
- Select P1.01 for RXD
- Confirm selection
- Verify UARTE20 appears in Selected list with correct pins

### 4. SPI Peripheral Test
- Expand the SPIM/SPIS accordion
- Verify SPIM/SPIS20 is disabled (address conflict with UARTE20)
- Click on SPIM/SPIS21
- Select P1.03 for SCK (should only show clock-capable pins)
- Select P1.04 for SDO
- Select P1.05 for CS
- Verify P1.00, P1.01 are disabled (used by UART)
- Confirm selection
- Verify SPIM/SPIS21 appears in Selected list

### 5. GPIO Pin Test
- Click "+ Add GPIO Pin" button
- Enter label: "led0"
- Select GPIO pin: P1.06
- Verify P1.00-P1.05 are shown as "(in use)" and disabled
- Select Active State: Active High
- Click "Add GPIO"
- Verify GPIO appears in Selected list as "GPIO: led0 - P1.06 (active-high)"

### 6. Oscillator Configuration Test
- Click "High Frequency Crystal Oscillator (Configure)" button
- Verify modal shows Internal/External capacitor options
- Change load capacitance from 15.00 pF to 10.00 pF
- Confirm configuration
- Verify HFXO in Selected list shows updated capacitance

### 7. MCU/Package Switching Test
- Change MCU to nRF54L15
- Verify:
  - Package options change (QFN-52, QFN-48, QFN-40, WLCSP-47)
  - Pin diagram updates to 52 pins
  - Additional peripherals appear (NFC, QSPI, I2S, PDM, PWM, QDEC)
  - Fresh state with only HFXO selected
- Switch back to nRF54LV10A
- Verify previous configuration is restored from localStorage

### 8. DeviceTree Export Test
- Click "Generate DeviceTree (BETA)"
- Fill in board info:
  - Board Name: test_board
  - Full Board Name: Test Board v1.0
  - Vendor: custom
- Click "Generate Board Definition"
- Verify ZIP file downloads
- Extract and verify contents include:
  - board.yml, board.cmake, Kconfig files
  - pinctrl.dtsi with correct pin mappings
  - DTS files for cpuapp, cpuapp_ns, cpuflpr, cpuflpr_xip

### 9. JSON Config Export Test
- Click "Export Config"
- Click "Export" in modal
- Verify JSON file downloads with correct structure:
  - version, exportDate, mcu, package
  - selectedPeripherals array with all configurations

### 10. Visual Verification
- Take a screenshot of final state
- Verify pin diagram shows:
  - Used pins highlighted (teal/cyan)
  - Clock-capable pins marked (orange)
  - Power/Debug pins distinct (dark gray)
```

---

## Manual Testing Checklist

### Core Functionality
- [ ] Page loads without console errors
- [ ] MCU dropdown populated with all supported MCUs
- [ ] Package dropdown updates based on MCU selection
- [ ] Pin diagram renders correctly for each package type
- [ ] Pin click shows details panel

### Peripheral Selection
- [ ] Simple peripherals toggle on/off with checkbox
- [ ] Complex peripherals open pin selection modal
- [ ] Required signals marked as "Yes" in modal
- [ ] Optional signals can be left unselected
- [ ] Pin dropdowns show only compatible pins
- [ ] Clock-capable pins marked with "(Clock)" suffix
- [ ] Used pins disabled with "(in use)" suffix

### Conflict Detection
- [ ] Pins selected in modal disabled in other dropdowns
- [ ] Pins used by other peripherals disabled globally
- [ ] Address space conflicts disable conflicting peripherals
- [ ] Alert shown when attempting to select conflicting peripheral

### Special Peripherals
- [ ] HFXO cannot be removed (system requirement)
- [ ] LFXO can be added/removed
- [ ] Oscillator config modal shows capacitor options
- [ ] GPIO modal validates label format
- [ ] UART "Disable RX" option makes RXD optional
- [ ] SPI allows adding extra CS GPIOs

### State Persistence
- [ ] Configuration saved to localStorage on changes
- [ ] Configuration restored when returning to MCU/package
- [ ] Different MCU/package combinations have independent state

### Export Functions
- [ ] DeviceTree export generates valid Zephyr board definition
- [ ] Generated pinctrl.dtsi has correct NRF_PSEL macros
- [ ] JSON export captures all peripheral configurations
- [ ] JSON import restores configuration correctly

### UI/UX
- [ ] Dark mode toggle works
- [ ] Peripheral search filters list correctly
- [ ] Accordion groups expand/collapse
- [ ] Modals can be closed with X button or Cancel
- [ ] Remove buttons work for all removable peripherals
- [ ] Clear All resets to default state (HFXO only)

---

## Known Edge Cases to Test

1. **Maximum pin usage**: Add peripherals until most pins are used
2. **All instances of a peripheral type**: Add UARTE20, UARTE21, UARTE30
3. **Package with fewer pins**: Test CSP-29 package (29 pins)
4. **Rapid MCU switching**: Quick switches between MCUs
5. **Browser refresh**: Verify state persists after page reload
6. **Clear All then re-add**: Ensure clean state after clearing

---

## Expected Console Logs

Normal operation should show:
```
Initializing nRF54L Pin Planner...
Loaded data for [MCU]-[Package]
State loaded for pinPlannerConfig-[mcu]-[package]  (or "No saved state found")
Initialization complete. Peripherals loaded: [count]
State saved for pinPlannerConfig-[mcu]-[package]  (on each change)
```

Warnings to note (not errors):
```
No template found for GPIO_[label]  (GPIO pins don't have DeviceTree templates)
```

---

## Reporting Issues

When reporting bugs, include:
1. MCU and Package selected
2. Steps to reproduce
3. Expected vs actual behavior
4. Console errors (if any)
5. Browser and version

