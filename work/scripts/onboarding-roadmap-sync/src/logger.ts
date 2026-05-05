type Counters = { created: number; updated: number; skipped: number; orphans: number };

export function makeCounters(): Counters {
  return { created: 0, updated: 0, skipped: 0, orphans: 0 };
}

export const log = {
  info: (msg: string) => console.log(msg),
  ok: (msg: string) => console.log(`✓ ${msg}`),
  warn: (msg: string) => console.warn(`⚠ ${msg}`),
  error: (msg: string) => console.error(`✗ ${msg}`),
  summary: (c: Counters) =>
    console.log(
      `\nCreated ${c.created}, Updated ${c.updated}, Skipped ${c.skipped}, Orphans ${c.orphans}`,
    ),
};
