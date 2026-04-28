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
 * The system started in 4/2026; pickers and recent-3 never go below that.
 */

const REPO = "doanminhdang93/tools";
const WORKFLOW_FILE = "notion-sheets-sync.yml";
const REF = "main";
const FLOOR_MONTH = { year: 2026, month: 4 };

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("🔄 Sync")
    .addSubMenu(buildScopeSubmenu("Sync ALL members", "syncAll"))
    .addSubMenu(buildScopeSubmenu("Sync this tab", "syncThisTab"))
    .addSeparator()
    .addItem("Custom sync…", "openCustomSyncDialog")
    .addToUi();
}

function buildScopeSubmenu(label, prefix) {
  const ui = SpreadsheetApp.getUi();
  const validRecent = recentThreeMonthLabels();
  const menu = ui.createMenu(label);

  if (validRecent.length > 0) {
    menu.addItem(`Recent ${validRecent.length} months (${validRecent.join(", ")})`, `${prefix}Recent3`);
  }

  const offsetItems = [
    { offset: -1, suffix: "last month", handler: `${prefix}PrevMonth` },
    { offset: 0, suffix: "current month", handler: `${prefix}CurrentMonth` },
    { offset: 1, suffix: "next month", handler: `${prefix}NextMonth` },
  ].filter((item) => isMonthAtOrAfterFloor(addMonthsLabel(item.offset)));

  if (offsetItems.length > 0) menu.addSeparator();
  offsetItems.forEach((item) => {
    menu.addItem(`${addMonthsLabel(item.offset)} (${item.suffix})`, item.handler);
  });

  menu.addSeparator().addItem("Other month…", `${prefix}OtherMonth`);
  return menu;
}

function isMonthAtOrAfterFloor(label) {
  const match = label.match(/^(\d+)\/(\d+)$/);
  if (!match) return false;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (year > FLOOR_MONTH.year) return true;
  if (year < FLOOR_MONTH.year) return false;
  return month >= FLOOR_MONTH.month;
}

function recentThreeMonthLabels() {
  return [-1, 0, 1].map((offset) => addMonthsLabel(offset)).filter(isMonthAtOrAfterFloor);
}

function pickerMonthLabels() {
  return [-3, -2, -1, 0, 1, 2, 3].map((offset) => addMonthsLabel(offset)).filter(isMonthAtOrAfterFloor);
}

