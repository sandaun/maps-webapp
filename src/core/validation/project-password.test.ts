import { describe, expect, it } from "vitest";
import { isDeployPasswordValid, isNewProjectPasswordValid } from "./project-password";

describe("MAPS password rules", () => {
  it.each(["", "café", "漢字", "😀"])("rejects %j for deploy and entry", (password) => {
    expect(isDeployPasswordValid(password)).toBe(false);
    expect(isNewProjectPasswordValid(password)).toBe(false);
  });

  it.each(["a", " ", "  test  ", "<&\"'>~!1", "12345678"])("accepts %j without trimming or strength rules", (password) => {
    expect(isDeployPasswordValid(password)).toBe(true);
    expect(isNewProjectPasswordValid(password)).toBe(true);
  });

  it.each(["123456789", "tab\t", "line\n", "\x7f"])("keeps the desktop's distinct import/deploy and entry rules for %j", (password) => {
    expect(isDeployPasswordValid(password)).toBe(true);
    expect(isNewProjectPasswordValid(password)).toBe(false);
  });
});
