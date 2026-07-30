/**
 * Worklog の記録を Google スプレッドシートへ保存する Apps Script。
 * 使い方は README.md を参照してください。
 */
const SHEET_NAME = "稼働ログ";
const HEADERS = ["ID", "稼働開始", "稼働終了", "内容分類", "内容記述", "更新日時", "アカウントID", "アカウント名", "大分類", "小分類"];

function setupWorklogSpreadsheet() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    const spreadsheet = SpreadsheetApp.create("Worklog 稼働管理");
    spreadsheetId = spreadsheet.getId();
    properties.setProperty("SPREADSHEET_ID", spreadsheetId);
  }
  setupWorklogSheet();
  return SpreadsheetApp.openById(spreadsheetId).getUrl();
}

function setupWorklogSheet() {
  const sheet = getSheet_();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold").setBackground("#d8f3e9");
  sheet.autoResizeColumns(1, HEADERS.length);
  return `準備完了: ${sheet.getName()}`;
}

function doGet(event) {
  const params = (event && event.parameter) || {};
  if (!isAuthorized_(params.token || "")) return json_({ ok: false, error: "アクセストークンが正しくありません。" }, params.callback);
  return json_({ ok: true, records: readRecords_() }, params.callback);
}

function doPost(event) {
  try {
    const payload = JSON.parse((event && event.postData && event.postData.contents) || "{}");
    if (!isAuthorized_(payload.token || "")) return json_({ ok: false, error: "アクセストークンが正しくありません。" });
    if (payload.action === "upsert") {
      upsertRecords_([payload.record]);
      return json_({ ok: true, count: 1 });
    }
    if (payload.action === "bulkUpsert") {
      const records = Array.isArray(payload.records) ? payload.records : [];
      upsertRecords_(records);
      return json_({ ok: true, count: records.length });
    }
    if (payload.action === "delete") {
      deleteRecord_(String(payload.id || ""), String(payload.accountId || ""));
      return json_({ ok: true });
    }
    return json_({ ok: false, error: "action が指定されていません。" });
  } catch (error) {
    return json_({ ok: false, error: String(error.message || error) });
  }
}

function getSheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  const spreadsheet = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("先に setupWorklogSpreadsheet を実行してください。");
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getRange(1, 1).getValue() !== HEADERS[0] || sheet.getRange(1, HEADERS.length).getValue() !== HEADERS[HEADERS.length - 1]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readRecords_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues()
    .filter((row) => row[0])
    .map((row) => ({
      id: String(row[0]),
      start: cellToString_(row[1]),
      end: cellToString_(row[2]),
      category: String(row[3] || "その他"),
      description: String(row[4] || ""),
      updatedAt: cellToString_(row[5]),
      accountId: String(row[6] || ""),
      accountName: String(row[7] || ""),
      majorCategory: String(row[8] || ""),
      minorCategory: String(row[9] || ""),
    }));
}

function upsertRecords_(records) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const idToRow = {};
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach((row, index) => {
      if (row[0]) idToRow[String(row[0])] = index + 2;
    });
  }
  const appendRows = [];
  records.filter((record) => record && record.id && record.start).forEach((record) => {
    const row = [String(record.id), String(record.start), String(record.end || ""), String(record.category || "その他"), String(record.description || ""), String(record.updatedAt || new Date().toISOString()), String(record.accountId || ""), String(record.accountName || ""), String(record.majorCategory || ""), String(record.minorCategory || "")];
    if (idToRow[row[0]]) sheet.getRange(idToRow[row[0]], 1, 1, HEADERS.length).setValues([row]);
    else appendRows.push(row);
  });
  if (appendRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, appendRows.length, HEADERS.length).setValues(appendRows);
}

function deleteRecord_(id, accountId) {
  if (!id) return;
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (String(ids[index][0]) !== id) continue;
    const rowAccountId = String(sheet.getRange(index + 2, 7).getValue() || "");
    if (!accountId || !rowAccountId || rowAccountId === accountId) sheet.deleteRow(index + 2);
  }
}

function cellToString_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm");
  return String(value || "");
}

function isAuthorized_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty("WORKLOG_TOKEN");
  return !expected || expected === token;
}

function json_(value, callback) {
  const serialized = JSON.stringify(value);
  if (callback && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${serialized});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(serialized).setMimeType(ContentService.MimeType.JSON);
}
