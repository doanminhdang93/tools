import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.ts";

const REQUIRED_ENV = {
  NOTION_API_KEY: "secret_abc",
  NOTION_DATABASE_ID: "database_id_123",
  GOOGLE_SHEETS_ID: "sheet_id_456",
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: "./service-account.json",
};

const MANAGED_KEYS = [
  ...Object.keys(REQUIRED_ENV),
  "SLACK_BOT_TOKEN",
  "NOTIFY_ON_ERROR_CHANNEL",
];

describe("loadConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of MANAGED_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      const previousValue = savedEnv[key];
      if (previousValue === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = previousValue;
    }
  });

  it("loads valid config when all required vars are set", () => {
    Object.assign(process.env, REQUIRED_ENV);

    const config = loadConfig();

    expect(config.notionApiKey).toBe("secret_abc");
    expect(config.notionDatabaseId).toBe("database_id_123");
    expect(config.googleSheetsId).toBe("sheet_id_456");
    expect(config.googleServiceAccountKeyFile).toBe("./service-account.json");
    expect(config.slackBotToken).toBeUndefined();
    expect(config.notifyOnErrorChannel).toBeUndefined();
  });

  it("throws when NOTION_API_KEY is missing", () => {
    const partial = { ...REQUIRED_ENV };
    delete (partial as Record<string, string>).NOTION_API_KEY;
    Object.assign(process.env, partial);

    expect(() => loadConfig()).toThrow(/NOTION_API_KEY/);
  });

  it("treats empty NOTIFY_ON_ERROR_CHANNEL as undefined", () => {
    Object.assign(process.env, REQUIRED_ENV, { NOTIFY_ON_ERROR_CHANNEL: "" });

    const config = loadConfig();

    expect(config.notifyOnErrorChannel).toBeUndefined();
  });

  it("exposes Slack bot token and channel when both are set", () => {
    Object.assign(process.env, REQUIRED_ENV, {
      SLACK_BOT_TOKEN: "xoxb-test-token",
      NOTIFY_ON_ERROR_CHANNEL: "#alerts",
    });

    const config = loadConfig();

    expect(config.slackBotToken).toBe("xoxb-test-token");
    expect(config.notifyOnErrorChannel).toBe("#alerts");
  });
});
