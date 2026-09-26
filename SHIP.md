# Shipping Tailzu

The day-to-day commands, from the Windows machine. Everything is on the
branch `claude/repo-analysis-verdict-6lpyaw` in all three repos, and the
VPS pulls that branch directly.

## Backend

One deploy powers the phones, the desktop and the site. Anything the server
creates — the keyboard's screens, the mic key's mark and its program, the
site's words — ships here and needs no build anywhere else.

```powershell
ssh root@91.108.104.168 'cd ~/tulmi && git pull --ff-only && ./deploy/ship.sh'
```

Check without deploying:

```powershell
ssh root@91.108.104.168 'cd ~/tulmi && CHECK=1 ./deploy/ship.sh'
```

## Site

tailzu.space is on Vercel, deployed from GitHub: a push to the branch is the
deploy. Nothing is copied to the VPS. (`vercel.json` proxies `/v1/*`,
`/download`, `/downloads/*`, `/privacy`, `/terms` and `/.well-known/*` to
the API.)

```powershell
cd C:\Users\user\tailzu-web
git pull --rebase origin claude/repo-analysis-verdict-6lpyaw
git push origin claude/repo-analysis-verdict-6lpyaw
```

Vercel builds it in under a minute; the deployment shows on the Vercel
dashboard.

## Phones

Only for changes to the app or the keyboards themselves. iOS goes to
TestFlight by itself; the Android build is uploaded in Play Console by hand.

Everything a rule in the control console (`/admin` on the API) can change
needs no build at all. The keyboards carry a copy of the server's config
for their very first open (`default-config.json`, and
`tailzu_default_config.json` on Android). It is refreshed in the repo from
the backend (`npx tsx scripts/export-keyboard-snapshots.ts`), so there is
nothing to do for it here.

```powershell
cd C:\Users\user\tulmi
git pull --rebase origin claude/repo-analysis-verdict-6lpyaw
cd app
npx eas-cli build --platform ios --profile production --auto-submit --no-wait
npx eas-cli build --platform android --profile production --no-wait
```

If the pull refuses because of `desktop/package-lock.json`, it is the last
`npm install`; drop it first: `git checkout -- desktop/package-lock.json`.

## Desktop, and the site's download

The Windows installer is built here and copied to the server, where the
download page finds it by name. The Mac installer needs a Mac
(`npm run dist:mac` → `Tailzu.dmg`, same copy).

```powershell
cd C:\Users\user\tulmi\desktop
npm install
npm run dist:win
scp "dist\Tailzu-Setup.exe" root@91.108.104.168:~/tulmi/downloads/
```

## Check

```powershell
ssh root@91.108.104.168 'cd ~/tulmi && CHECK=1 ./deploy/ship.sh'
```

Every line reads PASS: the site, the installer, payments, bootstrap.
