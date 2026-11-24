import { describe, expect, it } from "vitest";
import { workspaceLeadingVisualKind } from "./workspace-leading-visual-kind";

const AVATAR = "data:image/png;base64,aGk=";

describe("workspaceLeadingVisualKind", () => {
  it("leads a marked workspace with its avatar, hoisted or inside its project", () => {
    expect(workspaceLeadingVisualKind({ avatarDataUri: AVATAR, leadingProjectName: "shop" })).toBe(
      "avatar",
    );
    expect(workspaceLeadingVisualKind({ avatarDataUri: AVATAR, leadingProjectName: null })).toBe(
      "avatar",
    );
  });

  it("keeps the project icon on hoisted rows and the status inside a project otherwise", () => {
    expect(workspaceLeadingVisualKind({ avatarDataUri: null, leadingProjectName: "shop" })).toBe(
      "project",
    );
    expect(workspaceLeadingVisualKind({ avatarDataUri: null, leadingProjectName: null })).toBe(
      "status",
    );
  });
});
