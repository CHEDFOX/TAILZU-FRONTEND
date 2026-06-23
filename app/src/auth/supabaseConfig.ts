/**
 * Supabase project configuration for the Tulmi app.
 *
 * Both values below are the PUBLIC client credentials. The anon key is designed
 * to be embedded in the client app — it only allows what Row-Level Security lets
 * it, and it is what the app uses to sign users in. The SECRET service-role key
 * lives ONLY on the backend (tulmi/.env) and is never shipped here.
 *
 * To point the app at a different Supabase project, change these two lines.
 */
export const SUPABASE_URL = "https://merzyohecmyfvlyahxaz.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lcnp5b2hlY215ZnZseWFoeGF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMjU1MzAsImV4cCI6MjA5NzgwMTUzMH0.scDhHeRU20wRIgKBFL8GouIEp8bJG8w8aIsySUkePHY";

/** True only when both values are filled in (lets the app degrade gracefully). */
export const SUPABASE_CONFIGURED =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
