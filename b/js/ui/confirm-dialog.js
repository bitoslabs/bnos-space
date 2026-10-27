import { t } from "../shared/i18n.js";
/**
 * Small promise-based confirmation dialog. Uses the same native dialog shell
 * and button styles as the rest of the app, so confirmations no longer depend
 * on the browser's window.confirm UI.
 */
export function createConfirmDialog({
  dialog,
  kicker,
  title,
  message,
  accept,
  cancel,
}) {
  let pending = null;

  function settle(value) {
    const resolve = pending;
    pending = null;
    if (resolve) resolve(value);
  }

  function open({
    kicker: kickerText = t("Confirm"),
    title: titleText = t("Are you sure?"),
    message: messageText = "",
    confirmLabel = t("Confirm"),
    cancelLabel = t("Cancel"),
    tone = "primary",
  } = {}) {
    if (dialog.open) return Promise.resolve(false);

    kicker.textContent = kickerText;
    title.textContent = titleText;
    message.textContent = messageText;
    accept.textContent = confirmLabel;
    cancel.textContent = cancelLabel;
    accept.className = `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`;

    const result = new Promise((resolve) => {
      pending = resolve;
    });

    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    requestAnimationFrame(() => cancel.focus());
    return result;
  }

  function close() {
    if (dialog.open) dialog.close();
    else settle(false);
  }

  accept.addEventListener("click", () => {
    settle(true);
    dialog.close();
  });

  cancel.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("close", () => {
    settle(false);
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  return { open, close };
}
