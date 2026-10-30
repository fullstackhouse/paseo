import { describe, expect, it } from "vitest";
import { darkTheme } from "@/styles/theme";
import { editorTheme, type EditorVisualTheme } from "./extensions.web";

function visualTheme(background: string): EditorVisualTheme {
  return {
    colorScheme: "dark",
    background,
    foreground: darkTheme.colors.foreground,
    cursor: darkTheme.colors.terminal.cursor,
    foregroundMuted: darkTheme.colors.foregroundMuted,
    border: darkTheme.colors.border,
    selection: darkTheme.colors.terminal.selectionBackground,
    monoFont: darkTheme.fontFamily.mono,
    codeFontSize: darkTheme.fontSize.code,
    syntax: darkTheme.colors.syntax,
  };
}

describe("editorTheme", () => {
  it("reuses one extension for equal theme values", () => {
    expect(editorTheme(visualTheme("#000"))).toBe(editorTheme(visualTheme("#000")));
  });

  it("builds a new extension when the theme changes", () => {
    expect(editorTheme(visualTheme("#000"))).not.toBe(editorTheme(visualTheme("#111")));
  });
});
