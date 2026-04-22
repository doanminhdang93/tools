export type NotionProperty = { type: string; [key: string]: unknown };

type PlainTextSegment = { plain_text?: string };
type NamedItem = { name?: string | null };

type Handler = (property: NotionProperty) => string;

function joinPlainText(segments: PlainTextSegment[]): string {
  return segments.map((segment) => segment.plain_text ?? "").join("");
}

function joinNames(items: NamedItem[]): string {
  return items
    .map((item) => item.name ?? "")
    .filter((name) => name.length > 0)
    .join(", ");
}

function formatDateRange(date: { start: string; end: string | null } | null): string {
  if (!date) return "";
  if (!date.end) return date.start;
  return `${date.start} → ${date.end}`;
}

function formatUniqueId(uniqueId: { prefix: string | null; number: number }): string {
  if (!uniqueId.prefix) return String(uniqueId.number);
  return `${uniqueId.prefix}-${uniqueId.number}`;
}

const HANDLERS: Record<string, Handler> = {
  title: (property) => joinPlainText(property.title as PlainTextSegment[]),
  rich_text: (property) => joinPlainText(property.rich_text as PlainTextSegment[]),
  status: (property) => (property.status as NamedItem | null)?.name ?? "",
  select: (property) => (property.select as NamedItem | null)?.name ?? "",
  multi_select: (property) => joinNames(property.multi_select as NamedItem[]),
  people: (property) => joinNames(property.people as NamedItem[]),
  date: (property) => formatDateRange(property.date as { start: string; end: string | null } | null),
  created_time: (property) => (property.created_time as string) ?? "",
  last_edited_time: (property) => (property.last_edited_time as string) ?? "",
  unique_id: (property) => formatUniqueId(property.unique_id as { prefix: string | null; number: number }),
  relation: (property) => (property.relation as { id: string }[]).map((related) => related.id).join(", "),
  checkbox: (property) => ((property.checkbox as boolean) ? "✓" : ""),
  number: (property) => {
    const value = property.number as number | null | undefined;
    if (value === null || value === undefined) return "";
    return String(value);
  },
  url: (property) => (property.url as string | null) ?? "",
  email: (property) => (property.email as string | null) ?? "",
  phone_number: (property) => (property.phone_number as string | null) ?? "",
};

export function propertyToCell(property: NotionProperty): string {
  const handler = HANDLERS[property.type];
  if (!handler) return "";
  return handler(property);
}
