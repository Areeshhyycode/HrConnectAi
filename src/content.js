// Injected on demand by the popup (never on a schedule) to read the page the
// user is already looking at. LinkedIn rewrites its class names often, so every
// field goes through a list of candidate selectors and degrades to "" rather
// than throwing.

import { MSG } from "./lib/constants.js";

function clean(value) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  // LinkedIn renders the same string twice - once visible, once in a
  // visually-hidden span - so textContent comes back exactly doubled.
  const doubled = text.match(/^(.{3,})\1$/);
  return doubled ? doubled[1] : text;
}

function firstText(selectors, root = document) {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const text = clean(el?.textContent);
    if (text) return text;
  }
  return "";
}

function isProfilePage() {
  return /\/in\/[^/]+/.test(location.pathname);
}

function isPeopleSearchPage() {
  return /\/search\/results\/(people|all)/.test(location.pathname);
}

function canonicalProfileUrl(href) {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/\/in\/[^/]+/);
    return match ? `${url.origin}${match[0]}` : url.origin + url.pathname;
  } catch {
    return href;
  }
}

function scrapeLinkedInProfile() {
  const name = firstText([
    "main h1",
    "h1.text-heading-xlarge",
    ".pv-text-details__left-panel h1",
    "h1",
  ]);

  const headline = firstText([
    "main .text-body-medium.break-words",
    ".pv-text-details__left-panel .text-body-medium",
    "[data-generated-suggestion-target] + .text-body-medium",
  ]);

  // Not called `location`: that would shadow window.location for this whole function.
  const place = firstText([
    "main .text-body-small.inline.t-black--light.break-words",
    ".pv-text-details__left-panel .text-body-small.inline",
  ]);

  // The "Current company" button in the top card is the most stable company signal.
  let company = "";
  const companyBtn = document.querySelector(
    'button[aria-label^="Current company"], .pv-text-details__right-panel-item-text'
  );
  if (companyBtn) {
    company = clean(companyBtn.getAttribute("aria-label") || companyBtn.textContent)
      .replace(/^Current company:\s*/i, "")
      .replace(/\.\s*Click to skip.*$/i, "");
  }
  if (!company) {
    const expSection = document.querySelector("#experience")?.closest("section");
    company = firstText(
      ['span[aria-hidden="true"]', ".t-14.t-normal span"],
      expSection || document
    );
  }

  const aboutSection = document.querySelector("#about")?.closest("section");
  const about = aboutSection
    ? clean(aboutSection.textContent).replace(/^About\s*/i, "").slice(0, 700)
    : "";

  return {
    kind: "profile",
    name,
    headline,
    location: place,
    company,
    about,
    url: canonicalProfileUrl(window.location.href),
  };
}

function scrapeLinkedInSearchResults() {
  const seen = new Set();
  const people = [];

  const cards = document.querySelectorAll(
    '[data-view-name="search-entity-result"], .reusable-search__result-container, li.reusable-search__result-container'
  );

  for (const card of cards) {
    const anchor = card.querySelector('a[href*="/in/"]');
    if (!anchor) continue;

    const url = canonicalProfileUrl(anchor.getAttribute("href"));
    if (seen.has(url)) continue;
    seen.add(url);

    const name =
      firstText(['span[aria-hidden="true"]', ".entity-result__title-text"], anchor) ||
      clean(anchor.textContent).split("View")[0];

    people.push({
      kind: "profile",
      name,
      headline: firstText(
        [".entity-result__primary-subtitle", ".t-14.t-black.t-normal"],
        card
      ),
      location: firstText(
        [".entity-result__secondary-subtitle", ".t-14.t-normal.t-black--light"],
        card
      ),
      company: "",
      about: "",
      url,
    });
  }

  return people;
}

// Non-LinkedIn pages (company careers pages, job boards) still carry useful
// context, so return something rather than nothing.
function scrapeGenericPage() {
  const bodyText = clean(document.body?.innerText || "").slice(0, 1500);
  const emails = [
    ...new Set((document.body?.innerText || "").match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []),
  ].slice(0, 5);

  return {
    kind: "page",
    name: firstText(["h1"]) || clean(document.title),
    headline: document.querySelector('meta[name="description"]')?.content || "",
    location: "",
    company: clean(document.title).split(/[|\-–]/).pop()?.trim() || "",
    about: bodyText,
    emails,
    url: location.href,
  };
}

function scrape() {
  if (location.hostname.endsWith("linkedin.com")) {
    if (isProfilePage()) return { type: "single", person: scrapeLinkedInProfile() };
    if (isPeopleSearchPage()) {
      const people = scrapeLinkedInSearchResults();
      if (people.length) return { type: "list", people };
    }
  }
  return { type: "single", person: scrapeGenericPage() };
}

// executeScript re-runs this file on every scan; only wire the listener once.
if (!globalThis.__hrconnectAiInjected) {
  globalThis.__hrconnectAiInjected = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MSG.SCRAPE) return false;
    try {
      sendResponse({ ok: true, data: scrape() });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    }
    return false;
  });
}
