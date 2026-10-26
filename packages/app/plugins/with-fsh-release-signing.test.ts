import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const { configureReleaseSigning } = require("./with-fsh-release-signing");

const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}`;

describe("withFshReleaseSigning", () => {
  it("signs release with the FSH key from the environment and keeps debug on the debug key", () => {
    const out = configureReleaseSigning(TEMPLATE);
    expect(out).toContain('System.getenv("PASEO_ANDROID_KEYSTORE")');
    expect(out).toMatch(/release\s*\{[^}]*?signingConfig signingConfigs\.release/);
    expect(out).toMatch(/debug\s*\{\s*signingConfig signingConfigs\.debug/);
  });

  it("is idempotent", () => {
    const once = configureReleaseSigning(TEMPLATE);
    expect(configureReleaseSigning(once)).toBe(once);
  });

  it("fails loudly when the template no longer matches", () => {
    expect(() => configureReleaseSigning("android {}")).toThrow(/signingConfigs/);
    const noDebugRelease = TEMPLATE.replace(
      /signingConfig signingConfigs\.debug\n(\s*minifyEnabled)/,
      "$1",
    );
    expect(() => configureReleaseSigning(noDebugRelease)).toThrow(/debug key/);
  });

  it("matches the Gradle file Expo prebuild generates", () => {
    const generated = path.join(__dirname, "../android/app/build.gradle");
    let contents: string;
    try {
      contents = readFileSync(generated, "utf8");
    } catch {
      return; // only checkable after a local `APP_VARIANT=fsh expo prebuild`
    }
    expect(contents).toMatch(/release\s*\{[^}]*?signingConfig signingConfigs\.release/);
  });
});
