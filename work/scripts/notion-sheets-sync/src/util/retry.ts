const RETRYABLE_PATTERN = /Premature close|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|other side closed|UND_ERR_SOCKET/i;

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);

const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 800;

export interface RetryOptions {
  label: string;
  maxAttempts?: number;
  onRetry?: (attempt: number, cause: Error) => void;
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (cause) {
      lastError = cause;
      if (!isTransientError(cause) || attempt === maxAttempts) throw cause;
      options.onRetry?.(attempt, cause as Error);
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

export function isTransientError(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const status = readNumericStatus(cause);
  if (status !== undefined && RETRYABLE_HTTP_STATUS.has(status)) return true;

  const message = (cause as { message?: string }).message ?? "";
  if (RETRYABLE_PATTERN.test(message)) return true;

  const innerCause = (cause as { cause?: unknown }).cause;
  if (innerCause) return isTransientError(innerCause);

  return false;
}

function readNumericStatus(cause: unknown): number | undefined {
  const possibleStatus = (cause as { status?: unknown; code?: unknown }).status
    ?? (cause as { status?: unknown; code?: unknown }).code;
  if (typeof possibleStatus === "number") return possibleStatus;
  if (typeof possibleStatus === "string") {
    const parsed = Number(possibleStatus);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveAfter) => setTimeout(resolveAfter, ms));
}
