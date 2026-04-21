import configparser
import logging
from datetime import datetime, date, timedelta
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

config = configparser.ConfigParser()
config.read(BASE_DIR / "config.ini")

EQUIPMENT_NAME = config.get("EQUIPMENT", "NAME", fallback="Equipment")
USER_NAMES = [n.strip() for n in config.get("USERS", "NAMES", fallback="").split(",") if n.strip()]

SHEETS_ID = config.get("GOOGLE", "SHEETS_ID", fallback="")
CREDENTIALS_FILE = BASE_DIR / config.get("GOOGLE", "CREDENTIALS_FILE", fallback="credentials.json")

# Column range where task data lives (e.g. "E:L" if columns A-D have other data)
TASKS_COLUMNS = config.get("SHEETS", "TASKS_COLUMNS", fallback="A:H")
_TASKS_START_COL = TASKS_COLUMNS.split(":")[0].upper()
_TASKS_COL_OFFSET = sum((ord(c) - 64) * (26 ** i) for i, c in enumerate(reversed(_TASKS_START_COL))) - 1

DATE_FMT = "%Y-%m-%d"

# ---------------------------------------------------------------------------
# Google Sheets helpers
# ---------------------------------------------------------------------------

_gc: gspread.Client | None = None


def _sheets_client() -> gspread.Client:
    """Return a cached authenticated gspread client."""
    global _gc
    if _gc is None:
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ]
        creds = Credentials.from_service_account_file(str(CREDENTIALS_FILE), scopes=scopes)
        _gc = gspread.authorize(creds)
        log.info("Google Sheets client authorised")
    return _gc


def _get_spreadsheet() -> gspread.Spreadsheet:
    return _sheets_client().open_by_key(SHEETS_ID)



def _compute_status(row: dict) -> dict:
    """Add computed Status and 'overdue' boolean to a task row dict."""
    try:
        freq = int(row.get("Frequency (Days)") or 0)
    except ValueError:
        freq = 0

    last_completed = str(row.get("Last Completed", "")).strip()
    if last_completed:
        try:
            last_dt = datetime.strptime(last_completed, DATE_FMT).date()
            next_due = last_dt + timedelta(days=freq)
        except ValueError:
            next_due = None
            last_dt = None
    else:
        next_due = None
        last_dt = None

    today = date.today()
    if next_due is None:
        status = "OVERDUE"
        overdue = True
        next_due_str = "Never done"
    elif next_due <= today:
        status = "OVERDUE"
        overdue = True
        next_due_str = next_due.strftime(DATE_FMT)
    else:
        status = "OK"
        overdue = False
        next_due_str = next_due.strftime(DATE_FMT)

    return {
        "id": str(row.get("ID", "")),
        "task": row.get("Task", ""),
        "description": row.get("Description / Process", ""),
        "frequency_days": freq,
        "last_completed": last_completed or "Never",
        "completed_by": str(row.get("Completed By", "")),
        "next_due": next_due_str,
        "status": status,
        "overdue": overdue,
    }


def _get_task_records(ws) -> tuple[list[str], list[list[str]]]:
    """Read only the configured column range and return (headers, data_rows)."""
    all_values = ws.get(TASKS_COLUMNS)
    if not all_values:
        return [], []
    headers = all_values[0]
    return headers, all_values[1:]


def get_tasks() -> list[dict]:
    """Fetch all tasks from the Tasks worksheet and compute live status."""
    ss = _get_spreadsheet()
    ws = ss.worksheet("Tasks")
    headers, data_rows = _get_task_records(ws)
    if not headers:
        return []
    records = []
    for row in data_rows:
        padded = row + [""] * (len(headers) - len(row))
        records.append(dict(zip(headers, padded)))
    return [_compute_status(r) for r in records]


def complete_tasks(completed_by: str, task_names: list[str], notes: str = ""):
    """Mark tasks as completed: update Tasks sheet and append to History."""
    ss = _get_spreadsheet()
    ws_tasks = ss.worksheet("Tasks")
    ws_history = ss.worksheet("History")

    headers, data_rows = _get_task_records(ws_tasks)
    if not headers:
        return

    col_idx = {h: i for i, h in enumerate(headers)}
    today_str = date.today().strftime(DATE_FMT)
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

    updates: list[dict] = []
    history_rows: list[list[str]] = []

    for data_row_idx, row in enumerate(data_rows):
        padded = row + [""] * (len(headers) - len(row))
        task_name = padded[col_idx["Task"]] if "Task" in col_idx else ""
        if task_name in task_names:
            freq = 0
            try:
                freq = int(padded[col_idx["Frequency (Days)"]])
            except (KeyError, ValueError):
                pass

            next_due = (date.today() + timedelta(days=freq)).strftime(DATE_FMT)
            sheet_row = data_row_idx + 2  # +1 for header, +1 for 1-indexed

            for col_name, value in [("Last Completed", today_str),
                                     ("Completed By", completed_by),
                                     ("Next Due", next_due),
                                     ("Status", "OK")]:
                if col_name in col_idx:
                    abs_col = _TASKS_COL_OFFSET + col_idx[col_name] + 1  # 1-indexed
                    updates.append({"range": f"{_col_letter(abs_col)}{sheet_row}", "values": [[value]]})

            history_rows.append([now_str, task_name, completed_by, notes])

    if updates:
        ws_tasks.batch_update(updates)
    for hr in history_rows:
        ws_history.append_row(hr)

    log.info("Completed %d task(s) by %s", len(task_names), completed_by)


def _col_letter(col_num: int) -> str:
    """Convert 1-indexed column number to spreadsheet letter (1->A, 26->Z, 27->AA)."""
    result = ""
    while col_num > 0:
        col_num, rem = divmod(col_num - 1, 26)
        result = chr(65 + rem) + result
    return result


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder="frontend", static_url_path="")
CORS(app)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/config")
def api_config():
    """Return public configuration (equipment name, user list)."""
    return jsonify({
        "equipment_name": EQUIPMENT_NAME,
        "users": USER_NAMES,
    })


@app.route("/api/tasks")
def api_tasks():
    """Return all tasks with computed status."""
    try:
        tasks = get_tasks()
        return jsonify({"tasks": tasks, "equipment": EQUIPMENT_NAME})
    except Exception as e:
        log.exception("Error fetching tasks")
        return jsonify({"error": str(e)}), 500


@app.route("/api/complete", methods=["POST"])
def api_complete():
    """Mark one or more tasks as completed."""
    data = request.get_json(force=True)
    completed_by = data.get("completed_by", "").strip()
    task_names = data.get("tasks", [])
    notes = data.get("notes", "").strip()

    if not completed_by:
        return jsonify({"error": "completed_by is required"}), 400
    if not task_names:
        return jsonify({"error": "At least one task must be selected"}), 400

    try:
        complete_tasks(completed_by, task_names, notes)
        return jsonify({"success": True, "completed": task_names})
    except Exception as e:
        log.exception("Error completing tasks")
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info("Starting maintenance tracker on http://0.0.0.0:5001")
    app.run(host="0.0.0.0", port=5001)
