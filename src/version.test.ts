import { describe, expect, it } from "vitest";
import { packageVersion } from "./version.js";

describe("packageVersion", () => {
  it("reads a semver string from package.json", () => {
    expect(packageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
