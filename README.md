# HRConnect AI

A Chrome extension that reads the LinkedIn profile you are already looking at, tells you whether the person is worth contacting about a job, and drafts outreach in your voice using Claude.

Everything runs locally in your browser. There is no backend, no account, and no analytics. The only network call the extension ever makes is from its service worker straight to `api.anthropic.com`, using an API key you supply.

## What it does

- **Scan** — reads the open LinkedIn profile, or lists everyone on a people-search page so you can pick one. Falls back to reading a generic page (a careers page, a job board) when you are not on LinkedIn.
- **Score** — an instant offline keyword guess, then an optional AI pass that classifies the role, explains its verdict, and pulls 2–4 specific hooks out of their profile.
- **Draft** — a connection note (280 chars), an InMail, a cold email, or a follow-up, in one of four tones, written only from facts you provided and facts on their profile.
- **Track** — save contacts with a status (New → Contacted → Replied → Interviewing → Closed), search them, and export the list as JSON.

The prompt in [background.js](src/background.js) is deliberately strict about not inventing shared connections, metrics, or mutual acquaintances, and about avoiding the openers that make cold outreach obvious. If your profile in Settings is empty, it writes something short rather than making things up.

## Install

Requires Node 18+ and a Chromium browser on version 116 or newer.

```bash
npm install
npm run build     # draws the icons, then bundles everything into dist/
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the **`dist/`** folder.

> The repo root is not a loadable extension on purpose. `dist/` is the only thing Chrome should ever see.

On first install the Settings page opens automatically. Paste an [Anthropic API key](https://console.anthropic.com/settings/keys), hit **Test**, fill in your profile, and **Save**.

## Development

```bash
npm run watch   # rebuild on save; reload the extension in chrome://extensions after each change
npm run smoke   # offline checks: manifest references, bundles load, DOM ids match
npm run icons   # redraw icons/ after editing the geometry in tools/make-icons.mjs
npm run zip     # dist/ → hrconnect-ai-<version>.zip for the Web Store
```

`npm run smoke` runs without a browser. It catches a manifest pointing at a missing file, a bundle that throws on load, and a `getElementById` that no longer matches any id in the HTML. It cannot tell you that a LinkedIn selector has gone stale — only the browser can.

## Layout

```
src/
  manifest.json     MV3 manifest (copied into dist/ at build time)
  background.js     service worker — the only place the API key is used
  content.js        page scraper, injected on demand
  popup.{html,css,js}
  options.{html,css,js}
  lib/
    constants.js    channels, tones, statuses, keyword list
    storage.js      chrome.storage.local wrappers
tools/
  build.mjs         esbuild bundle + static copy
  make-icons.mjs    draws the PNG icons from scratch (no binaries in git)
  smoke.mjs         offline checks
  zip.mjs           dependency-free ZIP writer
```

## How the Claude calls work

Both calls use `claude-opus-5` with adaptive thinking and a JSON-schema structured output, from the service worker only:

| Call | Effort | Returns |
| --- | --- | --- |
| Analyze | `low` | `is_recruiter`, `confidence`, `role_type`, `reasoning`, `talking_points`, `best_channel` |
| Draft | `medium` | `subject`, `body`, `tips` |

Errors are mapped from the SDK's typed exception classes, so a rejected key, a rate limit, and a dropped connection each produce a different message in the popup rather than one generic failure.

Not wired up, but reasonable next steps: streaming the draft into the textarea, prompt caching once the system prompts grow past the minimum cacheable prefix, and the server-side `fallbacks` parameter.

## Things to know

- **Your key is stored in `chrome.storage.local`.** That is unencrypted on disk and readable by anything with access to your browser profile. It is fine for a personal tool; it is not a model for shipping this to other people with a shared key. Every request is billed to your own Anthropic account.
- **Permissions are deliberately narrow.** `activeTab` means the scraper only touches a page when you click the extension icon — there is no standing permission over LinkedIn and no background scraping. `host_permissions` covers `api.anthropic.com` and nothing else.
- **The selectors will rot.** LinkedIn rewrites its markup regularly. Every field is read through a list of candidate selectors and degrades to an empty string, and the popup has an **Edit details** panel so you can type over anything the scraper got wrong. When a field stops filling in, fix the list in [content.js](src/content.js).
- **Automating LinkedIn is against their User Agreement.** This reads a page you have already opened, only when you ask it to, which is ordinary extension behaviour — but bulk scraping or automated connecting with it is not, and can get an account restricted.
- **Read every draft before sending.** A model with thin input will write a thin message.
