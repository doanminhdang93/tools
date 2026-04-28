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
 *  5. Copy the worker URL (e.g. https://tools-sync-trigger.<account>.workers.dev) and put
 *     it in .token.env as WORKER_URL=https://tools-sync-trigger.<account>.workers.dev
 *  6. Re-run `npx tsx commands/summary-tab.ts` so the Sync buttons appear in the Summary tab.
 *
 * Query parameters:
 *   ?recent3=1                 → fire 3 dispatches for previous/current/next month
 *   ?recent3=1&tab=DangDM      → same, scoped to a single tab
 *   ?month=4/2026              → single dispatch for a specific month
 *   ?tab=DangDM                → single dispatch for a single tab in current month
 *   (no params)                → single dispatch, sync all members for current month
 */

const REPO = "doanminhdang93/tools";
const WORKFLOW_FILE = "notion-sheets-sync.yml";
const REF = "main";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const tab = (url.searchParams.get("tab") || "").trim();
    const month = (url.searchParams.get("month") || "").trim();
    const recent3 = url.searchParams.get("recent3") === "1";

    if (recent3) {
      const months = computeRecent3Months(new Date());
      const dispatches = months.map((targetMonth) =>
        dispatchWorkflow(env.GH_TOKEN, tab ? { tab, month: targetMonth } : { month: targetMonth }),
      );
      const results = await Promise.all(dispatches);
      const failures = results.filter((result) => result.status !== 204);
      if (failures.length > 0) {
        const detail = failures
          .map((failure) => `${failure.month}: HTTP ${failure.status}\n${failure.body}`)
          .join("\n\n");
        return htmlResponse(errorPage(`${failures.length} of ${results.length} dispatches failed`, detail), 500);
      }
      return htmlResponse(successPageMulti(tab, months), 200);
    }

    const inputs = {};
    if (tab) inputs.tab = tab;
    if (month) inputs.month = month;
    const result = await dispatchWorkflow(env.GH_TOKEN, inputs);
    if (result.status === 204) {
      return htmlResponse(successPage(tab, month), 200);
    }
    return htmlResponse(errorPage(`HTTP ${result.status}`, result.body), 500);
  },
};

async function dispatchWorkflow(token, inputs) {
  const dispatchUrl = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const response = await fetch(dispatchUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cf-worker-sync-trigger",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: REF, inputs }),
  });
  return {
    status: response.status,
    month: inputs.month ?? "(current)",
    body: response.status === 204 ? "" : await response.text(),
  };
}

function computeRecent3Months(now) {
  const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const baseMonth = vietnamNow.getUTCMonth() + 1;
  const baseYear = vietnamNow.getUTCFullYear();
  const labels = [];
  for (const offset of [-1, 0, 1]) {
    let month = baseMonth + offset;
    let year = baseYear;
    if (month < 1) {
      month += 12;
      year -= 1;
    }
    if (month > 12) {
      month -= 12;
      year += 1;
    }
    labels.push(`${month}/${year}`);
  }
  return labels;
}

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function successPage(tab, month) {
  const scope = tab ? `tab <code>${escapeHtml(tab)}</code>` : "all members";
  const monthNote = month ? ` — month <code>${escapeHtml(month)}</code>` : "";
  return wrapPage(
    `<h1 style="color:#2e7d32">✅ Sync triggered</h1>
     <p>Triggered for ${scope}${monthNote}.</p>`,
  );
}

function successPageMulti(tab, months) {
  const scope = tab ? `tab <code>${escapeHtml(tab)}</code>` : "all members";
  const monthList = months.map((label) => `<li><code>${escapeHtml(label)}</code></li>`).join("");
  return wrapPage(
    `<h1 style="color:#2e7d32">✅ ${months.length} syncs triggered</h1>
     <p>Scope: ${scope}</p>
     <p>Months queued (run sequentially via concurrency group):</p>
     <ul style="text-align:left;display:inline-block">${monthList}</ul>`,
  );
}

function errorPage(title, body) {
  return wrapPage(
    `<h1 style="color:#c62828">❌ ${escapeHtml(title)}</h1>
     <pre style="background:#f5f5f5;padding:16px;overflow:auto;border-radius:6px;text-align:left">${escapeHtml(body)}</pre>`,
  );
}

function wrapPage(innerHtml) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Sync trigger</title></head>
<body style="font-family:system-ui,sans-serif;max-width:640px;margin:80px auto;padding:24px;text-align:center;line-height:1.6">
  ${innerHtml}
  <p style="color:#666;font-size:14px;margin-top:24px">
    Check <a href="https://github.com/${REPO}/actions" target="_blank" rel="noopener">GitHub Actions</a> for progress. You can close this tab.
  </p>
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
