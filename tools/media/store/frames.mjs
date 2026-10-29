// THE STORE FRAMES, as data. build.mjs draws them; screens.mts renders each frame's app screen.
//
// The look: a full-bleed photograph behind everything, under one grade in build.mjs (ink shadows, cream light); a heavy
// Geist headline at the top left, two short lines, no full stop, one word handwritten with a clay underline; the app as a
// cream card (the top of a real screen, no phone frame) with one part lifted out and a clay arrow at it; the Peek-a-bot
// peeking over the card. Two other shapes: the photo with the keyboard's own mic key (`voice`), and a grid of the apps it
// works with (`tiles`).
//
// One entry per frame, in story order. A new bot's frame is one more entry:
//   { key, title, layout?, photo, screen, pop?, bot?, accent?, play? }
//   key      file name stem (lower case)
//   title    the headline: two short lines ("\n" between them), sentence case, no full stop; the *word* between stars is
//            written by hand, with a clay brush underline
//   mascot   the Peek-a-bot over the card's top edge: { pose: "curious" | "happy" | "wink" | "shy" | "starry" | "hello"
//            (art.mjs POSES), x: where along the card (0..1), size: share of the frame's width; tiles frames: tile: which one }
//   arrow    the clay arrow onto the lifted-out part comes from the left (default; the right for a pop on the right),
//            "right", or false for none
//   layout   "card" (default), "voice" (the photo, the words at the foot and the mic key: `keyArt`), or "tiles"
//   keyArt   voice frames: the Peek-a-bot key's moment { mode: "listen" | "idle" (peeking, paws on the rim) | "think" |
//            "done", level 0..1, size: share of the width }
//   photo    { file, x, y, zoom, blur, light }: a file in photos/ (CREDITS.md says whose it is), the point of it to centre
//            (0..1), how far to zoom in, and how bright under the shared grade (light, about 0.5; above 1 for a dark photo;
//            blur in px at 1320 wide)
//   screen   which app screen, with the sample day's answers (samples/ in the backend's bots-render) and this frame's own over them:
//            api: { "GET /path": answer } or (answers) => ({ ... }) to change some; fake: the live state (bots, jobs, tasks);
//            scroll: points, or { to: "text" } to bring a part near the top; viewport: another phone size for this screen
//   pop      the part of the screen to lift out of the card, drawn larger where it sits: { has: [texts it holds],
//            card?: true (the card around them), union?: true (the full-width rows holding each text, first to last),
//            bare?: true (without its own border), tall?: points (lift it from a taller phone, for a part below the fold),
//            at?: 0..1 (its centre, as a share of the frame's height), nudge?: share of the height to move it,
//            side?: "left" | "right" (lean it toward that edge) }
//   bot      the bot's name and a few words, for the feature graphic and the roster (leave out for a non-bot frame)
//   cardTop  card frames: where the card starts, as a share of the height (default about 0.21; lower it for a photo that
//            must be seen, its subject placed above the card with photo.y and photo.zoom)
//   fade     true fades the card's foot (for a screen whose content runs on past it, rather than ending in its own bar)
//   play     false leaves the frame out of Google Play's set (Play takes 8 phone screenshots; the App Store 10)
//   off      true keeps a frame defined but leaves it out of every export
//
// Store rules the words and the screens keep (screens.mts checks the screens' visible text against RULES):
// no prices or amounts, no other company's or app's name, no "best"/"#1", no reviews or awards, nothing that isn't in the build.
// The one exception is the `tiles` frame: the marks of apps X0 Bot really connects to (icons/, CREDITS.md), with no brand
// name in any text.

export const BRAND = { name: "X0 Bot", accent: "#D08A5C" };

/** The app icon: the soft-3D bot the brand helper renders. Used on the feature graphic once it exists. */
export const ICON = {
  dir: "../brand/x0-icon/peek3d",
  /** Set to a path (relative to this folder) to force one. Otherwise: the README's pick, else the only icon-1024.png there. */
  file: null, // e.g. "../brand/x0-icon/peek3d/<variant>/icon-1024.png"
};

