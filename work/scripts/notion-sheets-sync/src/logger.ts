const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export interface Logger {
  info(message: string): void;
  warn(message: string, cause?: unknown): void;
  error(message: string, cause?: unknown): void;
  notifyFailure(summary: string): Promise<void>;
  notifySuccess(summary: string): Promise<void>;
}

export interface LoggerOptions {
  slackBotToken?: string;
  notifyChannel?: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(options: LoggerOptions): Logger {
  const failureNotifier = buildSlackNotifier(options, ":rotating_light: notion-sheets-sync failed");
  const successNotifier = buildSlackNotifier(options, ":white_check_mark: notion-sheets-sync OK");

  return {
    info(message) {
      console.log(`[${timestamp()}] INFO  ${message}`);
    },
    warn(message, cause) {
      console.warn(`[${timestamp()}] WARN  ${message}`, cause ?? "");
    },
    error(message, cause) {
      console.error(`[${timestamp()}] ERROR ${message}`, cause ?? "");
    },
    notifyFailure: failureNotifier,
    notifySuccess: successNotifier,
  };
}

function buildSlackNotifier(
  options: LoggerOptions,
  headerLine: string,
): (summary: string) => Promise<void> {
  const { slackBotToken, notifyChannel } = options;

  if (!slackBotToken || !notifyChannel) {
    return async () => {};
  }

  return async (summary) => {
    try {
      const response = await fetch(SLACK_POST_MESSAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${slackBotToken}`,
        },
        body: JSON.stringify({
          channel: notifyChannel,
          text: `${headerLine}\n\`\`\`${summary}\`\`\``,
        }),
      });

      if (response.ok) return;
      console.error(`Slack notify failed: HTTP ${response.status}`);
    } catch (cause) {
      console.error("Slack notify threw:", cause);
    }
  };
}
