/**
 * Sharing into Tailzu, wired to the app: when something was shared from
 * another app, take it (modules/tulmi-share), send its files to the backend
 * and open the share-in screen (shareIn.ts has the order; this has the when).
 *
 * WHEN: the moment the app is ready (a share that cold-started it), every
 * time it comes to the front (iOS hands over through the App Group, then opens
 * tulmi://share), on that link itself, and on Android's "onShare" (a share
 * delivered to the running app). Each share is taken once, so the triggers
 * may overlap freely; one run at a time.
 *
 * Only while signed in and booted (`ready`): before that, the share waits
 * where the native side keeps it.
 */
import { useCallback, useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { addShareListener, consumeShared } from "../../modules/tulmi-share";
import { getBaseUrl } from "../storage";
import { commonHeaders } from "../sdui/client";
import { flagOn, num, str, txt } from "../sdui/knobs";
import { runShareIn, type ShareIO, type SharedFile } from "./shareIn";

export interface ShareInHost {
  /** Signed in, booted, a screen up. */
  ready: boolean;
  /** Push a screen. */
  open(screenId: string, params: Record<string, string>): void;
  toast(message: string, tone?: string): void;
}

/** tulmi://share, which the iOS share extension opens. */
const isShareLink = (url: string) => /^tulmi:\/\/share(?:[/?#]|$)/i.test(url);

/** POST /v1/files, multipart, one `file` part, as the signed-in person (the transcribe upload's way: api.ts). */
async function upload(f: SharedFile): Promise<{ id: string } | { error: string }> {
  const path = str("share.uploadPath", "/v1/files");
  // A server path, never an address: the token goes wherever this points.
  if (!path.startsWith("/")) return { error: "" };
  const res = await FileSystem.uploadAsync(`${await getBaseUrl()}${path}`, f.uri, {
    httpMethod: "POST",
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: "file",
    mimeType: f.mime || "application/octet-stream",
    headers: await commonHeaders(),
  });
  let body: { file?: { id?: unknown }; message?: unknown } | null = null;
  try { body = JSON.parse(res.body); } catch { body = null; }
  if (res.status >= 200 && res.status < 300 && typeof body?.file?.id === "string") return { id: body.file.id };
  // The file door words its refusals for a person ("That file is over 25 MB…").
  const said = typeof body?.message === "string" && body.message.length <= 200 ? body.message : "";
  console.warn(`[share] upload refused: ${res.status}`);
  return { error: said };
}

export function useShareIn(host: ShareInHost): void {
  const hostRef = useRef(host);
  hostRef.current = host;
  const busy = useRef(false);

  const check = useCallback(() => {
    if (!hostRef.current.ready || busy.current) return;
    busy.current = true;
    const io: ShareIO = {
      consume: () => consumeShared(num("share.maxAgeMs", 600_000)),
      enabled: () => flagOn("bots.app"),
      upload,
      discard: (f) => FileSystem.deleteAsync(f.uri, { idempotent: true }).catch(() => {}),
      open: (params) => hostRef.current.open(str("share.screenId", "bots.share-in"), params),
      toast: (m, tone) => hostRef.current.toast(m, tone),
      words: {
        adding: txt("share.adding", "Adding it to Tailzu…"),
        failed: txt("share.failed", "Couldn't add that. Try again."),
        partly: txt("share.partly", "Some of it couldn't be added."),
        off: txt("share.off", "Sending things to Tailzu isn't on for you yet."),
      },
    };
    void runShareIn(io)
      .catch((e) => console.warn("[share] could not take the share:", e))
      .finally(() => { busy.current = false; });
  }, []);

  // A share that started the app, or one waiting since before sign-in.
  useEffect(() => { if (host.ready) check(); }, [host.ready, check]);

  useEffect(() => {
    const front = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    const link = Linking.addEventListener("url", ({ url }) => { if (url && isShareLink(url)) check(); });
    const android = addShareListener(check);
    return () => { front.remove(); link.remove(); android?.remove(); };
  }, [check]);
}
