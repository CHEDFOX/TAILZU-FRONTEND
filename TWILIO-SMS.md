# SMS sign-in — Twilio → Supabase

The app's phone pill (`signInWithOtp({ phone })` → the same round code boxes →
`verifyOtp(type: "sms")`) is already built: country picker seeded from the
device locale, E.164 assembly, phone-pad input. Nothing in the app needs to
change. What's missing is an SMS provider behind Supabase, and one flag.

Two steps, in this order. Do NOT flip the flag first — a user who picks the
phone pill with no provider configured gets a dead end.

---

## 1. Twilio → Supabase

Supabase dashboard → **Authentication → Providers → Phone** → enable, then pick
an SMS provider.

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

| Supabase field | Twilio console |
|---|---|
| Account SID | Account Info on the dashboard home (`AC…`) |
| Auth Token | same panel — reveal it |
| Message Service SID | **Verify → Services → your service** (`VA…`) |

Create the Verify service first (Verify → Services → Create), name it `Tailzu`,
and turn OFF every channel except SMS unless you want voice fallback.

### India (read this before testing)

India's TRAI **DLT** regime governs A2P SMS: an Indian recipient will not
receive commercial SMS from an unregistered sender. This is regulator-side, not
Twilio-side — no amount of Twilio config bypasses it, and the failure mode is
silent (Twilio reports the message accepted, the phone never buzzes).

Confirm with Twilio support what your account needs for Indian delivery on
Verify **before** you launch phone sign-in to Indian users. If registration is
required, it takes days, not hours. Until it's confirmed working, test on a
non-Indian number so you're not debugging a regulator.

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
