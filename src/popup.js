import {
  MSG,
  CHANNELS,
  TONES,
  STATUSES,
  STATUS_LABELS,
  RECRUITER_KEYWORDS,
} from "./lib/constants.js";
import {
  getSettings,
  getRecruiters,
  upsertRecruiter,
  updateRecruiter,
  deleteRecruiter,
} from "./lib/storage.js";

const $ = (id) => document.getElementById(id);

// The popup is torn down every time it loses focus, so anything the user would
// be annoyed to retype lives in session storage until the browser restarts.
const SESSION_KEY = "lastScan";

const state = {
  person: null,
  analysis: null,
  draft: null,
  settings: null,
};

/* ── Helpers ───────────────────────────────────────────────────── */

function showBanner(text, kind = "info") {
  const banner = $("banner");
  banner.textContent = text;
  banner.className = `banner${kind === "info" ? "" : ` is-${kind}`}`;
  banner.hidden = false;
  if (kind === "success") {
    setTimeout(() => {
      banner.hidden = true;
    }, 2500);
  }
}

function hideBanner() {
  $("banner").hidden = true;
}

function sendToBackground(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || !response.ok) {
        reject(new Error((response && response.error) || "No response from the extension."));
      } else {
        resolve(response.data);
      }
    });
  });
}

async function withBusy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// A free first-pass guess so the card says something useful before you spend a token.
function heuristicScore(person) {
  const haystack = `${person.headline || ""} ${person.name || ""}`.toLowerCase();
  const hits = RECRUITER_KEYWORDS.filter((word) => haystack.includes(word.trim()));
  if (!hits.length) return null;
  return Math.min(50 + hits.length * 15, 95);
}

function persistSession() {
  chrome.storage.session
    .set({ [SESSION_KEY]: { person: state.person, analysis: state.analysis, draft: state.draft } })
    .catch(() => {});
}

/* ── Scanning ──────────────────────────────────────────────────── */

async function scrapeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab.");
  if (/^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("This page cannot be scanned. Open a LinkedIn profile first.");
  }

  const ask = () =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: MSG.SCRAPE }, (response) => {
        void chrome.runtime.lastError; // absent receiver is expected on first run
        resolve(response);
      });
    });

  let response = await ask();
  if (!response) {
    // Nothing listening yet, so inject the scraper and try once more.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    response = await ask();
  }

  if (!response) throw new Error("Could not read this page. Reload it and try again.");
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

async function onScan() {
  hideBanner();
  try {
    const result = await withBusy($("scanBtn"), "Scanning…", scrapeActiveTab);
    if (result.type === "list") {
      renderPickList(result.people);
    } else {
      selectPerson(result.person);
    }
  } catch (error) {
    showBanner(error.message, "error");
  }
}

function renderPickList(people) {
  $("personCard").hidden = true;
  $("pickList").hidden = false;

  const list = $("pickItems");
  list.textContent = "";

  for (const person of people) {
    const item = document.createElement("li");

    const name = document.createElement("div");
    name.className = "entry-name";
    name.textContent = person.name || "(no name)";

    const sub = document.createElement("div");
    sub.className = "entry-sub";
    sub.textContent = person.headline || person.url;

    item.append(name, sub);
    item.addEventListener("click", () => {
      $("pickList").hidden = true;
      selectPerson(person);
    });
    list.append(item);
  }
}

function selectPerson(person) {
  state.person = person;
  state.analysis = null;
  state.draft = null;
  $("analysisBox").hidden = true;
  $("draftBox").hidden = true;
  renderPerson();
  persistSession();
}

function renderPerson() {
  const person = state.person;
  if (!person) return;

  $("pickList").hidden = true;
  $("personCard").hidden = false;

  $("personName").textContent = person.name || "(no name found)";
  $("personHeadline").textContent = person.headline || "No headline found on the page.";
  $("personMeta").textContent = [person.company, person.location].filter(Boolean).join(" · ");

  $("editName").value = person.name || "";
  $("editHeadline").value = person.headline || "";
  $("editCompany").value = person.company || "";
  $("editUrl").value = person.url || "";

  const scoreEl = $("personScore");
  const score = state.analysis ? state.analysis.confidence : heuristicScore(person);
  if (score === null || score === undefined) {
    scoreEl.hidden = true;
  } else {
    scoreEl.hidden = false;
    scoreEl.textContent = `${score}% match`;
    scoreEl.classList.toggle("is-low", score < 60);
  }
}

