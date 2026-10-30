// THE STORE FRAMES, as data. build.mjs draws them; screens.mts renders each frame's app screen.
//
// The look is the app's own: white paper, ink, greys, and colour only where it belongs to a bot (palette.ts). A heavy Geist
// headline at the top left, two short lines, no full stop, one word handwritten with a brush underline in the frame's
// bot's colour (ink when the frame is no one bot's); the painted black bot of the app icon.
//
// The first three frames are the ones App Store search shows side by side, tiny, and the ones Google Play shows large: each
// is one idea in three to five words with one big picture, and the three read as one panorama (`pano`): one clay bar, the
// icon's, runs across all three at the same height, and from it hang the bot (the team), the X0 widget (answer in one tap)
// and a phone (watch them work: Bots at work on the Lock Screen; on Google Play, the app's own job screen). After them come
// the app's screens as cards: the top of a real screen, no phone frame, one part lifted out and an arrow at it, the bot
// peeking over the card. One other shape: `voice` (Keybot: a chat with the Keybot keyboard up, its mic key listening).
//
// One entry per frame, in story order. A new bot's frame is one more entry:
//   { key, title, layout?, screen, pop?, bot?, accent?, ios?, play? }
//   key      file name stem (lower case)
//   title    the headline: two short lines ("\n" between them), sentence case, no full stop; the *word* between stars is
//            written by hand, with a brush underline
//   accent   the colour of the underline and the arrow: the frame's bot's (palette.ts), ink when it is no one bot's
//   mascot   the bot peeking over the card's top edge: { pose: "curious" | "happy" | "wink" | "shy" | "starry" | "hello"
//            (art.mjs POSES), x: where along the card (0..1), size: share of the frame's width }
//   arrow    the arrow onto the lifted-out part comes from the left (default; the right for a pop on the right),
//            "right", or false for none
//   layout   "card" (default), "pano" (one of the first three: `pano` its place, 0..2, and `focus` its picture),
//            "voice" (Keybot: the screen above the keyboard, `keyArt` the mic key's moment), or "tiles"
//   focus    pano frames: { kind: "hang" } the icon's bot under the bar, and the team under him; { kind: "widget" } the
//            large X0 widget on a Home Screen; { kind: "lock" } a phone on its Lock Screen with Bots at work;
//            { kind: "android-widget" } the 4x4 X0 widget on an Android home screen; { kind: "phone" } a phone with this
//            frame's screen in it
//   keyArt   voice frames: the Peek-a-bot key's moment { mode: "listen" | "idle" | "think" | "done", level 0..1 }
//   screen   which app screen, with the sample day's answers (samples/ in the backend's bots-render) and this frame's own over them:
//            api: { "GET /path": answer } or (answers) => ({ ... }) to change some; fake: the live state (bots, jobs, tasks);
//            scroll: points, or { to: "text" } to bring a part near the top; viewport: another phone size for this screen;
//            state: values in the screen's state (what someone has typed)
//   pop      the part of the screen to lift out of the card, drawn larger where it sits: { has: [texts it holds],
//            card?: true (the card around them), union?: true (the full-width rows holding each text, first to last),
//            bare?: true (without its own border), tall?: points (lift it from a taller phone, for a part below the fold),
//            at?: 0..1 (its centre, as a share of the frame's height), nudge?: share of the height to move it,
//            side?: "left" | "right" (lean it toward that edge) }
//   bot      the bot's name and a few words, for the roster (leave out for a non-bot frame)
//   cardTop  card frames: where the card starts, as a share of the height (default about 0.21)
//   fade     true fades the card's foot (for a screen whose content runs on past it, rather than ending in its own bar)
//   ios      false leaves the frame out of the App Store's set (it takes 10); an object is this frame's changes there
//   play     false leaves the frame out of Google Play's set (it takes 8); an object is this frame's changes there
//   off      true keeps a frame defined but leaves it out of every export
//
// Store rules the words and the screens keep (screens.mts checks the screens' visible text against RULES):
// no prices or amounts, no other company's or app's name, no "best"/"#1", no reviews or awards, nothing that isn't in the build.
// The one exception is the `tiles` frame (off now): the marks of apps X0 Bot really connects to (icons/, CREDITS.md), with no
// brand name in any text.

