import { describe, it, expect } from "vitest";
import { deriveTabName } from "../name.ts";

describe("deriveTabName", () => {
  it("derives DangDM from Đoàn Minh Đăng", () => {
    expect(deriveTabName("Đoàn Minh Đăng")).toBe("DangDM");
  });

  it("derives HieuNT from Nguyễn Trọng Hiếu", () => {
    expect(deriveTabName("Nguyễn Trọng Hiếu")).toBe("HieuNT");
  });

  it("treats Đ as D in the given name", () => {
    expect(deriveTabName("Lê Đức")).toBe("DucL");
  });

  it("handles single-word names (no initials)", () => {
    expect(deriveTabName("Linh")).toBe("Linh");
  });

  it("handles four-word names", () => {
    expect(deriveTabName("Trần Thị Mỹ Linh")).toBe("LinhTTM");
  });

  it("trims and collapses whitespace", () => {
    expect(deriveTabName("  Đoàn   Minh   Đăng  ")).toBe("DangDM");
  });

  it("throws on empty input", () => {
    expect(() => deriveTabName("   ")).toThrow(/empty/i);
  });
});
