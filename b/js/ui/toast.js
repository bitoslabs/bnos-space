/**
 * Accessible transient status messages.
 */
export function createToast(element) {
  let timer = 0;

  return function show(message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", isError);
    element.classList.add("show");
    clearTimeout(timer);
    timer = window.setTimeout(() => element.classList.remove("show"), 4200);
  };
}
