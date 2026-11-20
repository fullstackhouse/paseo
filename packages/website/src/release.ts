import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { getWebsiteCacheContext } from "./cloudflare-cache";
import { githubApiUrl, type GitHubApiEnvironment } from "./github-cache";
import { getReleaseChannels } from "./latest-release";

export const getLatestRelease = createServerFn({ method: "GET" }).handler(async () => {
  return getReleaseChannels(githubApiUrl(env as GitHubApiEnvironment), getWebsiteCacheContext());
});
