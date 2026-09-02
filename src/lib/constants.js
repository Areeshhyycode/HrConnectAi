// Shared constants for popup, options, background and content scripts.

export const MSG = {
  SCRAPE: "hrconnect/scrape",
  ANALYZE: "hrconnect/analyze",
  DRAFT: "hrconnect/draft",
  TEST_KEY: "hrconnect/test-key",
};

export const MODEL = "claude-opus-5";

export const CHANNELS = {
  connection_note: {
    label: "Connection note",
    limit: 280,
    hasSubject: false,
    brief:
      "A LinkedIn connection request note. Hard limit 280 characters including spaces. " +
      "No greeting block, no sign-off block - it reads as a single short paragraph.",
  },
  inmail: {
    label: "InMail / DM",
    limit: 1200,
    hasSubject: true,
    brief:
      "A LinkedIn InMail or direct message. Subject under 60 characters. " +
      "Body is 90-150 words, 2-3 short paragraphs, one clear ask at the end.",
  },
  email: {
    label: "Cold email",
    limit: 1600,
    hasSubject: true,
    brief:
      "A cold email to a recruiter. Subject under 70 characters and specific, never clickbait. " +
      "Body is 100-180 words with a concrete ask and a single link if the sender supplied one.",
  },
  follow_up: {
    label: "Follow-up",
    limit: 700,
    hasSubject: false,
    brief:
      "A polite follow-up to an earlier message that got no reply. 40-70 words. " +
      "Adds one new piece of value rather than only repeating the original ask.",
  },
};

export const TONES = {
  warm: "Warm and human. Contractions are fine. Friendly but not chummy.",
  direct: "Direct and efficient. Short sentences. Respects the reader's time above all.",
  formal: "Professional and polished, without being stiff or corporate-generic.",
  enthusiastic: "Genuinely energetic about the company and role, but never gushing or over-eager.",
};

export const STATUSES = ["new", "contacted", "replied", "interviewing", "closed"];

export const STATUS_LABELS = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  interviewing: "Interviewing",
  closed: "Closed",
};

// Used for the offline (no-API) heuristic recruiter score shown before you spend a token.
export const RECRUITER_KEYWORDS = [
  "recruiter", "recruiting", "recruitment", "talent acquisition", "talent partner",
  "talent sourcer", "sourcer", "sourcing", "headhunter", "staffing", "hiring manager",
  "hiring", "people operations", "people ops", "human resources", " hr ", "hr ",
  "talent", "campus recruit", "technical recruiter", "executive search",
];

export const DEFAULT_SETTINGS = {
  apiKey: "",
  fullName: "",
  currentRole: "",
  yearsExperience: "",
  targetRoles: "",
  skills: "",
  highlights: "",
  links: "",
  location: "",
  defaultTone: "warm",
  defaultChannel: "connection_note",
};
