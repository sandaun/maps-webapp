import { describe, expect, it } from "vitest";
import { XmlDocument } from "./xml/document";
import { isS700Platform, platformXmlValue, projectPlatform } from "./platform";

function project(attrs: string): XmlDocument {
  return XmlDocument.parse(`<?xml version="1.0" encoding="UTF-8"?>\r\n<Project${attrs}></Project>\r\n`);
}

describe("projectPlatform (ProjectParser.InitializeProject_getPlatform)", () => {
  it("reads the PlatformGw values", () => {
    expect(projectPlatform(project(' Platform="0"'))).toBe("NONE");
    expect(projectPlatform(project(' Platform="1"'))).toBe("KTS");
    expect(projectPlatform(project(' Platform="2"'))).toBe("RT");
    expect(projectPlatform(project(' Platform="3"'))).toBe("RT_AIR");
    expect(projectPlatform(project(' Platform=" +3 "'))).toBe("RT_AIR");
  });

  it("falls back to KTS when the value is missing, not an integer or unknown", () => {
    expect(projectPlatform(project(""))).toBe("KTS");
    expect(projectPlatform(project(' Platform="RT"'))).toBe("KTS");
    expect(projectPlatform(project(' Platform="2.0"'))).toBe("KTS");
    expect(projectPlatform(project(' Platform="4"'))).toBe("KTS");
    expect(projectPlatform(project(' Platform="-1"'))).toBe("KTS");
  });

  it("groups RT and RT_AIR as 700 Series, like GetProject", () => {
    expect(["NONE", "KTS", "RT", "RT_AIR"].map((p) => isS700Platform(p as never))).toEqual([false, false, true, true]);
    expect(platformXmlValue("RT")).toBe("2");
    expect(platformXmlValue("RT_AIR")).toBe("3");
  });
});
