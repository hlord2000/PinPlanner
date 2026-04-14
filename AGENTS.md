# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nordic Pin Planner is an **unofficial** web-based tool for visualizing and planning pin assignments for Nordic Semiconductor's nRF54L series microcontrollers. It generates Zephyr RTOS board definition files based on user configurations.

**Important**: This is NOT an official Nordic Semiconductor application. All configurations must be verified against official documentation.

## Development Commands

### Install dependencies

```bash
npm install
```

### Formatting

```bash
npm run format          # Auto-fix formatting
npm run format:check    # Check formatting (CI)
```

### Validation & Testing

```bash
npm run validate:schemas   # Validate MCU JSON against mcuSchema.json
npm run smoke-test         # Smoke test MCU data integrity
npm test                   # Run all checks (format + schema + smoke)
```

### Devkit Extraction (requires local Zephyr checkout)

```bash
npm run extract-devkits -- --zephyr-path=/path/to/zephyr
```

### Running the Application

This is a static web application. Open `index.html` in a web browser or use a local development server:

```bash
python -m http.server 8000
# or
npx http-server
```

## Architecture

### Module Structure (`js/`)

The application uses native ES modules (`<script type="module">`). No bundler required.

| Module                   | Purpose                                                       |
| ------------------------ | ------------------------------------------------------------- |
| `js/main.js`             | Entry point: event wiring, theme setup, initialization        |
| `js/state.js`            | Centralized state object, persistence (save/load/reset)       |
| `js/mcu-loader.js`       | MCU/package loading, `initializeApp`, `reinitializeView`      |
| `js/peripherals.js`      | Peripheral organization, toggle, oscillator config, filtering |
| `js/pin-layout.js`       | Responsive pin diagram rendering, pin display updates         |
| `js/devicetree.js`       | All DeviceTree generation functions (30+)                     |
| `js/export.js`           | Board info modal, ZIP assembly, overlay export                |
| `js/console-config.js`   | Serial console UART selection and warnings                    |
| `js/devkit-loader.js`    | Load devkit configs, overlay generation mode                  |
| `js/utils.js`            | Shared utilities (scroll wheel, `parsePinName`)               |
| `js/ui/modals.js`        | Pin selection modal, GPIO modal                               |
| `js/ui/selected-list.js` | Selected peripherals list rendering                           |
| `js/ui/import-export.js` | JSON config import/export modals                              |
| `js/ui/notifications.js` | Toast notification system                                     |

### Other Key Files

