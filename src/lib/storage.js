// Thin promise wrappers over chrome.storage.local.
// Everything lives in `local` on purpose: the API key should not sync across
// devices, and the saved-recruiter list can outgrow the per-item sync quota.

import { DEFAULT_SETTINGS } from "./constants.js";

const SETTINGS_KEY = "settings";
const RECRUITERS_KEY = "recruiters";

export async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getRecruiters() {
  const stored = await chrome.storage.local.get(RECRUITERS_KEY);
  return stored[RECRUITERS_KEY] || [];
}

// Keyed on profile URL so re-scanning the same person updates instead of duplicating.
export async function upsertRecruiter(entry) {
  const list = await getRecruiters();
  const key = entry.url || entry.id;
  const idx = list.findIndex((r) => (r.url || r.id) === key);

  if (idx === -1) {
    const record = {
      id: crypto.randomUUID(),
      status: "new",
      notes: "",
      savedAt: Date.now(),
      ...entry,
    };
    list.unshift(record);
    await chrome.storage.local.set({ [RECRUITERS_KEY]: list });
    return record;
  }

  list[idx] = { ...list[idx], ...entry, updatedAt: Date.now() };
  await chrome.storage.local.set({ [RECRUITERS_KEY]: list });
  return list[idx];
}

export async function updateRecruiter(id, patch) {
  const list = await getRecruiters();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [RECRUITERS_KEY]: list });
  return list[idx];
}

export async function deleteRecruiter(id) {
  const list = await getRecruiters();
  await chrome.storage.local.set({
    [RECRUITERS_KEY]: list.filter((r) => r.id !== id),
  });
}
