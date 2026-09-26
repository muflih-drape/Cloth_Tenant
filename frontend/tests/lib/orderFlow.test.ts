import { describe, it, expect } from "vitest";
import {
  buildOrderCreatePayload,
  extractErrorMessage,
  getOrderAfterPlacePath,
  getOrderBasePath,
  AGENT_ORDER_BASE_PATH,
  ADMIN_ORDER_BASE_PATH,
} from "../../lib/orderFlow";

describe("getOrderBasePath", () => {
  it("returns the agent base path for agent mode", () => {
    expect(getOrderBasePath("agent")).toBe(AGENT_ORDER_BASE_PATH);
    expect(getOrderBasePath("agent")).toBe("/agent/order/new");
  });

  it("returns the admin base path for admin mode", () => {
    expect(getOrderBasePath("admin")).toBe(ADMIN_ORDER_BASE_PATH);
    expect(getOrderBasePath("admin")).toBe("/admin/order/new");
  });
});

describe("getOrderAfterPlacePath", () => {
  it("sends agents to the order form after placing", () => {
    expect(getOrderAfterPlacePath("agent", 42)).toBe(
      "/agent/order/orderform",
    );
  });

  it("sends admins to the order status page after placing", () => {
    expect(getOrderAfterPlacePath("admin", 42)).toBe(
      "/admin/order/status/42",
    );
  });
});

describe("buildOrderCreatePayload", () => {
  it("sends the customer, draft status and assigned agent", () => {
    expect(buildOrderCreatePayload(7, 3)).toEqual({
      customer: 7,
      status: "DRAFT",
      agent: 3,
    });
  });
});

describe("extractErrorMessage", () => {
  const fallback = "Failed to create order";

  it("returns a top-level error string", () => {
    expect(extractErrorMessage({ error: "Boom" }, fallback)).toBe("Boom");
  });

  it("returns a detail string", () => {
    expect(extractErrorMessage({ detail: "Nope" }, fallback)).toBe("Nope");
  });

  it("returns the first field error (DRF style)", () => {
    expect(
      extractErrorMessage({ agent: ["An agent is required."] }, fallback),
    ).toBe("An agent is required.");
  });

  it("falls back when nothing usable is present", () => {
    expect(extractErrorMessage(null, fallback)).toBe(fallback);
    expect(extractErrorMessage({}, fallback)).toBe(fallback);
  });
});
