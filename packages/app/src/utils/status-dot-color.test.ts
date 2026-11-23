import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme } from "@/styles/theme";
import { getStatusDotColor } from "@/utils/status-dot-color";

describe("getStatusDotColor", () => {
  it.each([
    ["light", lightTheme],
    ["dark", darkTheme],
  ])(
    "gives Blocked its own yellow in the %s theme, apart from Done and Needs input",
    (_, theme) => {
      const blocked = getStatusDotColor({ theme, bucket: "blocked" });

      expect(blocked).toBe(theme.colors.statusDotBlocked);
      expect(blocked).not.toBe(getStatusDotColor({ theme, bucket: "needs_input" }));
      expect(getStatusDotColor({ theme, bucket: "done" })).toBeNull();
    },
  );
});
