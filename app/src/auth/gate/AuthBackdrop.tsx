import { MediaPlayer } from "../../media/MediaPlayer";
import type { AuthBackground } from "../../sdui/client";
import { FILL } from "./look";

/**
 * The uploaded backdrop. A still or a clip, whichever was uploaded.
 *
 * MediaPlayer rather than a hand-rolled branch: it already decides image vs
 * video from contentType first and the extension second, which is the check
 * that kept the intro black for a week when it was done the other way round.
 * Reusing it means this screen cannot reacquire that bug independently.
 *
 * Silent, looping, and never interactive. It fails to NOTHING rather than to an
 * error box — this is the sign-in screen, so a backdrop that cannot load must
 * cost someone a plain background, never the ability to get into the app.
 */
export function AuthBackdrop({ background }: { background: AuthBackground }) {
  return (
    <MediaPlayer
      spec={{ url: background.url, contentType: background.contentType }}
      contentFit={background.fit}
      autoplay
      loop
      muted
      style={FILL}
    />
  );
}
