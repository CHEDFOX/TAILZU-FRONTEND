// THE STORE FRAMES, as data. build.mjs draws them; screens.mts renders each frame's app screen.
//
// One entry per frame, in story order. A new bot's frame is one more entry:
//   { key, kicker, title, sub, accent, bot: { name, line }, screen: { id, params?, api?, fake?, scroll?, state? } }
//   key      file name stem (lower case)
//   kicker   the small line over the headline: the bot's name
//   title    the headline, 2 to 5 words; "\n" forces a break, *word* sets a word in the serif italic
//   sub      one sentence under it: what the bot really does in this build (store rule: nothing that isn't in the build)
//   accent   the light behind the phone and the kicker's dot (the bot's colour, lifted for a dark ground)
//   bot      the bot's name and a few words, for the hero's roster and the feature graphic (leave out for a non-bot frame)
//   screen   which app screen, with the sample day's answers (samples/ in the backend's bots-render) and this frame's own over them:
//            api: { "GET /path": answer } or (answers) => ({ ... }) to change some; fake: the live state (bots, jobs, tasks);
//            scroll: points, or { to: "text" } to bring a part near the top
//   off      true keeps a frame defined but leaves it out of the exports (App Store takes 10, Google Play 8)
//
// Store rules the words and the screens keep (screens.mts checks the screens' visible text against RULES):
// no prices or amounts, no other company's or app's name, no "best"/"#1", no reviews or awards, nothing that isn't in the build.

export const BRAND = { name: "X0 Bot", accent: "#D08A5C" };

/** The app icon: the soft-3D bot the brand helper renders. The first file that exists is used (hero and feature graphic). */
export const ICON = {
  dir: "../brand/x0-icon/peek3d",
  /** Set to a path (relative to this folder) to force one. Otherwise: the README's pick, else the only icon-1024.png there. */
  file: null, // e.g. "../brand/x0-icon/peek3d/<variant>/icon-1024.png"
};

export const SIZES = {
  /** The phone the screens are drawn on, in points (screens.mts draws at 3x). `top` is the status bar's height. */
  phone: { w: 402, h: 874, top: 62, bottom: 34 },
  targets: [
    { dir: "ios-6.9", w: 1320, h: 2868, name: "App Store (iPhone 6.9\")", max: 10 },
    { dir: "ios-6.7", w: 1290, h: 2796, name: "App Store (iPhone 6.7\")", max: 10 },
    { dir: "play-phone", w: 1080, h: 1920, name: "Google Play (phone)", max: 8 },
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

export const FRAMES = [
  {
    key: "team", hero: true, kicker: "X0 Bot", accent: "#D08A5C",
    title: "Players that make\nyour life *easy*.",
    sub: "A team of bots, each great at one thing.",
    screen: {
      id: "bots.home", fake: HOME_DAY,
      // Home's own reads: no first-arrival card, no deletion date, the notifications ask already answered.
      api: { "GET /v1/bots/first-run/arrival": { due: false }, "GET /v1/account/deletion": { scheduled: null }, "GET /v1/bots/push-ask": { due: false } },
    },
  },
  {
    key: "keybot", kicker: "Keybot", accent: "#D9825E", bot: { name: "Keybot", line: "Writes for you, in any app" },
    title: "Say it.\nIt *writes*.",
    sub: "A voice keyboard that writes for you in any app, in the tone that fits.",
    screen: { id: "bots.keybot.tone" },
  },
  {
    key: "plan", kicker: "Plan", accent: "#D2A24A", bot: { name: "Plan", line: "Your day, planned" },
    title: "Your day,\n*planned*.",
    sub: "Your own calendar and to-dos, with the time it takes to get there.",
    screen: { id: "bots.plan", api: (a) => ({ [PLAN_KEY]: { ...a[PLAN_KEY], travel: { ...a[PLAN_KEY].travel, credits: [] } } }) },
  },
  {
    key: "notes", kicker: "Notes", accent: "#B48AB0", bot: { name: "Notes", line: "Meetings, written up" },
    title: "Every meeting,\n*written up*.",
    sub: "Meetings noted on your computer, written up with decisions and to-dos.",
    screen: { id: "bots.note", params: { id: "n1" }, api: { "GET /v1/notes/n1": { note: NOTE, finding: false }, "GET /v1/botsapp/calendar/notes/n1": { todos: { t2: { id: "c-t2", done: false } } } } },
  },
  {
    key: "travel", kicker: "Travel", accent: "#6FA3C7", bot: { name: "Travel", line: "Trips, sorted" },
    title: "Trips,\n*sorted*.",
    sub: "Travel times, weather and stays near where you'll be, in one place.",
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
      scroll: { to: "Pune · 14–16 Nov", offset: 6 },
    },
  },
  {
    key: "code", kicker: "Code bot", accent: "#7FAF62", bot: { name: "Code bot", line: "Builds and fixes your code" },
    title: "Ship code\nby *asking*.",
    sub: "It reads your project, works on a safe copy, and asks before anything goes live.",
    // Code bot's home: what it is on, what needs you, your projects. The projects' framework and language names are left out.
    screen: {
      id: "bots.code.start", variant: "home", params: { step: "home" },
      api: (a) => Object.fromEntries(Object.entries(a).filter(([k]) => k.endsWith("/brain")).map(([k, v]) => [k, { ...v, structure: { ...v.structure, frameworks: [], languages: [] } }])),
    },
  },
  {
    key: "spaces", kicker: "Spaces", accent: "#5E9C88", bot: { name: "Spaces", line: "Family and friends" },
    title: "Your people,\n*in sync*.",
    sub: "Share anything with family and friends, chat one-to-one or in groups, and give tasks.",
    screen: {
      id: "bots.spaces", variant: "home", params: { id: "s1" },
      api: (a) => {
        const k = `GET ${A}/spaces/s1`, d = a[k];
        const tasks = d.tasks.map((t) => (t.id === "t-cake" ? { ...t, notes: "The eggless one" } : t));
        return { [k]: { ...d, payments: [], tasks, space: { ...d.space, waiting: 0, activity: d.space.activity.filter((x) => x.kind !== "pay") } } };
      },
    },
  },
  {
    key: "make", kicker: "Your own bots", accent: "#C8B48E", bot: { name: "Your own", line: "Made by you, in a sentence", own: true },
    title: "Make your\nown *bot*.",
    sub: "Say what it should do. It joins your team, with your rules.",
    screen: {
      id: "bots.make",
      api: (a) => {
        const k = `GET ${A}/draft`, d = a[k].draft;
        const def = { ...d.draft.definition, skills: { ...d.draft.definition.skills, connectors: ["calendar"] } };
        return { [k]: { draft: { ...d, draft: { ...d.draft, definition: def, connectors: [{ id: "calendar", name: "Calendar", status: "connected" }] } } } };
      },
    },
  },
  {
    key: "ask", off: true, kicker: "Ask", accent: "#D0B48A",
    title: "Just ask.\nIt gets *done*.",
    sub: "Type or speak, in any mix of languages. The right bot picks it up.",
    screen: { id: "bots.ask" },
  },
];

/** The Play feature graphic (1024 x 500). */
export const FEATURE = {
  title: "Players that make\nyour life *easy*.",
  sub: "A team of bots, each great at one thing.",
  screen: "team",
};
