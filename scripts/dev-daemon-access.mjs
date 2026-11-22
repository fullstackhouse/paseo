#!/usr/bin/env node
// Decides who may reach a dev daemon: the listen address, the browser origins it accepts, and
// whether it may leave loopback. scripts/dev-home.sh runs this before any dev script starts or
// targets a daemon. Dev homes have no password, so a daemon that anyone can reach is an open
// door to this machine: loopback and this checkout's own origins are the default, and the LAN
// needs PASEO_DEV_LAN=1 plus a password saved in the home. See docs/development.md.
import { readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { isMainModule } from "./is-main-module.mjs";

// Metro ports the dev scripts pick outside a Paseo workspace: `dev:app` uses 8081,
// `packages/desktop/scripts/dev.sh` the first free port from 8082 through 8089.
const STANDALONE_METRO_PORTS = [8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];
const DEFAULT_LISTEN = "127.0.0.1:6768";

export class DevDaemonAccessError extends Error {}

export function resolveDevDaemonAccess({ env, config, lanAddresses }) {
  const listen = resolveListen(env, config);
  const lan = env.PASEO_DEV_LAN === "1";
  const metroHosts = ["localhost", "127.0.0.1", ...(lan ? lanAddresses : [])];
  const origins = new Set();
  for (const port of resolveMetroPorts(env)) {
    for (const host of metroHosts) origins.add(`http://${host}:${port}`);
  }
  for (const [key, value] of Object.entries(env)) {
    if (key === "PASEO_URL" || /^PASEO_SERVICE_.+_URL$/.test(key)) {
      const origin = parseOrigin(value);
      if (origin) origins.add(origin);
    }
  }
  for (const origin of (env.PASEO_CORS_ORIGINS ?? "").split(",")) {
    const trimmed = origin.trim();
    if (trimmed === "*") {
      throw new DevDaemonAccessError(
        "PASEO_CORS_ORIGINS=* lets any website drive the dev daemon. List the origins instead.",
      );
    }
    if (trimmed) origins.add(trimmed);
  }
  const port = listen.port;
  return {
    listen: listen.value,
    corsOrigins: [...origins],
    lanUrls: lan && port ? lanAddresses.map((address) => `http://${address}:${port}`) : [],
  };
}

// Corrects a dev home's config.json: the daemon merges its persisted origins with
// PASEO_CORS_ORIGINS, so a leftover "*" would still admit every website.
export function correctDevDaemonConfig(config, listen) {
  const next = structuredClone(config ?? {});
  next.version ??= 1;
  next.daemon ??= {};
  next.daemon.listen = listen;
  const origins = next.daemon.cors?.allowedOrigins;
  if (Array.isArray(origins) && origins.includes("*")) {
    const kept = origins.filter((origin) => origin !== "*");
    if (kept.length > 0) next.daemon.cors.allowedOrigins = kept;
    else delete next.daemon.cors.allowedOrigins;
    if (Object.keys(next.daemon.cors).length === 0) delete next.daemon.cors;
  }
  return next;
}

function resolveListen(env, config) {
  const value = env.PASEO_LISTEN || DEFAULT_LISTEN;
  const tcp = parseTcpListen(value);
  if (!tcp) return { value, port: null };
  if (env.PASEO_DEV_LAN === "1") {
    if (!config?.daemon?.auth?.password) {
      throw new DevDaemonAccessError(
        "PASEO_DEV_LAN=1 needs a daemon password in this dev home. Save one first:\n" +
          `  npm run cli -- daemon set-password --home ${env.PASEO_HOME ?? ".dev/paseo-home"}`,
      );
    }
    return { value: `0.0.0.0:${tcp.port}`, port: tcp.port };
  }
  if (!isLoopbackHost(tcp.host)) {
    throw new DevDaemonAccessError(
      `Dev daemons listen on loopback only, not ${value}. ` +
        "For LAN testing set PASEO_DEV_LAN=1 (requires a daemon password).",
    );
  }
  return { value, port: tcp.port };
}

function resolveMetroPorts(env) {
  const ports = /^\d+$/.test(env.EXPO_PORT ?? "") ? [env.EXPO_PORT] : [];
  // Workspace services get a new free port on every start, so a peer's port in this env goes
  // stale; browser clients there come through their stable proxy URLs instead.
  const inWorkspace = Object.keys(env).some((key) => /^PASEO_SERVICE_.+_URL$/.test(key));
  return inWorkspace ? ports : [...ports, ...STANDALONE_METRO_PORTS.map(String)];
}

function parseTcpListen(value) {
  if (value.startsWith("/") || value.startsWith("unix://") || value.startsWith("pipe://")) {
    return null;
  }
  const match = /^(.*):(\d+)$/.exec(value);
  if (!match) return null;
  return { host: match[1].replace(/^\[|\]$/g, ""), port: match[2] };
}

function isLoopbackHost(host) {
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function parseOrigin(value) {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

function listLanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address) => !address.startsWith("169.254."));
}

function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

// Prints `key=value` lines for dev-home.sh. With --write-config, also corrects config.json.
function main() {
  const configPath = `${process.env.PASEO_HOME}/config.json`;
  const config = readConfig(configPath);
  let access;
  try {
    access = resolveDevDaemonAccess({
      env: process.env,
      config,
      lanAddresses: listLanAddresses(),
    });
  } catch (error) {
    if (!(error instanceof DevDaemonAccessError)) throw error;
    console.error(`[dev] ${error.message}`);
    process.exit(1);
  }
  if (process.argv.includes("--write-config")) {
    const next = correctDevDaemonConfig(config, access.listen);
    if (JSON.stringify(next) !== JSON.stringify(config)) {
      writeFileSync(configPath, JSON.stringify(next, null, 2));
    }
  }
  process.stdout.write(
    [
      `listen=${access.listen}`,
      `cors=${access.corsOrigins.join(",")}`,
      `lan=${access.lanUrls.join(" ")}`,
      "",
    ].join("\n"),
  );
}

if (isMainModule(import.meta.url)) main();
