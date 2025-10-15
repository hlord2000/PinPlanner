# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nordic Pin Planner is an **unofficial** web-based tool for visualizing and planning pin assignments for Nordic Semiconductor's nRF54L series microcontrollers. It generates Zephyr RTOS board definition files based on user configurations.

**Important**: This is NOT an official Nordic Semiconductor application. All configurations must be verified against official documentation.

## Development Commands

### Formatting
```bash
npx prettier --write .
```

### Running the Application
This is a static web application. Open `index.html` in a web browser or use a local development server:
```bash
python -m http.server 8000
# or
npx http-server
```

## Architecture

### Core Files Structure

- **index.html**: Main application UI with modals for pin selection, oscillator config, and board info
- **script.js** (2573 lines): All application logic including state management, UI rendering, and export
- **style.css**: Complete styling including dark mode support
- **mcus/**: MCU package definitions and templates

### MCU Data Architecture

The application uses a hierarchical JSON-based system:

1. **manifest.json**: Top-level MCU catalog
   - Lists all supported MCUs (nRF54L05, nRF54L10, nRF54L15, nRF54LM20A)
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

### Global State Management

Key state variables in `script.js`:
- `mcuManifest`: Loaded from manifest.json at startup
- `mcuData`: Currently selected MCU package data
- `selectedPeripherals`: Array of user-selected peripherals with pin assignments
- `usedPins`: Tracks which pins are assigned to prevent conflicts
- `usedAddresses`: Tracks address space usage for peripherals
- `deviceTreeTemplates`: Loaded per-MCU for export generation

### Key Application Flows

#### 1. Initialization (initializeApp)
- Fetches `mcus/manifest.json`
- Populates MCU selector dropdown
- Triggers initial MCU/package load

#### 2. MCU/Package Selection
- `handleMcuChange()`: Populates package selector
- `loadCurrentMcuData()`: Loads package JSON and devicetree templates
- `reinitializeView()`: Rebuilds UI including peripherals list and pin diagram

#### 3. Peripheral Configuration
- Simple peripherals (no pins): Toggle on/off with checkboxes (`toggleSimplePeripheral`)
- Complex peripherals: Open modal for pin selection (`openPinSelectionModal`)
- Pin selection validates against availability and conflicts
- Oscillators have special configuration modals for GPIO control and capacitance

#### 4. Pin Diagram Rendering (`createPinLayout`)
- Canvas-based rendering using package `renderConfig`
- Supports multiple layout strategies (currently quadPerimeter for QFN packages)
- Color-codes pins by assignment status (available, used, selected)
- Interactive hover shows pin details

#### 5. Board Definition Export (`exportBoardDefinition`)
Generates a complete Zephyr board definition as a ZIP file containing:
- `board.yml`: Board metadata and supported features
- `board.cmake`: Build system integration
- `Kconfig.board`: Kconfig configuration
- `<board>_<mcu>_cpuapp.dts`: Main DeviceTree file for ARM Cortex-M33
- `<board>_<mcu>_cpuapp_common.dtsi`: Common peripheral definitions with pinctrl
- Optional non-secure variants for MCUs with TrustZone-M (`supportsNonSecure`)
- Optional FLPR variants for MCUs with RISC-V FLPR core (`supportsFLPR`):
  - `<board>_<mcu>_cpuflpr.dts`: FLPR DeviceTree (executes from SRAM)
  - `<board>_<mcu>_cpuflpr_xip.dts`: FLPR XIP DeviceTree (executes in-place from RRAM)

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

**Implementation details:**
- `getMcuSupportsFLPR()`: Checks manifest for FLPR capability
- `generateFLPRDts()`: Generates base FLPR device tree with SRAM configuration
- `generateFLPRXIPDts()`: Extends base FLPR with XIP memory configuration
- `generateFLPRYaml()`: Creates board metadata for FLPR targets
- `generateFLPRDefconfig()`: Generates Kconfig with XIP=y/n setting

### Package Rendering
- Layout strategies defined in JSON (currently quadPerimeter)
- Pin numbering configurable (corner start, direction)
- Supports different pin shapes and orientations
- Real physical dimensions used for accurate representation

## Git Workflow

- Main branch: `main`
- Development branch: `dev` (current)
- Recent work includes oscillator improvements and board definition export implementation
