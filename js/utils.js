// --- UTILITY FUNCTIONS ---

export function enableScrollWheelSelection(selectorId) {
  const selector = document.getElementById(selectorId);
  if (!selector) return;
  enableScrollWheelSelectionForElement(selector);
}

export function enableScrollWheelSelectionForElement(selector) {
  if (!selector) return;

  selector.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();

      const direction = Math.sign(event.deltaY);
      const currentIndex = selector.selectedIndex;
      const numOptions = selector.options.length;

      if (numOptions === 0) return;

      let nextIndex = currentIndex + direction;

      while (nextIndex >= 0 && nextIndex < numOptions) {
        const option = selector.options[nextIndex];
        if (!option.disabled && option.value !== "") {
          break;
        }
        nextIndex += direction;
      }

      nextIndex = Math.max(0, Math.min(nextIndex, numOptions - 1));

      if (nextIndex !== currentIndex && !selector.options[nextIndex].disabled) {
        selector.selectedIndex = nextIndex;
        selector.dispatchEvent(new Event("change", { bubbles: true }));
      }
    },
    { passive: false },
  );
}

export function parsePinName(pinName) {
  const match = pinName.match(/P(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    port: parseInt(match[1]),
    pin: parseInt(match[2]),
    name: pinName,
  };
}
