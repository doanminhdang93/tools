import { z } from "zod";

const ConfigSchema = z.object({
  NOTION_API_KEY: z.string().min(1, "NOTION_API_KEY is required"),
  NOTION_DATABASE_ID: z.string().min(1, "NOTION_DATABASE_ID is required"),
  GOOGLE_SHEETS_ID: z.string().min(1, "GOOGLE_SHEETS_ID is required"),
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE: z.string().min(1, "GOOGLE_SERVICE_ACCOUNT_KEY_FILE is required"),
  SLACK_BOT_TOKEN: z.string().optional(),
  NOTIFY_ON_ERROR_CHANNEL: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export interface Config {
  notionApiKey: string;
  notionDatabaseId: string;
  googleSheetsId: string;
  googleServiceAccountKeyFile: string;
  slackBotToken?: string;
  notifyOnErrorChannel?: string;
}

function formatValidationError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  return `Config error: ${details}`;
}

export function loadConfig(): Config {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(formatValidationError(result.error));
  }

  const environment = result.data;
  return {
    notionApiKey: environment.NOTION_API_KEY,
    notionDatabaseId: environment.NOTION_DATABASE_ID,
    googleSheetsId: environment.GOOGLE_SHEETS_ID,
    googleServiceAccountKeyFile: environment.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
    slackBotToken: environment.SLACK_BOT_TOKEN,
    notifyOnErrorChannel: environment.NOTIFY_ON_ERROR_CHANNEL,
  };
}