/* ── AI actions ────────────────────────────────────────────────── */

async function onAnalyze() {
  if (!state.person) return;
  hideBanner();
  try {
    const analysis = await withBusy($("analyzeBtn"), "Analyzing…", () =>
      sendToBackground(MSG.ANALYZE, { person: state.person })
    );
    state.analysis = analysis;

    $("analysisVerdict").textContent = `${analysis.role_type} — ${analysis.reasoning}`;
    const points = $("analysisPoints");
    points.textContent = "";
    for (const point of analysis.talking_points || []) {
      const li = document.createElement("li");
      li.textContent = point;
      points.append(li);
    }
    $("analysisBox").hidden = false;

    if (analysis.best_channel && CHANNELS[analysis.best_channel]) {
      $("channelSelect").value = analysis.best_channel;
    }
    renderPerson();
    persistSession();
  } catch (error) {
    showBanner(error.message, "error");
  }
}

async function onDraft(button) {
  if (!state.person) return;
  hideBanner();
  try {
    const draft = await withBusy(button, "Writing…", () =>
      sendToBackground(MSG.DRAFT, {
        person: state.person,
        channel: $("channelSelect").value,
        tone: $("toneSelect").value,
        extraContext: $("extraContext").value,
        analysis: state.analysis,
      })
    );
    state.draft = draft;
    renderDraft();
    persistSession();
  } catch (error) {
    showBanner(error.message, "error");
  }
}

function renderDraft() {
  const draft = state.draft;
  if (!draft) return;

  $("draftBox").hidden = false;
  $("subjectWrap").hidden = !draft.hasSubject;
  $("draftSubject").value = draft.subject || "";
  $("draftBody").value = draft.body || "";

  const tips = $("draftTips");
  tips.textContent = "";
  for (const tip of draft.tips || []) {
    const li = document.createElement("li");
    li.textContent = tip;
    tips.append(li);
  }
  updateCharCount();
}

function updateCharCount() {
  if (!state.draft) return;
  const limit = state.draft.limit;
  const length = $("draftBody").value.length;
  const el = $("charCount");
  el.textContent = `${length} / ${limit} characters`;
  el.classList.toggle("is-over", length > limit);
}

async function onCopy() {
  const draft = state.draft;
  if (!draft) return;
  const subject = $("draftSubject").value.trim();
  const text =
    draft.hasSubject && subject
      ? `Subject: ${subject}\n\n${$("draftBody").value}`
      : $("draftBody").value;
  await navigator.clipboard.writeText(text);
  showBanner("Copied to clipboard.", "success");
}

/* ── Saved contacts ────────────────────────────────────────────── */

async function onSave() {
  if (!state.person) return;
  await upsertRecruiter({
    ...state.person,
    roleType: state.analysis ? state.analysis.role_type : "",
    confidence: state.analysis ? state.analysis.confidence : heuristicScore(state.person),
  });
  showBanner("Saved.", "success");
  await renderSaved();
}

async function renderSaved() {
  const query = $("searchSaved").value.trim().toLowerCase();
  const all = await getRecruiters();
  $("savedCount").textContent = String(all.length);

  const list = all.filter((entry) =>
    [entry.name, entry.headline, entry.company, entry.notes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query)
  );

  const container = $("savedList");
  container.textContent = "";
  $("savedEmpty").hidden = list.length > 0;
  if (!list.length) {
    $("savedEmpty").textContent = all.length
      ? "No saved contacts match that search."
      : "Nothing saved yet. Scan a profile and hit Save.";
    return;
  }

  for (const entry of list) {
    container.append(buildSavedRow(entry));
  }
}

