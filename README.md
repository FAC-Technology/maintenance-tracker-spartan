# Equipment Maintenance Tracker

Mobile-friendly web app for tracking maintenance tasks on a piece of equipment.  
Backed by Google Sheets as the single source of truth.

## Setup

### 1. Google Cloud Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. Enable the **Google Sheets API** and **Google Drive API**
4. Go to **IAM & Admin → Service Accounts** → Create a service account
5. Create a JSON key and download it
6. Save it as `credentials.json` in this directory

### 2. Google Sheet

1. Create a new Google Sheet
2. Copy the spreadsheet ID from the URL:  
   `https://docs.google.com/spreadsheets/d/<THIS-IS-THE-ID>/edit`
3. Share the sheet with the service account email  
   (found in `credentials.json` as `client_email`) — give **Editor** access
4. The app will auto-create "Tasks" and "History" worksheets on first run

### 3. Add Tasks to the Sheet

After first run, open the "Tasks" worksheet and add rows:

| Task | Frequency Days | Last Completed | Completed By | Next Due | Status |
|------|---------------|----------------|--------------|----------|--------|
| Clean filter | 7 | | | | |
| Check oil level | 30 | | | | |
| Inspect belts | 90 | | | | |

Leave "Last Completed", "Completed By", "Next Due", and "Status" empty — the app fills them in.

### 4. Configure

Edit `config.ini`:

```ini
[EQUIPMENT]
NAME = Your Equipment Name

[USERS]
NAMES = Alice,Bob,Charlie

[GOOGLE]
SHEETS_ID = your-spreadsheet-id-here
CREDENTIALS_FILE = credentials.json
```

### 5. Install as a Service

```bash
sudo cp maintenance-tracker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable maintenance-tracker
sudo systemctl start maintenance-tracker
```

Check status:
```bash
sudo systemctl status maintenance-tracker
```

### 6. Generate QR Code

```bash
cd /home/admin/maintenance-tracker
./venv/bin/python generate_qr.py
```

This creates `qr_code.png` — print it and stick it on the equipment.

## Running Manually (development)

```bash
cd /home/admin/maintenance-tracker
./venv/bin/python app.py
```

Then open `http://<pi-ip>:5001` in a browser.
