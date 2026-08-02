# Tailzu Launch Runbook

State after the full three-agent launch audit (backend, mobile native, desktop)
plus fixes. Everything **code-side is done and pushed**; each platform below
lists the exact remaining steps and which are yours (account/console work).

Baseline verified at audit time: backend `tsc` clean + **157/157 tests**,
frontend `tsc` at its 2-error cosmetic baseline, iOS keyboard CI green **with
`-application-extension` rules** (the real build's rules), Android keyboard CI
green, desktop installers (win/mac/linux) building on GitHub runners.

---

## 0. Backend first (one deploy powers all four platforms)

```bash
cd ~/tulmi
git pull origin claude/repo-analysis-verdict-6lpyaw
# fill NEW vars in tulmi/.env — see .env.example:
#   ADMIN_SECRET, STATIC_BEARER_TOKENS, SUPABASE_JWT_SECRET,
#   FREE_MONTHLY_AUDIO_SECONDS / FREE_MONTHLY_WORDS  (the server-side free tier),
#   ANDROID_SIGNING_SHA256  (from Play Console → App integrity)
docker compose up -d --build
# wait healthy, then:
SECRET=$(docker compose exec -T backend printenv ADMIN_SECRET | tr -d '\r\n')
curl -X POST http://127.0.0.1:8770/v1/admin/cache/bump -H "x-admin-secret: $SECRET"
```

Monetization switches (flip together at launch):
- `paywall.showAfterOnboarding: true` in `catalog.ts` (currently false while IAP
  products finish setup) — OTA.
- `FREE_MONTHLY_*` env caps — this is what makes the paywall *mean* something.

## 1. iOS (App Store)

1. Build once from the branch tip: `cd app && eas build -p ios --profile production --auto-submit`
   (needs EAS quota; local `--local` builds need a Mac).
2. Install → **reload dance**: Settings → Keyboards → delete Tailzu → re-add →
   Allow Full Access → restart the phone → open Tailzu once.
3. Verify delivery: flip `kb.buildStamp.enabled: true` (OTA + cache bump) → the
   orange `K1` appears on the keyboard → proves new binary AND live OTA →
   flip back false.
4. Tell the backend the build is live: set `kb.flow.armOnForeground: true`
   (warm-keeping — the Wispr model) — OTA.
5. App Store Connect before submitting for review:
   - Paid Apps Agreement **Active**.
   - IAPs `TAILZU_MONT` + `tailzu_annu` → **Ready to Submit**, attached to the
     app version (they're verified correct in RevenueCat: entitlement
     `TAILZU AIR`, offering `default`).
   - Re-enable the paywall (see §0) — review must be able to see the purchase.
   - Review notes: explain the background-audio Flow Session (keyboard
     extensions cannot record; the app holds the mic like Wispr Flow; the
     orange recording indicator is expected while a session is warm).
   - Privacy labels: mic + speech data, no tracking (`NSPrivacyTracking=false`).

## 2. Android (Play)

1. `cd app && eas build -p android --profile production` → manual upload to Play
   Console (no Android submit block in eas.json — add one later if wanted).
2. Play Console: Data Safety form (mic audio processed, not sold; no tracking —
   AD_ID permission was removed), content rating, and the keyboard/IME
   declaration if prompted. Permission list is now minimal (RECORD_AUDIO,
   INTERNET, POST_NOTIFICATIONS, VIBRATE, ACCESS_NETWORK_STATE, BILLING).
3. Copy the **App integrity → App signing key SHA-256** into
   `ANDROID_SIGNING_SHA256` on the backend (fixes assetlinks.json / App Links).
4. Play Billing: react-native-purchases 10.4.1 bundles Play Billing 8 — the
   Aug 2026 requirement is already satisfied. Create matching products in Play
   Console + RevenueCat (Google project) before enabling the paywall on Android.

## 3. Windows + 4. macOS (site distribution)

Installers build on GitHub runners — no local machines needed:

1. GitHub → Actions → **desktop-build** → latest green run → download artifacts
   `Tailzu-Setup.exe` (win) and `Tailzu.dmg` (mac — universal: Intel + Apple
   Silicon).
2. Publish: `scp Tailzu-Setup.exe Tailzu.dmg root@SERVER:~/tulmi/downloads/`
3. `https://tailzu.space/download` goes live per-file automatically (OS-detected
   buttons; missing platforms show "coming soon").

Known gaps (acceptable for early access, fix before wide marketing):
- **Unsigned binaries**: Windows shows SmartScreen ("More info → Run anyway");
  macOS 15 requires Settings → Privacy & Security → "Open Anyway". Fix =
  code-signing cert (Windows) + Developer ID cert & notarization (macOS — you
  already pay for the Apple Developer account; say the word and the CI gets a
  signing step).
- **Desktop onboarding is token-based**: users paste a `STATIC_BEARER_TOKENS`
  entry into config. Fine for testers; public users need in-app sign-in
  (Supabase email/Google) — next build-out.
- Live captions mode (`live: true`) requires `DEEPGRAM_API_KEY` on the backend;
  batch mode works without it.

## Verification loop (how we know a change landed — any platform)

1. **Binary**: bump/see the build stamp (`kb.buildStamp.enabled`, OTA-gated).
2. **OTA**: deploy + cache bump + reopen — the keyboard/app re-fetches live.
3. **CI**: keyboard-ios (extension-API rules ON), keyboard-android,
   desktop-build must be green on the branch tip before cutting any build.
