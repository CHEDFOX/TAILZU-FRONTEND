// node run.mjs script.js [out.json]
// Runs script.js in a page that has KIT and BF (see page.html) as the body of an
// async function; whatever it returns is written as JSON (or printed).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const [script, out] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const p = await b.newPage();
p.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
p.on("console", (m) => console.error("console:", m.text()));
await p.goto("file://" + here + "/page.html");
await p.waitForFunction(() => window.ready === true);
const body = fs.readFileSync(script, "utf8");
const res = await p.evaluate(async (src) => { const f = new Function("KIT", "BF", `return (async () => { ${src} })();`); return await f(window.KIT, window.KIT.BF); }, body);
await b.close();
const json = JSON.stringify(res);
if (out) { fs.writeFileSync(out, json); console.log("wrote", out, json.length, "bytes"); } else console.log(json);
