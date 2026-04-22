export function currentMonthLabel(now: Date = new Date()): string {
  return formatMonthLabel(now.getUTCMonth() + 1, now.getUTCFullYear());
}

export function monthLabelFromIsoString(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`monthLabelFromIsoString: invalid ISO string "${isoString}"`);
  }
  return formatMonthLabel(date.getUTCMonth() + 1, date.getUTCFullYear());
}

function formatMonthLabel(month: number, year: number): string {
  return `${month}/${year}`;
}