function addMonthsLabel(offset) {
  const now = new Date();
  const vietnamNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  let month = vietnamNow.getUTCMonth() + 1 + offset;
  let year = vietnamNow.getUTCFullYear();
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${month}/${year}`;
}

function thisTabName() {
  return SpreadsheetApp.getActiveSheet().getName();
}

function syncAllRecent3() { fireSync({ recent3: true }); }
function syncAllPrevMonth() { fireSync({ month: addMonthsLabel(-1) }); }
function syncAllCurrentMonth() { fireSync({ month: addMonthsLabel(0) }); }
function syncAllNextMonth() { fireSync({ month: addMonthsLabel(1) }); }
function syncAllOtherMonth() {
  const month = promptForMonth();
  if (!month) return;
  fireSync({ month });
}

function syncThisTabRecent3() { fireSync({ recent3: true, tab: thisTabName() }); }
function syncThisTabPrevMonth() { fireSync({ month: addMonthsLabel(-1), tab: thisTabName() }); }
function syncThisTabCurrentMonth() { fireSync({ month: addMonthsLabel(0), tab: thisTabName() }); }
function syncThisTabNextMonth() { fireSync({ month: addMonthsLabel(1), tab: thisTabName() }); }
function syncThisTabOtherMonth() {
  const month = promptForMonth();
  if (!month) return;
  fireSync({ month, tab: thisTabName() });
}

function openCustomSyncDialog() {
  const members = getMemberList();
  const months = pickerMonthLabels();
  const recent = recentThreeMonthLabels();
  const memberOptions = members
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  const monthOptions = months
    .map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`)
    .join("");
  const recent3Label = recent.length > 0
    ? `Recent ${recent.length} months (${recent.join(", ")})`
    : "Recent months (none yet)";

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <style>
      body { font-family: 'Google Sans', Roboto, Arial, sans-serif; padding: 20px; margin: 0; }
      label { display: block; margin: 12px 0 6px; font-size: 12px; font-weight: 600; color: #5f6368; text-transform: uppercase; letter-spacing: 0.5px; }
      select { width: 100%; padding: 9px 10px; font-size: 14px; border: 1px solid #dadce0; border-radius: 4px; background: white; }
      .actions { margin-top: 24px; display: flex; gap: 8px; justify-content: flex-end; }
      button { padding: 9px 18px; font-size: 14px; border-radius: 4px; cursor: pointer; font-weight: 500; }
      button.primary { background: #1a73e8; color: white; border: 0; }
      button.primary:hover { background: #1765cc; }
      button.secondary { background: white; border: 1px solid #dadce0; color: #1a73e8; }
      button.secondary:hover { background: #f8f9fa; }
    </style>
  </head>
  <body>
    <label for="member">Member</label>
    <select id="member">
      <option value="">— ALL members —</option>
      ${memberOptions}
    </select>

    <label for="month">Month</label>
    <select id="month">
      <option value="recent3">${escapeHtml(recent3Label)}</option>
      ${monthOptions}
    </select>

    <div class="actions">
      <button class="secondary" onclick="google.script.host.close()">Cancel</button>
      <button class="primary" onclick="runSync()">Sync</button>
    </div>

    <script>
      function runSync() {
        const member = document.getElementById('member').value;
        const month = document.getElementById('month').value;
        document.querySelectorAll('button').forEach(b => b.disabled = true);
        google.script.run
          .withSuccessHandler(function() { google.script.host.close(); })
          .withFailureHandler(function(err) {
            document.querySelectorAll('button').forEach(b => b.disabled = false);
            alert('Error: ' + err.message);
          })
          .triggerCustomSync(member, month);
      }
    </script>
  </body>
</html>`;

  const dialog = HtmlService.createHtmlOutput(html).setWidth(420).setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(dialog, "Custom sync");
}

function triggerCustomSync(member, month) {
  const inputs = {};
  if (member) inputs.tab = member;
  if (month === "recent3") inputs.recent3 = true;
  else if (month) inputs.month = month;
  fireSync(inputs);
}

function getMemberList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Members");
  if (!sheet) return [];
  const data = sheet.getRange("A2:A").getValues();
  return data
    .map((row) => (row[0] || "").toString().trim())
    .filter((name) => name.length > 0);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function promptForMonth() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt("Enter month", "Format M/YYYY (e.g. 4/2026):", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return null;
  const text = resp.getResponseText().trim();
  if (!/^\d{1,2}\/\d{4}$/.test(text)) {
    ui.alert("Invalid month format. Use M/YYYY");
    return null;
  }
  if (!isMonthAtOrAfterFloor(text)) {
    ui.alert(`No syncs allowed before ${FLOOR_MONTH.month}/${FLOOR_MONTH.year}.`);
    return null;
  }
  return text;
}

function fireSync(inputs) {
  const token = PropertiesService.getScriptProperties().getProperty("GH_TOKEN");
  if (!token) {
    SpreadsheetApp.getUi().alert('Missing "GH_TOKEN" in Script Properties.');
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
    if (months.length === 0) {
      SpreadsheetApp.getUi().alert(`No syncable months — floor is ${FLOOR_MONTH.month}/${FLOOR_MONTH.year}.`);
      return;
    }
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
        `Sync triggered for ${scope}: ${months.join(", ")}`, "🔄 Sync", 6,
      );
    } else {
      SpreadsheetApp.getUi().alert(
        `${failures.length} of ${responses.length} dispatches failed.\n` +
          failures.map((r) => `HTTP ${r.getResponseCode()}: ${r.getContentText()}`).join("\n\n"),
      );
    }
    return;
  }

  if (inputs.month && !isMonthAtOrAfterFloor(inputs.month)) {
    SpreadsheetApp.getUi().alert(`No syncs allowed before ${FLOOR_MONTH.month}/${FLOOR_MONTH.year}.`);
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
    SpreadsheetApp.getActive().toast(`Sync triggered for ${scope}${monthNote}`, "🔄 Sync", 6);
  } else {
    SpreadsheetApp.getUi().alert(`Failed (HTTP ${code}):\n${response.getContentText()}`);
  }
}
