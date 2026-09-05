# Tailzu Launch Runbook

Everything code-side is on **`main`** and green. What is left is deploy, store
console work, and — the part with no substitute — actually using the builds.

Current baseline: backend `tsc` clean + **225/225 tests**, frontend `tsc` at its
2-error cosmetic baseline, iOS keyboard CI green under `-application-extension`
(the real build's rules), Android keyboard CI green, desktop installers building
on GitHub runners.

Build stamps: iOS **K25**, Android **A5**.

> **Read this before cutting builds.** Neither stamp has ever run on a device.
> CI type-checks; it does not launch anything. The Apple-mic bug — the system
> mic glyph appearing on our own keyboard — passed every CI run and was only
> caught by looking at a screenshot. Install to TestFlight and Play internal
> testing, use both for a day, and submit after that. Not before.

---

## 0. Backend first (one deploy powers all four platforms)

```bash
cd ~/tulmi
git pull origin main
# fill NEW vars in tulmi/.env — see .env.example:
#   ADMIN_SECRET, STATIC_BEARER_TOKENS, SUPABASE_JWT_SECRET,
#   ANDROID_SIGNING_SHA256   (Play Console → App integrity)
#   SARVAM_STT_MODEL=saaras:v3   (saarika:v2.5 is deprecated)
#   FREE_MONTHLY_WORDS=2500      (the free tier; see below)
#   FREE_MONTHLY_AUDIO_SECONDS=0 (words are the only meter)
docker compose up -d --build
# wait healthy, then:
SECRET=$(docker compose exec -T backend printenv ADMIN_SECRET | tr -d '\r\n')
curl -X POST http://127.0.0.1:8770/v1/admin/cache/bump -H "x-admin-secret: $SECRET"
```

Then run both migrations in the Supabase SQL editor, in order:
`0006_keyboard_telemetry.sql`, `0007_profile_identity.sql`. Without 0006 the
keyboards report nothing and every question about whether a change helped stays
unanswerable.

### The free tier

**2,500 words refined per month.** Words written, not minutes spoken — someone
who dictates slowly is not costing more than someone who dictates fast.

`FREE_MONTHLY_WORDS` is enforced by the server AND served to the app as
`quota.freeMonthlyWords`, so the progress the user sees and the wall they hit
are the same number. Change it in one place; both follow. `0` = unlimited.

### Monetization switches (flip together at launch)

- `paywall.showAfterOnboarding: true` in `catalog.ts` — OTA, no build.
  **Apple review must be able to reach the purchase**, so this has to be on
  before you submit, with the IAPs attached to the version.
- The word cap above is what makes the paywall mean anything. A paywall with no
  cap behind it is a screen nobody has a reason to read.

## 1. iOS (App Store)

1. Build once from the branch tip: `cd app && eas build -p ios --profile production --auto-submit`
   (needs EAS quota; local `--local` builds need a Mac).
2. Install → **reload dance**: Settings → Keyboards → delete Tailzu → re-add →
   Allow Full Access → restart the phone → open Tailzu once.
3. Verify delivery: flip `kb.buildStamp.enabled: true` (OTA + cache bump) → the
   orange **`K25`** appears on the keyboard → proves new binary AND live OTA →
   flip back false. A stamp that reads anything else means the build did not
   land, and nothing below is worth testing yet.
4. `kb.flow.armOnForeground` is already `true`. Confirm the mic works from the
   keyboard without reopening the app: open Tailzu, swipe away, then dictate
   from the keyboard somewhere else. That path was broken until K25 (a cold
   launch fires no AppState transition, so nothing armed) — it is the single
   most valuable thing to check on the first install.
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

### If review rejects on the microphone

The likely objection is the background recording indicator. The answer, in the
review notes and again in any reply:

> iOS forbids a keyboard extension from recording audio — `AVAudioRecorder`
> returns false inside one even with Full Access. So the app holds the
> microphone in the background and the keyboard drives it, which is the same
> architecture Wispr Flow uses. The orange indicator is that session, it is
> user-initiated, and the user can end it from inside the app at any time.

Have that written down before you submit rather than after a rejection.

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

5. **Play needs an IME declaration.** A keyboard app is asked to confirm it
   does not collect what users type. Tailzu's answer is genuinely no: the
   telemetry is counters only — integers per named event, with no API anywhere
   that accepts a string of user text, and the server rejects any counter name
   it does not know. Say that plainly; it is unusually easy to defend.

6. **Data Safety, concretely.** Audio is *processed* and not stored; refined
   text is stored only when the user turns history on; no advertising ID; no
   data sold. Those answers are what the code actually does — do not soften
   them into something vaguer, because a mismatch found later is a policy
   problem rather than a form problem.

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
