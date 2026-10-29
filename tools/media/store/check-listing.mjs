// Checks docs/store-listing.md: every field's length against its store's limit, and the store rules.
//
//   node tools/media/store/check-listing.mjs           # check, print a table; exits 1 on any problem
//   node tools/media/store/check-listing.mjs --write   # also rewrite each heading's count ("· 27 / 30")
//
// A field is a heading "### <name> · <n> / <limit>" followed by a ```text block; the block's text is the field, exactly
// (its last newline is not part of it). Characters are counted as the stores count them: one per character (code point),
// a line break is one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOC = path.resolve(HERE, "../../../docs/store-listing.md");
const write = process.argv.includes("--write");

const src = fs.readFileSync(DOC, "utf8");
const FIELD = /^(#{3,4}) (.+?) · (\d+) \/ (\d+)[ \t]*\n+```text\n([\s\S]*?)\n```/gm;

/** What no field may say (store rules): money, other companies and apps, superlatives, things not in the build. */
const RULES = [
  ["money or a price", /₹|\$|€|£|\bRs\.?\s?\d|\bINR\b|\bUSD\b|\d+\s?(rupees|paise)\b|\bper month\b.*\d|\bprice[sd]? (is|are|at|from)\b/i],
  ["another company or app", /\b(google|gmail|whatsapp|github|gitlab|slack|notion|iphone|ipad|android|mac\s?book|macos|windows|microsoft|uber|ola|irctc|booking\.com|makemytrip|airbnb|openstreetmap|chatgpt|openai|gemini|claude|siri|alexa|wispr|grammarly|gboard|swiftkey|instagram|facebook|youtube|zoom|razorpay|upi|paytm|phonepe|gpay|tailzu)\b/i],
  ["a superlative or ranking", /\b(best|#\s?1|number one|top[- ]rated|world'?s first|leading|award)/i],
  ["something not in the build", /\b(coming soon|soon|image generation|video generation|generate (images|videos)|images? bot|video bot)\b/i],
  ["a review or testimonial", /★|⭐|"[^"]{0,60}" ?[-—] ?[A-Z][a-z]+ [A-Z]\.|\btestimonial|\breviews? say/i],
];
/** Fields where store words are expected and allowed (the review notes are not shown on the store). */
const ALLOW = { "another company or app": /review notes|app access/i };

const fields = [];
let m;
while ((m = FIELD.exec(src))) {
  const [whole, hashes, name, , limit, body] = m;
  fields.push({ whole, hashes, name: name.trim(), limit: Number(limit), body, count: [...body].length, at: m.index });
}

const problems = [];
for (const f of fields) {
  if (f.count > f.limit) problems.push(`${f.name}: ${f.count} characters, over its ${f.limit}`);
  if (!f.body.trim()) problems.push(`${f.name}: empty`);
  for (const [what, re] of RULES) {
    if (ALLOW[what]?.test(f.name)) continue;
    const hit = f.body.match(re);
    // A link to the site's own pages is not a price; "per month" alone (no figure) is fine.
    if (hit) problems.push(`${f.name}: ${what}: "${f.body.slice(Math.max(0, hit.index - 20), hit.index + hit[0].length + 20).replace(/\n/g, " ")}"`);
  }
  if (/keywords/i.test(f.name)) {
    if (/,\s/.test(f.body) || /\s,/.test(f.body)) problems.push(`${f.name}: a space next to a comma`);
    const words = f.body.split(",").map((w) => w.trim().toLowerCase());
    const dup = words.filter((w, i) => words.indexOf(w) !== i);
    if (dup.length) problems.push(`${f.name}: repeated: ${dup.join(", ")}`);
    const name = fields.find((x) => /^app name/i.test(x.name));
    const sub = fields.find((x) => /^subtitle/i.test(x.name));
    const taken = new Set(`${name?.body ?? ""} ${sub?.body ?? ""}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const again = words.flatMap((w) => w.split(/[^a-z0-9]+/)).filter((w) => taken.has(w));
    if (again.length) problems.push(`${f.name}: words already in the name or subtitle (indexed there already): ${[...new Set(again)].join(", ")}`);
  }
  if (/url/i.test(f.name) && !/^https:\/\/\S+$/.test(f.body)) problems.push(`${f.name}: not one https link`);
}

const pad = Math.max(...fields.map((f) => f.name.length));
for (const f of fields) console.log(`${f.count > f.limit ? "OVER" : "ok  "}  ${f.name.padEnd(pad)}  ${String(f.count).padStart(4)} / ${f.limit}`);
if (problems.length) console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
else console.log(`\n${fields.length} fields, all within their limits and the store rules.`);

if (write) {
  let out = src;
  for (const f of fields.slice().reverse()) {
    const head = `${f.hashes} ${f.name} · ${f.count} / ${f.limit}`;
    const fixed = f.whole.replace(/^#{3,4} .+? · \d+ \/ \d+/, head);
    out = out.slice(0, f.at) + fixed + out.slice(f.at + f.whole.length);
  }
  if (out !== src) { fs.writeFileSync(DOC, out); console.log("counts written into the headings."); }
}
process.exit(problems.length ? 1 : 0);
