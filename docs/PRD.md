# Image Collection v2 — Product Requirements Document

## 1. Overview

Image Collection v2 is a desktop tool for production floor operators to bulk-collect device images from NAS-mounted shared folders by IMEI number. Operators load an audit list of 15-digit IMEIs, select which machine folders to search, and export matching image folders to a destination with configurable organization.

**Target Users**: Production floor operators, quality engineers, FAEs  
**Platform**: Windows (Electron desktop app)  
**Primary Data Source**: NAS shared folders (e.g., `\\NAS_Lonestar` mapped to `Z:\`)

---

## 2. Core Features

### 2.1 Audit List Import

The tool accepts audit files containing 15-digit IMEI device numbers.

**Supported Formats:**
| Format | Detection | Parsing Strategy |
|--------|-----------|-----------------|
| CSV (.csv) | File extension + comma/tab delimiters | Auto-detect IMEI column by scanning for 15-digit numeric values; handle header rows |
| Excel (.xlsx, .xls) | File extension | Read first sheet by default; auto-detect IMEI column; support column selection |
| Text (.txt) | File extension | One IMEI per line; ignore blank lines and whitespace |

**IMEI Validation Rules:**
- Must be exactly 15 digits
- Must be all numeric (0-9)
- Duplicates within the audit list are flagged but accepted
- Invalid entries are reported to the user with line numbers

**Import Methods:**
- File browser dialog (button click)
- Drag-and-drop onto the Audit List panel

**OneDrive-safe read:** the audit-file read uses a 20-second timeout. If the file is a OneDrive "Files On-Demand" placeholder that hasn't finished downloading, the parse fails fast with a clear, retryable message ("file still downloading — right-click → Always keep on this device") instead of hanging.

**Post-Import Display:**
- Detected file format
- Total valid IMEIs loaded
- Count of invalid/skipped entries (if any)
- Warning for duplicate IMEIs within the file

### 2.2 Shared Folder Source Selection

**Root Folder Selection:**
- File browser dialog to select the NAS share root (e.g., `Z:\`)
- Persisted between sessions via electron-store
- On launch: reload saved path and re-scan for subfolders

**Auto-Scan Behavior:**
- On folder selection or app launch: read all first-level subdirectories from the shared folder root
- Populate a toggleable checkbox list of discovered folders
- Each folder shows its name (e.g., M8, M10, audits, crackimages)
- New folders (detected on refresh but not in saved state) default to **unchecked**
- Removed folders (in saved state but no longer on disk) are pruned from the list

**Toggle Controls:**
- Individual checkbox per folder
- "Select All" / "Deselect All" button
- Refresh button (⟳) to re-scan without restarting the app
- Toggle states persist between sessions (per-source)

### 2.3 IMEI Search Engine

**Search Behavior:**
1. For each selected first-level folder (e.g., M8, M10):
   - List all subfolders
   - Filter to **date folders only** — folders matching the regex `^\d{8}$` (YYYYMMDD format)
   - Skip all non-date folders (Bin, ModelRecogImages, etc.)
2. For each date folder:
   - List all subfolders (IMEI_index folders)
   - Extract the 15-digit IMEI: split folder name on underscore `_`, take the first segment
   - Extract the scan index: the numeric segment after the underscore
3. Match extracted IMEIs against the loaded audit list
4. Build result records with: IMEI, source machine, source date, scan index, full source path, file count, file types present

**Performance:**
- Parallel scanning across machine folders (concurrent directory reads)
- Progress reporting via IPC: percentage complete, currently scanning folder
- Cancelable: user can abort a search in progress

**Diagnostics:** every search writes a rotating `search-<timestamp>.log` (see §2.10) capturing the search parameters, the path taken (targeted vs full-discovery), per-machine counts, fallbacks, scan errors, and a final summary.

**Filters (applied during search):**

| Filter | Options | Description |
|--------|---------|-------------|
| Date Range | Start date+time / End date+time (optional) | Only search date folders within the specified range; optional time component filters by image timestamps within folders |
| Scan Index | All, First only (_1) | Filter by scan index number — sequential position in the series of scans for a device |

### 2.4 Results Preview

After search completes, results are displayed **before export** so the user can review:

- **Summary bar**: "Found 1,182 / 1,247 IMEIs · 65 not found"
- **Results list** (scrollable): each matched IMEI with source machine, date, scan index, file count
- **Color-coded status indicators**:
  - **Green**: IMEI found, file count within normal range
  - **Orange**: IMEI found but potentially incomplete (file count significantly below median — see §2.8)
  - **Red**: (shown in Missing view) IMEI from audit list not found in any searched folder
- **"View Missing IMEIs" button**: opens a panel/modal listing all audit list entries that returned no results
- **Sort/filter**: sort results by IMEI, machine, date, or scan index

### 2.5 Export Engine

**Actions:**
| Action | Behavior |
|--------|----------|
| Copy | Recursive copy of matched IMEI folders to destination. Source unchanged. |
| Move | Move folders to destination (fs.rename; falls back to copy + delete for cross-device transfers). Source folders removed after successful transfer. |

**Image Type Filter:**
| Option | Files Collected |
|--------|----------------|
| BMP | Only `.bmp` files |
| JPEG | Only `.jpg` and `.jpeg` files |
| Both | All image files (`.bmp`, `.jpg`, `.jpeg`) |

> **Note on BMP files**: BMP images are typically stored **locally on the scanning machine**, not on the NAS. Users who need BMP images should install the tool on the specific machine and use a local path as the source (supported via the multi-source feature). The NAS primarily stores JPEG scan images, MR `.png` images, and metadata.

**AI Detection Images Toggle:**
| Toggle | Default | Behavior |
|--------|---------|----------|
| AI Images Only | OFF | When ON, collects only the contents of the `FD/` subfolder within each matched IMEI folder (AI detection images). Standard scan images at the IMEI folder root are excluded. When OFF, standard export copies the entire IMEI folder contents including FD/. |

**Model Recognition (MR) Image Toggles:**

Each device's Model Recognition image — a single `SG-*.png` — is captured by the system and stored **inside that device's IMEI_Index folder**, alongside the scan images, `DefectLog.xml`, and `Grade.json`. MR mode collects exactly this file.

Enabling **either** toggle activates MR mode, which runs the **same fast standard IMEI-folder search** (the normal `{machine}/{date}/{IMEI}_{index}/` lookup) and then exports only the `SG-*.png` from each matched folder. It does **not** scan the `ModelRecogImages/` tree — those `{Brand-Model}/` folders hold tens of thousands of files and time out over SMB. A device's grade (e.g. "Wrong Color") is knowable only from the audit file, so the audit list is the filter; results are tagged PASS/FAIL from the model name parsed out of the `SG-*.png` filename.

| Toggle | Default | Activates | Result Tag |
|--------|---------|-----------|------------|
| MR PASS | OFF | MR mode (standard search + `SG-*.png` extraction) | A `SG-*.png` whose model is not `Error-Error` is tagged **PASS** (green) |
| MR FAIL | OFF | MR mode (standard search + `SG-*.png` extraction) | A `SG-*.png` whose model is `Error-Error` is tagged **FAIL** (red) |

**MR toggle rules:**
- When **both MR toggles are OFF**: normal image collection from IMEI_Index folders per Image Type setting (JPEG/BMP/Both)
- When **either toggle is ON** (PASS, FAIL, or both): the tool runs the standard date→IMEI_Index search and, for each match, exports only that folder's `SG-*.png` (the whole-folder scan images are excluded). There is intentionally **no "wrong color" toggle** — the audit list determines which IMEIs are collected, and PASS/FAIL tagging comes from the parsed model name
- MR mode does **not** scan `ModelRecogImages/` — the per-device `SG-*.png` inside each IMEI folder is the same image, looked up far faster by the standard search
- IMEI matching is unchanged from standard search (folder name `{IMEI}_{index}`); the `SG-*.png` is then read from the matched folder and its model parsed from the filename
- A matched IMEI folder that contains no `SG-*.png` is reported as missing (and counted in the search log)
- **Midnight rollover** is handled by the standard search's auto End Date = max(test date) + 1 day (MR mode inherits it); there is no MR-specific ±1-day folder probing
- MR image filename pattern: `SG-{machine}-{code}-{IMEI}-{brand}-{model}.png`
- PASS/FAIL detection: from the `{model}` segment of the filename — `Error-Error` → FAIL, anything else → PASS

**Duplicate Handling:**
| Option | Behavior |
|--------|----------|
| Skip | If an IMEI folder already exists at the destination, skip it |
| Overwrite | Replace existing destination folder with the new source |

**Output Organization (configurable nesting depth):**

| Mode | Destination Structure | Use Case |
|------|----------------------|----------|
| Flat | `dest/IMEI_index/` | Simple dump of all results |
| By Machine | `dest/M8/IMEI_index/` | Group by source machine |
| By Date | `dest/20260515/IMEI_index/` | Group by scan date |
| Machine → Date | `dest/M8/20260515/IMEI_index/` | 2-level: machine then date |
| Date → Machine | `dest/20260515/M8/IMEI_index/` | 2-level: date then machine |
| Machine → Model | `dest/M8/Apple-iPhone13Pro/IMEI_index/` | 2-level: machine then device model (parsed from MR `.png` filename) |
| By IMEI | `dest/350002267153742/M8_20260515_192/` | Group all instances of same device |
| By Scan Index | `dest/scan_1/IMEI_index/`, `dest/scan_2/IMEI_index/` | Group by scan index number |

> **Machine → Model in MR mode**: when an MR toggle is active, each match is a single `.png` and the layout becomes `dest/{machine}/<Model|Error-Error>/{IMEI}/<date>_<tag>.png`. The model level is the parsed device model for PASS images and `Error-Error` for FAIL images.

**Progress:**
- Progress bar with percentage and current operation
- Elapsed time display
- Cancelable

### 2.6 Export Summary Report

Generated automatically after each export as a CSV or Excel file.

**Report Columns:**
| Column | Description |
|--------|-------------|
| IMEI | The 15-digit device identifier |
| Status | Complete / Incomplete / Not Found |
| Source Machine | Machine folder where the IMEI was found (e.g., M8) |
| Source Date | Date folder (e.g., 20260515) |
| Scan Index | The index number from the folder name |
| File Count | Number of image files in the folder |
| Total Size | Combined file size |
| Destination Path | Where the files were exported to |

**Color Coding:**
- **Green**: Complete — IMEI found, file count within normal range
- **Orange**: Incomplete — IMEI found but flagged (see §2.8)
- **Red**: Not Found — IMEI from audit list with no matching folder

**Summary Statistics (top of report):**
- Total IMEIs in audit list
- Total found (green + orange)
- Total incomplete (orange)
- Total not found (red)
- Search duration
- Export duration

**Additional Export Options:**
- Export missing-IMEIs-only list as a separate file

### 2.7 Multi-Source Support

Save and switch between multiple shared folder roots for different NAS shares, RDP-accessible paths, or local drives.

- **Source manager**: add, remove, rename shared folder roots
- **Per-source state**: each source independently saves its folder toggle states
- **Source switcher**: dropdown in the Source Panel to switch active source
- **On switch**: re-scan the selected source's root folder, apply its saved toggle states

### 2.8 Incomplete Detection Heuristic

**Primary detection (always active):**
- After search, calculate the **median file count** across all matched IMEI folders
- Flag any matched IMEI folder with a file count below 50% of the median as **incomplete (orange)**

**Secondary detection (optional, toggle in Settings):**
- Flag if the matched IMEI folder is missing an expected image type (e.g., has .bmp files but no .jpg, or vice versa)
- **Off by default** — users rarely pull both image types simultaneously, so this would generate false positives in most workflows

### 2.9 Search History

- Store the **last 5 searches** with: audit file path, selected source and folders, date range filter, scan index filter, result summary (found/missing counts)
- Accessible from a dropdown or sidebar in the UI
- One-click re-run: reloads the audit file (if still accessible) and re-applies all search settings

### 2.10 Diagnostic Logging

Both searches and exports write rotating diagnostic logs to `%APPDATA%/Image Collection v2/logs/`. Each log family keeps its **3 most recent** files (search and export logs rotate independently).

**Search log** (`search-<timestamp>.log`, written on every search) records:
- Search mode (standard vs MR), IMEI count, hint count, SmartSearch flag, MR PASS/FAIL flags, scan-index filter, date range, selected folders, root path
- The path taken (targeted vs full-discovery) with per-machine folder counts and drop-reason counters
- Fallback transitions and any scan errors
- A final summary: matches, missing, foldersScanned, scanErrors, elapsed

**Export log** (`export-<timestamp>.log`) records the export settings header, per-file entries, and a throughput summary.

The status-bar **"View Log"** link opens the logs folder.

---

## 3. Settings Persistence

All settings persist between sessions via electron-store:

| Setting | Persisted | Refresh Behavior |
|---------|-----------|-----------------|
| Shared folder path(s) | Yes | Re-scan subfolder list on launch |
| Folder toggle states | Yes, per source | Merge with re-scanned list; new folders unchecked |
| Action (Move/Copy) | Yes | — |
| Image Type | Yes | — |
| Organization mode | Yes | — |
| Duplicate handling | Yes | — |
| MR PASS toggle | Yes | — |
| MR FAIL toggle | Yes | — |
| AI Images Only toggle | Yes | — |
| Theme (Dark/Light) | Yes | — |
| Window size/position | Yes | — |
| Last destination path | Yes | — |
| Search history | Yes (last 5) | Pruned if audit file no longer exists |
| Incomplete detection toggle | Yes | — |

---

## 4. Pending Features (Awaiting Documentation)

The following features exist in v1 but require additional specification before implementation in v2:

- **Coworker-requested features**: Additional feature requests to be incorporated after initial analysis

---

## 5. Packaging & Distribution

**Installer (NSIS):**
- Install path: `C:\Program Files\Image Collection v2\`
- Desktop shortcut option (checkbox, default ON)
- Start Menu shortcut option (checkbox, default ON)
- App icon (.ico) for exe, installer, and shortcuts

**Uninstaller:**
- Removes ALL files, shortcuts, registry entries, and app data
- Clean uninstall with zero remnants
- Registered in Windows Add/Remove Programs (Programs and Features)

**Build:**
- Production build: minified, tree-shaken, dev dependencies excluded
- Must run on target production machines without Node.js installed

---

## 6. Documentation

A comprehensive `README.md` serves as the primary user-facing reference:
- Quick Start guide (installation, first launch, basic workflow)
- Full settings reference for every parameter, option, and toggle
- Output organization examples with folder structure diagrams
- Export report color coding reference
- Installation and uninstallation instructions
- System requirements and troubleshooting

---

## 7. Non-Functional Requirements

- **Startup time**: App should be usable within 3 seconds of launch
- **Search performance**: Scanning 20 machine folders × 30 date folders should complete in under 60 seconds on a typical NAS connection
- **Export reliability**: Cross-device move operations must verify copy success before deleting source
- **Error recovery**: Failed exports should not leave partial/corrupted folders at the destination
- **NAS compatibility**: Must work with SMB/CIFS network shares mapped as drive letters or UNC paths
