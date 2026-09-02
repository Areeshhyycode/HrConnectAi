// MV3 service worker. Every Claude call happens here so the API key is never
// exposed to page context (a content script shares the page's world).

import Anthropic from "@anthropic-ai/sdk";
import { MSG, MODEL, CHANNELS, TONES } from "./lib/constants.js";
import { getSettings } from "./lib/storage.js";

function makeClient(apiKey) {
  return new Anthropic({
    apiKey,
    // The key belongs to the person running the extension and lives in their own
    // browser profile, which is exactly what this header is for.
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  });
}

async function getClient() {
  const { apiKey } = await getSettings();
  if (!apiKey) throw new Error("NO_API_KEY");
  return makeClient(apiKey);
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    is_recruiter: { type: "boolean" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    role_type: {
      type: "string",
      description:
        "Short label, e.g. 'Technical recruiter', 'Talent sourcer', 'Hiring manager', 'Not a hiring contact'.",
    },
    company: { type: "string", description: "Best guess at their employer, or empty string." },
    reasoning: { type: "string", description: "One sentence explaining the verdict." },
    talking_points: {
      type: "array",
      items: { type: "string" },
      description:
        "2-4 specific hooks drawn from THEIR profile that are worth referencing. Never generic flattery.",
    },
    best_channel: {
      type: "string",
      enum: ["connection_note", "inmail", "email", "follow_up"],
    },
  },
  required: [
    "is_recruiter",
    "confidence",
    "role_type",
    "company",
    "reasoning",
    "talking_points",
    "best_channel",
  ],
  additionalProperties: false,
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Subject line, or an empty string for channels that have none.",
    },
    body: { type: "string", description: "The message itself, ready to paste." },
    tips: {
      type: "array",
      items: { type: "string" },
      description: "1-3 short notes on why this angle was chosen or what to tweak.",
    },
  },
  required: ["subject", "body", "tips"],
  additionalProperties: false,
};

const ANALYST_SYSTEM = `You assess LinkedIn profiles for a job seeker who is looking for hiring contacts.

Decide whether this person is worth reaching out to about a role. Recruiters, sourcers, talent acquisition, HR and people teams, and hiring managers all count. Individual contributors with no hiring involvement do not.

Base the talking points strictly on what appears in the scraped profile text. If the profile is thin, return fewer points rather than inventing detail. Never fabricate a company, a tenure, a school, or a shared connection.`;

const WRITER_SYSTEM = `You write outreach messages that a job seeker sends to recruiters and hiring contacts.

Rules that matter more than style:
- Use ONLY the facts supplied about the sender and the recipient. Never invent a shared connection, a mutual acquaintance, an award, a metric, or a detail about either person.
- If the sender's background is thin, write a shorter message rather than padding it with claims.
- Open with a specific reason for contacting THIS person. Never "I hope this message finds you well", "I came across your profile", or "I am reaching out because I am passionate about".
- One clear ask. No stacked questions.
- Plain sentences. No em-dashes, no buzzwords (synergy, leverage, rockstar, dynamic), at most one exclamation mark.
- Never leave placeholder brackets like [Company]. If a fact is missing, write around it.
- Write as the sender, in first person. Put no commentary inside the body.`;

function textOf(response) {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Belt and braces, in case the model ever wraps the object in a fence.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Claude returned a response that was not valid JSON.");
    return JSON.parse(match[0]);
  }
}

function describePerson(person) {
  const lines = [
    `Name: ${person.name || "(unknown)"}`,
    `Headline: ${person.headline || "(none)"}`,
    `Company: ${person.company || "(unknown)"}`,
    `Location: ${person.location || "(unknown)"}`,
    `Profile URL: ${person.url || "(none)"}`,
  ];
  if (person.about) lines.push(`About / page text: ${person.about}`);
  return lines.join("\n");
}

function describeSender(settings) {
  const rows = [
    ["Name", settings.fullName],
    ["Current role", settings.currentRole],
    ["Years of experience", settings.yearsExperience],
    ["Roles they want", settings.targetRoles],
    ["Key skills", settings.skills],
    ["Notable work and highlights", settings.highlights],
    ["Links", settings.links],
    ["Location", settings.location],
  ].filter(([, value]) => value && String(value).trim());

  if (!rows.length) {
    return "(The sender has not filled in their profile yet. Keep the message short and ask-focused rather than claiming any experience.)";
  }
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}

async function analyzeProfile(person) {
  const client = await getClient();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: ANALYST_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
    },
    messages: [{ role: "user", content: `Assess this profile:\n\n${describePerson(person)}` }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to analyze this profile.");
  }
  return parseJson(textOf(response));
}

async function draftOutreach({ person, channel, tone, extraContext, analysis }) {
  const client = await getClient();
  const settings = await getSettings();
  const spec = CHANNELS[channel] || CHANNELS.connection_note;

  const parts = [
    `Channel: ${spec.label}`,
    spec.brief,
    `Hard length limit for the body: ${spec.limit} characters.`,
    `Tone: ${TONES[tone] || TONES.warm}`,
    "",
    "RECIPIENT",
    describePerson(person),
  ];

  if (analysis?.talking_points?.length) {
    parts.push(
      "",
      "Hooks already identified in their profile:",
      ...analysis.talking_points.map((point) => `- ${point}`)
    );
  }

  parts.push("", "SENDER", describeSender(settings));

  if (extraContext && extraContext.trim()) {
    parts.push("", "Extra context from the sender (treat as highest priority):", extraContext.trim());
  }

  if (!spec.hasSubject) {
    parts.push("", 'This channel has no subject line. Return "" for subject.');
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: WRITER_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: DRAFT_SCHEMA },
    },
    messages: [{ role: "user", content: parts.join("\n") }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to draft this message.");
  }

  const draft = parseJson(textOf(response));
  return { ...draft, channel, limit: spec.limit, hasSubject: spec.hasSubject };
}

async function testKey({ apiKey }) {
  await makeClient(apiKey).messages.create({
    model: MODEL,
    max_tokens: 16,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
  });
  return { ok: true };
}

// Most specific first. A bare `instanceof APIError` would collapse "your key is
// wrong" and "slow down" into the same unhelpful message.
function toFriendlyError(error) {
  if (error && error.message === "NO_API_KEY") {
    return "No API key saved yet. Open Settings and add your Anthropic API key.";
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return "That API key was rejected. Check it in Settings.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "This key cannot access that model. Check your plan in the Anthropic Console.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The API rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Check your internet connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status}: ${error.message}`;
  }
  return (error && error.message) || "Something went wrong.";
}

const HANDLERS = {
  [MSG.ANALYZE]: (payload) => analyzeProfile(payload.person),
  [MSG.DRAFT]: (payload) => draftOutreach(payload),
  [MSG.TEST_KEY]: (payload) => testKey(payload),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message && message.type];
  if (!handler) return false;

  handler(message.payload || {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => {
      console.error("[HRConnect AI]", error);
      sendResponse({ ok: false, error: toFriendlyError(error) });
    });

  return true; // keep the message channel open for the async response
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
  }
});
