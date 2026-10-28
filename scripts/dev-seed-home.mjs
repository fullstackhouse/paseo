#!/usr/bin/env node
// Seeds this checkout's dev home from your real Paseo home, so a worktree's dev daemon has your
// providers, profiles, plugins and projects. Agents are not copied: their sessions belong to the
// main daemon. Usage: npm run dev:seed-home [-- <source home>]
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { seedDesktopProfile } from "./dev-seed-desktop-profile.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(process.argv[2] ?? join(homedir(), ".paseo"));
// Not $PASEO_HOME: terminals opened inside Paseo inherit the main daemon's home.
const target = join(root, ".dev/paseo-home");

if (source === target) {
  console.error(`Source and target are the same home: ${source}`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });

const config = JSON.parse(readFileSync(join(source, "config.json"), "utf8"));
// The dev desktop app only gets a local credential for daemons it started itself, so a copied
// password locks it out. The relay would publish the dev daemon as one more remote host.
delete config.daemon?.auth;
delete config.daemon?.relay;
writeFileSync(join(target, "config.json"), `${JSON.stringify(config, null, 2)}\n`);

const projects = join(source, "projects");
if (existsSync(projects)) {
  cpSync(projects, join(target, "projects"), {
    recursive: true,
    filter: (path) => path === projects || path.endsWith(".json"),
  });
}

console.log(`Seeded ${target} from ${source}. Restart the dev daemon to load it.`);

await seedDesktopProfile({ root, ...(process.argv[3] ? { sourceProfile: process.argv[3] } : {}) });
