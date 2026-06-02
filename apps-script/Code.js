/**
 * Check for overdue maintenance tasks and send a Google Chat webhook alert.
 * Intended to be called by a time-driven trigger (e.g. daily at 8am).
 */
function checkOverdueTasks() {
  var props = PropertiesService.getScriptProperties();
  var webhookUrl = props.getProperty("WEBHOOK_URL");
  if (!webhookUrl) {
    Logger.log("WEBHOOK_URL not set in Script Properties");
    return;
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tasks");
  if (!sheet) {
    Logger.log("No worksheet named 'Tasks' found");
    return;
  }

  var taskCol = getColumnByHeader_(sheet, "Task");
  var nextDueCol = getColumnByHeader_(sheet, "Next Due");
  var lastCompletedCol = getColumnByHeader_(sheet, "Last Completed");
  var statusCol = getColumnByHeader_(sheet, "Status");

  if (!taskCol || !nextDueCol) {
    Logger.log("Could not find required columns (Task, Next Due)");
    return;
  }

  var lastRow = sheet.getLastRow();
  var headerRow = taskCol.row;
  if (lastRow <= headerRow) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var overdue = [];

  for (var r = headerRow + 1; r <= lastRow; r++) {
    var taskName = sheet.getRange(r, taskCol.col).getValue();
    var nextDueVal = sheet.getRange(r, nextDueCol.col).getValue();
    var lastDoneVal = lastCompletedCol ? sheet.getRange(r, lastCompletedCol.col).getValue() : "";

    if (!taskName) continue;

    var isOverdue = false;
    if (!nextDueVal && !lastDoneVal) {
      isOverdue = true;
    } else if (nextDueVal) {
      var dueDate = new Date(nextDueVal);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate <= today) isOverdue = true;
    }

    if (isOverdue) {
      if (statusCol) sheet.getRange(r, statusCol.col).setValue("OVERDUE");
      overdue.push({
        task: taskName,
        nextDue: nextDueVal ? Utilities.formatDate(new Date(nextDueVal), Session.getScriptTimeZone(), "yyyy-MM-dd") : "Never done",
        lastDone: lastDoneVal ? Utilities.formatDate(new Date(lastDoneVal), Session.getScriptTimeZone(), "yyyy-MM-dd") : "Never"
      });
    } else {
      if (statusCol) sheet.getRange(r, statusCol.col).setValue("OK");
    }
  }

  if (overdue.length === 0) {
    Logger.log("No overdue tasks");
    return;
  }

  var equipmentName = props.getProperty("EQUIPMENT_NAME") || "Equipment";
  var formUrl = props.getProperty("FORM_URL") || "";

  var lines = ["⚠️  *Overdue maintenance on " + equipmentName + "*\n"];
  for (var i = 0; i < overdue.length; i++) {
    var t = overdue[i];
    lines.push("• *" + t.task + "* — due " + t.nextDue + " (last done: " + t.lastDone + ")");
  }

  if (formUrl) {
    lines.push("\n<" + formUrl + "|Complete maintenance here>");
  }

  var payload = { text: lines.join("\n") };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(webhookUrl, options);
  Logger.log("Webhook response: " + response.getResponseCode());
}

/**
 * Find a column header in the sheet, searching all cells in the used range.
 * Returns {row, col} of the header cell, or null if not found.
 */
function getColumnByHeader_(sheet, headerName) {
  var data = sheet.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    for (var c = 0; c < data[r].length; c++) {
      if (String(data[r][c]).trim() === headerName) {
        return { row: r + 1, col: c + 1 };
      }
    }
  }
  return null;
}
