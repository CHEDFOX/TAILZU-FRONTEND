/**
 * Expo config plugin: Tailzu in Android's Share menu.
 *
 * Adds ACTION_SEND and ACTION_SEND_MULTIPLE filters to the app's MainActivity
 * for text, links, pictures, videos, recordings and files. The activity is
 * singleTask (Expo's default), so a share reaches a running app through
 * onNewIntent; modules/tulmi-share reads the intent either way, and the app
 * sends the files to the backend and opens the share-in screen
 * (src/share/useShareIn.ts).
 *
 * No permission is added: a share hands the app a read grant for exactly the
 * files shared, for as long as the activity lives.
 */
const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

// What the backend reads (src/media in the backend): text, pictures, PDFs and
// office files, spreadsheets, recordings, videos, archives.
const TYPES = ["text/*", "image/*", "video/*", "audio/*", "application/*"];
const ACTIONS = ["android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"];

function filterFor(action) {
  return {
    action: [{ $: { "android:name": action } }],
    category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
    data: TYPES.map((t) => ({ $: { "android:mimeType": t } })),
  };
}

function hasAction(filter, action) {
  return (filter.action || []).some((a) => a.$ && a.$["android:name"] === action);
}

module.exports = function withTulmiShare(config) {
  return withAndroidManifest(config, (cfg) => {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    main["intent-filter"] = main["intent-filter"] || [];
    for (const action of ACTIONS) {
      // Idempotent: a second prebuild over the same manifest adds nothing.
      if (!main["intent-filter"].some((f) => hasAction(f, action))) main["intent-filter"].push(filterFor(action));
    }
    return cfg;
  });
};
