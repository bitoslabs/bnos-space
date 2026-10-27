/**
 * Fullscreen gallery viewer. Uses the native dialog element, keeps focus in the
 * page and supports arrow-key navigation.
 */
import { esc } from "../shared/dom.js";

export function createLightbox({
  dialog,
  stage,
  title,
  count,
  caption,
  prevBtn,
  nextBtn,
}) {
  let items = [];
  let index = 0;

  function labelFor(item) {
    return item.caption || item.alt || (item.type === "video" ? "Video" : "Image");
  }

  function render() {
    if (!items.length) {
      close();
      return;
    }
    index = Math.max(0, Math.min(index, items.length - 1));
    const item = items[index];
    const alt = item.alt || item.caption || "";

    if (item.type === "video") {
      stage.innerHTML = `<video class="lightbox-media" src="${esc(
        item.url
      )}"${
        item.poster ? ` poster="${esc(item.poster)}"` : ""
      } controls playsinline autoplay aria-label="${esc(labelFor(item))}"></video>`;
    } else {
      stage.innerHTML = `<img class="lightbox-media" src="${esc(
        item.url
      )}" alt="${esc(alt)}" decoding="async">`;
    }

    title.textContent = labelFor(item);
    count.textContent = `${index + 1} / ${items.length}`;
    caption.textContent =
      item.alt && item.alt !== item.caption ? item.alt : "";
    caption.hidden = !caption.textContent;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === items.length - 1;
    prevBtn.hidden = items.length < 2;
    nextBtn.hidden = items.length < 2;
  }

  function open(list, start = 0) {
    items = (Array.isArray(list) ? list : []).filter(
      (item) => item && item.url
    );
    if (!items.length) return;
    index = Number.isFinite(Number(start)) ? Number(start) : 0;
    render();
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    document.documentElement.classList.add("lightbox-open");
  }

  function close() {
    if (dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function step(delta) {
    if (!items.length) return;
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    index = next;
    render();
  }

  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener("close", () => {
    stage.innerHTML = "";
    document.documentElement.classList.remove("lightbox-open");
  });

  document.addEventListener("keydown", (event) => {
    if (!dialog.open) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    }
  });

  return { open, close };
}
