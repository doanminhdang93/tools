import { describe, it, expect } from "vitest";
import { parseTab, findSection } from "./parser.ts";

const HEADER_ROW = [
  "Month & Stt",
  "Task title",
  "link",
  "App",
  "Staging test",
  "Type",
  "Status",
  "Point",
  "Money",
  "Note",
];

describe("parseTab", () => {
  it("returns empty parse for empty input", () => {
    const parsed = parseTab([]);
    expect(parsed.sections).toHaveLength(0);
    expect(parsed.totalRowCount).toBe(0);
  });

  it("parses a single month section with tasks", () => {
    const rows = [
      HEADER_ROW,
      ["4/2025", "", "", "", "", "", "", "103", "4635000", ""],
      ["", "Task 1", "url-1", "PPU", "", "Feature", "Done", "2", "", ""],
      ["", "Task 2", "url-2", "PPU", "", "Feature", "Done", "3", "", ""],
    ];

    const parsed = parseTab(rows);

    expect(parsed.sections).toHaveLength(1);
    const section = parsed.sections[0];
    expect(section.monthLabel).toBe("4/2025");
    expect(section.headerRowIndex).toBe(2);
    expect(section.taskRows).toHaveLength(2);
    expect(section.firstTaskRowIndex).toBe(3);
    expect(section.lastRowIndex).toBe(4);
  });

  it("splits multiple sections on blank separator rows", () => {
    const rows = [
      HEADER_ROW,
      ["4/2025", "", "", "", "", "", "", "100", "4500000", ""],
      ["", "T1", "u1", "PPU", "", "Feature", "Done", "5", "", ""],
      [],
      ["5/2025", "", "", "", "", "", "", "200", "9000000", ""],
      ["", "T2", "u2", "BS", "", "Hotfix", "Done", "3", "", ""],
    ];

    const parsed = parseTab(rows);

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].monthLabel).toBe("4/2025");
    expect(parsed.sections[0].lastRowIndex).toBe(3);
    expect(parsed.sections[1].monthLabel).toBe("5/2025");
    expect(parsed.sections[1].headerRowIndex).toBe(5);
  });

  it("findSection locates by month label", () => {
    const rows = [
      HEADER_ROW,
      ["4/2025", "", "", "", "", "", "", "100", "4500000", ""],
      ["", "T1", "u1", "PPU", "", "Feature", "Done", "5", "", ""],
    ];
    const parsed = parseTab(rows);

    expect(findSection(parsed, "4/2025")?.monthLabel).toBe("4/2025");
    expect(findSection(parsed, "4/2099")).toBeUndefined();
  });

  it("accepts month label with single-digit month", () => {
    const rows = [HEADER_ROW, ["9/2025", "", "", "", "", "", "", "0", "0", ""]];
    const parsed = parseTab(rows);
    expect(parsed.sections[0].monthLabel).toBe("9/2025");
  });

  it("ignores stray task rows before any month header", () => {
    const rows = [
      HEADER_ROW,
      ["", "Stray", "u", "PPU", "", "Feature", "Done", "1", "", ""],
      ["4/2025", "", "", "", "", "", "", "0", "0", ""],
      ["", "T1", "u1", "PPU", "", "Feature", "Done", "5", "", ""],
    ];

    const parsed = parseTab(rows);

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].taskRows).toHaveLength(1);
  });
});
