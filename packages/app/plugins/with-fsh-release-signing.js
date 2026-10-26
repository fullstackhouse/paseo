const { withAppBuildGradle } = require("expo/config-plugins");

// FSH fork: sign release APKs with our own key instead of the template's shared debug
// keystore, so a sideloaded install only accepts updates built by us. Gradle reads the
// keystore from the environment at build time (fsh-android.yml decodes it from a secret);
// without PASEO_ANDROID_KEYSTORE the release build fails instead of signing with debug.
const SIGNING_CONFIG = `
        release {
            def paseoKeystore = System.getenv("PASEO_ANDROID_KEYSTORE")
            if (paseoKeystore) {
                storeFile file(paseoKeystore)
                storePassword System.getenv("PASEO_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("PASEO_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("PASEO_ANDROID_KEY_PASSWORD")
            }
        }`;

// Without the env, signingConfigs.release has no storeFile and Gradle fails the release
// build ("Keystore file not set"), which is what we want.
const RELEASE_SIGNING = "signingConfig signingConfigs.release";

function configureReleaseSigning(contents) {
  if (contents.includes("PASEO_ANDROID_KEYSTORE")) return contents;

  const signingConfigs = /signingConfigs\s*\{/;
  if (!signingConfigs.test(contents)) {
    throw new Error("with-fsh-release-signing: no signingConfigs block in app/build.gradle");
  }
  let next = contents.replace(signingConfigs, (match) => match + SIGNING_CONFIG);

  const releaseDebugSigning = /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/;
  if (!releaseDebugSigning.test(next)) {
    throw new Error("with-fsh-release-signing: release build type does not use the debug key");
  }
  next = next.replace(releaseDebugSigning, (_, head) => head + RELEASE_SIGNING);
  return next;
}

module.exports = function withFshReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = configureReleaseSigning(modConfig.modResults.contents);
    return modConfig;
  });
};
module.exports.configureReleaseSigning = configureReleaseSigning;
