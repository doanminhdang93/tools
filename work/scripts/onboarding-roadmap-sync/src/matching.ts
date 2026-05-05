import { createHash } from "node:crypto";

export function normaliseText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function hashContent(input: string): string {
  const normalised = normaliseText(input);
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}
