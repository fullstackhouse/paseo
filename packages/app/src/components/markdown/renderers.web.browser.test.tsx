import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ToastApi } from "@/components/toast-host";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { i18n } from "@/i18n/i18next";
import { MarkdownExternalContext } from "./external-context";
import { WEB_RENDERERS } from "./renderers.web";

const PR_URL = "https://github.com/o/r/pull/12";
const openInPaseo = vi.fn();
const toast: ToastApi = { show: () => () => {}, copied() {}, error() {} };

vi.mock("@/plugins/link-handlers", () => ({
  usePluginLinkResolver: () => ({
    active: true,
    resolve: (url: string) =>
      url === PR_URL ? { url, title: "Open in Inbox", open: openInPaseo } : null,
  }),
}));

const Link = WEB_RENDERERS.link;
const LINK_TEXT = "src/index.ts";

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function anchorPropsFor(url: string) {
  return { href: url };
}

function renderAnchor(
  link: { url: string; sourceType?: "markdown" | "text" | "inline-code" },
  { external = false }: { external?: boolean } = {},
) {
  if (!Link) {
    throw new Error("Expected a web link renderer");
  }
  const anchorProps = anchorPropsFor(link.url);
  const client = new QueryClient();
  act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <ToastApiProvider api={toast}>
          <MarkdownExternalContext.Provider value={external}>
            <Link link={link} anchorProps={anchorProps}>
              {LINK_TEXT}
            </Link>
          </MarkdownExternalContext.Provider>
        </ToastApiProvider>
      </QueryClientProvider>,
    ),
  );
  const anchor = container.querySelector("a");
  if (!anchor) {
    throw new Error("Expected a rendered link");
  }
  return anchor;
}

it("marks a link it recognized from a path for selection copy", () => {
  const anchor = renderAnchor({ url: LINK_TEXT, sourceType: "text" });
  expect(anchor.getAttribute("href")).toBe(LINK_TEXT);
  expect(anchor.getAttribute("data-paseo-markdown-recognized-link")).toBe("true");
});

it("leaves an authored link wrapped", () => {
  const anchor = renderAnchor({ url: "https://example.test/doc", sourceType: "markdown" });
  expect(anchor.hasAttribute("data-paseo-markdown-recognized-link")).toBe(false);
});

function rightClick(anchor: HTMLAnchorElement) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  act(() => {
    anchor.dispatchEvent(event);
  });
  return event;
}

it("gives a link a plugin opens a menu with Paseo, browser and copy", async () => {
  const anchor = renderAnchor({ url: PR_URL, sourceType: "markdown" });
  const event = rightClick(anchor);
  expect(event.defaultPrevented).toBe(true);
  const menu = await vi.waitFor(() => {
    const element = document.querySelector('[data-testid="plugin-link-context-menu"]');
    if (!element) throw new Error("menu not open");
    return element;
  });
  expect(menu.textContent).toContain("Open in Inbox");
  expect(menu.textContent).toContain("Open in browser");
  expect(menu.textContent).toContain("Copy link");
  const item = document.querySelector<HTMLElement>('[data-testid="plugin-link-open-in-paseo"]');
  act(() => item?.click());
  expect(openInPaseo).toHaveBeenCalledOnce();
});

it("leaves the browser menu of a link no plugin opens", () => {
  const anchor = renderAnchor({ url: "https://example.test/doc", sourceType: "markdown" });
  expect(rightClick(anchor).defaultPrevented).toBe(false);
});

it("keeps plugins off the links of external Markdown", () => {
  const anchor = renderAnchor({ url: PR_URL, sourceType: "markdown" }, { external: true });
  expect(rightClick(anchor).defaultPrevented).toBe(false);
});
