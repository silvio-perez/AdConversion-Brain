import { describe, expect, it } from "vitest";
import { findViolations, isAllowed } from "./license-policy.mjs";

describe("isAllowed", () => {
  it.each(["MIT", "Apache-2.0", "(MIT OR Apache-2.0)", "MIT OR GPL-3.0-or-later", "MIT AND Zlib"])(
    "allows %s",
    (license) => expect(isAllowed(license)).toBe(true),
  );

  it.each(["GPL-3.0", "AGPL-3.0-only", "SSPL-1.0", "Unknown", "UNLICENSED", "", "MIT AND GPL-2.0"])(
    "rejects %s",
    (license) => expect(isAllowed(license)).toBe(false),
  );
});

describe("findViolations", () => {
  const input = {
    MIT: [{ name: "ok", versions: ["1.0.0"] }],
    "AGPL-3.0": [{ name: "bad", versions: ["2.0.0"] }],
    Unknown: [{ name: "reviewed", versions: ["3.0.0"] }],
  };

  it("flags disallowed packages", () => {
    expect(findViolations(input, {}).map((v) => v.name)).toEqual(["bad", "reviewed"]);
  });

  it("respects hand-reviewed exceptions", () => {
    const exceptions = { reviewed: "LICENSE file is MIT" };
    expect(findViolations(input, exceptions).map((v) => v.name)).toEqual(["bad"]);
  });
});