function buildSavedRow(entry) {
  const item = document.createElement("li");

  const name = document.createElement("div");
  name.className = "entry-name";
  name.textContent = entry.name || "(no name)";

  const sub = document.createElement("div");
  sub.className = "entry-sub";
  sub.textContent = [entry.roleType || entry.headline, entry.company].filter(Boolean).join(" · ");

  const actions = document.createElement("div");
  actions.className = "saved-actions";

  const status = document.createElement("select");
  for (const value of STATUSES) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = STATUS_LABELS[value];
    status.append(option);
  }
  status.value = entry.status || "new";
  status.addEventListener("change", () => updateRecruiter(entry.id, { status: status.value }));

  actions.append(status);

  if (entry.url) {
    const link = document.createElement("a");
    link.href = entry.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Open";
    actions.append(link);
  }

  const reuse = document.createElement("button");
  reuse.className = "link-btn";
  reuse.textContent = "Draft";
  reuse.addEventListener("click", () => {
    switchTab("discover");
    selectPerson(entry);
  });

  const remove = document.createElement("button");
  remove.className = "danger-btn";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    await deleteRecruiter(entry.id);
    await renderSaved();
  });

  actions.append(reuse, remove);
  item.append(name, sub, actions);
  return item;
}

// An anchor click rather than chrome.downloads, so the extension needs no
// downloads permission and the popup does not have to survive a save dialog.
async function onExport() {
  const data = await getRecruiters();
  if (!data.length) {
    showBanner("Nothing to export yet.", "error");
    return;
  }

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `hrconnect-contacts-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();

  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showBanner(`Exported ${data.length} contact${data.length === 1 ? "" : "s"}.`, "success");
}

/* ── Wiring ────────────────────────────────────────────────────── */

function switchTab(name) {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.classList.toggle("is-active", tab.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll(".panel")) {
    panel.classList.toggle("is-active", panel.id === `panel-${name}`);
  }
}

function fillSelect(select, entries, selected) {
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  if (selected) select.value = selected;
}

async function init() {
  state.settings = await getSettings();

  fillSelect(
    $("channelSelect"),
    Object.entries(CHANNELS).map(([value, spec]) => [value, spec.label]),
    state.settings.defaultChannel
  );
  fillSelect(
    $("toneSelect"),
    Object.keys(TONES).map((value) => [value, value[0].toUpperCase() + value.slice(1)]),
    state.settings.defaultTone
  );

  if (!state.settings.apiKey) {
    showBanner("Add your Anthropic API key in Settings to enable the AI features.", "error");
  }

  const stored = await chrome.storage.session.get(SESSION_KEY);
  const last = stored[SESSION_KEY];
  if (last && last.person) {
    state.person = last.person;
    state.analysis = last.analysis || null;
    state.draft = last.draft || null;
    renderPerson();
    if (state.analysis) {
      $("analysisVerdict").textContent = `${state.analysis.role_type} — ${state.analysis.reasoning}`;
      $("analysisBox").hidden = false;
    }
    if (state.draft) renderDraft();
  }

  await renderSaved();

  $("scanBtn").addEventListener("click", onScan);
  $("backToScan").addEventListener("click", () => {
    $("pickList").hidden = true;
  });
  $("analyzeBtn").addEventListener("click", onAnalyze);
  $("saveBtn").addEventListener("click", onSave);
  $("draftBtn").addEventListener("click", (event) => onDraft(event.currentTarget));
  $("regenBtn").addEventListener("click", (event) => onDraft(event.currentTarget));
  $("copyBtn").addEventListener("click", onCopy);
  $("draftBody").addEventListener("input", updateCharCount);
  $("searchSaved").addEventListener("input", renderSaved);
  $("exportBtn").addEventListener("click", onExport);
  $("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

  $("applyEdits").addEventListener("click", () => {
    state.person = {
      ...state.person,
      name: $("editName").value.trim(),
      headline: $("editHeadline").value.trim(),
      company: $("editCompany").value.trim(),
      url: $("editUrl").value.trim(),
    };
    $("editDetails").open = false;
    renderPerson();
    persistSession();
  });

  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }
}

init();
