import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DevDaemonAccessError,
  correctDevDaemonConfig,
  resolveDevDaemonAccess,
} from "./dev-daemon-access.mjs";

const repoRoot = join(import.meta.dirname, "..");
const withPassword = { daemon: { auth: { password: "$2b$10$hash" } } };

function resolve(env, config = {}) {
  return resolveDevDaemonAccess({ env, config, lanAddresses: ["192.0.2.10"] });
}

test("workspace services: loopback listen and only the workspace's proxy origins", () => {
  const access = resolve({
    PASEO_LISTEN: "127.0.0.1:6000",
    PASEO_URL: "http://daemon--fix--paseo.localhost:6767",
    PASEO_SERVICE_DAEMON_PORT: "6000",
    PASEO_SERVICE_DAEMON_URL: "http://daemon--fix--paseo.localhost:6767",
    PASEO_SERVICE_APP_PORT: "6001",
    PASEO_SERVICE_APP_URL: "http://app--fix--paseo.localhost:6767",
    PASEO_SERVICE_DESKTOP_PORT: "6002",
    PASEO_SERVICE_DESKTOP_URL: "http://desktop--fix--paseo.localhost:6767",
  });

  assert.equal(access.listen, "127.0.0.1:6000");
  assert.deepEqual(access.lanUrls, []);
  assert.deepEqual(
    new Set(access.corsOrigins),
    // Peer ports change whenever a peer restarts, so they are not admitted.
    new Set([
      "http://daemon--fix--paseo.localhost:6767",
      "http://app--fix--paseo.localhost:6767",
      "http://desktop--fix--paseo.localhost:6767",
    ]),
  );
});

test("standalone scripts admit the dev Metro ports on localhost only", () => {
  const access = resolve({ PASEO_LISTEN: "127.0.0.1:6768" });

  assert.equal(access.listen, "127.0.0.1:6768");
  assert.ok(access.corsOrigins.includes("http://localhost:8081"));
  assert.ok(access.corsOrigins.includes("http://127.0.0.1:8089"));
  assert.ok(
    access.corsOrigins.every((origin) => /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)),
  );
});

test("a wildcard bind or wildcard origin is refused without the LAN opt-in", () => {
  assert.throws(() => resolve({ PASEO_LISTEN: "0.0.0.0:6768" }), DevDaemonAccessError);
  assert.throws(
    () => resolve({ PASEO_LISTEN: "127.0.0.1:6768", PASEO_CORS_ORIGINS: "http://a.test,*" }),
    DevDaemonAccessError,
  );
});

test("the LAN opt-in requires a password saved in the dev home", () => {
  const env = { PASEO_LISTEN: "127.0.0.1:6768", PASEO_DEV_LAN: "1" };
  assert.throws(() => resolve(env), /needs a daemon password/);
  // A PASEO_PASSWORD variable would sit in the process environment; it does not count.
  assert.throws(() => resolve({ ...env, PASEO_PASSWORD: "dummy" }), /needs a daemon password/);

  const access = resolve(env, withPassword);
  assert.equal(access.listen, "0.0.0.0:6768");
  assert.deepEqual(access.lanUrls, ["http://192.0.2.10:6768"]);
  assert.ok(access.corsOrigins.includes("http://192.0.2.10:8081"));
});

test("existing homes lose the wildcard origin and take the resolved listen", () => {
  const legacy = {
    version: 1,
    daemon: { listen: "0.0.0.0:6768", cors: { allowedOrigins: ["*"] }, auth: { password: "h" } },
  };
  assert.deepEqual(correctDevDaemonConfig(legacy, "127.0.0.1:6768"), {
    version: 1,
    daemon: { listen: "127.0.0.1:6768", auth: { password: "h" } },
  });
  assert.deepEqual(
    correctDevDaemonConfig(
      { daemon: { cors: { allowedOrigins: ["*", "http://kept.test"] } } },
      "127.0.0.1:1",
    ).daemon.cors,
    { allowedOrigins: ["http://kept.test"] },
  );
});

test("dev-home.sh exports the resolved access and corrects config.json", () => {
  const home = mkdtempSync(join(tmpdir(), "paseo-dev-access-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { listen: "0.0.0.0:7000", cors: { allowedOrigins: ["*"] } } }),
  );
  const script = [
    `source "${join(repoRoot, "scripts/dev-home.sh")}"`,
    "configure_dev_paseo_home",
    'printf "%s\\n%s\\n" "$PASEO_LISTEN" "$PASEO_CORS_ORIGINS"',
  ].join("\n");
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    PASEO_HOME: home,
    PASEO_DEV_MANAGED_HOME: "1",
    PASEO_LISTEN: "127.0.0.1:7000",
    PASEO_SERVICE_APP_URL: "http://app--x--y.localhost:6767",
    EXPO_PORT: "7001",
  };
  const [listen, cors] = execFileSync("bash", ["-c", script], { env, encoding: "utf8" })
    .trim()
    .split("\n");

  assert.equal(listen, "127.0.0.1:7000");
  assert.equal(cors, "http://localhost:7001,http://127.0.0.1:7001,http://app--x--y.localhost:6767");
  assert.deepEqual(JSON.parse(readFileSync(join(home, "config.json"), "utf8")).daemon, {
    listen: "127.0.0.1:7000",
  });

  const refused = spawnSync("bash", ["-c", script], {
    env: { ...env, PASEO_DEV_LAN: "1" },
    encoding: "utf8",
  });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /needs a daemon password/);
  assert.equal(refused.stdout, "");
});

test("paseo.json services never bind the wildcard address", () => {
  const paseoJson = readFileSync(join(repoRoot, "paseo.json"), "utf8");
  assert.doesNotMatch(paseoJson, /0\.0\.0\.0/);
});
