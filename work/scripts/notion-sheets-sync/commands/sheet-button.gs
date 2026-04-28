/**
 * Apps Script for the Re-sync button in the Google Sheet.
 *
 * Setup (one-time):
 *  1. In the Sheet: Extensions → Apps Script → paste this whole file.
 *  2. Project Settings → Script Properties → add property:
 *       Name:  GH_TOKEN
 *       Value: <fine-grained PAT with Actions: read & write on doanminhdang93/tools>
 *  3. Reload the Sheet — the "🔄 Sync" menu appears.
 *
 * The PAT does NOT need any other scope. Use a fine-grained token
 * scoped to the single repo.
 */

const REPO = "doanminhdang93/tools";
const WORKFLOW_FILE = "notion-sheets-sync.yml";
const REF = "main";

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🔄 Sync")
    .addItem("Re-sync all members", "reSyncAll")
    .addItem("Re-sync this tab only", "reSyncCurrentTab")
    .addToUi();
}

function reSyncAll() {
  triggerSync({});
}

function reSyncCurrentTab() {
  const tabName = SpreadsheetApp.getActiveSheet().getName();
  triggerSync({ tab: tabName });
}

function triggerSync(inputs) {
  const token = PropertiesService.getScriptProperties().getProperty("GH_TOKEN");
  if (!token) {
    SpreadsheetApp.getUi().alert(
      'Missing "GH_TOKEN" in Script Properties — set a GitHub PAT with Actions: read & write.',
    );
    return;
  }

  const cleanInputs = {};
  Object.keys(inputs).forEach((key) => {
    if (inputs[key]) cleanInputs[key] = inputs[key];
  });

  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    payload: JSON.stringify({ ref: REF, inputs: cleanInputs }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code === 204) {
    const scopeMessage = inputs.tab ? `tab "${inputs.tab}"` : "all members";
    SpreadsheetApp.getActive().toast(
      `Sync triggered for ${scopeMessage}. Check GitHub Actions for progress.`,
      "🔄 Sync",
      6,
    );
  } else {
    SpreadsheetApp.getUi().alert(
      `Failed to trigger sync (HTTP ${code}):\n${response.getContentText()}`,
    );
  }
}