- **index.html**: Main application UI with modals
- **style.css**: Complete styling including dark mode, responsive breakpoints, toast styles
- **mcus/**: MCU package definitions and devicetree templates
- **devkits/**: Pre-extracted devkit pin configurations (JSON)
- **ci/**: CI validation scripts (schema validation, smoke tests, board generation)
- **.github/workflows/**: GitHub Actions CI/CD pipelines

### MCU Data Architecture

The application uses a hierarchical JSON-based system:

1. **manifest.json**: Top-level MCU catalog
   - Lists all supported MCUs (nRF54L05, nRF54L10, nRF54L15, nRF54LV10A, nRF54LM20A)
   - Maps MCUs to available packages
   - Defines which MCUs support non-secure builds (`supportsNonSecure`)
   - Defines which MCUs support FLPR (Fast Lightweight Processor) core (`supportsFLPR`)

2. **Package Definition Files** (e.g., `qfn48-6x6-qfaa.json`):
   - Physical chip dimensions and rendering parameters
   - Pin layout strategy (quadPerimeter with pin counts per side)
   - Pin definitions with GPIO mappings
   - Peripheral configurations with signal-to-pin mappings
   - Address space information for memory-mapped peripherals

3. **devicetree-templates.json**: Per-MCU Zephyr DeviceTree generation templates
   - Maps peripheral IDs to DeviceTree node names
   - Defines signal-to-pinctrl mappings
   - Provides templates for generating `.dtsi` files

### State Management

All state is centralized in `js/state.js` via a single exported `state` object:

- `state.mcuManifest`: Loaded from manifest.json at startup
- `state.mcuData`: Currently selected MCU package data
- `state.selectedPeripherals`: Array of user-selected peripherals with pin assignments
- `state.usedPins`: Tracks which pins are assigned to prevent conflicts
- `state.usedAddresses`: Tracks address space usage for peripherals
- `state.deviceTreeTemplates`: Loaded per-MCU for export generation
- `state.consoleUart`: Selected console UART peripheral ID (null = RTT mode)
- `state.devkitConfig`: Loaded devkit configuration (null = custom board mode)

### Key Application Flows

#### 1. Initialization (initializeApp in mcu-loader.js)

- Fetches `mcus/manifest.json`
- Populates MCU selector dropdown
- Triggers initial MCU/package load

#### 2. MCU/Package Selection (mcu-loader.js)

- `handleMcuChange()`: Populates package selector
- `loadCurrentMcuData()`: Loads package JSON and devicetree templates
- `reinitializeView()`: Rebuilds UI including peripherals list and pin diagram

#### 3. Peripheral Configuration (peripherals.js)

- Simple peripherals (no pins): Toggle on/off with checkboxes (`toggleSimplePeripheral`)
- Complex peripherals: Open modal for pin selection (`openPinSelectionModal`)
- Pin selection validates against availability and conflicts
- Oscillators have special configuration modals for GPIO control and capacitance

#### 4. Console UART Configuration (console-config.js)

- 0 UARTs selected: Warning banner, RTT will be used
- 1 UART selected: Auto-selected as console
- Multiple UARTs: Dropdown to choose which is the serial console
- `state.consoleUart` drives all DeviceTree `chosen` section generation

#### 5. Devkit Loading (devkit-loader.js)

- Loads pre-extracted configs from `devkits/<board>.json`
- Applies peripheral and GPIO configs to state
- Switches export mode from full board definition to `.overlay` file
- Shows evaluation notice and Zephyr version info

#### 6. Pin Diagram Rendering (pin-layout.js)

- Responsive rendering (reads actual container width)
- Supports multiple layout strategies (currently quadPerimeter for QFN packages)
- Color-codes pins by assignment status (available, used, selected, devkit-occupied)
- Interactive hover shows pin details

#### 7. Board Definition Export (export.js + devicetree.js)

**Custom board mode**: Generates a complete Zephyr board definition as ZIP:

- `board.yml`, `board.cmake`, `Kconfig.*`
- DTS/DTSI files for cpuapp, cpuapp/ns, cpuflpr, cpuflpr/xip

**Devkit mode**: Generates `.overlay` and optional `-pinctrl.dtsi` files for evaluation

### Data Persistence

State is saved to `localStorage` per MCU/package combination:

- Key format: `pinPlannerState_<mcuId>_<packageFile>`
- Saves: `selectedPeripherals` array with all pin assignments and configs
- Auto-loads on MCU/package selection
- Special handling for system requirements (HFXO oscillator)

### Schema Validation

`mcuSchema.json` defines the complete JSON schema for package definition files including:

- Part information and physical dimensions
- Render configuration for visual display
- Pin layout strategies and defaults
- Pin definitions with GPIO/peripheral mappings
- Peripheral definitions with signals and address spaces

## Important Implementation Details

### Pin Selection Logic

- Each pin can have multiple functions (GPIO, peripheral signals)
- `availableFor` array in pin definitions lists compatible peripherals
- Pin conflicts are checked before assignment
- Address space conflicts checked for memory-mapped peripherals (SPI, I2C, UART, etc.)

### Oscillator Handling

- HFXO (High Frequency Crystal Oscillator) marked as system requirement
- Cannot be removed once added
- GPIO pins can optionally be assigned for oscillator control
- Load capacitance configurable per oscillator

### DeviceTree Generation

- Uses template-based system with signal name placeholders
- Console UART driven by `state.consoleUart` (not first-found)
- Generates multiple build targets:
  - Standard cpuapp (ARM Cortex-M33)
  - Non-secure cpuapp/ns (TrustZone-M) for L10/L15
  - FLPR cpuflpr (RISC-V, execute from SRAM) for L05/L10/L15
  - FLPR XIP cpuflpr/xip (RISC-V, execute in-place from RRAM) for L05/L10/L15
- Includes pinctrl nodes with NRF_PSEL() macros
- Automatically detects and includes required features in board.yml

### FLPR (Fast Lightweight Processor) Support

The nRF54L05, nRF54L10, and nRF54L15 include a RISC-V FLPR core for low-power peripheral management:

**Key differences from cpuapp:**

- Architecture: RISC-V instead of ARM Cortex-M33
- Two execution modes:
  - **SRAM mode**: Code runs from SRAM (96KB SRAM, 96KB flash partition)
  - **XIP mode**: Code executes in-place from RRAM (68KB SRAM, 96KB flash)
- Separate device tree and configuration files
- JLink debugging:
  - L15: Uses `--device=nRF54L15_RV32`
  - L05/L10: Require JLink script for generic RISC-V debugging

### Package Rendering

- Layout strategies defined in JSON (currently quadPerimeter)
- Pin numbering configurable (corner start, direction)
- Supports different pin shapes and orientations
- Real physical dimensions used for accurate representation

## CI/CD

### GitHub Actions Workflows

- **ci.yml**: Runs on push/PR to `main`/`dev`. Checks formatting, validates MCU schemas, runs smoke tests.
- **zephyr-build.yml**: Triggered when devicetree or MCU data changes. Generates test board definitions and builds them against Zephyr.

### CI Scripts (`ci/`)

- `validate-mcu-schemas.js`: AJV-based schema validation of all package JSON files
- `smoke-test.js`: Structural integrity checks for MCU data and templates
- `generate-test-boards.js`: Generates test board definitions for Zephyr build verification
- `extract-devkit-configs.js`: Extracts pin configs from Zephyr board DTS files

## Git Workflow

- Main branch: `main`
- Feature branches: `feature/<name>`
