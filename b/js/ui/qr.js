/**
 * QR rendering through the vendored qrcode-generator (classic script).
 * If the library is unavailable, the caller still has copy/share paths.
 */
import { setHidden } from "../shared/dom.js";

const LOGO_SRC = "../icon.svg";

export function renderQr(container, text, { logo = LOGO_SRC } = {}) {
  if (!container) return false;
  if (!window.qrcode || !text) {
    clearQr(container);
    return false;
  }
  try {
    const qr = window.qrcode(0, "H");
    qr.addData(text);
    qr.make();
    container.innerHTML = qr.createSvgTag(4, 0);
    if (logo) {
      const img = document.createElement("img");
      img.className = "qr-logo";
      img.src = logo;
      img.alt = "";
      img.decoding = "async";
      container.append(img);
    }
    setHidden(container, false);
    return true;
  } catch {
    clearQr(container);
    return false;
  }
}

export function clearQr(container) {
  if (!container) return;
  container.innerHTML = "";
  setHidden(container, true);
}
