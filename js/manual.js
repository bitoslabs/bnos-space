// Manual page behaviour: reading progress, scroll-spy, TOC search,
// mobile drawer, section pager and back-to-top. Progressive enhancement only.

const sidebar = document.getElementById("sidebar");
const backdrop = document.getElementById("backdrop");
const menuToggle = document.getElementById("menuToggle");
const toTop = document.getElementById("toTop");
const progress = document.getElementById("progress");
const tocSearch = document.getElementById("tocSearch");
const tocNav = document.getElementById("tocNav");
const tocEmpty = document.getElementById("tocEmpty");
const pagerPrev = document.getElementById("pagerPrev");
const pagerNext = document.getElementById("pagerNext");

const sections = Array.from(document.querySelectorAll("section[id]"));
const navLinks = Array.from(document.querySelectorAll(".sidebar-nav a"));
const linkById = new Map(
  navLinks.map((a) => [(a.getAttribute("href") || "").slice(1), a]),
);

/* ---------------------------------------------------------------- *
 * Reading progress                                                *
 * ---------------------------------------------------------------- */
function updateProgress() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - doc.clientHeight;
  const pct = max > 0 ? (doc.scrollTop / max) * 100 : 0;
  if (progress) progress.style.width = pct + "%";
  if (toTop) toTop.classList.toggle("show", doc.scrollTop > 500);
}

/* ---------------------------------------------------------------- *
 * Scroll-spy + pager                                              *
 * ---------------------------------------------------------------- */
function labelFor(id) {
  const link = linkById.get(id);
  const span = link && link.querySelector("span");
  return span ? span.textContent.trim() : id;
}

function setPager(link, target) {
  if (!link) return;
  const label = link.querySelector("b");
  if (!target) {
    link.classList.add("is-disabled");
    link.setAttribute("href", "#");
    if (label) label.textContent = "";
    return;
  }
  link.classList.remove("is-disabled");
  link.setAttribute("href", "#" + target);
  if (label) label.textContent = labelFor(target);
}

function updateActiveSection() {
  let current = "";
  for (const section of sections) {
    if (window.scrollY >= section.offsetTop - 140) current = section.id;
  }
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 4) {
    current = sections.length ? sections[sections.length - 1].id : current;
  }

  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === "#" + current);
  });

  const index = sections.findIndex((s) => s.id === current);
  setPager(pagerPrev, index > 0 ? sections[index - 1].id : null);
  setPager(pagerNext, index >= 0 && index < sections.length - 1 ? sections[index + 1].id : null);
}

let ticking = false;
window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateProgress();
      updateActiveSection();
      ticking = false;
    });
  },
  { passive: true },
);

/* ---------------------------------------------------------------- *
 * Mobile drawer (navigation toggle opens the table of contents)   *
 * ---------------------------------------------------------------- */
function openDrawer() {
  sidebar?.classList.add("open");
  backdrop?.classList.add("show");
}
function closeDrawer() {
  sidebar?.classList.remove("open");
  backdrop?.classList.remove("show");
}

menuToggle?.addEventListener("click", () => {
  sidebar?.classList.contains("open") ? closeDrawer() : openDrawer();
});
backdrop?.addEventListener("click", closeDrawer);
navLinks.forEach((link) => link.addEventListener("click", closeDrawer));

/* ---------------------------------------------------------------- *
 * TOC search                                                      *
 * ---------------------------------------------------------------- */
tocSearch?.addEventListener("input", () => {
  const query = tocSearch.value.trim().toLowerCase();
  let visible = 0;
  tocNav?.querySelectorAll("li").forEach((li) => {
    const match = li.textContent.toLowerCase().includes(query);
    li.style.display = match ? "" : "none";
    if (match) visible += 1;
  });
  if (tocEmpty) tocEmpty.style.display = visible === 0 ? "block" : "none";
});

/* ---------------------------------------------------------------- *
 * Back to top                                                     *
 * ---------------------------------------------------------------- */
toTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------------------------------------------------------------- *
 * Initial state                                                   *
 * ---------------------------------------------------------------- */
updateProgress();
updateActiveSection();
