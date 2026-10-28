import { describe, expect, it } from "vitest";
import { shouldShowSidebarArchiveButton } from "@/components/sidebar/archive-button-visibility";

const hoveredDesktopRow = {
  enabled: true,
  showKebab: true,
  isHovered: true,
  isTouchPlatform: false,
};

describe("shouldShowSidebarArchiveButton", () => {
  it("shows beside the kebab on a hovered desktop row", () => {
    expect(shouldShowSidebarArchiveButton(hoveredDesktopRow)).toBe(true);
  });

  it("hides when the setting is off", () => {
    expect(shouldShowSidebarArchiveButton({ ...hoveredDesktopRow, enabled: false })).toBe(false);
  });

  it("hides on touch, where the kebab is permanent and there is no hover", () => {
    expect(shouldShowSidebarArchiveButton({ ...hoveredDesktopRow, isTouchPlatform: true })).toBe(
      false,
    );
  });

  it("hides when the row is not hovered", () => {
    expect(shouldShowSidebarArchiveButton({ ...hoveredDesktopRow, isHovered: false })).toBe(false);
  });

  it("hides with the kebab while shortcut hints take the slot", () => {
    expect(shouldShowSidebarArchiveButton({ ...hoveredDesktopRow, showKebab: false })).toBe(false);
  });
});
