/**
 * Loading / empty / error presentation.
 */
import { $, setHidden } from "../shared/dom.js";

const ERROR_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
const EMPTY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>';

export function renderState(
  root,
  { mode = "loading", title = "", text = "", actions = "" }
) {
  const loading = mode === "loading";
  const card = $(".state-card", root);
  const skeleton = $("#state-skeleton", root);
  const status = $("#state-status", root);
  const spinner = $(".state-spinner", root);
  const icon = $(".state-icon", root);
  const titleEl = $("#state-title", root);
  const textEl = $("#state-text", root);
  const actionsEl = $("#state-actions", root);

  setHidden(card, loading);
  setHidden(skeleton, !loading);
  if (status) status.textContent = loading ? title : "";
  root.classList.toggle("is-loading", loading);
  root.setAttribute("aria-busy", loading ? "true" : "false");
  setHidden(spinner, mode !== "loading");
  setHidden(icon, mode === "loading");
  if (mode !== "loading" && icon) {
    icon.innerHTML = mode === "error" ? ERROR_ICON : EMPTY_ICON;
  }
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.innerHTML = text || "";
  if (actionsEl) actionsEl.innerHTML = actions || "";
}
