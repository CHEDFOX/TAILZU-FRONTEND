# SMS sign-in — Twilio → Supabase

The app's phone pill (`signInWithOtp({ phone })` → the same round code boxes →
`verifyOtp(type: "sms")`) is already built: country picker seeded from the
device locale, E.164 assembly, phone-pad input. Nothing in the app needs to
change. What's missing is an SMS provider behind Supabase, and one flag.

Two steps, in this order. Do NOT flip the flag first — a user who picks the
phone pill with no provider configured gets a dead end.

---

## 1. Twilio → Supabase

Supabase dashboard → **Authentication → Configuration → Providers → Phone**
(older projects: Authentication → Providers → Phone) → toggle the Phone
provider on, then pick from the **SMS Provider** dropdown.

### Which Twilio product

Supabase offers **Twilio** (Programmable Messaging) and **Twilio Verify** as
separate options. Use **Twilio Verify**.

Verify generates, delivers, expires and rate-limits the code itself. That means
Supabase sends "verify this number" rather than "send this exact text", and
Twilio picks the channel and the sender that actually works in the recipient's
country. For a product whose users are largely in India, that difference is the
whole ballgame — see the India note below.

### Credentials

Twilio console → the values Supabase asks for:

Create the Verify service FIRST — the SID it hands you is the third field.
Twilio console → **Verify → Services → Create new** → name it `Tailzu` → enable
**SMS** as a verification channel (leave the rest off unless you want voice
fallback). The `VA…` on the next screen is the one you need.

With `SMS Provider: Twilio Verify` selected, Supabase asks for exactly three
values:

| Supabase field | Where in Twilio |
|---|---|
| Twilio Account SID | Console home → Account Info (`AC…`) |
| Twilio Auth Token | same panel — reveal it |
| Twilio Verify Service SID | the service you just made (`VA…`) |

Note the difference from the plain **Twilio** provider: that one wants a
*Messaging* Service SID (`MG…`) and makes you write the SMS body yourself in a
required **SMS Message** field. Verify owns the message, so that field is not
part of this path — one less thing to get wrong, and one less thing to register
in India.

While you are on the page: **OTP expiry** and **OTP length** live here too. The
app's code boxes are fixed at 6 (`CODE_LEN`), so leave length at 6 or the
verify screen will not accept a full code.

### India (read this before testing)

India's TRAI **DLT** regime governs A2P SMS: an Indian recipient will not
receive commercial SMS from an unregistered sender. This is regulator-side, not
Twilio-side — no amount of Twilio config bypasses it, and the failure mode is
silent (Twilio reports the message accepted, the phone never buzzes).

Concretely, DLT wants three things registered: a **Principal Entity** (your
business), a **Header** / sender ID, and every **content template**. Entity and
header are yours to register no matter which provider sends the message —
budget 7–10 business days. Verify may cover the template side, since Twilio
owns the message body on that path; confirm that with Twilio support rather
than assuming it.

Do this **before** you launch phone sign-in to Indian users, and test on a
non-Indian number until it is confirmed, so you are not debugging a regulator
while you are also debugging your own wiring.

### Rate limits

Supabase Auth caps SMS sends per hour project-wide (**Authentication → Rate
Limits**). The default is low enough to hit while testing on one number and it
fails as a generic error, so if codes stop arriving after a handful of tries,
look there before you suspect Twilio.

### Verify it works

Supabase's provider page has no test button. The real test:

1. Set `AUTH_ENABLE_PHONE=true` in `tulmi/.env` on a **staging** backend only.
2. Sign in with a real number on a build pointed at it.
3. Twilio console → **Monitor → Logs → Verify** shows the attempt and its
   outcome. A delivered-but-not-received code is the DLT symptom.

---

## 2. Turn it on

`tulmi/.env`:

```
AUTH_ENABLE_PHONE=true
```

Then `docker compose up -d --build`.

The backend serves `auth.enablePhone` in the bootstrap flags. The sign-in gate
reads it before there's a session (bootstrap is auth-optional) and adds the
phone pill under the email one. Off is the default and the safe state — flip it
back the moment SMS delivery goes bad in a region, and the pill disappears on
the next app launch with no build involved.

---

## Signing UP by phone

`shouldCreateUser: true` is set on the phone path, so a number that has never
been seen creates an account rather than being rejected. Two Supabase project
settings still have to allow it:

- **Authentication → Sign In / Providers → Allow new users to sign up** — global,
  and already on (email signup works).
- **Phone provider → Confirm phone** — verifying the SMS code confirms the
  number in the same step. No second confirmation screen exists in the app.

Nothing in our schema references an email address: profiles, personalities,
history, usage and telemetry all key on `user_id`. A phone-only account
onboards, trains a style portrait, and uses the keyboard exactly like an
email one.

## What a phone account looks like

Supabase creates a user with `phone` set and `email` null. Identity everywhere
in the backend is `user.id`, never the email, so nothing keys off the missing
address. The one place it surfaced was snippet expansion: a signature built
around `{email}` would quietly expand to nothing for these users, so `{phone}`
exists as the symmetric slot.

A user who signs in by email on one device and by phone on another gets **two
accounts** — Supabase does not merge identities across methods on its own, and
neither do we. If you want one person to reach the same style portrait either
way, that's account linking, and it's a separate piece of work.
