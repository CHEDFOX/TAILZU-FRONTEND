/**
 * THE IPHONE'S RINGTONE, COPIED WHERE iOS PLAYS IT FROM (the steps and why: ringtoneCore.ts). The App Group container's
 * Library/Sounds, written with the same expo-file-system calls glance.ts uses for the widget's faces (the App Group
 * entitlement and these calls are in the store binary). This is the iOS file: Metro gives Android ringtone.ts, so the 0.9 MB
 * tone never rides in Android's update.
 */
import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import { APP_GROUP, RINGTONE_FILE } from "./callsCore";
import { installRingtone, ringtoneOnce, type FileLike } from "./ringtoneCore";

/** Library/Sounds in the App Group container, or null for a build without the App Group. Never throws. */
function soundsDir(): Directory | null {
  try {
    const group = Paths.appleSharedContainers[APP_GROUP];
    return group ? new Directory(group, "Library", "Sounds") : null;
  } catch {
    return null;
  }
}

const install = () =>
  installRingtone({
    soundsDir,
    makeDir: (dir) => (dir as Directory).create({ intermediates: true, idempotent: true }),
    file: (dir, name) => new File(dir as Directory, name) as unknown as FileLike,
    bundled: async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const asset = Asset.fromModule(require("../../assets/sounds/x0_ring_1.wav"));
      await asset.downloadAsync();
      return asset.localUri ?? "";
    },
    fileAt: (uri) => new File(uri) as unknown as FileLike,
  });

/** Whether the tone is there right now (asked when the install takes too long). */
function installedNow(): boolean {
  const dir = soundsDir();
  return !!dir && new File(dir, RINGTONE_FILE).exists;
}

/**
 * True when the ringtone is in the App Group's Library/Sounds, so the push token may say BotRingtone and the server may name
 * it. One install per launch; an answer within `timeoutMs` (2 s), because the token's registration waits for it.
 */
export const ringtoneReady: (timeoutMs?: number) => Promise<boolean> = ringtoneOnce(install, installedNow);
