/**
 * Expo config plugin: copies our PrivacyInfo.xcprivacy into the main iOS app
 * target and adds it to the Xcode "Copy Bundle Resources" phase so App Store
 * Connect actually picks it up.
 *
 * Apple requires a PrivacyInfo.xcprivacy in every third-party app since
 * Nov 2024. Missing → automatic upload warning + eventual rejection.
 *
 * The keyboard extension has its own PrivacyInfo.xcprivacy that's handled by
 * @bacons/apple-targets (any file in the target folder is copied verbatim).
 */
const {
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SOURCE = path.join("assets", "PrivacyInfo.xcprivacy");
const DEST_NAME = "PrivacyInfo.xcprivacy";

function withPrivacyManifestFile(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, SOURCE);
      if (!fs.existsSync(src)) {
        throw new Error(
          `[withPrivacyManifest] source file missing: ${src}. ` +
            `Restore assets/PrivacyInfo.xcprivacy before building.`,
        );
      }
      const projectName = cfg.modRequest.projectName || "Tulmi";
      const targetDir = path.join(
        cfg.modRequest.platformProjectRoot,
        projectName,
      );
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(src, path.join(targetDir, DEST_NAME));
      return cfg;
    },
  ]);
}

function withPrivacyManifestPbx(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectName = cfg.modRequest.projectName || "Tulmi";
    const relPath = `${projectName}/${DEST_NAME}`;

    IOSConfig.XcodeUtils.addResourceFileToGroup({
      filepath: relPath,
      groupName: projectName,
      project,
      isBuildFile: true,
      verbose: false,
    });
    return cfg;
  });
}

module.exports = function withPrivacyManifest(config) {
  config = withPrivacyManifestFile(config);
  config = withPrivacyManifestPbx(config);
  return config;
};
