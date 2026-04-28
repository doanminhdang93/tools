/**
 * Apps Script — bound script for the X Team Sheet (personal Drive copy).
 *
 * Setup (one-time):
 *  1. In the Sheet: Extensions → Apps Script → paste this whole file.
 *  2. ⚙️ Project Settings → Script Properties → add:
 *       Name:  GH_TOKEN
 *       Value: <fine-grained PAT, Actions:R&W on doanminhdang93/tools>
 *  3. Save → reload Sheet — the "🔄 Sync" menu appears.
 *
 * Menu structure:
 *   🔄 Sync
 *     ├─ Sync ALL members ▶
 *     │   ├─ Recent 3 months
 *     │   ├─ <prev month> / <current month> / <next month>
 *     │   └─ Other month…
 *     ├─ Sync this tab ▶
 *     │   └─ (same five options)
 *     └─ Sync specific member… (prompts for member + month)
 */

const REPO = "doanminhdang93/tools";
const WORKFLOW_FILE = "notion-sheets-sync.yml";
const REF = "main";

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const months = recentThreeMonthLabels();

  const allMenu = ui
    .createMenu("Sync ALL members")
    .addItem(`Recent 3 months (${months.join(", ")})`, "syncAllRecent3")
    .addSeparator()
    .addItem(`${months[0]} (last month)`, "syncAllPrevMonth")
    .addItem(`${months[1]} (current month)`, "syncAllCurrentMonth")
    .addItem(`${months[2]} (next month)`, "syncAllNextMonth")
    .addSeparator()
    .addItem("Other month…", "syncAllOtherMonth");

  const tabMenu = ui
    .createMenu("Sync this tab")
    .addItem(`Recent 3 months (${months.join(", ")})`, "syncThisTabRecent3")
    .addSeparator()
    .addItem(`${months[0]} (last month)`, "syncThisTabPrevMonth")
    .addItem(`${months[1]} (current month)`, "syncThisTabCurrentMonth")
    .addItem(`${months[2]} (next month)`, "syncThisTabNextMonth")
    .addSeparator()
    .addItem("Other month…", "syncThisTabOtherMonth");

  ui.createMenu("🔄 Sync")
    .addSubMenu(allMenu)
    .addSubMenu(tabMenu)
    .addSeparator()
    .addItem("Sync specific member…", "syncSpecificMemberPrompt")
    .addToUi();
}

function recentThreeMonthLabels() {
  const now = new Date();
  const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const baseMonth = vietnamNow.getUTCMonth() + 1;
  const baseYear = vietnamNow.getUTCFullYear();
  const labels = [];
  [-1, 0, 1].forEach((offset) => {
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
  });
  return labels;
}

function thisTabName() {
  return SpreadsheetApp.getActiveSheet().getName();
}

function syncAllRecent3() {
  fireSync({ recent3: true });
}
function syncAllPrevMonth() {
  fireSync({ month: recentThreeMonthLabels()[0] });
}
function syncAllCurrentMonth() {
  fireSync({ month: recentThreeMonthLabels()[1] });
}
function syncAllNextMonth() {
  fireSync({ month: recentThreeMonthLabels()[2] });
}
function syncAllOtherMonth() {
  const month = promptForMonth();
  if (!month) return;
  fireSync({ month });
}

function syncThisTabRecent3() {
  fireSync({ recent3: true, tab: thisTabName() });
}
function syncThisTabPrevMonth() {
  fireSync({ month: recentThreeMonthLabels()[0], tab: thisTabName() });
}
function syncThisTabCurrentMonth() {
  fireSync({ month: recentThreeMonthLabels()[1], tab: thisTabName() });
}
function syncThisTabNextMonth() {
  fireSync({ month: recentThreeMonthLabels()[2], tab: thisTabName() });
}
function syncThisTabOtherMonth() {
  const month = promptForMonth();
  if (!month) return;
  fireSync({ month, tab: thisTabName() });
}

function syncSpecificMemberPrompt() {
  const ui = SpreadsheetApp.getUi();

  const memberResp = ui.prompt(
    "Sync specific member",
    "Enter member tab name (e.g. DangDM, NhatNT). Leave blank for ALL:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (memberResp.getSelectedButton() !== ui.Button.OK) return;
  const tab = memberResp.getResponseText().trim();

  const monthResp = ui.prompt(
    "Sync month",
    "Format M/YYYY (e.g. 4/2026). Leave blank for recent 3 months:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (monthResp.getSelectedButton() !== ui.Button.OK) return;
  const month = monthResp.getResponseText().trim();

  if (month && !/^\d{1,2}\/\d{4}$/.test(month)) {
    ui.alert("Invalid month format. Use M/YYYY (e.g. 4/2026)");
    return;
  }

  const inputs = {};
  if (tab) inputs.tab = tab;
  if (month) inputs.month = month;
  else inputs.recent3 = true;
  fireSync(inputs);
}

function promptForMonth() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    "Enter month",
    "Format M/YYYY (e.g. 4/2026):",
    ui.ButtonSet.OK_CANCEL,
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  const text = resp.getResponseText().trim();
  if (!/^\d{1,2}\/\d{4}$/.test(text)) {
    ui.alert("Invalid month format. Use M/YYYY");
    return null;
  }
  return text;
}

function fireSync(inputs) {
  const token = PropertiesService.getScriptProperties().getProperty("GH_TOKEN");
  if (!token) {
    SpreadsheetApp.getUi().alert(
      'Missing "GH_TOKEN" in Script Properties — set a GitHub PAT with Actions:R&W.',
    );
    return;
  }

  const dispatchUrl = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (inputs.recent3) {
    const months = recentThreeMonthLabels();
    const baseInputs = {};
    if (inputs.tab) baseInputs.tab = inputs.tab;

    const responses = months.map((month) =>
      UrlFetchApp.fetch(dispatchUrl, {
        method: "post",
        contentType: "application/json",
        headers,
        payload: JSON.stringify({ ref: REF, inputs: { ...baseInputs, month } }),
        muteHttpExceptions: true,
      }),
    );
    const failures = responses.filter((r) => r.getResponseCode() !== 204);
    if (failures.length === 0) {
      const scope = inputs.tab ? `tab "${inputs.tab}"` : "all members";
      SpreadsheetApp.getActive().toast(
        `Sync triggered for ${scope}: ${months.join(", ")}`,
        "🔄 Sync",
        6,
      );
    } else {
      SpreadsheetApp.getUi().alert(
        `${failures.length} of ${responses.length} dispatches failed.\n` +
          failures.map((r) => `HTTP ${r.getResponseCode()}: ${r.getContentText()}`).join("\n\n"),
      );
    }
    return;
  }

  const cleanInputs = {};
  if (inputs.tab) cleanInputs.tab = inputs.tab;
  if (inputs.month) cleanInputs.month = inputs.month;

  const response = UrlFetchApp.fetch(dispatchUrl, {
    method: "post",
    contentType: "application/json",
    headers,
    payload: JSON.stringify({ ref: REF, inputs: cleanInputs }),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code === 204) {
    const scope = inputs.tab ? `tab "${inputs.tab}"` : "all members";
    const monthNote = inputs.month ? ` — ${inputs.month}` : "";
    SpreadsheetApp.getActive().toast(
      `Sync triggered for ${scope}${monthNote}`,
      "🔄 Sync",
      6,
    );
  } else {
    SpreadsheetApp.getUi().alert(
      `Failed (HTTP ${code}):\n${response.getContentText()}`,
    );
  }
}
