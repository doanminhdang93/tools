import { describe, it, expect } from "vitest";
import { parseTab } from "./sheets/parser.ts";
import { resolveTargetMonthLabel, isSectionClosed } from "./resolve-target.ts";
import type { RgbColor } from "./sheets/client.ts";

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
  "Assignees",
  "Followers",
  "Note",
];

const DEFAULT_WHITE: RgbColor = { red: 1, green: 1, blue: 1 };
const PURPLE: RgbColor = { red: 0.6, green: 0.4, blue: 0.9 };

function whiteBackgrounds(rowCount: number): RgbColor[] {
  return Array.from({ length: rowCount }, () => ({ ...DEFAULT_WHITE }));
}

const MAY_3_2026 = new Date("2026-05-03T03:00:00Z");

describe("isSectionClosed", () => {
  it("marks a non-last section as closed", () => {
    const rows = [
      HEADER_ROW,
      ["3/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "March task", "url-1", "", "", "", "Done", "1", "", ""],
      [],
      ["4/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "April task", "url-2", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    const march = parsed.sections[0];
    expect(isSectionClosed(march, parsed, whiteBackgrounds(rows.length))).toBe(true);
  });

  it("treats a last section with styled separator below as closed", () => {
    const rows = [
      HEADER_ROW,
      ["4/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "April task", "url-1", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    const backgrounds = whiteBackgrounds(rows.length + 1);
    backgrounds[rows.length] = PURPLE;
    const april = parsed.sections[0];
    expect(isSectionClosed(april, parsed, backgrounds)).toBe(true);
  });

  it("treats a last section without styled separator as open", () => {
    const rows = [
      HEADER_ROW,
      ["4/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "April task", "url-1", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    const april = parsed.sections[0];
    expect(isSectionClosed(april, parsed, whiteBackgrounds(rows.length + 3))).toBe(false);
  });
});

describe("resolveTargetMonthLabel", () => {
  it("targets previous month when its section is the last and open (screenshot scenario)", () => {
    const rows = [
      HEADER_ROW,
      ["3/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "March task", "u", "", "", "", "Done", "1", "", ""],
      [],
      ["4/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "April task", "u", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    expect(resolveTargetMonthLabel(parsed, whiteBackgrounds(rows.length), MAY_3_2026)).toBe(
      "4/2026",
    );
  });

  it("targets current month when previous month is closed", () => {
    const rows = [
      HEADER_ROW,
      ["4/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "April task", "u", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    const backgrounds = whiteBackgrounds(rows.length + 1);
    backgrounds[rows.length] = PURPLE;
    expect(resolveTargetMonthLabel(parsed, backgrounds, MAY_3_2026)).toBe("5/2026");
  });

  it("targets current month when no relevant sections exist", () => {
    const rows = [
      HEADER_ROW,
      ["3/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "March task", "u", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    expect(resolveTargetMonthLabel(parsed, whiteBackgrounds(rows.length), MAY_3_2026)).toBe(
      "5/2026",
    );
  });

  it("targets current month when its own section is open", () => {
    const rows = [
      HEADER_ROW,
      ["4/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "April task", "u", "", "", "", "Done", "1", "", ""],
      [],
      ["5/2026", "", "", "", "", "", "", "0", "0", ""],
      ["", "May task", "u", "", "", "", "Done", "1", "", ""],
    ];
    const parsed = parseTab(rows);
    expect(resolveTargetMonthLabel(parsed, whiteBackgrounds(rows.length), MAY_3_2026)).toBe(
      "5/2026",
    );
  });

  it("targets current month when sheet has no sections", () => {
    const rows = [HEADER_ROW];
    const parsed = parseTab(rows);
    expect(resolveTargetMonthLabel(parsed, whiteBackgrounds(rows.length), MAY_3_2026)).toBe(
      "5/2026",
    );
  });
});
