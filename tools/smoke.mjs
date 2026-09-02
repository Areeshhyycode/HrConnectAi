// Sanity checks that run without a browser. They will not catch a bad LinkedIn
// selector, but they do catch the three things that actually break this build:
// a manifest pointing at a missing file, a bundle that throws on load, and a
// getElementById that no longer matches any id in the HTML.

import { readFileSync, existsSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

let failures = 0;

function check(label, fn) {
  try {
    fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures++;
    console.error(`  FAIL ${label}\n       ${error.message}`);
  }
}

/* ── 1. Manifest references resolve ─────────────────────────────── */

console.log("\nmanifest");
const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));

const referenced = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  "content.js", // injected programmatically, so the manifest never names it
];

for (const file of new Set(referenced)) {
  check(`dist/${file} exists`, () => {
    if (!existsSync(`dist/${file}`)) throw new Error("missing");
  });
}

check("manifest_version is 3", () => {
  if (manifest.manifest_version !== 3) throw new Error("expected 3");
});

check("api.anthropic.com host permission present", () => {
  if (!(manifest.host_permissions || []).some((h) => h.includes("api.anthropic.com"))) {
    throw new Error("the service worker cannot reach the API without it");
  }
});

/* ── 2. Worker-side bundles load without throwing ───────────────── */

function fakeChrome() {
  const listeners = [];
  const noop = () => {};
  return {
    listeners,
    api: {
      runtime: {
        onMessage: { addListener: (fn) => listeners.push(fn) },
        onInstalled: { addListener: noop },
        getURL: (path) => `chrome-extension://test/${path}`,
        lastError: undefined,
      },
      storage: {
        local: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {} },
      },
      tabs: { create: async () => {}, query: async () => [], sendMessage: noop },
      scripting: { executeScript: async () => {} },
    },
  };
}

check("manifest asks for no permission the code does not use", () => {
  const used = { storage: true, activeTab: true, scripting: true };
  const extra = manifest.permissions.filter((p) => !used[p]);
  if (extra.length) throw new Error(`unused: ${extra.join(", ")}`);
});

function loadBundle(file, extraGlobals = {}) {
  const chrome = fakeChrome();
  const sandbox = {
    chrome: chrome.api,
    console: { log: () => {}, error: () => {}, warn: () => {} },
    fetch: async () => {
      throw new Error("network disabled in smoke test");
    },
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    URL,
    AbortController,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
    ...extraGlobals,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  runInContext(readFileSync(file, "utf8"), createContext(sandbox));
  return chrome;
}

console.log("\nbundles");

check("background.js loads and registers a message listener", () => {
  const chrome = loadBundle("dist/background.js");
  if (chrome.listeners.length !== 1) {
    throw new Error(`expected 1 listener, got ${chrome.listeners.length}`);
  }
  if (chrome.listeners[0]({ type: "nope" }, {}, () => {}) !== false) {
    throw new Error("unknown message types should be ignored, not handled");
  }
});

check("content.js loads and registers a scrape listener", () => {
  const chrome = loadBundle("dist/content.js", {
    location: { hostname: "www.linkedin.com", pathname: "/feed/", href: "https://www.linkedin.com/feed/", origin: "https://www.linkedin.com" },
    document: { querySelector: () => null, querySelectorAll: () => [], title: "", body: null },
  });
  if (chrome.listeners.length !== 1) {
    throw new Error(`expected 1 listener, got ${chrome.listeners.length}`);
  }
});

/* ── 3. Every getElementById has a matching id in the HTML ──────── */

console.log("\ndom ids");

for (const [script, html] of [
  ["src/popup.js", "src/popup.html"],
  ["src/options.js", "src/options.html"],
]) {
  const markup = readFileSync(html, "utf8");
  const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  const source = readFileSync(script, "utf8");
  const used = new Set([
    ...source.matchAll(/\$\("([^"]+)"\)/g),
    ...source.matchAll(/getElementById\("([^"]+)"\)/g),
  ].map((m) => m[1]));

  const missing = [...used].filter((id) => !ids.has(id));
  check(`${script} → ${html} (${used.size} ids)`, () => {
    if (missing.length) throw new Error(`not in the HTML: ${missing.join(", ")}`);
  });
}

// options.js writes every settings key back by id, and that loop is invisible to
// the regex above, so check the keys against the markup directly.
check("every settings key has an input in options.html", () => {
  const markup = readFileSync("src/options.html", "utf8");
  const ids = new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const keys = [
    ...readFileSync("src/lib/constants.js", "utf8")
      .split("DEFAULT_SETTINGS")[1]
      .matchAll(/^\s{2}(\w+):/gm),
  ].map((m) => m[1]);

  const missing = keys.filter((key) => !ids.has(key));
  if (!keys.length) throw new Error("could not parse DEFAULT_SETTINGS");
  if (missing.length) throw new Error(`no input for: ${missing.join(", ")}`);
});

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
