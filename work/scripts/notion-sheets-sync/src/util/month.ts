const VIETNAM_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;

function toVietnamTime(date: Date): Date {
  return new Date(date.getTime() + VIETNAM_OFFSET_MILLISECONDS);
}

export function currentMonthLabel(now: Date = new Date()): string {
  const vietnamNow = toVietnamTime(now);
  return formatMonthLabel(vietnamNow.getUTCMonth() + 1, vietnamNow.getUTCFullYear());
}

export function monthLabelFromIsoString(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`monthLabelFromIsoString: invalid ISO string "${isoString}"`);
  }
  const vietnamDate = toVietnamTime(date);
  return formatMonthLabel(vietnamDate.getUTCMonth() + 1, vietnamDate.getUTCFullYear());
}

function formatMonthLabel(month: number, year: number): string {
  return `${month}/${year}`;
}

export function previousMonthLabel(monthLabel: string): string {
  const match = monthLabel.match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`previousMonthLabel: bad label "${monthLabel}"`);

  const month = Number(match[1]);
  const year = Number(match[2]);

  if (month === 1) return formatMonthLabel(12, year - 1);
  return formatMonthLabel(month - 1, year);
}

export function monthLabelToDate(monthLabel: string): Date {
  const match = monthLabel.match(/^(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`monthLabelToDate: bad label "${monthLabel}"`);

  const month = Number(match[1]);
  const year = Number(match[2]);

  if (month < 1 || month > 12) {
    throw new Error(`monthLabelToDate: month out of range in "${monthLabel}"`);
  }

  // UTC midday on the 15th stays inside the same month when converted to Vietnam time,
  // so currentMonthLabel(this) reliably returns the requested label.
  return new Date(Date.UTC(year, month - 1, 15, 12, 0, 0));
}