export const SIZES = {
  /** The phone the card screens are drawn on, in points, and how sharp (scale). `top` is the space above the app's own header. */
  phone: { w: 390, h: 788, top: 16, bottom: 10, scale: 4 },
  targets: [
    { dir: "ios-6.9", w: 1320, h: 2868, name: "App Store (iPhone 6.9\")", max: 10, store: "ios" },
    { dir: "ios-6.7", w: 1290, h: 2796, name: "App Store (iPhone 6.7\")", max: 10, store: "ios" },
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

export const FRAMES = [
  {
    key: "team", title: "Players that make\nyour life *easy*", mascot: { pose: "hello", x: 0.78 }, bot: null,
    photo: { file: "team.jpg", x: 0.48, y: 0.42, zoom: 1, light: 0.5, warm: 0.5 },
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
    key: "ask", title: "Ask once, and the\n*right* bot takes it", accent: "#D0B48A", mascot: { pose: "curious", x: 0.8 },
    photo: { file: "ask.jpg", x: 0.55, y: 0.5, zoom: 1.25, blur: 34, light: 0.7, warm: 0.5 },
    screen: { id: "bots.ask" },
    pop: { has: ["will take this", "Or hand it to"], union: true, pad: 6, nudge: 0.022 },
  },
  {
    key: "keybot", layout: "voice", title: "Say it, and\nKeybot *writes* it", accent: "#D9825E", bot: { name: "Keybot", line: "Writes for you, in any app" },
    photo: { file: "keybot.jpg", x: 0.38, y: 0.61, zoom: 1.4, light: 1.5, warm: 0.55 }, // y keeps the photo's bright strip (its top 23%) out of frame
    // The mic key under the words: the Peek-a-bot popped up and listening (ears and antenna lit), at this share of the width.
    keyArt: { mode: "listen", level: 0.6, size: 0.25 },
  },
  {
    key: "connect", layout: "tiles", title: "Works with the apps\nyou *already* use", mascot: { pose: "happy", tile: 1 },
    photo: { file: "connect.jpg", x: 0.45, y: 0.5, zoom: 1.05, blur: 22, light: 0.55, warm: 0.5 },
  },
  {
    key: "plan", title: "Your day,\n*planned* for you", mascot: { pose: "happy", x: 0.78 }, accent: "#D2A24A", bot: { name: "Plan", line: "Your day, planned" },
    photo: { file: "plan.jpg", x: 0.4, y: 0.35, zoom: 1, light: 0.5, warm: 0.45 },
    screen: { id: "bots.plan", api: (a) => ({ [PLAN_KEY]: { ...a[PLAN_KEY], travel: { ...a[PLAN_KEY].travel, credits: [] } } }) },
    pop: { has: ["Leave home by", "Dinner with Mom"], union: true, pad: 4, nudge: -0.016 },
  },
  {
    // Google Play's set leaves this one out: the meetings are noted on the computer, so it says least on a phone.
    key: "notes", title: "Every meeting,\n*written up*", mascot: { pose: "shy", x: 0.8 }, accent: "#B48AB0", bot: { name: "Notes", line: "Meetings, written up" }, play: false,
    photo: { file: "notes.jpg", x: 0.5, y: 0.45, zoom: 1, light: 0.5, warm: 0.45 },
    screen: { id: "bots.note", params: { id: "n1" }, api: { "GET /v1/notes/n1": { note: NOTE, finding: false }, "GET /v1/botsapp/calendar/notes/n1": { todos: { t2: { id: "c-t2", done: false } } } } },
    pop: { has: ["Order 200 gift boxes", "Send the team the final plan"], card: true, bare: true }, fade: true,
  },
  {
    key: "travel", title: "Your trips,\nall *sorted*", mascot: { pose: "starry", x: 0.78 }, accent: "#6FA3C7", bot: { name: "Travel", line: "Trips, sorted" },
    photo: { file: "travel.jpg", x: 0.5, y: 0.4, zoom: 1, light: 0.55, warm: 0.4 },
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
    key: "code", title: "Ship code\nby *asking*", mascot: { pose: "curious", x: 0.78 }, accent: "#7FAF62", bot: { name: "Code bot", line: "Builds and fixes your code" }, play: false,
    photo: { file: "code.jpg", x: 0.47, y: 0.5, zoom: 1, light: 0.55, warm: 0.4 },
    // Code bot's home: what it is on, what needs you, your projects. The projects' framework and language names are left out.
    screen: {
      id: "bots.code.start", variant: "home", params: { step: "home" },
      api: (a) => Object.fromEntries(Object.entries(a).filter(([k]) => k.endsWith("/brain")).map(([k, v]) => [k, { ...v, structure: { ...v.structure, frameworks: [], languages: [] } }])),
    },
    pop: { has: ["Round the cart total", "Per item"], card: true, bare: true, nudge: -0.012 },
  },
  {
    key: "spaces", title: "Your people,\nin *sync*", mascot: { pose: "happy", x: 0.78 }, accent: "#5E9C88", bot: { name: "Spaces", line: "Family and friends" },
    // A grandmother's hand and a baby's, above the card: the card starts lower to give the photo room.
    photo: { file: "spaces.jpg", x: 0.53, y: 0.5, zoom: 1.2, light: 0.75, warm: 0.6 }, cardTop: 0.47,
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
    key: "make", title: "Make a bot\nof your *own*", mascot: { pose: "wink", x: 0.78 }, accent: "#C8B48E", bot: { name: "Your own", line: "Made by you, in a sentence", own: true },
    photo: { file: "make.jpg", x: 0.5, y: 0.5, zoom: 1, light: 0.55, warm: 0.5 },
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
];

/** The Play feature graphic (1024 x 500): this frame's photo and screen, and these words. */
export const FEATURE = {
  title: "Players that make\nyour life *easy*",
  frame: "team",
  /** The photo's place on the wide graphic (over the frame's own): the phone in it sits behind the card. */
  photo: { x: 0.33, y: 0.5, zoom: 1.6, blur: 4 },
};
