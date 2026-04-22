import { COLUMN_INDEX, MONTH_HEADER_PATTERN } from "./constants.ts";

export interface MonthSection {
  monthLabel: string;
  headerRowIndex: number;
  taskRows: string[][];
  firstTaskRowIndex: number;
  lastRowIndex: number;
}

export interface ParsedTab {
  headerRow: string[];
  sections: MonthSection[];
  totalRowCount: number;
}

export function parseTab(rows: string[][]): ParsedTab {
  if (rows.length === 0) {
    return { headerRow: [], sections: [], totalRowCount: 0 };
  }

  const sections: MonthSection[] = [];
  let currentSection: MonthSection | null = null;

  for (let rowOffset = 1; rowOffset < rows.length; rowOffset++) {
    const row = rows[rowOffset];
    const rowIndex = rowOffset + 1;
    const monthCell = row?.[COLUMN_INDEX.month] ?? "";

    if (MONTH_HEADER_PATTERN.test(monthCell)) {
      if (currentSection) finalizeSection(currentSection, rowIndex - 1);
      currentSection = {
        monthLabel: monthCell,
        headerRowIndex: rowIndex,
        taskRows: [],
        firstTaskRowIndex: rowIndex + 1,
        lastRowIndex: rowIndex,
      };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection) continue;

    if (isEmptyRow(row)) {
      finalizeSection(currentSection, rowIndex - 1);
      currentSection = null;
      continue;
    }

    currentSection.taskRows.push(row);
  }

  if (currentSection) finalizeSection(currentSection, rows.length);

  return { headerRow: rows[0], sections, totalRowCount: rows.length };
}

function finalizeSection(section: MonthSection, lastRowIndex: number): void {
  section.lastRowIndex = lastRowIndex;
}

function isEmptyRow(row: string[] | undefined): boolean {
  if (!row) return true;
  return row.every((cell) => (cell ?? "").toString().trim().length === 0);
}

export function findSection(parsed: ParsedTab, monthLabel: string): MonthSection | undefined {
  return parsed.sections.find((section) => section.monthLabel === monthLabel);
}
