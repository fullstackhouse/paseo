#!/usr/bin/env node
// Decides who may reach a dev daemon: the listen address, the browser origins it accepts, and
// whether it may leave loopback. scripts/dev-home.sh runs this before any dev script starts or
// targets a daemon. Dev homes have no password, so a daemon that anyone can reach is an open
// door to this machine: loopback and this checkout's own origins are the default, and the LAN
// needs PASEO_DEV_LAN=1 plus a password saved in the home. See docs/development.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { isMainModule } from "./is-main-module.mjs";

// Metro ports the dev scripts pick outside a Paseo workspace: `dev:app` uses 8081,
// `packages/desktop/scripts/dev.sh` the first free port from 8082 through 8089.
const STANDALONE_METRO_PORTS = [8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];
const DEFAULT_LISTEN = "127.0.0.1:6768";
// The main daemon serves the local `<label>.localhost` proxy routes. paseo.json's `app-main`
// service assumes the same default.
const DEFAULT_MAIN_DAEMON_ENDPOINT = "localhost:6767";

export class DevDaemonAccessError extends Error {}

export function resolveDevDaemonAccess({ env, config, lanAddresses }) {
  const lan = env.PASEO_DEV_LAN === "1";
  const listen = resolveListen(env, config, lan);
  const metroPorts = resolveMetroPorts(env);
  const origins = new Set();
  for (const port of metroPorts) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  const mainPort = resolveMainDaemonPort(env);
  for (const [key, value] of Object.entries(env)) {
    if (key !== "PASEO_URL" && !/^PASEO_SERVICE_.+_URL$/.test(key)) continue;
    const origin = parseOrigin(value);
    if (!origin) continue;
    origins.add(origin);
    origins.add(localProxyOrigin(origin, mainPort));
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
  const lanOrigins = lan
    ? lanAddresses.flatMap((address) => metroPorts.map((port) => `http://${address}:${port}`))
    : [];
  const selfOrigin = env.PASEO_URL ? parseOrigin(env.PASEO_URL) : null;
  return {
    listen: listen.value,
    // Managed launches (desktop, `paseo daemon start`) read only config.json, and must stay on
    // loopback even when this process opted into the LAN.
    persistedListen: listen.persisted,
    corsOrigins: [...origins, ...lanOrigins],
    persistedCorsOrigins: [...origins],
    lanUrls:
      lan && listen.port ? lanAddresses.map((address) => `http://${address}:${listen.port}`) : [],
    localUrl: selfOrigin ? localProxyOrigin(selfOrigin, mainPort) : null,
  };
}

// Rewrites a dev home's config.json to what this run resolved. The daemon merges persisted
// origins with PASEO_CORS_ORIGINS, and managed launches get only the persisted ones, so the
// list is replaced, not merged: a seeded or older home must not keep "*" or another origin.
export function correctDevDaemonConfig(config, { persistedListen, persistedCorsOrigins }) {
  const next = structuredClone(config ?? {});
  next.version ??= 1;
  next.daemon ??= {};
  next.daemon.listen = persistedListen;
  next.daemon.cors = { ...next.daemon.cors, allowedOrigins: persistedCorsOrigins };
  return next;
}

// Mirrors parseListenString in packages/server/src/server/bootstrap.ts. Returns null for
// sockets and pipes.
export function parseTcpListen(value) {
  if (
    value.startsWith("\\\\.\\pipe\\") ||
    value.startsWith("pipe://") ||
    value.startsWith("unix://") ||
    value.startsWith("/") ||
    value.startsWith("~")
  ) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return { host: "127.0.0.1", port: String(parseInt(trimmed, 10)) };
  if (!/^[A-Za-z]:[\\/]/.test(value) && value.includes(":")) {
    const index = value.lastIndexOf(":");
    const port = parseInt(value.slice(index + 1), 10);
    if (Number.isFinite(port)) {
      const host = value.slice(0, index).replace(/^\[(.*)\]$/, "$1");
      return { host: host || "127.0.0.1", port: String(port) };
    }
  }
  throw new DevDaemonAccessError(`Invalid PASEO_LISTEN: ${value}`);
}

function resolveListen(env, config, lan) {
  const value = env.PASEO_LISTEN || DEFAULT_LISTEN;
  const tcp = parseTcpListen(value);
  if (!tcp) {
    if (lan)
      throw new DevDaemonAccessError(`PASEO_DEV_LAN=1 needs a TCP PASEO_LISTEN, not ${value}`);
    return { value, persisted: value, port: null };
  }
  if (lan) {
    if (!config?.daemon?.auth?.password) {
      throw new DevDaemonAccessError(
        "PASEO_DEV_LAN=1 needs a daemon password in this dev home. Save one first:\n" +
          `  npm run cli -- daemon set-password --home ${env.PASEO_HOME ?? ".dev/paseo-home"}`,
      );
    }
    return { value: `0.0.0.0:${tcp.port}`, persisted: `127.0.0.1:${tcp.port}`, port: tcp.port };
  }
  if (!isLoopbackHost(tcp.host)) {
    throw new DevDaemonAccessError(
      `Dev daemons listen on loopback only, not ${value}. ` +
        "For LAN testing set PASEO_DEV_LAN=1 (requires a daemon password).",
    );
  }
  return { value, persisted: value, port: tcp.port };
}

function resolveMetroPorts(env) {
  const ports = /^\d+$/.test(env.EXPO_PORT ?? "") ? [env.EXPO_PORT] : [];
  // Workspace services get a new free port on every start, so a peer's port in this env goes
  // stale; browser clients there come through their stable proxy URLs instead.
  const inWorkspace = Object.keys(env).some((key) => /^PASEO_SERVICE_.+_URL$/.test(key));
  return inWorkspace ? ports : [...ports, ...STANDALONE_METRO_PORTS.map(String)];
}

function resolveMainDaemonPort(env) {
  const endpoint = env.PASEO_MAIN_DAEMON_ENDPOINT || DEFAULT_MAIN_DAEMON_ENDPOINT;
  return /:(\d+)$/.exec(endpoint)?.[1] ?? "6767";
}

// With serviceProxy.publicBaseUrl set, service URLs are public (`<label>.<public host>`); the
// same route stays reachable locally as `<label>.localhost` on the main daemon's port.
function localProxyOrigin(origin, mainPort) {
  const { hostname } = new URL(origin);
  if (hostname.endsWith(".localhost")) return origin;
  return `http://${hostname.split(".")[0]}.localhost:${mainPort}`;
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
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new DevDaemonAccessError(`Cannot parse ${path}: ${error.message}. Fix or remove it.`);
  }
}

// Prints `key=value` lines for dev-home.sh. With --write-config, also corrects config.json.
function main() {
  const configPath = `${process.env.PASEO_HOME}/config.json`;
  try {
    const config = readConfig(configPath);
    const access = resolveDevDaemonAccess({
      env: process.env,
      config,
      lanAddresses: listLanAddresses(),
    });
    if (process.argv.includes("--write-config")) {
      const next = correctDevDaemonConfig(config, access);
      if (JSON.stringify(next) !== JSON.stringify(config)) {
        writeFileSync(configPath, JSON.stringify(next, null, 2));
      }
    }
    process.stdout.write(
      [
        `listen=${access.listen}`,
        `cors=${access.corsOrigins.join(",")}`,
        `lan=${access.lanUrls.join(" ")}`,
        `local_url=${access.localUrl ?? ""}`,
        "",
      ].join("\n"),
    );
  } catch (error) {
    if (!(error instanceof DevDaemonAccessError)) throw error;
    console.error(`[dev] ${error.message}`);
    process.exit(1);
  }
}

if (isMainModule(import.meta.url)) main();
