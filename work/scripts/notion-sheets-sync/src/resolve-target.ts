import type { ParsedTab, MonthSection } from "./sheets/parser.ts";
import { isNonDefaultFill, type RgbColor } from "./sheets/client.ts";
import { currentMonthLabel, previousMonthLabel } from "./util/month.ts";

export function isSectionClosed(
  section: MonthSection,
  parsed: ParsedTab,
  columnABackgrounds: RgbColor[],
): boolean {
  const sectionIndex = parsed.sections.indexOf(section);
  if (sectionIndex < parsed.sections.length - 1) return true;

  const separatorRowOneBased = section.lastRowIndex + 1;
  const separatorRowZeroBased = separatorRowOneBased - 1;
  const fill = columnABackgrounds[separatorRowZeroBased];
  return isNonDefaultFill(fill);
}

export function resolveTargetMonthLabel(
  parsed: ParsedTab,
  columnABackgrounds: RgbColor[],
  now: Date,
): string {
  const currentLabel = currentMonthLabel(now);
  const previousLabel = previousMonthLabel(currentLabel);

  const currentSection = parsed.sections.find((section) => section.monthLabel === currentLabel);
  if (currentSection && !isSectionClosed(currentSection, parsed, columnABackgrounds)) {
    return currentLabel;
  }

  const previousSection = parsed.sections.find((section) => section.monthLabel === previousLabel);
  if (previousSection && !isSectionClosed(previousSection, parsed, columnABackgrounds)) {
    return previousLabel;
  }

  return currentLabel;
}
