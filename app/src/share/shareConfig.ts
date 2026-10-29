/**
 * THE iOS SHARE EXTENSION'S CARD, FROM THE SERVER.
 *
 * The extension (targets/share/ShareViewController.swift) cannot read the bootstrap: it runs in another app's
 * Share menu, before Tailzu is open. So, as for the widgets (widgets/month.ts), the app writes what it shows to
 * the App Group every time a bootstrap lands: its four lines, its limits and its look. The extension reads each
 * over its own literal, and only ever LOWERS a limit (what it has is the most its memory holds).
 *
 * Each fallback here is the literal the extension keeps, so nothing changes until the server says so.
 */
import { Platform } from "react-native";
import { setShareConfig, type ShareConfig } from "../../modules/tulmi-share";
import { color, num, txt } from "../sdui/knobs";

/** The block, as the knobs in hand say it. */
export function shareConfig(): ShareConfig {
  return {
    v: 1,
    words: {
      opening: txt("share.ext.opening", "Opening Tailzu…"),
      tooBig: txt("share.ext.tooBig", "That's too big for Tailzu."),
      cantTake: txt("share.ext.cantTake", "Tailzu can't take this one."),
      saved: txt("share.ext.saved", "Saved. Open Tailzu to send it."),
    },
    limits: {
      maxFiles: num("share.ext.maxFiles", 5),
      maxBytes: num("media.maxBytes", 52428800),
      maxText: num("share.ext.maxText", 6000),
      maxPixels: num("share.ext.maxPixels", 4096),
      closeMs: num("share.ext.closeMs", 1600),
    },
    card: {
      background: color("share.ext.cardColor", "#FFFFFF"),
      ink: color("share.ext.inkColor", "#0A0A0A"),
      dim: num("share.ext.dimAlpha", 0.2),
      radius: num("share.ext.radius", 20),
    },
  };
}

/** Write it where the extension reads it. iOS only; after the bootstrap's knobs are the ones in hand. */
export function publishShareConfig(): void {
  if (Platform.OS !== "ios") return;
  setShareConfig(shareConfig());
}
