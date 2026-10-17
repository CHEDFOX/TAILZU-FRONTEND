#!/usr/bin/env node
/**
 * Is app.config.ts's version higher than the one live on the App Store?
 *
 * Apple refuses an upload whose CFBundleShortVersionString is not higher than
 * the last approved version (errors 90062 / 90186), and says so only after the
 * build has been made and sent: half an hour of a Mac runner, then a failed
 * submit. This asks the App Store first and stops the run in seconds.
 *
 *   node tools/ci/ios-version.mjs
 *
 * The store is asked through Apple's public lookup, so no key is needed. If it
 * cannot be reached the run goes on, with a warning: a check that cannot run
 * must not be what stops a release.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_STORE_ID = "6784811357";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../../app/app.config.ts"), "utf8");
const ours = /^\s*version:\s*"([\d.]+)"/m.exec(src)?.[1];
if (!ours) {
  console.log("::error::No version found in app/app.config.ts.");
  process.exit(1);
}

/** 8.10 is higher than 8.9: compared part by part, as numbers. */
const higher = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
};

let live = "";
for (const country of ["us", "in"]) {
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=${country}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const v = (await res.json())?.results?.[0]?.version;
    if (typeof v === "string" && /^[\d.]+$/.test(v) && (!live || higher(v, live))) live = v;
  } catch {
    // try the next storefront
  }
}

if (!live) {
  console.log(`::warning::Could not read the App Store's version, so ${ours} was not checked against it.`);
} else if (!higher(ours, live)) {
  console.log(
    `::error title=Version too low for the App Store::app/app.config.ts says ${ours}, but ${live} is live on the App Store. ` +
      `Apple only takes a higher version: set version to something above ${live} and run again.`,
  );
  process.exit(1);
} else {
  console.log(`version ${ours} is above the App Store's ${live}`);
}