/** The store name is "X0 Bot"; the brand's mark, on the art, is "X0". */
export const BRAND = { name: "X0 Bot", mark: "X0", accent: "#C9683F" };

/** The app icon (the painted bot hanging under the clay bar; app/assets/icon.png is the same picture). */
export const ICON = {
  dir: "../brand/x0-icon/curious-hang",
  /** Set to a path (relative to this folder) to force one. Otherwise: the README's pick, else the only icon-1024.png there. */
  file: "../brand/x0-icon/curious-hang/8-painted-clay-bar/icon-1024.png",
};

/** The bots' own colours (backend src/experience/bots/palette.ts), for the frames' marks. */
export const COLORS = { ink: "#0A0A0A", clay: "#C9683F", code: "#4F7A3A", keybot: "#A9573A", plan: "#8F6A1F", travel: "#3E6E8E", pine: "#2F5D50", plum: "#6E4A6B" };

export const SIZES = {
  /** The phone the card screens are drawn on, in points, and how sharp (scale). `top` is the space above the app's own header. */
  phone: { w: 390, h: 788, top: 16, bottom: 10, scale: 4 },
  targets: [
    { dir: "ios-6.9", w: 1320, h: 2868, name: "App Store (iPhone 6.9\")", max: 10, store: "ios" },
    { dir: "ios-6.5", w: 1284, h: 2778, name: "App Store (iPhone 6.5\")", max: 10, store: "ios" },
    { dir: "play-phone", w: 1080, h: 1920, name: "Google Play (phone)", max: 8, store: "play" },
  ],
};

