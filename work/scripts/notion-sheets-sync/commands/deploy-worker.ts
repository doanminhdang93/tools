import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

loadDotenv({ path: resolve(import.meta.dirname, "../../../../.token.env") });

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const SCRIPT_NAME = process.env.CF_WORKER_NAME ?? "tools-sync-trigger";

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("Missing CF_ACCOUNT_ID or CF_API_TOKEN in .token.env");
  process.exit(1);
}
if (!GH_TOKEN) {
  console.error("Missing GH_TOKEN (or GITHUB_TOKEN) — PAT with Actions:R&W on doanminhdang93/tools");
  process.exit(1);
}

const CF_API = "https://api.cloudflare.com/client/v4";
const authHeaders = { Authorization: `Bearer ${API_TOKEN}` };

interface CloudflareEnvelope<T = unknown> {
  success: boolean;
  errors?: { code: number; message: string }[];
  result: T;
}

async function callCloudflare<T>(
  path: string,
  init: RequestInit = {},
): Promise<CloudflareEnvelope<T>> {
  const response = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  });
  const json = (await response.json()) as CloudflareEnvelope<T>;
  if (!json.success) {
    const errorList = json.errors?.map((error) => `${error.code}: ${error.message}`).join("; ");
    throw new Error(`Cloudflare API ${path} failed (HTTP ${response.status}): ${errorList ?? JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const subdomainEnvelope = await callCloudflare<{ subdomain: string }>(
    `/accounts/${ACCOUNT_ID}/workers/subdomain`,
  );
  const subdomain = subdomainEnvelope.result.subdomain;
  if (!subdomain) {
    console.error("Account doesn't have a workers.dev subdomain yet — claim one at:");
    console.error("  https://dash.cloudflare.com/?to=/:account/workers-and-pages");
    process.exit(1);
  }
  console.log(`✔ Account subdomain: ${subdomain}.workers.dev`);

  const workerScriptPath = resolve(import.meta.dirname, "cloudflare-worker.js");
  const workerCode = readFileSync(workerScriptPath, "utf8");

  const uploadForm = new FormData();
  uploadForm.append(
    "metadata",
    new Blob(
      [JSON.stringify({ main_module: "worker.js", compatibility_date: "2024-09-01" })],
      { type: "application/json" },
    ),
  );
  uploadForm.append(
    "worker.js",
    new Blob([workerCode], { type: "application/javascript+module" }),
    "worker.js",
  );
  await callCloudflare(
    `/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`,
    { method: "PUT", body: uploadForm },
  );
  console.log(`✔ Uploaded script "${SCRIPT_NAME}"`);

  await callCloudflare(
    `/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/secrets`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "GH_TOKEN", text: GH_TOKEN, type: "secret_text" }),
    },
  );
  console.log(`✔ Set GH_TOKEN secret`);

  await callCloudflare(
    `/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/subdomain`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    },
  );
  console.log(`✔ Enabled workers.dev subdomain for "${SCRIPT_NAME}"`);

  const workerUrl = `https://${SCRIPT_NAME}.${subdomain}.workers.dev`;
  console.log(`\n🎉 Deployment complete!`);
  console.log(`   Worker URL: ${workerUrl}`);
  console.log(`\nAdd this line to .token.env then re-run summary-tab.ts:`);
  console.log(`   WORKER_URL=${workerUrl}`);
}

main().catch((cause) => {
  console.error("Fatal:", cause);
  process.exit(1);
});
