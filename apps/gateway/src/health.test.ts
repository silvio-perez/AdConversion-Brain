import { describe, expect, it } from "vitest";
import { health } from "./health.js";

describe("health", () => {
  it("reports the gateway as ok", () => {
    expect(health()).toEqual({ service: "brain-gateway", status: "ok" });
  });
});
