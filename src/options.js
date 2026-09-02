import { MSG, CHANNELS, TONES, DEFAULT_SETTINGS } from "./lib/constants.js";
import { getSettings, saveSettings } from "./lib/storage.js";

const $ = (id) => document.getElementById(id);

const FIELDS = Object.keys(DEFAULT_SETTINGS);

function showBanner(text, kind = "info") {
  const banner = $("banner");
  banner.textContent = text;
  banner.className = `banner${kind === "info" ? "" : ` is-${kind}`}`;
  banner.hidden = false;
}

function fillSelect(select, entries, selected) {
  for (const [value, label] of entries) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = selected;
}

async function load() {
  const settings = await getSettings();

  fillSelect(
    $("defaultChannel"),
    Object.entries(CHANNELS).map(([value, spec]) => [value, spec.label]),
    settings.defaultChannel
  );
  fillSelect(
    $("defaultTone"),
    Object.keys(TONES).map((value) => [value, value[0].toUpperCase() + value.slice(1)]),
    settings.defaultTone
  );

  for (const field of FIELDS) {
    const el = $(field);
    if (el && el.tagName !== "SELECT") el.value = settings[field] || "";
  }
}

async function onSave() {
  const patch = {};
  for (const field of FIELDS) {
    const el = $(field);
    if (el) patch[field] = el.value.trim();
  }
  await saveSettings(patch);

  const note = $("savedNote");
  note.hidden = false;
  setTimeout(() => {
    note.hidden = true;
  }, 2000);
}

async function onTestKey() {
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) {
    showBanner("Paste a key first.", "error");
    return;
  }

  const button = $("testKey");
  button.disabled = true;
  button.textContent = "Testing…";
  showBanner("Sending a one-token request to the Anthropic API…");

  chrome.runtime.sendMessage({ type: MSG.TEST_KEY, payload: { apiKey } }, (response) => {
    button.disabled = false;
    button.textContent = "Test";

    if (chrome.runtime.lastError) {
      showBanner(chrome.runtime.lastError.message, "error");
    } else if (response && response.ok) {
      showBanner("Key works. Remember to hit Save settings.", "success");
    } else {
      showBanner((response && response.error) || "The test failed.", "error");
    }
  });
}

function onToggleKey() {
  const input = $("apiKey");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  $("toggleKey").textContent = hidden ? "Hide" : "Show";
}

$("save").addEventListener("click", onSave);
$("testKey").addEventListener("click", onTestKey);
$("toggleKey").addEventListener("click", onToggleKey);

load();
