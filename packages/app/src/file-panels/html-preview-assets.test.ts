import { describe, expect, it } from "vitest";
import { inlineLocalAssets, pageDirectory, resolveLocalAssetPath } from "./html-preview-assets";

function reader(files: Record<string, string>) {
  const reads: string[] = [];
  const read = async (path: string) => {
    reads.push(path);
    return files[path] ?? null;
  };
  return { read, reads };
}

describe("resolveLocalAssetPath", () => {
  it("accepts paths inside the page's directory", () => {
    expect(resolveLocalAssetPath("tokens.css")).toBe("tokens.css");
    expect(resolveLocalAssetPath("./css/app.css?v=2#x")).toBe("css/app.css");
    expect(resolveLocalAssetPath("css/../app.css")).toBe("app.css");
    expect(resolveLocalAssetPath("my%20styles.css")).toBe("my styles.css");
  });

  it("refuses anything that leaves the directory or names another origin", () => {
    for (const reference of [
      "",
      "../secret.css",
      "css/../../secret.css",
      "%2e%2e/secret.css",
      "/etc/passwd",
      "//example.com/a.css",
      "https://example.com/a.css",
      "data:text/css,body{}",
      "file:///etc/passwd",
      "C:/x.css",
      "..\\secret.css",
      "a%5c..%5c..%5csecret.css",
      ".",
      ".env",
      ".git/config.js",
      "css/.hidden/a.css",
    ]) {
      expect(resolveLocalAssetPath(reference), reference).toBeNull();
    }
  });
});

describe("inlineLocalAssets", () => {
  it("reads only stylesheets and scripts, so a page cannot pull other files into itself", async () => {
    const { read, reads } = reader({ "secrets.json": "{}", "notes.txt": "x", "env.sh": "x" });
    const html = [
      '<link rel="stylesheet" href="secrets.json">',
      '<link rel="stylesheet" href="notes.txt">',
      '<script src="env.sh"></script>',
      '<script src="secrets.json"></script>',
    ].join("\n");

    expect(await inlineLocalAssets(html, read)).toBe(html);
    expect(reads).toEqual([]);
  });

  it("inlines same-directory stylesheets and scripts in place", async () => {
    const { read } = reader({
      "tokens.css": ":root{--a:1}",
      "print.css": "body{color:black}",
      "app.js": "window.ready=true;",
    });
    const html = [
      '<link rel="stylesheet" href="tokens.css" />',
      "<link rel=stylesheet href='print.css' media=print>",
      '<script src="app.js" defer></script>',
    ].join("\n");

    expect(await inlineLocalAssets(html, read)).toBe(
      [
        "<style>:root{--a:1}</style>",
        '<style media="print">body{color:black}</style>',
        "<script>window.ready=true;</script>",
      ].join("\n"),
    );
  });

  it("keeps a module script a module", async () => {
    const { read } = reader({ "m.js": "export {};" });
    expect(await inlineLocalAssets('<script type="module" src="m.js"></script>', read)).toBe(
      '<script type="module">export {};</script>',
    );
  });

  it("leaves remote, escaping, missing and non-stylesheet references alone without reading them", async () => {
    const { read, reads } = reader({});
    const html = [
      '<link rel="stylesheet" href="https://cdn.example.com/a.css">',
      '<link rel="stylesheet" href="../outside.css">',
      '<link rel="icon" href="favicon.css">',
      '<script src="//cdn.example.com/a.js"></script>',
      '<script src="missing.js"></script>',
      "<script>inline()</script>",
    ].join("\n");

    expect(await inlineLocalAssets(html, read)).toBe(html);
    expect(reads).toEqual(["missing.js"]);
  });

  it("keeps the inlined code from closing its own element", async () => {
    const { read } = reader({
      "a.js": 'const s = "</script><img src=x>";',
      "a.css": "/* </style><script>x()</script> */",
    });
    const output = await inlineLocalAssets(
      '<link rel="stylesheet" href="a.css"><script src="a.js"></script>',
      read,
    );

    expect(output).toBe(
      '<style>/* <\\/style><script>x()</script> */</style><script>const s = "<\\/script><img src=x>";</script>',
    );
  });

  it("does not re-scan inlined content or expand replacement patterns", async () => {
    const { read } = reader({
      "a.js": 'document.write(\'<script src="b.js"></script>\'); "$&";',
      "b.js": "never()",
    });
    const output = await inlineLocalAssets(
      '<script src="a.js"></script><script src="b.js"></script>',
      read,
    );

    expect(output).toBe(
      '<script>document.write(\'<script src="b.js"><\\/script>\'); "$&";</script><script>never()</script>',
    );
  });

  it("reads a file linked twice once", async () => {
    const { read, reads } = reader({ "a.css": "x" });
    await inlineLocalAssets(
      '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="./a.css">',
      read,
    );
    expect(reads).toEqual(["a.css"]);
  });
});

describe("pageDirectory", () => {
  it("is the absolute folder of the page", () => {
    expect(pageDirectory({ cwd: "/repo", path: "index.html" })).toBe("/repo");
    expect(pageDirectory({ cwd: "/repo/", path: "a/b/index.html" })).toBe("/repo/a/b");
    expect(pageDirectory({ cwd: "/", path: "/tmp/plans/index.html" })).toBe("/tmp/plans");
    expect(pageDirectory({ cwd: "/", path: "/index.html" })).toBe("/");
    expect(pageDirectory({ cwd: "~", path: "~/plans/index.html" })).toBe("~/plans");
  });
});
