/**
 * Small DOM helpers. No application state lives here.
 */
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

export function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[ch];
  });
}

export function setHidden(element, hidden) {
  if (element) element.hidden = Boolean(hidden);
}

export function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export function focusFirst(root) {
  const target = root && root.querySelector("input, textarea, select, button");
  if (target) target.focus();
}
