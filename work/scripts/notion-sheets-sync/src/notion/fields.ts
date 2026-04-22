import type { NotionPage } from "./client.ts";

export function titleOf(page: NotionPage): string {
  const titleProperty = page.properties["product"];
  if (!titleProperty || titleProperty.type !== "title") return "";
  const segments = (titleProperty as { title?: { plain_text?: string }[] }).title ?? [];
  return segments.map((segment) => segment.plain_text ?? "").join("");
}

export function statusOf(page: NotionPage): string {
  const statusProperty = page.properties["Status"];
  if (!statusProperty || statusProperty.type !== "status") return "";
  const statusValue = (statusProperty as { status?: { name?: string } | null }).status;
  return statusValue?.name ?? "";
}

export function firstTagNameOf(page: NotionPage): string {
  const tagProperty = page.properties["Tag"];
  if (!tagProperty || tagProperty.type !== "multi_select") return "";
  const tags = (tagProperty as { multi_select?: { name?: string }[] }).multi_select ?? [];
  return tags[0]?.name ?? "";
}

export function sizeCardNumberOf(page: NotionPage): number {
  const sizeCardProperty = page.properties["Size Card"];
  if (!sizeCardProperty || sizeCardProperty.type !== "select") return 0;
  const sizeCard = (sizeCardProperty as { select?: { name?: string } | null }).select;
  if (!sizeCard?.name) return 0;
  const asNumber = Number(sizeCard.name);
  return Number.isFinite(asNumber) ? asNumber : 0;
}

export function createdTimeOf(page: NotionPage): string {
  const createdProperty = page.properties["Created time"];
  if (!createdProperty || createdProperty.type !== "created_time") return "";
  return (createdProperty as { created_time?: string }).created_time ?? "";
}
