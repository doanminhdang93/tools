import { describe, it, expect, vi } from "vitest";
import { isTransientError, withRetry } from "./retry.ts";

describe("isTransientError", () => {
  it("flags Premature close", () => {
    expect(isTransientError(new Error("Invalid response body … Premature close"))).toBe(true);
  });

  it("flags fetch failed", () => {
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
  });

  it("flags ECONNRESET / ETIMEDOUT / EAI_AGAIN", () => {
    expect(isTransientError(new Error("read ECONNRESET"))).toBe(true);
    expect(isTransientError(new Error("connect ETIMEDOUT"))).toBe(true);
    expect(isTransientError(new Error("getaddrinfo EAI_AGAIN"))).toBe(true);
  });

  it("flags retryable HTTP status codes", () => {
    expect(isTransientError({ status: 429, message: "rate limit" })).toBe(true);
    expect(isTransientError({ status: 503, message: "down" })).toBe(true);
    expect(isTransientError({ code: 502, message: "bad gateway" })).toBe(true);
  });

  it("walks through .cause chains", () => {
    const outer = new Error("wrap");
    (outer as Error & { cause: unknown }).cause = new Error("UND_ERR_SOCKET");
    expect(isTransientError(outer)).toBe(true);
  });

  it("rejects non-transient errors", () => {
    expect(isTransientError(new Error("permission denied"))).toBe(false);
    expect(isTransientError({ status: 404, message: "not found" })).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError("string error")).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the value on first success", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(operation, { label: "test" });
    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries on transient errors and eventually succeeds", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("Premature close"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue("recovered");
    const onRetry = vi.fn();
    const result = await withRetry(operation, { label: "test", onRetry, maxAttempts: 4 });
    expect(result).toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("does not retry non-transient errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("permission denied"));
    await expect(withRetry(operation, { label: "test" })).rejects.toThrow("permission denied");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("rethrows after exhausting attempts", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Premature close"));
    await expect(withRetry(operation, { label: "test", maxAttempts: 2 })).rejects.toThrow("Premature close");
    expect(operation).toHaveBeenCalledTimes(2);
  }, 10_000);
});