/** What a screen may not show in a store screenshot (checked on the visible text of every rendered screen). */
export const RULES = [
  { name: "old name", re: /tailzu/ },
  { name: "money", re: /₹|\bRs\.?\s?\d|\$\s?\d|\bINR\b|\d+\s?(rupees|paise)\b/ },
  { name: "other company", re: /\b(google|gmail|whatsapp|github|gitlab|slack|notion|apple|iphone|android|ipad|mac\s?book|windows|microsoft|uber|ola|irctc|booking\.com|makemytrip|airbnb|openstreetmap|osrm|met norway|next\.?js|next 15|supabase|typescript|tailwind|vercel|razorpay|upi|paytm|phonepe|gpay|chatgpt|openai|claude|instagram|facebook|youtube|zoom|theobroma)\b/ },
  { name: "claim", re: /\b(best|#1|number one|top[- ]rated|award)/ },
];

// ------------------------------------------------------------------ the sample day (Aanya, Tuesday 28 October, 7:40 pm in Bengaluru)

const N = Date.UTC(2026, 9, 28, 14, 10);
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const A = "/v1/botsapp/bots";
const TRIP = "7a1b2c3d-0000-4000-8000-0000000000aa";
const PLAN_KEY = `GET ${A}/plan?tz=330&week=0`;
const EXTRAS_KEY = `GET ${A}/trip/${TRIP}/extras?tz=330`;

/** Home: Plan bot asks one thing, Travel bot is working, four things done this week. */
const HOME_DAY = {
  jobs: [{ id: "7c1d2e3f-0000-4000-8000-000000000003", task: "Move sign-in to phone OTP", state: "done", waitingOn: null, spentPaise: 0, createdAt: N - 2 * DAY, updatedAt: N - 2 * DAY + HOUR }],
  tasks: [
    { id: "a1b2c3d4-0000-4000-8000-0000000000a1", state: "waiting", title: "Only 15 min between the dentist and dinner. Move dinner to 7:30?",
      approval: { id: "ap-1", connector: "google-calendar", preview: "Moves Dinner with Mom to 7:30 pm and tells Mom" }, createdAt: N - 10 * MIN, updatedAt: N - 4 * MIN },
    { id: "a1b2c3d4-0000-4000-8000-0000000000a2", state: "running", title: "Finding stays near the wedding", approval: { id: "ap-2", connector: "maps", preview: "" }, createdAt: N - 20 * MIN, updatedAt: N - 2 * MIN },
    { id: "a1b2c3d4-0000-4000-8000-0000000000a3", state: "done", title: "Added 3 workouts to your days", createdAt: N - 12 * HOUR, updatedAt: N - 12 * HOUR },
    { id: "a1b2c3d4-0000-4000-8000-0000000000a4", state: "done", title: "Packing list for Pune", createdAt: N - DAY, updatedAt: N - DAY },
    { id: "a1b2c3d4-0000-4000-8000-0000000000a5", state: "done", title: "Moved the standup to 10", createdAt: N - 30 * HOUR, updatedAt: N - 30 * HOUR },
  ],
  minutesSaved: 140,
};

/** A meeting written up: the Diwali sale, with the shop's team. */
const people = { you: { label: "You", name: "Aanya Sharma" }, k: { label: "Speaker 1", name: "Kavya Rao" }, i: { label: "Speaker 2", name: "Ishaan Mehta" }, m: { label: "Speaker 3", name: "Meera Iyer" } };
const NOTE = {
  id: "n1", status: "ready", startedAt: new Date(N - 8 * HOUR).toISOString(), durationSeconds: 2520, words: 5200, title: "Diwali sale plan",
  summary: "The sale runs from 7 to 12 November. Kavya sets up the shop window on Friday, Ishaan takes the online orders, and every order this week gets free gift wrap.",
  people: [people.you, people.k, people.i, people.m], organised: true, openTodos: 3,
  decisions: ["The sale runs from 7 to 12 November", "Free gift wrap on every order this week", "The shop window goes up on Friday"],
  todos: [
    { id: "t1", text: "Order 200 gift boxes", who: "Speaker 3", when: "this week", done: false },
    { id: "t2", text: "Write the sale message for customers", who: "You", when: "today", done: false },
    { id: "t3", text: "Set up the shop window", who: "Speaker 1", when: "by Friday", done: false },
    { id: "t4", text: "Send the team the final plan", who: "You", done: true, doneAt: new Date(N - 7 * HOUR).toISOString() },
  ],
  highlights: [
    { speaker: "Speaker 1", text: "Last year the window brought in half the walk-ins. Let's do it properly this time." },
    { speaker: "You", text: "Free gift wrap on every order this week." },
  ],
  transcript: [
    { at: 40, speaker: "Speaker 1", text: "Last year the window brought in half the walk-ins. Is baar properly karte hain." },
    { at: 72, speaker: "You", text: "Sale seven se twelve November tak. Gift wrap free on every order." },
    { at: 98, speaker: "Speaker 2", text: "I'll take the online orders. We need more boxes though." },
    { at: 131, speaker: "Speaker 3", text: "Two hundred gift boxes should be enough for the week." },
    { at: 160, speaker: "You", text: "Done. Kavya, window by Friday?" },
    { at: 171, speaker: "Speaker 1", text: "Haan, Friday shaam tak ready." },
  ],
  found: { hash: "sample", at: new Date(N - 8 * HOUR).toISOString(), ok: true },
};

// ------------------------------------------------------------------ the frames

/** The apps on the `tiles` frame: ones X0 Bot connects to in this build (src/connectors), as their own marks (icons/). */
export const APPS = ["whatsapp", "gmail", "googlemaps", "github", "notion", "googledocs", "youtube", "googlesheets", "telegram"];

const C = COLORS;
const THREAD = `GET ${A}/threads/th-home`;
/** What Keybot writes in the Keybot frame (and the App Preview): the spoken words, filler gone, punctuation in. */
export const DICTATION = { said: "um so I'm, uh, running like late, start without me", wrote: "Running late, start without me." };

export const FRAMES = [
  // ---- the first three: one panorama, one clay bar across them
  {
    key: "x0", layout: "pano", pano: 0, title: "Your team\nof *bots*", accent: C.clay, focus: { kind: "hang" },
  },
  {
    // The X0 widget, asking for Code bot: answered in place, with one tap.
    key: "widget", layout: "pano", pano: 1, title: "Answer in\n*one tap*", accent: C.clay, focus: { kind: "widget" },
    play: { focus: { kind: "android-widget" } },
  },
  {
    // Bots at work: Code bot's job on the Lock Screen as it runs (iOS). Android has no Live Activity: there, the app's own job screen.
    key: "live", layout: "pano", pano: 2, title: "Watch them\n*work*", accent: C.clay, focus: { kind: "lock" },
    play: { focus: { kind: "phone", platform: "android" } },
    screen: { id: "bots.code.job", viewport: { w: 412, h: 892, top: 40, bottom: 12, scale: 3 } },
  },
  // ---- then the app, a screen at a time
  {
    key: "team", title: "Players that make\nyour life *easy*", accent: C.ink, mascot: { pose: "hello", x: 0.78 }, bot: null, play: false,
    screen: {
      id: "bots.home", fake: HOME_DAY,
      // Home's own reads: no first-arrival card, no deletion date, the notifications ask already answered.
      api: { "GET /v1/bots/first-run/arrival": { due: false }, "GET /v1/account/deletion": { scheduled: null }, "GET /v1/bots/push-ask": { due: false } },
    },
    // The team, lifted out: the bots' own tiles.
    pop: { has: ["Needs you · 1 question", "Make a bot"], tall: 1400, at: 0.71 },
  },
  {
    // One ask, by voice or by typing, in Hinglish; X0 Bot picks the bot for it, and any other is a tap away. The team, at work.
    key: "ask", title: "Ask once, and the\n*right* bot takes it", accent: C.ink, mascot: { pose: "curious", x: 0.8 },
    screen: { id: "bots.ask" },
    pop: { has: ["will take this", "Or hand it to"], union: true, pad: 6, nudge: 0.022 },
  },
  {
    // Keybot, writing in X0's own family chat: what was said, written clean, the keyboard's Peek-a-bot key listening.
    key: "keybot", layout: "voice", title: "Say it, and\nKeybot *writes* it", accent: C.keybot, bot: { name: "Keybot", line: "Writes for you, in any app" },
    mascot: { pose: "happy", x: 0.8 }, keyArt: { mode: "listen", level: 0.7 },
    screen: {
      id: "bots.thread", params: { id: "th-home" }, scroll: 9999, state: { say: DICTATION.wrote },
      viewport: { w: 390, h: 520, top: 16, bottom: 0, scale: 4 },
      // Leo's photo of the cake is a picture the renderer cannot fetch: his message says it instead, and the answer to it.
      api: (a) => ({ [THREAD]: { ...a[THREAD], messages: a[THREAD].messages.map((m) => m.id === "msg2" ? { ...m, text: "Picked up the cake for tonight.", files: [] } : m.id === "msg3" ? { ...m, text: "Perfect, thank you!" } : m) } }),
    },
  },
  {
    key: "plan", title: "Your day,\n*planned* for you", mascot: { pose: "happy", x: 0.78 }, accent: C.plan, bot: { name: "Plan", line: "Your day, planned" },
    screen: { id: "bots.plan", api: (a) => ({ [PLAN_KEY]: { ...a[PLAN_KEY], travel: { ...a[PLAN_KEY].travel, credits: [] } } }) },
    pop: { has: ["Leave home by", "Dinner with Mom"], union: true, pad: 4, nudge: -0.016 },
  },
  {
    // Out of both sets now: the meetings are noted on the computer, so it says least on a phone.
    key: "notes", title: "Every meeting,\n*written up*", mascot: { pose: "shy", x: 0.8 }, accent: C.plum, bot: { name: "Notes", line: "Meetings, written up" }, ios: false, play: false,
    screen: { id: "bots.note", params: { id: "n1" }, api: { "GET /v1/notes/n1": { note: NOTE, finding: false }, "GET /v1/botsapp/calendar/notes/n1": { todos: { t2: { id: "c-t2", done: false } } } } },
    pop: { has: ["Send the team the final plan"], card: true, bare: true }, fade: true,
  },
  {
    key: "travel", title: "Your trips,\nall *sorted*", mascot: { pose: "starry", x: 0.78 }, accent: C.travel, bot: { name: "Travel", line: "Trips, sorted" },
    screen: {
      id: "bots.travel",
      api: (a) => {
        const t = a[`GET ${A}/trip`], x = a[EXTRAS_KEY].extras;
        const stays = x.stays.map((s, i) => ({ ...s, host: "", url: "", label: i === 0 ? "Travel bot's pick" : "" }));
        return {
          [`GET ${A}/trip`]: { ...t, trip: { ...t.trip, stays }, bookings: [{ label: "Evening train to Pune · 2 window seats", url: "https://x0bot.com", at: N - 2 * HOUR, said: "Trains from Mumbai to Pune on 14 Nov" }] },
          [EXTRAS_KEY]: { extras: { ...x, stays, credits: [] } },
        };
      },
    },
    pop: { has: ["Shanti Residency", "Add one"], nudge: -0.013 },
  },
  {
    // Out of both sets now: the first three frames are Code bot's (its question on the widget, its job at work).
    key: "code", title: "Ship code\nby *asking*", mascot: { pose: "curious", x: 0.78 }, accent: C.code, bot: { name: "Code bot", line: "Builds and fixes your code" }, ios: false, play: false,
    // Code bot's home: what it is on, what needs you, your projects. The projects' framework and language names are left out.
    screen: {
      id: "bots.code.start", variant: "home", params: { step: "home" },
      api: (a) => Object.fromEntries(Object.entries(a).filter(([k]) => k.endsWith("/brain")).map(([k, v]) => [k, { ...v, structure: { ...v.structure, frameworks: [], languages: [] } }])),
    },
    pop: { has: ["Round the cart total", "Per item"], card: true, bare: true, nudge: -0.012 },
  },
  {
    key: "spaces", title: "Your people,\nin *sync*", mascot: { pose: "happy", x: 0.78 }, accent: C.ink, bot: { name: "Spaces", line: "Family and friends" },
    screen: {
      id: "bots.spaces", variant: "home", params: { id: "s1" },
      api: (a) => {
        const k = `GET ${A}/spaces/s1`, d = a[k];
        const tasks = d.tasks.map((t) => (t.id === "t-cake" ? { ...t, notes: "The eggless one" } : t));
        return { [k]: { ...d, payments: [], tasks, space: { ...d.space, waiting: 0, activity: d.space.activity.filter((x) => x.kind !== "pay") } } };
      },
    },
    pop: { has: ["Call Nani", "Can't do it"], card: true, bare: true, side: "right" }, fade: true,
  },
  {
    key: "make", title: "Make a bot\nof your *own*", mascot: { pose: "wink", x: 0.78 }, accent: C.pine, bot: { name: "Your own", line: "Made by you, in a sentence", own: true }, play: false,
    screen: {
      id: "bots.make",
      api: (a) => {
        const k = `GET ${A}/draft`, d = a[k].draft;
        const def = { ...d.draft.definition, skills: { ...d.draft.definition.skills, connectors: ["calendar"] } };
        return { [k]: { draft: { ...d, draft: { ...d.draft, definition: def, connectors: [{ id: "calendar", name: "Calendar", status: "connected" }] } } } };
      },
    },
    // The one sentence it was made from, lifted out over the bot it drafted.
    pop: { has: ["A bot that plans my workouts"], card: true },
  },
  {
    // Out of both sets now: other companies' marks say least in the new look, and the App Store set has no room for it.
    key: "connect", layout: "tiles", title: "Works with the apps\nyou *already* use", accent: C.ink, mascot: { pose: "happy", tile: 1 }, off: true,
  },
];

/** The Play feature graphic (1024 x 500): the icon's bot under his bar, the mark, and one line. */
export const FEATURE = { mark: "X0", line: "Your team of bots" };

// ------------------------------------------------------------------ the sets: global (the default) and India

/** A meeting written up, for the global set: a product launch. */
const gp = { you: { label: "You", name: "Maya Collins" }, s: { label: "Speaker 1", name: "Sofia Martins" }, k: { label: "Speaker 2", name: "Kenji Sato" }, a: { label: "Speaker 3", name: "Amara Okafor" } };
const NOTE_GLOBAL = {
  id: "n1", status: "ready", startedAt: new Date(N - 8 * HOUR).toISOString(), durationSeconds: 2520, words: 5200, title: "Spring launch plan",
  summary: "The launch moves to 12 March. Sofia finishes the landing page by Friday, Kenji runs a beta with fifty customers first, and every early sign-up gets a welcome call.",
  people: [gp.you, gp.s, gp.k, gp.a], organised: true, openTodos: 3,
  decisions: ["The launch moves to 12 March", "A beta with fifty customers comes first", "The landing page goes live on Friday"],
  todos: [
    { id: "t1", text: "Invite fifty beta customers", who: "Speaker 2", when: "this week", done: false },
    { id: "t2", text: "Write the launch email", who: "You", when: "today", done: false },
    { id: "t3", text: "Finish the landing page", who: "Speaker 1", when: "by Friday", done: false },
    { id: "t4", text: "Send the team the final plan", who: "You", done: true, doneAt: new Date(N - 7 * HOUR).toISOString() },
  ],
  highlights: [
    { speaker: "Speaker 1", text: "If the page is ready by Friday, the beta can start on Monday." },
    { speaker: "You", text: "Fifty customers first, then everyone on 12 March." },
  ],
  transcript: [
    { at: 40, speaker: "Speaker 1", text: "If the page is ready by Friday, the beta can start on Monday." },
    { at: 72, speaker: "You", text: "Let's move the launch to 12 March and do it properly." },
    { at: 98, speaker: "Speaker 2", text: "I'll pick the fifty beta customers this week." },
    { at: 131, speaker: "Speaker 3", text: "And every early sign-up gets a welcome call from us." },
    { at: 160, speaker: "You", text: "Done. Sofia, page by Friday?" },
    { at: 171, speaker: "Speaker 1", text: "Friday evening, yes." },
  ],
  found: { hash: "sample", at: new Date(N - 8 * HOUR).toISOString(), ok: true },
};

/**
 * The global set's names and places, swapped into the sample data (the server's answers, the live state, the params), never
 * into the app's own words: the screens are still the app's. Longer phrases first; whole words only.
 */
const GLOBAL_SWAP = [
  ["Aanya Sharma", "Maya Collins"], ["Aanya S.", "Maya C."], ["Aanya", "Maya"],
  ["Rohan Mehta", "Kenji Sato"], ["Ishaan Mehta", "Kenji Sato"], ["Rohan", "Leo"], ["Ishaan", "Kenji"],
  ["Kavya Rao", "Sofia Martins"], ["Kavya", "Sofia"], ["Meera Iyer", "Amara Okafor"], ["Meera R.", "Amara O."], ["Meera", "Amara"],
  ["Dr. Mehta", "Dr. Lee"], ["Vikram Joshi", "Daniel Weiss"], ["Dev K", "Noah K"], ["Dev", "Noah"], ["Ishita", "Elena"], ["Kabir", "Omar"], ["Tanmay", "Lucas"],
  ["Nani", "Grandma"],
  ["HSR Layout", "Elm Park"], ["Indiranagar", "Midtown"], ["Koramangala", "Riverside"], ["Jayanagar", "Old Town"], ["Bandra", "the harbour"],
  ["Koregaon Park", "Alfama"], ["FC Road", "Baixa"], ["Shanti Residency", "Casa Alfama"], ["Shanti_Residency", "Casa_Alfama"],
  ["Deccan Courtyard", "Hotel Rio Tejo"], ["Deccan Queen 12123", "Intercity 521"], ["Sakshi and Arjun's wedding", "Ana and Tom's wedding"],
  ["Pune", "Lisbon"], ["Mumbai", "Porto"], ["Goa", "Seville"],
  ["Aadhaar for check-in", "Passport for check-in"], ["Aadhaar", "Passport"], ["16° nights", "11° nights"],
  ["Diwali sale plan", "Spring launch plan"], ["Diwali party", "Launch party"], ["Diwali", "Spring"],
  ["Theobroma", "the bakery"], ["The eggless one", "The chocolate one"],
  ["Chakki atta · 5 kg", "Flour · 2 kg"], ["Toor dal · 1 kg", "Lentils · 1 kg"], ["Tomato, onion, palak", "Tomatoes, onions, spinach"], ["Paneer · 400 g", "Feta · 200 g"],
  ["GST papers due", "Tax papers due"],
];

/** Whole-word replacement of `swap` pairs in one string. */
export function swapText(t, swap) {
  if (!swap?.length || typeof t !== "string") return t;
  for (const [from, to] of swap) {
    const re = new RegExp(`(?<![A-Za-z])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "g");
    t = t.replace(re, to);
  }
  return t;
}
/** The same over every string in a value (object keys untouched). */
export function swapDeep(v, swap) {
  if (!swap?.length) return v;
  if (typeof v === "string") return swapText(v, swap);
  if (Array.isArray(v)) return v.map((x) => swapDeep(x, swap));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swapDeep(x, swap)]));
  return v;
}

/**
 * The sets. `global` is the default (the output in out/, the sheet, the listing); `india` is for Google Play's English (India)
 * and Hindi listings (out/india/). Each set has the person signed in, the swap for its sample data, the frames it keeps as
 * they are (`local`: the global set keeps one or two Indian moments on purpose), and per-frame overrides (screen, pop).
 */
export const SETS = {
  global: {
    title: "Global", out: "",
    user: { id: "00000000-0000-4000-8000-00000000aaaa", name: "Maya Collins", email: "maya@example.com" },
    swap: GLOBAL_SWAP,
    // Kept Indian on purpose: Ask in Hinglish (the "speaks your language" touch) and a family space with Nani.
    local: ["ask", "spaces"],
    frames: {
      notes: { screen: { api: { "GET /v1/notes/n1": { note: NOTE_GLOBAL, finding: false } } }, pop: { has: ["Invite fifty beta customers", "Send the team the final plan"], card: true, bare: true } },
      travel: {
        screen: {
          api: (a) => {
            const x = a[EXTRAS_KEY].extras;
            const days = [["2026-11-14", 19, 12], ["2026-11-15", 20, 12], ["2026-11-16", 18, 11]].map(([key, hiC, loC]) => ({ key, hiC, loC, sky: "clear", rainMm: 0 }));
            return { [EXTRAS_KEY]: { extras: { ...x, weather: { ...x.weather, days, line: "Mild days, cool nights", sub: "Sat 19° · Sun 20° · Mon 18° · lows 11°" } } } };
          },
        },
      },
    },
  },
  india: {
    title: "India (Google Play English (India) and Hindi)", out: "india",
    user: { id: "00000000-0000-4000-8000-00000000aaaa", name: "Aanya Sharma", email: "aanya@example.in" },
    swap: [], local: [],
    frames: {
      notes: { pop: { has: ["Order 200 gift boxes", "Send the team the final plan"], card: true, bare: true } },
    },
  },
};
export const DEFAULT_SET = "global";

const chain = (a, b) => (answers) => {
  const run = (x, ans) => (typeof x === "function" ? x(ans) : x ?? {});
  const first = run(a, answers), second = run(b, { ...answers, ...first });
  return { ...first, ...second };
};

/** The frames of a set: the frames above with the set's overrides, its swap (`swap`, empty for a `local` frame) and its person. */
export function framesFor(name = DEFAULT_SET) {
  const set = SETS[name];
  if (!set) throw new Error(`no set "${name}" (sets: ${Object.keys(SETS).join(", ")})`);
  return FRAMES.map((f) => {
    const o = set.frames?.[f.key] ?? {};
    const swap = set.local?.includes(f.key) ? [] : set.swap ?? [];
    const g = { ...f, ...o, swap, user: set.user };
    if (f.screen || o.screen) g.screen = { ...(f.screen ?? {}), ...(o.screen ?? {}), api: chain(f.screen?.api, o.screen?.api) };
    if (g.pop) g.pop = { ...g.pop, has: g.pop.has.map((t) => swapText(t, swap)) };
    return g;
  });
}
