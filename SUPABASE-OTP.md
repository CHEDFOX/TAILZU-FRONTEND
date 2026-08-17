# Supabase email OTP — send a 6-digit CODE, not a magic link

The app's sign-in (`signInWithOtp` → round code boxes → `verifyOtp(type: "email")`)
expects the email to carry a **6-digit code**. Supabase decides code-vs-link purely
by the EMAIL TEMPLATE: if the template contains `{{ .ConfirmationURL }}` the user
gets a magic link; if it contains `{{ .Token }}` they get the code. No app or
backend change involved — this is dashboard config.

## Where

Supabase dashboard → **Authentication → Email Templates**.

Update **Magic Link** (sent to existing users on `signInWithOtp`) and — so brand-new
signups get a code too — **Confirm signup**. Paste the same body into both.

## Subject

```
Your Tailzu code: {{ .Token }}
```

(Code in the subject = visible from the notification banner without opening the mail.)

## Body (paste as the template's HTML)

```html
<div style="background:#000000;padding:48px 0;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:420px;margin:0 auto;padding:36px 28px;text-align:center">
    <p style="color:#ffffff;font-size:15px;font-weight:600;letter-spacing:.3px;margin:0">
      Your Tailzu sign-in code
    </p>
    <p style="color:#E8A23C;font-size:40px;font-weight:700;letter-spacing:10px;margin:22px 0 0">
      {{ .Token }}
    </p>
    <p style="color:#8a8a8e;font-size:13px;line-height:1.7;margin:26px 0 0">
      Type this code in the app. It expires in 60 minutes.<br>
      Didn&rsquo;t request it? You can safely ignore this email.
    </p>
  </div>
</div>
```

Notes:

- **Do not leave `{{ .ConfirmationURL }}` anywhere in the template** — if both are
  present the email still carries a tappable link, and people tap links instead of
  typing codes.
- The code is 6 digits (matches the app's `CODE_LEN = 6`) and expires per
  **Auth → Providers → Email → OTP expiry** (default 3600s — fine).
- Rate limit: Supabase sends at most one auth email per address per 60s by default.
  The app now surfaces that error verbatim ("email rate limit exceeded") instead of
  a silent shake.
- Deliverability: the project should have custom SMTP (Resend) configured under
  **Project Settings → Auth → SMTP** — Supabase's built-in sender is heavily
  rate-limited (~2 emails/hour) and lands in spam.
