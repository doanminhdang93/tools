import { describe, it, expect } from "vitest";
import { propertyToCell } from "../transform.ts";

describe("propertyToCell", () => {
  it("title — concatenates all plain_text segments", () => {
    const property = {
      type: "title",
      title: [{ plain_text: "Fix " }, { plain_text: "bug" }],
    };
    expect(propertyToCell(property)).toBe("Fix bug");
  });

  it("title — empty returns empty string", () => {
    expect(propertyToCell({ type: "title", title: [] })).toBe("");
  });

  it("rich_text — concatenates segments", () => {
    const property = {
      type: "rich_text",
      rich_text: [{ plain_text: "line1 " }, { plain_text: "line2" }],
    };
    expect(propertyToCell(property)).toBe("line1 line2");
  });

  it("status — returns the name", () => {
    expect(
      propertyToCell({ type: "status", status: { name: "In Progress" } }),
    ).toBe("In Progress");
  });

  it("status — null returns empty", () => {
    expect(propertyToCell({ type: "status", status: null })).toBe("");
  });

  it("select — returns name or empty", () => {
    expect(propertyToCell({ type: "select", select: { name: "High" } })).toBe(
      "High",
    );
    expect(propertyToCell({ type: "select", select: null })).toBe("");
  });

  it("multi_select — joins names with comma + space", () => {
    const property = {
      type: "multi_select",
      multi_select: [{ name: "bug" }, { name: "urgent" }],
    };
    expect(propertyToCell(property)).toBe("bug, urgent");
  });

  it("people — joins names, skips entries without name", () => {
    const property = {
      type: "people",
      people: [{ name: "Alice" }, { name: "Bob" }, { name: null }],
    };
    expect(propertyToCell(property)).toBe("Alice, Bob");
  });

  it("date — single start date returns start", () => {
    expect(
      propertyToCell({ type: "date", date: { start: "2026-05-01", end: null } }),
    ).toBe("2026-05-01");
  });

  it("date — start + end returns 'start → end'", () => {
    expect(
      propertyToCell({
        type: "date",
        date: { start: "2026-05-01", end: "2026-05-03" },
      }),
    ).toBe("2026-05-01 → 2026-05-03");
  });

  it("created_time — returns the timestamp as-is", () => {
    expect(
      propertyToCell({
        type: "created_time",
        created_time: "2026-04-22T10:00:00Z",
      }),
    ).toBe("2026-04-22T10:00:00Z");
  });

  it("unique_id — returns PREFIX-NUMBER when prefix exists", () => {
    expect(
      propertyToCell({
        type: "unique_id",
        unique_id: { prefix: "TASK", number: 42 },
      }),
    ).toBe("TASK-42");
  });

  it("unique_id — returns NUMBER only when prefix is null", () => {
    expect(
      propertyToCell({
        type: "unique_id",
        unique_id: { prefix: null, number: 7 },
      }),
    ).toBe("7");
  });

  it("relation — joins related page IDs with comma + space", () => {
    const property = {
      type: "relation",
      relation: [{ id: "page-1" }, { id: "page-2" }],
    };
    expect(propertyToCell(property)).toBe("page-1, page-2");
  });

  it("checkbox — true maps to ✓, false maps to empty", () => {
    expect(propertyToCell({ type: "checkbox", checkbox: true })).toBe("✓");
    expect(propertyToCell({ type: "checkbox", checkbox: false })).toBe("");
  });

  it("number — returns string representation, null returns empty", () => {
    expect(propertyToCell({ type: "number", number: 3.14 })).toBe("3.14");
    expect(propertyToCell({ type: "number", number: null })).toBe("");
  });

  it("unknown type — returns empty string (no crash)", () => {
    expect(propertyToCell({ type: "something_unsupported" })).toBe("");
  });
});
