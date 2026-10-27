/**
 * Owner editor. Owns only editor-local state (fields, draft, publish status).
 * Authentication, storage and publishing are delegated to services.
 */
import { $, $$, esc, setHidden } from "../shared/dom.js";
import { clone } from "../shared/clone.js";
import {
  makeId,
  splitList,
  timeAgo,
} from "../shared/format.js";
import {
  httpUrl,
  normalizeBlossomServer,
  parseRelayUrls,
} from "../shared/urls.js?v=13";
import {
  GALLERY_LIMIT,
  INLINE_IMAGE_BUDGET,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  dataUrlToFile,
  extractVideoPoster,
  formatBytes,
  inlineImageBytes,
  isDataImage,
  isInlineMedia,
} from "../shared/media.js?v=13";
import { normalizeTheme } from "../data/themes.js";
import { t } from "../shared/i18n.js";
import {
  emptyProfile,
  normalizeProfile,
  validateProfile,
} from "../data/profile-model.js?v=13";
import {
  clearDraft,
  loadBlossomServer,
  loadRelays,
  readDraft,
  saveBlossomServer,
  saveRelays,
  writeDraft,
} from "../data/storage.js?v=13";
import { hexToNpub } from "../shared/bech32.js";
import * as auth from "../services/auth.js";
import { publishProfile } from "../services/publish.js?v=13";
import { uploadFilesToBlossom } from "../services/blossom.js?v=13";
import { uploadEntriesToMediaServer } from "../services/media-server.js?v=13";
import { createNip05Wizard } from "./nip05-wizard.js";

