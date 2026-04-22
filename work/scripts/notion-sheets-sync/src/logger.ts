const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

export interface Logger {
  info(message: string): void;
  warn(message: string, cause?: unknown): void;
  error(message: string, cause?: unknown): void;
  notifyFailure(summary: string): Promise<void>;
}

export interface LoggerOptions {
  slackBotToken?: string;
  notifyChannel?: string;
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createLogger(options: LoggerOptions): Logger {
  const slackNotifier = buildSlackNotifier(options);

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
    notifyFailure: slackNotifier,
  };
}

function buildSlackNotifier(options: LoggerOptions): (summary: string) => Promise<void> {
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
          text: `:rotating_light: notion-sheets-sync failed\n\`\`\`${summary}\`\`\``,
        }),
      });

      if (response.ok) return;
      console.error(`Slack notify failed: HTTP ${response.status}`);
    } catch (cause) {
      console.error("Slack notify threw:", cause);
    }
  };
}
