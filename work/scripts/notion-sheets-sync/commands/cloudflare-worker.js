/**
 * Cloudflare Worker — proxy from Sheet HYPERLINK to GitHub Actions workflow_dispatch.
 *
 * Setup (one-time):
 *  1. Sign up at https://dash.cloudflare.com (free).
 *  2. Workers & Pages → Create → Create Worker → name it (e.g. tools-sync-trigger).
 *  3. Edit code → paste this whole file → Save and deploy.
 *  4. Settings → Variables and Secrets → Add variable:
 *       Name:  GH_TOKEN
 *       Value: <fine-grained PAT with Actions: Read and write on doanminhdang93/tools>
 *       Type:  Secret (encrypted)
 *  5. Copy the worker URL (e.g. https://tools-sync-trigger.<account>.workers.dev).
 *  6. In the Sheet, paste these into any cells:
 *       =HYPERLINK("https://tools-sync-trigger.<account>.workers.dev/", "🔄 Re-sync all")
 *       =HYPERLINK("https://tools-sync-trigger.<account>.workers.dev/?tab=DangDM", "🔄 Re-sync DangDM")
 *
 * Anyone with view access to the Sheet can click the link — the PAT lives only
 * in Cloudflare env (never exposed to the browser).
 */

const REPO = "doanminhdang93/tools";
const WORKFLOW_FILE = "notion-sheets-sync.yml";
const REF = "main";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const tab = (url.searchParams.get("tab") || "").trim();
    const month = (url.searchParams.get("month") || "").trim();

    const inputs = {};
    if (tab) inputs.tab = tab;
    if (month) inputs.month = month;

    const dispatchUrl = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
    const ghResponse = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cf-worker-sync-trigger",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: REF, inputs }),
    });

    if (ghResponse.status === 204) {
      return htmlResponse(successPage(tab, month), 200);
    }

    const errorBody = await ghResponse.text();
    return htmlResponse(errorPage(ghResponse.status, errorBody), 500);
  },
};

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function successPage(tab, month) {
  const scope = tab ? `tab <code>${escapeHtml(tab)}</code>` : "all members";
  const monthNote = month ? ` — month <code>${escapeHtml(month)}</code>` : "";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sync triggered</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:80px auto;padding:24px;text-align:center;line-height:1.6">
  <h1 style="color:#2e7d32">✅ Sync triggered</h1>
  <p>Triggered for ${scope}${monthNote}.</p>
  <p>Check <a href="https://github.com/${REPO}/actions" target="_blank" rel="noopener">GitHub Actions</a> for progress.</p>
  <p style="color:#666;font-size:14px">You can close this tab.</p>
</body></html>`;
}

function errorPage(status, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sync failed</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:80px auto;padding:24px;line-height:1.6">
  <h1 style="color:#c62828">❌ Failed (HTTP ${status})</h1>
  <pre style="background:#f5f5f5;padding:16px;overflow:auto;border-radius:6px">${escapeHtml(body)}</pre>
</body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