export function createEditorView({
  root,
  toast,
  confirm,
  onPublished,
  onClosed,
  onRelaysChanged,
  onThemePreview,
}) {
  const body = $("#editor-body", root);
  const publishButtons = $$("[data-editor-publish]", root);
  const els = {
    owner: $("#editor-owner", root),
    status: $("#editor-status", root),
    url: $("#editor-url", root),
    saveState: $("#save-state", root),
    publishBtn: $("#publish-btn", root),
    saveDraft: $("#save-draft", root),
    discardDraft: $("#discard-draft", root),
    exportBtn: $("#export-btn", root),
    importBtn: $("#import-btn", root),
    importFile: $("#import-file", root),
    fRelays: $("#f-relays", root),
    saveRelays: $("#save-relays", root),
    resultsWrap: $("#publish-results-wrap", root),
    results: $("#publish-results", root),
    fName: $("#f-name", root),
    fDisplayName: $("#f-displayName", root),
    typeMore: $("#type-more", root),
    fHeadline: $("#f-headline", root),
    fBio: $("#f-bio", root),
    fLocation: $("#f-location", root),
    fTimezone: $("#f-timezone", root),
    fLanguages: $("#f-languages", root),
    fAvailability: $("#f-availability", root),
    fAvailabilityNote: $("#f-availabilityNote", root),
    fAvatar: $("#f-avatar", root),
    fBanner: $("#f-banner", root),
    fNip05: $("#f-nip05", root),
    fContactLabel: $("#f-contactLabel", root),
    fContactUrl: $("#f-contactUrl", root),
    links: $("#links-editor", root),
    projects: $("#projects-editor", root),
    skills: $("#skills-editor", root),
    credentials: $("#credentials-editor", root),
    gallery: $("#gallery-editor", root),
    galleryDrop: $("#gallery-drop", root),
    galleryAddVideo: $("#gallery-add-video", root),
    galleryAddImageUrl: $("#gallery-add-image-url", root),
    galleryUploadMedia: $("#gallery-upload-media", root),
    galleryMediaFile: $("#gallery-media-file", root),
    fBlossom: $("#f-blossom", root),
    galleryBudget: $("#gallery-budget", root),
    galleryUploadStatus: $("#gallery-upload-status", root),
    themeInputs: $$('input[name="portfolio-theme"]', root),
  };

  let current = null;
  let saveTimer = 0;
  let galleryBusy = false;
  let publishClock = 0;
  let expandedProjects = new Set();

  const publishTargets = Array.from(
    new Set([els.publishBtn, ...publishButtons].filter(Boolean))
  );
  const publishLabels = publishTargets
    .map((button) => {
      const label = button.querySelector("[data-publish-label]");
      return label ? { label, idle: label.textContent.trim() } : null;
    })
    .filter(Boolean);

  const nip05 = createNip05Wizard({
    root,
    getIdentifier: () => els.fNip05.value,
    getPubkey: () => (current ? current.pubkey : ""),
    getRelays: () => currentRelays(),
    toast,
  });

  function currentRelays() {
    return parseRelayUrls(els.fRelays.value).length
      ? parseRelayUrls(els.fRelays.value)
      : loadRelays();
  }

  function open(profile, pubkey, { updatedAt = 0, tab = "profile" } = {}) {
    const draft = readDraft(pubkey);
    const publishedProfile = profile ? clone(profile) : null;
    const draftAt = draft ? Number(draft.draftUpdatedAt) || 0 : 0;
    const publishedAt = Number(updatedAt) * 1000;
    const staleDraft = Boolean(
      draft &&
        publishedProfile &&
        draftAt > 0 &&
        publishedAt > 0 &&
        draftAt < publishedAt
    );
    if (staleDraft) clearDraft(pubkey);
    const restoredDraft = Boolean(draft && !staleDraft);
    current = {
      profile: clone(
        (restoredDraft ? draft : null) || publishedProfile || emptyProfile()
      ),
      publishedProfile,
      pubkey,
      updatedAt,
      dirty: false,
      restoredDraft,
      tab,
    };
    expandedProjects = new Set();
    if (els.fBlossom) els.fBlossom.value = loadBlossomServer();
    fill();
    setTab(tab, false);
    nip05.reset();
    if (restoredDraft) {
      toast("Local draft restored. Publish when ready.");
    } else if (staleDraft) {
      toast("Older local draft ignored. Showing the published version.");
    }
  }

  function isOpen() {
    return Boolean(current);
  }

  function fill() {
    if (!current) return;
    const profile = current.profile;
    els.fName.value = profile.name || "";
    els.fDisplayName.value = profile.displayName || "";
    const type = profile.type === "organization" ? "organization" : "personal";
    $$('input[name="portfolio-type"]', root).forEach((input) => {
      input.checked = input.value === type;
    });
    setHidden(els.typeMore, type !== "organization");
    els.fHeadline.value = profile.headline || "";
    els.fBio.value = profile.bio || "";
    els.fLocation.value = profile.location || "";
    els.fTimezone.value = profile.timezone || "";
    els.fLanguages.value = (profile.languages || []).join(", ");
    els.fAvailability.value =
      (profile.availability && profile.availability.status) || "";
    els.fAvailabilityNote.value =
      (profile.availability && profile.availability.note) || "";
    els.fAvatar.value = profile.avatar || "";
    els.fBanner.value = profile.banner || "";
    els.fNip05.value = profile.nip05 || "";
    els.fContactLabel.value = (profile.contact && profile.contact.label) || "";
    els.fContactUrl.value = (profile.contact && profile.contact.url) || "";
    els.fRelays.value = loadRelays().join("\n");
    fillTheme(profile.theme);

    els.owner.textContent = t("Signed in as {key} — only this key can sign the update.", { key: hexToNpub(current.pubkey) });
    els.status.textContent = current.updatedAt
      ? t("Last published {time}.", { time: timeAgo(current.updatedAt) })
      : t("Not published yet.");
    els.url.textContent = `bnos.space/b/${hexToNpub(current.pubkey)}`;
    els.saveState.textContent = current.restoredDraft
      ? t("Local draft restored")
      : t("No changes yet");
    els.saveState.className =
      "save-state" + (current.restoredDraft ? " dirty" : "");
    setHidden(els.resultsWrap, true);
    els.results.innerHTML = "";

    renderLinks();
    renderProjects();
    renderSkills();
    renderCredentials();
    renderGallery();
    setTab("profile", false);
    nip05.reset();
    current.dirty = false;
    if (onThemePreview) onThemePreview(profile.theme);
  }

  function setTab(tab, sync = true) {
    if (!current) return;
    if (sync) syncFromForm();
    current.tab = tab;
    $$(".editor-tab", root).forEach((button) => {
      const active = button.getAttribute("data-tab") === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    $$(".editor-panel", root).forEach((panel) => {
      setHidden(panel, panel.getAttribute("data-panel") !== tab);
    });
  }

  function rowValue(row, name) {
    const field = row.querySelector(`[data-f="${name}"]`);
    return field ? field.value.trim() : "";
  }

  function rowChecked(row, name) {
    const field = row.querySelector(`[data-f="${name}"]`);
    return field ? field.checked : true;
  }

  function readRows(container) {
    return container
      ? Array.from(container.querySelectorAll(".repeat-row"))
      : [];
  }

  function syncFromForm() {
    if (!current) return null;
    const profile = current.profile;
    profile.name = els.fName.value.trim();
    profile.displayName = els.fDisplayName.value.trim();
    const typeInput = root.querySelector('input[name="portfolio-type"]:checked');
    profile.type =
      typeInput && typeInput.value === "organization"
        ? "organization"
        : "personal";
    profile.headline = els.fHeadline.value.trim();
    profile.bio = els.fBio.value.trim();
    profile.location = els.fLocation.value.trim();
    profile.timezone = els.fTimezone.value.trim();
    profile.languages = splitList(els.fLanguages.value);
    profile.availability = {
      status: els.fAvailability.value,
      note: els.fAvailabilityNote.value.trim(),
    };
    profile.avatar = els.fAvatar.value.trim();
    profile.banner = els.fBanner.value.trim();
    profile.nip05 = els.fNip05.value.trim();
    profile.contact = {
      label: els.fContactLabel.value.trim(),
      url: els.fContactUrl.value.trim(),
    };
    profile.theme = normalizeTheme(
      (root.querySelector('input[name="portfolio-theme"]:checked') || {}).value ||
        profile.theme
    );

    profile.links = readRows(els.links).map((row) => ({
      label: rowValue(row, "label"),
      url: rowValue(row, "url"),
    }));

    const previousProjects = profile.projects || [];
    profile.projects = readRows(els.projects).map((row, index) => {
      const rowId = row.getAttribute("data-id");
      const previous =
        previousProjects.find((entry) => entry.id === rowId) ||
        previousProjects[index] ||
        {};
      return {
        id: previous.id || rowId || makeId(),
        title: rowValue(row, "title"),
        summary: rowValue(row, "summary"),
        description: rowValue(row, "description"),
        role: rowValue(row, "role"),
        contribution: rowValue(row, "contribution"),
        year: rowValue(row, "year"),
        tags: splitList(rowValue(row, "tags")),
        link: rowValue(row, "link"),
        media: rowValue(row, "media"),
        public: rowChecked(row, "public"),
      };
    });

    profile.skills = readRows(els.skills).map((row) => ({
      name: rowValue(row, "name"),
      evidence: rowValue(row, "evidence") === "issuer" ? "issuer" : "self",
      issuer: rowValue(row, "issuer"),
    }));

    const previousGallery = profile.gallery || [];
    profile.gallery = readRows(els.gallery)
      .map((row, index) => {
        const rowId = row.getAttribute("data-id");
        const previous =
          previousGallery.find((entry) => entry.id === rowId) ||
          previousGallery[index] ||
          {};
        const urlField = row.querySelector('[data-f="url"]');
        return {
          id: previous.id || rowId || makeId("md"),
          type:
            row.getAttribute("data-media-type") === "video" ? "video" : "image",
          url: urlField ? rowValue(row, "url") : previous.url || "",
          poster: rowValue(row, "poster"),
          caption: rowValue(row, "caption"),
          alt: rowValue(row, "alt"),
          public: rowChecked(row, "public"),
          reel: previous.reel === true,
        };
      });

    const previousCredentials = profile.credentials || [];
    profile.credentials = readRows(els.credentials).map((row, index) => ({
      id:
        (previousCredentials[index] && previousCredentials[index].id) ||
        makeId("cr"),
      title: rowValue(row, "title"),
      issuer: rowValue(row, "issuer"),
      year: rowValue(row, "year"),
      status: rowValue(row, "status"),
      note: rowValue(row, "note"),
      public: rowChecked(row, "public"),
    }));

    return profile;
  }

  function renderLinks() {
    if (!current) return;
    const links = current.profile.links || [];
    els.links.innerHTML = links
      .map(
        (link, index) => `<div class="repeat-row" data-index="${index}">
          <div class="row-head">
            <span class="row-title">Link ${index + 1}</span>
            <button class="row-remove" type="button" data-remove="link" data-index="${index}">Remove</button>
          </div>
          <div class="field-grid">
            <label class="field"><span>Label</span><input data-f="label" type="text" maxlength="60" value="${esc(
              link.label
            )}" placeholder="GitHub"></label>
            <label class="field"><span>URL</span><input data-f="url" type="url" maxlength="500" value="${esc(
              link.url
            )}" placeholder="https://…"></label>
          </div>
        </div>`
      )
      .join("");
  }

  function projectInitials(title) {
    const value = String(title || "").trim();
    return value ? value.charAt(0).toUpperCase() : "P";
  }

  function projectThumb(project, title) {
    const media = httpUrl(project.media);
    return media
      ? `<img src="${esc(media)}" alt="">`
      : `<span class="project-initials" aria-hidden="true">${esc(
          projectInitials(title)
        )}</span>`;
  }

  function chipMarkup(tags) {
    return (tags || [])
      .map(
        (tag) =>
          `<span class="chip" data-value="${esc(tag)}">${esc(
            tag
          )}<button class="chip-x" type="button" data-chip-remove aria-label="Remove tag ${esc(
            tag
          )}">×</button></span>`
      )
      .join("");
  }

  function renderProjects() {
    if (!current) return;
    const projects = current.profile.projects || [];
    els.projects.innerHTML = projects
      .map((project, index) => {
        const expanded = expandedProjects.has(project.id);
        const title = (project.title || "").trim() || t("Untitled case study");
        const status = project.public === false ? t("Draft") : t("Public");
        return `<div class="repeat-row project-row${
          expanded ? "" : " is-collapsed"
        }" data-index="${index}" data-id="${esc(project.id || "")}">
          <div class="row-head project-head">
            <div class="project-summary">
              <span class="project-thumb">${projectThumb(project, title)}</span>
              <span class="project-summary-text">
                <span class="row-title" data-project-title>${esc(title)}</span>
                <span class="project-meta"><span data-project-year>${esc(
                  project.year || t("No year")
                )}</span><span aria-hidden="true">·</span><span data-project-status>${status}</span></span>
              </span>
            </div>
            <div class="row-actions">
              <button class="icon-btn row-icon" type="button" data-project-move="up" data-index="${index}" aria-label="${t("Move case study up")}" title="${t("Move up")}" ${
                index === 0 ? "disabled" : ""
              }>↑</button>
              <button class="icon-btn row-icon" type="button" data-project-move="down" data-index="${index}" aria-label="${t("Move case study down")}" title="${t("Move down")}" ${
                index === projects.length - 1 ? "disabled" : ""
              }>↓</button>
              <button class="btn btn-ghost btn-sm" type="button" data-project-toggle data-index="${index}" aria-expanded="${expanded}" aria-controls="project-body-${index}">${
                expanded ? t("Close") : t("Edit")
              }</button>
              <button class="row-remove" type="button" data-remove="project" data-index="${index}">${t("Remove")}</button>
            </div>
          </div>
          <div class="project-body" id="project-body-${index}"${
            expanded ? "" : " hidden"
          }>
            <div class="field-grid">
              <label class="field span2"><span>${t("Title")} <b class="req">*</b></span><input data-f="title" type="text" maxlength="120" value="${esc(
                project.title
              )}"></label>
              <label class="field"><span>${t("Year")}</span><input data-f="year" type="text" maxlength="40" value="${esc(
                project.year
              )}" placeholder="2025 — 2026"></label>
              <label class="field"><span>${t("Role")}</span><input data-f="role" type="text" maxlength="120" value="${esc(
                project.role
              )}" placeholder="UX architecture"></label>
              <label class="field span2"><span>${t("Summary")}</span><textarea data-f="summary" rows="2" maxlength="400">${esc(
                project.summary
              )}</textarea></label>
              <label class="field span2"><span>${t("Description")}</span><textarea data-f="description" rows="3" maxlength="4000">${esc(
                project.description
              )}</textarea></label>
              <label class="field"><span>${t("Contribution")}</span><input data-f="contribution" type="text" maxlength="200" value="${esc(
                project.contribution
              )}" placeholder="Design system &amp; front-end — 60%"></label>
              <label class="field"><span>${t("Case study link")}</span><input data-f="link" type="url" maxlength="500" value="${esc(
                project.link
              )}" placeholder="https://…"></label>
              <label class="field span2"><span>${t("Cover image URL")}</span><input data-f="media" type="url" maxlength="500" value="${esc(
                project.media
              )}" placeholder="https://…"></label>
              <div class="field span2 tag-field">
                <span>${t("Tags")}</span>
                <div class="chip-input" data-chips>
                  ${chipMarkup(project.tags)}
                  <input class="chip-entry" type="text" maxlength="24" placeholder="${t("Type a tag and press Enter")}" aria-label="${t("Add project tag")}">
                </div>
                <input type="hidden" data-f="tags" value="${esc(
                  (project.tags || []).join(", ")
                )}">
                <span class="tag-hint">${t("Up to 8 tags. Press Enter or comma to add.")}</span>
              </div>
            </div>
            <label class="check-field"><input data-f="public" type="checkbox" ${
              project.public !== false ? "checked" : ""
            }> ${t("Include this case study in the published business page")}</label>
          </div>
        </div>`;
      })
      .join("");
  }

  function chipTags(wrap) {
    return Array.from(wrap.querySelectorAll(".chip"))
      .map((chip) => chip.getAttribute("data-value"))
      .filter(Boolean);
  }

  function syncChipHidden(wrap) {
    const field = wrap.parentElement.querySelector('[data-f="tags"]');
    if (field) field.value = chipTags(wrap).join(", ");
  }

  function addChips(wrap, raw) {
    if (!wrap) return;
    const entry = wrap.querySelector(".chip-entry");
    const tags = chipTags(wrap);
    const seen = new Set(tags.map((tag) => tag.toLowerCase()));
    String(raw || "")
      .split(",")
      .forEach((part) => {
        const tag = part.replace(/\s+/g, " ").trim().slice(0, 24);
        const key = tag.toLowerCase();
        if (!tag || seen.has(key) || tags.length >= 8) return;
        seen.add(key);
        tags.push(tag);
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.setAttribute("data-value", tag);
        chip.append(document.createTextNode(tag));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip-x";
        button.setAttribute("data-chip-remove", "");
        button.setAttribute("aria-label", t("Remove tag {tag}", { tag }));
        button.textContent = "×";
        chip.append(button);
        wrap.insertBefore(chip, entry);
      });
    if (entry) entry.value = "";
    syncChipHidden(wrap);
  }

  function updateProjectRow(row) {
    if (!row) return;
    const titleField = row.querySelector('[data-f="title"]');
    const yearField = row.querySelector('[data-f="year"]');
    const mediaField = row.querySelector('[data-f="media"]');
    const publicField = row.querySelector('[data-f="public"]');
    const title = titleField ? titleField.value.trim() : "";
    const titleEl = row.querySelector("[data-project-title]");
    if (titleEl) titleEl.textContent = title || t("Untitled case study");
    const yearEl = row.querySelector("[data-project-year]");
    if (yearEl) {
      yearEl.textContent = (yearField && yearField.value.trim()) || t("No year");
    }
    const statusEl = row.querySelector("[data-project-status]");
    if (statusEl) {
      statusEl.textContent =
        publicField && !publicField.checked ? t("Draft") : t("Public");
    }
    const thumb = row.querySelector(".project-thumb");
    if (!thumb) return;
    const media = httpUrl(mediaField ? mediaField.value.trim() : "");
    const img = thumb.querySelector("img");
    if (media) {
      if (!img) thumb.innerHTML = `<img src="${esc(media)}" alt="">`;
      else if (img.getAttribute("src") !== media) img.src = media;
    } else if (img) {
      thumb.innerHTML = `<span class="project-initials" aria-hidden="true">${esc(
        projectInitials(title)
      )}</span>`;
    } else {
      const initials = thumb.querySelector(".project-initials");
      if (initials) initials.textContent = projectInitials(title);
    }
  }

  function renderSkills() {
    if (!current) return;
    const skills = current.profile.skills || [];
    els.skills.innerHTML = skills
      .map(
        (skill, index) => `<div class="repeat-row" data-index="${index}">
          <div class="row-head">
            <span class="row-title">${t("Capability")} ${index + 1}</span>
            <button class="row-remove" type="button" data-remove="skill" data-index="${index}">${t("Remove")}</button>
          </div>
          <div class="field-grid">
            <label class="field"><span>${t("Capability")}</span><input data-f="name" type="text" maxlength="60" value="${esc(
              skill.name
            )}" placeholder="Design systems"></label>
            <label class="field"><span>${t("Evidence")}</span><select data-f="evidence">
              <option value="self" ${
                skill.evidence !== "issuer" ? "selected" : ""
              }>${t("Self-described")}</option>
              <option value="issuer" ${
                skill.evidence === "issuer" ? "selected" : ""
              }>${t("Listed by an issuer")}</option>
            </select></label>
            <label class="field span2"><span>${t("Issuer (optional)")}</span><input data-f="issuer" type="text" maxlength="120" value="${esc(
              skill.issuer
            )}" placeholder="Interaction Guild"></label>
          </div>
        </div>`
      )
      .join("");
  }

  function renderCredentials() {
    if (!current) return;
    const credentials = current.profile.credentials || [];
    els.credentials.innerHTML = credentials
      .map(
        (credential, index) => `<div class="repeat-row" data-index="${index}">
          <div class="row-head">
            <span class="row-title">${t("Credential")} ${index + 1}</span>
            <button class="row-remove" type="button" data-remove="credential" data-index="${index}">${t("Remove")}</button>
          </div>
          <div class="field-grid">
            <label class="field"><span>${t("Title")}</span><input data-f="title" type="text" maxlength="120" value="${esc(
              credential.title
            )}" placeholder="Advanced UX Systems"></label>
            <label class="field"><span>${t("Issuer")}</span><input data-f="issuer" type="text" maxlength="120" value="${esc(
              credential.issuer
            )}" placeholder="Interaction Guild"></label>
            <label class="field"><span>Year</span><input data-f="year" type="text" maxlength="40" value="${esc(
              credential.year
            )}" placeholder="2025"></label>
            <label class="field"><span>${t("Status")}</span><input data-f="status" type="text" maxlength="60" value="${esc(
              credential.status
            )}" placeholder="Valid · expires 2027"></label>
            <label class="field span2"><span>${t("Note")}</span><input data-f="note" type="text" maxlength="200" value="${esc(
              credential.note
            )}" placeholder="Shared selectively"></label>
          </div>
          <label class="check-field"><input data-f="public" type="checkbox" ${
            credential.public !== false ? "checked" : ""
          }> ${t("Include this credential in the published business page")}</label>
        </div>`
      )
      .join("");
  }

  function fillTheme(theme) {
    const value = normalizeTheme(theme);
    els.themeInputs.forEach((input) => {
      input.checked = input.value === value;
    });
  }

  function galleryPreview(item) {
    const video = item.type === "video";
    const poster = isDataImage(item.poster)
      ? item.poster
      : httpUrl(item.poster);
    if (video) {
      return poster
        ? `<img src="${esc(poster)}" alt="">`
        : `<span class="gallery-thumb-empty">${icon("play")}</span>`;
    }
    const url = isInlineMedia(item.url) ? item.url : httpUrl(item.url);
    return url
      ? `<img src="${esc(url)}" alt="">`
      : `<span class="gallery-thumb-empty">${icon("image")}</span>`;
  }

  function icon(name) {
    if (name === "play") {
      return '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10-6.5-10-6.5Z"/></svg>';
    }
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 5-5 4 4 3-3 4 4"/></svg>';
  }

  function renderGallery() {
    if (!current || !els.gallery) return;
    const items = current.profile.gallery || [];
    els.gallery.innerHTML = items
      .map((item, index) => {
        const video = item.type === "video";
        const inline = isInlineMedia(item.url);
        return `<div class="repeat-row gallery-row" data-index="${index}" data-id="${esc(
          item.id
        )}" data-media-type="${video ? "video" : "image"}">
          <div class="row-head">
            <span class="row-title">${video ? "Video" : "Image"} ${
              index + 1
            } · ${inline ? "embedded" : "link"}${
              item.reel === true
                ? ` <span class="reel-badge">${t("Show reel")}</span>`
                : ""
            }</span>
            <div class="row-actions">
              <button class="row-star${
                item.reel === true ? " is-active" : ""
              }" type="button" data-gallery-reel="${index}" aria-pressed="${
                item.reel === true
              }" title="${
                item.reel === true ? t("Current show reel") : t("Use as show reel")
              }">${item.reel === true ? "★" : "☆"}<span>Showreel</span></button>
              <button class="icon-btn row-icon" type="button" data-gallery-move="up" data-index="${index}" aria-label="${t("Move gallery item up")}" title="${t("Move up")}" ${
                index === 0 ? "disabled" : ""
              }>↑</button>
              <button class="icon-btn row-icon" type="button" data-gallery-move="down" data-index="${index}" aria-label="${t("Move gallery item down")}" title="${t("Move down")}" ${
                index === items.length - 1 ? "disabled" : ""
              }>↓</button>
              <button class="row-remove" type="button" data-gallery-remove="${index}">Remove</button>
            </div>
          </div>
          <div class="gallery-row-body">
            <div class="gallery-thumb${video ? " is-video" : ""}">${galleryPreview(
              item
            )}${video ? `<span class="gallery-play" aria-hidden="true">${icon("play")}</span>` : ""}</div>
            <div class="gallery-fields">
              ${
                video
                  ? `<label class="field span2"><span>Video URL <b class="req">*</b></span><input data-f="url" type="url" maxlength="500" value="${esc(
                      item.url
                    )}" placeholder="https://…/clip.mp4"></label>
                     ${
                       isDataImage(item.poster)
                         ? `<div class="field span2 inline-media-note">
                              <span>Poster generated from video · ${formatBytes(
                                item.poster.length
                              )}</span>
                              <button class="btn btn-ghost btn-sm" type="button" data-poster-clear="${index}">Remove</button>
                              <input type="hidden" data-f="poster" value="${esc(
                                item.poster
                              )}">
                            </div>`
                         : `<label class="field span2"><span>Poster image URL (optional)</span><input data-f="poster" type="url" maxlength="500" value="${esc(
                             item.poster
                           )}" placeholder="https://…/poster.jpg"></label>`
                     }`
                  : inline
                  ? `<div class="inline-media-note">
                       <span>Embedded image (legacy) · ${formatBytes(
                         item.url.length
                       )}</span>
                     </div>`
                  : `<label class="field span2"><span>Image URL</span><input data-f="url" type="url" maxlength="500" value="${esc(
                      item.url
                    )}" placeholder="https://…/image.jpg"></label>`
              }
              <label class="field span2"><span>Caption</span><input data-f="caption" type="text" maxlength="160" value="${esc(
                item.caption
              )}" placeholder="A short title for visitors"></label>
              <label class="field span2"><span>Alt text</span><input data-f="alt" type="text" maxlength="160" value="${esc(
                item.alt
              )}" placeholder="Describe the image for screen readers"></label>
              <label class="check-field span2"><input data-f="public" type="checkbox" ${
                item.public !== false ? "checked" : ""
              }> Include this item in the published gallery</label>
            </div>
          </div>
        </div>`;
      })
      .join("");
    renderGalleryBudget();
  }

  function renderGalleryBudget() {
    if (!els.galleryBudget || !current) return;
    const items = current.profile.gallery || [];
    const used = inlineImageBytes(items);
    const hasInline = items.some(
      (item) => isInlineMedia(item.url) || isInlineMedia(item.poster)
    );
    if (!hasInline) {
      els.galleryBudget.classList.remove("is-high");
      els.galleryBudget.innerHTML = `<span class="budget-text">${t("{count}/{limit} media items · links only", { count: items.length, limit: GALLERY_LIMIT })}</span>`;
      return;
    }
    const percent = Math.min(100, Math.round((used / INLINE_IMAGE_BUDGET) * 100));
    els.galleryBudget.classList.toggle("is-high", percent >= 80);
    els.galleryBudget.innerHTML = `<div class="budget-bar"><span style="width:${percent}%"></span></div>
      <span class="budget-text">${formatBytes(used)} of ${formatBytes(
      INLINE_IMAGE_BUDGET
    )} legacy inline budget · ${items.length}/${GALLERY_LIMIT} items</span>`;
  }

  function setGalleryBusy(busy) {
    if (els.galleryAddImageUrl) els.galleryAddImageUrl.disabled = busy;
    if (els.galleryAddVideo) els.galleryAddVideo.disabled = busy;
    if (els.galleryUploadMedia) els.galleryUploadMedia.disabled = busy;
    if (els.galleryMediaFile) els.galleryMediaFile.disabled = busy;
    if (els.fBlossom) els.fBlossom.disabled = busy;
    if (els.galleryDrop) {
      els.galleryDrop.classList.toggle("is-busy", busy);
    }
  }

  function addGalleryLink(type) {
    if (!current) return;
    syncFromForm();
    const list = current.profile.gallery;
    if (list.length >= GALLERY_LIMIT) {
      toast(`The gallery holds up to ${GALLERY_LIMIT} items.`, true);
      return;
    }
    list.push({
      id: makeId("md"),
      type: type === "video" ? "video" : "image",
      url: "",
      poster: "",
      caption: "",
      alt: "",
      public: true,
    });
    markDirty();
    renderGallery();
    const last = els.gallery && els.gallery.lastElementChild;
    if (last) {
      last.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const input = last.querySelector("input");
      if (input) input.focus();
    }
  }

  function listFor(type) {
    if (type === "link") return current.profile.links;
    if (type === "project") return current.profile.projects;
    if (type === "skill") return current.profile.skills;
    if (type === "credential") return current.profile.credentials;
    return null;
  }

  function renderList(type) {
    if (type === "link") renderLinks();
    else if (type === "project") renderProjects();
    else if (type === "skill") renderSkills();
    else if (type === "credential") renderCredentials();
  }

  function addItem(type) {
    if (!current) return;
    syncFromForm();
    const list = listFor(type);
    if (!list) return;
    if (type === "link") list.push({ label: "", url: "" });
    else if (type === "project") {
      const project = {
        id: makeId(),
        title: "",
        summary: "",
        description: "",
        role: "",
        contribution: "",
        year: "",
        tags: [],
        link: "",
        media: "",
        public: true,
      };
      list.push(project);
      expandedProjects.add(project.id);
    } else if (type === "skill") {
      list.push({ name: "", evidence: "self", issuer: "" });
    } else if (type === "credential") {
      list.push({
        id: makeId("cr"),
        title: "",
        issuer: "",
        year: "",
        status: "",
        note: "",
        public: true,
      });
    }
    markDirty();
    renderList(type);
    const container =
      els[type === "link" ? "links" : type === "project" ? "projects" : type === "skill" ? "skills" : "credentials"];
    const last = container && container.lastElementChild;
    if (last) {
      last.scrollIntoView({ block: "nearest", behavior: "smooth" });
      const input = last.querySelector("input, textarea, select");
      if (input) input.focus();
    }
  }

  function removeItem(type, index) {
    if (!current) return;
    syncFromForm();
    const list = listFor(type);
    if (!list || !Number.isInteger(index) || index < 0 || index >= list.length) {
      return;
    }
    if (type === "project" && list[index] && list[index].id) {
      expandedProjects.delete(list[index].id);
    }
    list.splice(index, 1);
    markDirty();
    renderList(type);
  }

  function markDirty() {
    if (!current) return;
    current.dirty = true;
    els.saveState.textContent = t("Unsaved changes");
    els.saveState.className = "save-state dirty";
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveDraft(false), 1000);
  }

  function saveDraft(manual) {
    if (!current) return;
    syncFromForm();
    current.profile.draftUpdatedAt = Date.now();
    if (!writeDraft(current.pubkey, current.profile)) {
      toast("Could not save the draft in this browser (storage full?).", true);
      return;
    }
    current.dirty = false;
    els.saveState.textContent = manual
      ? t("Draft saved locally")
      : t("Saved locally just now");
    els.saveState.className = "save-state saved";
    clearTimeout(saveTimer);
    if (manual) {
      toast(t("Draft saved in this browser. Publish to make it public."));
    }
  }

  async function publish() {
    if (!current) return;
    if (galleryBusy) {
      toast(t("Wait for the upload to finish before publishing."), true);
      return;
    }
    syncFromForm();
    const validation = validateProfile(current.profile);
    if (validation) {
      toast(validation, true);
      setTab(/gallery|image|video|poster|media/i.test(validation) ? "gallery" : "profile", false);
      return;
    }
    if (!auth.getState().pubkey) {
      toast(t("Connect a signer before publishing."), true);
      return;
    }

    setBusy(true, t("Waiting for signer…"));
    const startedAt = Date.now();
    clearInterval(publishClock);
    publishClock = window.setInterval(() => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (seconds >= 3) setPublishLabel(t("Waiting for signer… {seconds}s", { seconds }));
    }, 1000);

    try {
      saveDraft(false);
      const result = await publishProfile(current.profile, currentRelays(), {
        onPhase: (phase, info) => {
          if (phase === "signing") {
            setBusy(true, t("Waiting for signer…"));
            return;
          }
          if (phase === "publishing") {
            clearInterval(publishClock);
            publishClock = 0;
            setPublishLabel(t("Publishing {done}/{total}…", info));
          }
        },
      });
      renderResults(result.results);
      if (!result.accepted) {
        toast(t("No relay accepted the event. Check the relay list and retry."), true);
        return;
      }
      onPublished(result);
      if (!current) {
        toast(
          t("Published to {accepted} of {total} relays.", { accepted: result.accepted, total: result.results.length })
        );
        return;
      }
      current.updatedAt = result.signed.created_at;
      current.publishedProfile = normalizeProfile(result.publicProfile);
      clearDraft(current.pubkey);
      current.restoredDraft = false;
      els.status.textContent = t("Last published {time}.", { time: timeAgo(current.updatedAt) });
      toast(
        `Published to ${result.accepted} of ${result.results.length} relays.`
      );
    } catch (error) {
      toast((error && error.message) || t("Publishing failed."), true);
    } finally {
      setBusy(false);
    }
  }

  function setPublishLabel(text) {
    publishLabels.forEach((entry) => {
      entry.label.textContent = text;
    });
  }

  function setBusy(busy, label) {
    publishTargets.forEach((button) => {
      button.disabled = busy;
      button.setAttribute("aria-busy", busy ? "true" : "false");
    });
    if (busy) {
      if (label) setPublishLabel(label);
    } else {
      clearInterval(publishClock);
      publishClock = 0;
      publishLabels.forEach((entry) => {
        entry.label.textContent = entry.idle;
      });
    }
    els.saveDraft.disabled = busy;
    els.discardDraft.disabled = busy;
  }

  function renderResults(results) {
    setHidden(els.resultsWrap, false);
    els.results.innerHTML = results
      .map(
        (result) => `<li class="${result.ok ? "ok" : "err"}">
          <span class="status">${result.ok ? "ok" : "failed"}</span>
          <span><code>${esc(result.relay)}</code><br>${esc(
            result.message
          )}</span>
        </li>`
      )
      .join("");
  }

  function exportJson() {
    if (!current) return;
    syncFromForm();
    const payload = {
      version: 1,
      kind: 30078,
      pubkey: current.pubkey,
      exportedAt: new Date().toISOString(),
      profile: current.profile,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bnos-business-${current.pubkey.slice(0, 8)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t("Exported JSON. Private drafts are included in the file."));
  }

  async function importJson(file) {
    if (!file || !current) return;
    try {
      const data = JSON.parse(await file.text());
      const source = data && data.profile ? data.profile : data;
      if (!source || typeof source !== "object") {
        throw new Error("No business object found.");
      }
      current.profile = normalizeProfile(source);
      fill();
      markDirty();
      toast(t("Imported as a local draft. Publish when ready."));
    } catch (error) {
      toast(
        t("Could not import: {error}", { error: (error && error.message) || t("invalid JSON") }),
        true
      );
    }
  }

  async function discard() {
    if (!current) return;
    const question = {
      kicker: t("Local draft"),
      title: t("Discard this draft?"),
      message:
        t("This removes the local draft for this key and restores the last published version, or a blank business page if nothing was published. This cannot be undone."),
      confirmLabel: t("Discard draft"),
      cancelLabel: "Keep editing",
      tone: "danger",
    };
    const confirmed = confirm
      ? await confirm(question)
      : window.confirm(question.message);
    if (!confirmed || !current) return;
    clearDraft(current.pubkey);
    current.profile = clone(
      current.publishedProfile || emptyProfile()
    );
    current.restoredDraft = false;
    fill();
    toast("Local draft discarded.");
  }

  function saveRelayList() {
    const list = parseRelayUrls(els.fRelays.value);
    if (!list.length) {
      toast("Add at least one wss:// relay URL.", true);
      return;
    }
    const saved = saveRelays(list);
    els.fRelays.value = saved.join("\n");
    if (onRelaysChanged) onRelaysChanged(saved);
    toast(`Relay list saved (${saved.length}).`);
  }

  /* ---------------- events ---------------- */

  $$(".editor-tab", root).forEach((button) => {
    button.addEventListener("click", () => {
      setTab(button.getAttribute("data-tab"));
    });
  });

  $$("[data-add]", root).forEach((button) => {
    button.addEventListener("click", () => {
      addItem(button.getAttribute("data-add"));
    });
  });

  root.addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (!img || img.tagName !== "IMG") return;
      const thumb = img.closest(".project-thumb, .gallery-thumb");
      if (!thumb) return;
      event.preventDefault();
      if (thumb.classList.contains("project-thumb")) {
        const row = thumb.closest(".project-row");
        const field = row && row.querySelector('[data-f="title"]');
        thumb.innerHTML = `<span class="project-initials" aria-hidden="true">${esc(
          projectInitials(field ? field.value : "")
        )}</span>`;
      } else {
        const video = thumb.classList.contains("is-video");
        thumb.innerHTML = `<span class="gallery-thumb-empty">${icon(
          video ? "play" : "image"
        )}</span>`;
      }
    },
    true
  );

  root.addEventListener("click", (event) => {
    const summary = event.target.closest(".project-summary");
    if (summary && !event.target.closest("button")) {
      const toggle = summary
        .closest(".project-row")
        .querySelector("[data-project-toggle]");
      if (toggle) {
        toggle.click();
        return;
      }
    }

    const chipRemove = event.target.closest("[data-chip-remove]");
    if (chipRemove) {
      event.preventDefault();
      const chip = chipRemove.closest(".chip");
      const wrap = chip && chip.closest("[data-chips]");
      if (chip && wrap) {
        chip.remove();
        syncChipHidden(wrap);
        markDirty();
      }
      return;
    }

    const projectToggle = event.target.closest("[data-project-toggle]");
    if (projectToggle && current) {
      const row = projectToggle.closest(".project-row");
      if (row) {
        const id = row.getAttribute("data-id");
        const collapsed = row.classList.toggle("is-collapsed");
        const projectBody = row.querySelector(".project-body");
        if (projectBody) projectBody.hidden = collapsed;
        projectToggle.setAttribute("aria-expanded", String(!collapsed));
        projectToggle.textContent = collapsed ? "Edit" : "Close";
        if (id) {
          if (collapsed) expandedProjects.delete(id);
          else expandedProjects.add(id);
        }
      }
      return;
    }

    const projectMove = event.target.closest("[data-project-move]");
    if (projectMove && current) {
      syncFromForm();
      const index = Number(projectMove.getAttribute("data-index"));
      const delta =
        projectMove.getAttribute("data-project-move") === "up" ? -1 : 1;
      const list = current.profile.projects || [];
      const target = index + delta;
      if (Number.isInteger(index) && target >= 0 && target < list.length) {
        [list[index], list[target]] = [list[target], list[index]];
        markDirty();
        renderProjects();
      }
      return;
    }

    const galleryReel = event.target.closest("[data-gallery-reel]");
    if (galleryReel && current) {
      syncFromForm();
      const index = Number(galleryReel.getAttribute("data-gallery-reel"));
      (current.profile.gallery || []).forEach((item, itemIndex) => {
        item.reel = itemIndex === index;
      });
      markDirty();
      renderGallery();
      return;
    }

    const galleryMove = event.target.closest("[data-gallery-move]");
    if (galleryMove && current) {
      syncFromForm();
      const index = Number(galleryMove.getAttribute("data-index"));
      const delta =
        galleryMove.getAttribute("data-gallery-move") === "up" ? -1 : 1;
      const list = current.profile.gallery || [];
      const target = index + delta;
      if (Number.isInteger(index) && target >= 0 && target < list.length) {
        [list[index], list[target]] = [list[target], list[index]];
        markDirty();
        renderGallery();
      }
      return;
    }

    const remove = event.target.closest("[data-remove]");
    if (remove && current) {
      removeItem(
        remove.getAttribute("data-remove"),
        Number(remove.getAttribute("data-index"))
      );
      return;
    }
    const galleryRemove = event.target.closest("[data-gallery-remove]");
    if (galleryRemove && current) {
      syncFromForm();
      const index = Number(galleryRemove.getAttribute("data-gallery-remove"));
      if (Number.isInteger(index) && index >= 0) {
        current.profile.gallery.splice(index, 1);
        markDirty();
        renderGallery();
      }
      return;
    }
    const clearPoster = event.target.closest("[data-poster-clear]");
    if (clearPoster && current) {
      syncFromForm();
      const index = Number(clearPoster.getAttribute("data-poster-clear"));
      const item = current.profile.gallery[index];
      if (item) {
        item.poster = "";
        markDirty();
        renderGallery();
      }
    }
  });

  $$("[data-editor-close]", root).forEach((button) => {
    button.addEventListener("click", close);
  });

  body.addEventListener("input", (event) => {
    if (event.target && event.target.id === "f-relays") return;
    if (event.target && event.target.id === "f-nip05") nip05.reset();
    const projectRow = event.target.closest(".project-row");
    if (projectRow) updateProjectRow(projectRow);
    markDirty();
  });
  body.addEventListener("change", (event) => {
    if (event.target && event.target.id === "f-relays") return;
    if (event.target && event.target.name === "portfolio-type") {
      setHidden(els.typeMore, event.target.value !== "organization");
    }
    const projectRow = event.target && event.target.closest(".project-row");
    if (projectRow) updateProjectRow(projectRow);
    if (event.target && event.target.closest(".gallery-row")) {
      syncFromForm();
      renderGalleryBudget();
    }
    markDirty();
  });

  root.addEventListener("keydown", (event) => {
    const entry = event.target.closest(".chip-entry");
    if (!entry) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addChips(entry.closest("[data-chips]"), entry.value);
      markDirty();
    } else if (event.key === "Backspace" && !entry.value) {
      const wrap = entry.closest("[data-chips]");
      const chips = wrap ? wrap.querySelectorAll(".chip") : [];
      if (chips.length) {
        event.preventDefault();
        chips[chips.length - 1].remove();
        syncChipHidden(wrap);
        markDirty();
      }
    }
  });

  root.addEventListener("focusout", (event) => {
    const entry = event.target.closest(".chip-entry");
    if (!entry || !entry.value.trim()) return;
    addChips(entry.closest("[data-chips]"), entry.value);
    markDirty();
  });

  function setUploadLabel(text) {
    if (els.galleryUploadMedia) {
      els.galleryUploadMedia.textContent = text || "Upload media";
    }
  }

  function setUploadStatus(text) {
    if (els.galleryUploadStatus) {
      els.galleryUploadStatus.textContent = text || "";
    }
  }

  function startMediaUpload() {
    if (!els.galleryMediaFile) return;
    els.galleryMediaFile.value = "";
    els.galleryMediaFile.click();
  }

  async function uploadMediaFiles(files) {
    if (!current || !files || !files.length || galleryBusy) return;
    syncFromForm();
    const session = current;
    if (current.profile.gallery.length >= GALLERY_LIMIT) {
      toast(`The gallery holds up to ${GALLERY_LIMIT} items.`, true);
      return;
    }
    const server =
      normalizeBlossomServer(els.fBlossom ? els.fBlossom.value : "") ||
      loadBlossomServer();
    if (!server) {
      toast("Enter a valid Blossom fallback server URL.", true);
      return;
    }
    if (els.fBlossom) els.fBlossom.value = server;
    saveBlossomServer(server);
    setUploadStatus("Preparing upload…");

    galleryBusy = true;
    setGalleryBusy(true);
    let added = 0;
    let serverUnavailable = false;
    let usedFallback = false;

    const queue = Array.from(files);
    try {
      for (let position = 0; position < queue.length; position += 1) {
        if (current !== session) return;
        const file = queue[position];
        if (current.profile.gallery.length >= GALLERY_LIMIT) {
          toast(`The gallery holds up to ${GALLERY_LIMIT} items.`, true);
          break;
        }
        const type = String(file.type || "");
        const video = type.startsWith("video/");
        const image = type.startsWith("image/");
        if (!video && !image) {
          toast("Choose an image, MP4, or WebM file.", true);
          continue;
        }
        if (video && !/^video\/(?:mp4|webm)$/i.test(type)) {
          toast("Video must be MP4 or WebM.", true);
          continue;
        }
        if (video && file.size > MAX_VIDEO_UPLOAD_BYTES) {
          toast(
            `Video must be smaller than ${formatBytes(
              MAX_VIDEO_UPLOAD_BYTES
            )}.`,
            true
          );
          continue;
        }
        if (image && file.size > MAX_UPLOAD_BYTES) {
          toast(
            `Images must be smaller than ${formatBytes(MAX_UPLOAD_BYTES)}.`,
            true
          );
          continue;
        }

        const posterData = video ? await extractVideoPoster(file) : "";
        const entries = [{ file, label: video ? "video" : "image" }];
        if (posterData) {
          entries.push({
            file: dataUrlToFile(posterData, "poster.jpg"),
            label: "poster",
          });
        }

        const counter =
          queue.length > 1 ? ` ${position + 1}/${queue.length}` : "";
        const kind = `${video ? "video" : "image"}${counter}`;
        let provider = "bitos";
        const progress = ({ index, ratio }) => {
          const percent = Math.round(ratio * 100);
          const which = index === 0 ? kind : `poster${counter}`;
          const target = provider === "bitos" ? "managed media" : "Blossom";
          if (ratio >= 0.99) {
            setUploadLabel("Processing…");
            setUploadStatus(`Processing ${which} on ${target}…`);
          } else {
            setUploadLabel(`Uploading… ${percent}%`);
            setUploadStatus(`Uploading ${which} to ${target} ${percent}%`);
          }
        };

        let uploaded = null;
        if (serverUnavailable) {
          provider = "blossom";
          setUploadLabel(`Uploading ${kind}…`);
          setUploadStatus(`Uploading ${kind} to Blossom…`);
        } else {
          try {
            setUploadLabel(`Uploading ${kind}…`);
            setUploadStatus(`Uploading ${kind} to managed media…`);
            uploaded = await uploadEntriesToMediaServer(
              entries,
              current.pubkey,
              { onProgress: progress }
            );
          } catch {
            serverUnavailable = true;
            provider = "blossom";
            setUploadStatus("Managed media unavailable — switching to Blossom…");
          }
        }

        if (!uploaded) {
          provider = "blossom";
          uploaded = await uploadFilesToBlossom(entries, server, {
            onProgress: progress,
          });
        }
        if (provider === "blossom") usedFallback = true;
        if (current !== session) return;

        // An autosave can run while a large file uploads, replacing
        // current.profile.gallery with a new array. Sync and re-read it so the
        // completed item is appended to the live list, not a stale array.
        syncFromForm();
        current.profile.gallery.push({
          id: makeId("md"),
          type: video ? "video" : "image",
          url: uploaded[0].url,
          poster: uploaded[1] ? uploaded[1].url : "",
          caption: "",
          alt: "",
          public: true,
        });
        added += 1;
        markDirty();
        renderGallery();
      }
      if (added) {
        const last = els.gallery && els.gallery.lastElementChild;
        if (last) last.scrollIntoView({ block: "nearest", behavior: "smooth" });
        const message = `${added} ${
          added === 1 ? "item" : "items"
        } uploaded${usedFallback ? " via Blossom fallback" : " to managed media"}.`;
        setUploadStatus(message);
        toast(message);
      }
    } catch (error) {
      const message = (error && error.message) || "Media upload failed.";
      setUploadStatus(message);
      toast(message, true);
    } finally {
      galleryBusy = false;
      setGalleryBusy(false);
      setUploadLabel("");
      if (els.galleryMediaFile) els.galleryMediaFile.value = "";
    }
  }

  if (els.galleryUploadMedia) {
    els.galleryUploadMedia.addEventListener("click", startMediaUpload);
  }
  if (els.galleryMediaFile) {
    els.galleryMediaFile.addEventListener("change", () => {
      const files = els.galleryMediaFile.files;
      if (files && files.length) uploadMediaFiles(files);
    });
  }
  if (els.fBlossom) {
    els.fBlossom.addEventListener("change", () => {
      const normalized = normalizeBlossomServer(els.fBlossom.value);
      if (!normalized) {
        toast("Enter a valid https:// Blossom server URL.", true);
        els.fBlossom.value = loadBlossomServer();
        return;
      }
      els.fBlossom.value = normalized;
      saveBlossomServer(normalized);
    });
  }
  els.galleryAddImageUrl.addEventListener("click", () => addGalleryLink("image"));
  els.galleryAddVideo.addEventListener("click", () => addGalleryLink("video"));

  if (els.galleryDrop) {
    ["dragenter", "dragover"].forEach((type) => {
      els.galleryDrop.addEventListener(type, (event) => {
        event.preventDefault();
        els.galleryDrop.classList.add("is-drag");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      els.galleryDrop.addEventListener(type, (event) => {
        event.preventDefault();
        els.galleryDrop.classList.remove("is-drag");
      });
    });
    els.galleryDrop.addEventListener("drop", async (event) => {
      const files = Array.from(
        (event.dataTransfer && event.dataTransfer.files) || []
      );
      if (!files.length) return;
      await uploadMediaFiles(files);
    });
  }

  els.themeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!current) return;
      current.profile.theme = normalizeTheme(input.value);
      if (onThemePreview) onThemePreview(current.profile.theme);
      markDirty();
    });
  });
  els.saveDraft.addEventListener("click", () => saveDraft(true));
  els.publishBtn.addEventListener("click", publish);
  publishButtons.forEach((button) => {
    button.addEventListener("click", publish);
  });
  els.discardDraft.addEventListener("click", () => {
    void discard();
  });
  els.exportBtn.addEventListener("click", exportJson);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files && els.importFile.files[0];
    importJson(file).finally(() => {
      els.importFile.value = "";
    });
  });
  els.saveRelays.addEventListener("click", saveRelayList);

  window.addEventListener("beforeunload", (event) => {
    if (current && current.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  function close() {
    if (!current) return;
    if (galleryBusy) {
      toast("Wait for the upload to finish before leaving the editor.", true);
      return;
    }
    if (current.dirty) saveDraft(false);
    current = null;
    if (onClosed) onClosed();
  }

  function flush() {
    if (current && current.dirty) saveDraft(false);
  }

  return { open, isOpen, close, flush };
}
