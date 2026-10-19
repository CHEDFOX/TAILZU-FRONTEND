# A day for the desk's pages

The "Time back" and "Voices" films show the desktop app's own Today and
Voices pages. The Today page computes its figures from a person's
history and usage, so for the film it is drawn against a throwaway copy
of the backend whose in-memory stores hold one Sunday of dictations,
with its clock held at Sunday 18 October 2026, 11:48 PM in India.
Nothing here touches the real backend or any database.

1. Copy the backend somewhere disposable, without its `node_modules`,
   and link the real one in:

       mkdir -p /tmp/be && (cd TAILZU-BACKEND && tar --exclude=tulmi/node_modules -cf - tulmi shared) | (cd /tmp/be && tar -xf -)
       ln -s "$PWD/TAILZU-BACKEND/tulmi/node_modules" /tmp/be/tulmi/node_modules

2. In the copy only, three small changes:
   - `src/auth/supabase.ts`: the dev user's id `"dev-user"` becomes
     `"static-film"`, so the usage meter keeps its events in memory.
   - `src/history/store.ts`, appended:
     `export function __filmSeed(userId: string, rows: any[]): void { memoryRows(userId).push(...rows); }`
   - `src/usage/metering.ts`, appended:
     `export function __filmUsage(userId: string, events: { at: number; audioSeconds: number; words: number }[]): void { memUsage.set(userId, events); }`

3. Put `film-day.ts` in the copy's `src/` and start it in place of the server:

       cd /tmp/be/tulmi && DEV_SKIP_AUTH=true OPENROUTER_API_KEY=film OPENAI_API_KEY=film \
         STT_PROVIDER=openai PORT=8788 HOST=127.0.0.1 npx tsx src/film-day.ts

4. Capture the pages (the browser in India's time zone, its clock at the backend's):

       MODE=today  BASE=http://127.0.0.1:8788 CLOCK=2026-10-18T18:18:30Z node tools/media/capture-desk.mjs
       MODE=voices BASE=http://127.0.0.1:8788 CLOCK=2026-10-18T18:18:30Z node tools/media/capture-desk.mjs

The seeded Sunday is 28 dictations and 2,485 words; the page itself says
46 minutes back (said 17 min against typed 1 h 02 at 40 wpm) and a 14-day
streak. The counter between the film's stops is that same day's running
total.

## A meeting, for the note page

The "Bleeped" film ends on the note Tailzu made of a real meeting (AMI's
ES2002a, `meeting/README.md`), drawn by the desktop app's own note page. In
the same throwaway copy:

1. `src/notes/store.ts`, appended:
   `export function __filmNote(userId: string, note: Note): void { mem(userId).push(note); }`
2. `python3 tools/media/meeting/note-seed.py` writes `note-seed.json` here:
   the meeting's own words in turns, the project manager (who took the
   note) as "You", the others "Speaker 1" to "Speaker 3". Put it and
   `film-note.ts` in the copy's `src/`, and start that in place of the server:

       cd /tmp/be/tulmi && NODE_ENV=development DEV_SKIP_AUTH=true OPENROUTER_API_KEY=film OPENAI_API_KEY=film \
         STT_PROVIDER=openai PORT=8789 HOST=127.0.0.1 npx tsx src/film-note.ts

3. Capture the page:

       MODE=note BASE=http://127.0.0.1:8789 CLOCK=2026-10-19T06:32:30Z node tools/media/capture-desk.mjs

The note's title, paragraph and seven highlights were written by hand, in
the writer's own form (`src/notes/organise.ts`), from what was said: the
writer needs a model key the copy does not have. Everything under "The
conversation in numbers" is the page's own arithmetic on the real
transcript: 147 words a minute, 4 voices, 163 turns, 33 questions.
