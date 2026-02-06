# Known Issues

## Bugs (Fixed in this release)

1. **FLPR hardcodes `uart30` for console** - Previously, the FLPR DTS generation always used `uart30` regardless of user selection. Now uses `state.consoleUart`.
2. **FLPR defconfig always enables UART console** - Even when no UART was selected. Now conditional on `state.consoleUart`.
3. **First-UART-wins console selection** - Console UART depended on peripheral selection order. Now uses explicit console UART selector.
4. **NS DTS uses first-found UART** - Non-secure DTS used first-found UART instead of user-chosen console. Now uses `state.consoleUart`.
5. **No warning when exporting without UART console** - Users weren't warned. Now shows console status banner.
6. **Debug `console.log` left in production code** - `console.log("Processing GPIO:", gpio)` removed.

## Enhancements (Added in this release)

7. **Responsive design** - Added CSS breakpoints for tablet/mobile layouts.
8. **CI/CD pipeline** - GitHub Actions for formatting, schema validation, and smoke tests.
9. **Zephyr build verification** - CI workflow to build generated board definitions against real Zephyr.
10. **Modular architecture** - Split 3849-line `script.js` into 12 ES modules in `js/` directory.
11. **Explicit console UART selector** - UI for choosing which UART is the serial console.
12. **Devkit configuration loading** - Load pre-extracted devkit pin configs for evaluation.
13. **Overlay export mode** - When devkit is loaded, exports `.overlay` instead of full board definition.
14. **Toast notification system** - Non-blocking notifications for user feedback.
15. **package.json tracked in git** - Enables CI dev dependencies (was previously gitignored).
