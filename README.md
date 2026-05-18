# Image Collection v2

Desktop tool for bulk-collecting device images from NAS shared folders by IMEI number. Built with Electron, React, and a Liquid Glass UI theme.

Operators import an audit list — ideally with IMEI, Machine, and Date columns for fastest results — select which NAS machine folders to search, and export matched image folders to a local destination with configurable organization.

---

## Quick Start

1. **Install** — run `Image Collection v2 Setup X.X.X.exe` and follow the prompts.
2. **Set source** — click **Browse** next to Shared Folder and select the NAS root (e.g. `Z:\`). Machine folders populate automatically.
3. **Import audit list** — click **Browse** in the Audit panel or drag-and-drop a CSV / XLSX file. **For best results, include IMEI, Machine, and Date columns** — Smart Search will auto-detect them, auto-select the relevant machine folders, auto-fill the date range, and search in seconds instead of minutes.
4. **Verify detection** — check the Audit panel for green badges confirming Machine and Date columns were detected. Verify that only the relevant machine folders are checked in the Source panel. If detection fails or data is inaccurate, toggle Smart Search OFF to fall back to IMEI-only mode.
5. **Configure settings** — choose Action, Image Type, Organize mode, and set a Destination.
6. **Search** — click **Start Search**. Matches stream into the results table in real time.
7. **Export** — review results, then click **Export Results**. Progress shows in the status bar.

---

## Features

| Feature | Description |
|---|---|
| **Multi-format audit import** | CSV, XLSX, XLS, TXT — auto-detects IMEI column and skips headers |
| **Smart Search** | Auto-detects Machine and Date columns in audit files for targeted folder lookups instead of full NAS scan; auto-selects machine folders and fills date range |
| **Parallel NAS search** | 48 concurrent folder reads, tuned for RS3617RPxs (12-drive RAID 5, 1 Gbps) |
| **Parallel export** | 8 folders x 4 files = 32 concurrent copies, saturates the 1 Gbps pipe |
| **6 organization modes** | Flat, By Machine, By Date, Machine-Date, Date-Machine, By IMEI |
| **MR PASS / FAIL collection** | Collect Model Recognition images from `ModelRecogImages/` by toggle |
| **AI Images Only** | Export only the `FD/` subfolder (AI detection images) from matched IMEI folders |
| **Multi-source manager** | Save and switch between multiple NAS roots; each source remembers its own folder toggles |
| **Search history** | Last 5 searches stored with full parameter and result summaries |
| **Date range filter** | Restrict searches to a specific date window (YYYYMMDD folder names) |
| **Scan index filter** | Search all scans or first scan only (`_1` entries) |
| **Export logging** | Detailed per-file logs with file sizes and throughput; keeps 3 most recent logs |
| **Missing IMEI report** | View and save the list of audit IMEIs not found on the NAS |
| **Dark / Light theme** | Liquid Glass theming in both variants; persists across sessions |
| **Trilingual** | English, Traditional Chinese, and Simplified Chinese — cycle with the language button in the Source panel |
| **Settings persistence** | All preferences saved via electron-store and restored on next launch |

---

## Source Configuration

### Shared Folder

Enter or browse to the NAS mount point (e.g. `Z:\`, `\\NAS_Lonestar\share`). The tool scans first-level subdirectories and populates the folder toggle grid.

- **Machine folders** (names matching `M` + digits, like `M8`, `M10`) are checked by default.
- **Utility folders** (`audits`, `crackimages`, `GRR Images`, `version_control`) are unchecked by default.
- `#recycle` and `$RECYCLE.BIN` are always hidden.

Use **Select All / Deselect All** to bulk-toggle. **Refresh** re-scans the NAS for new or removed subfolders.

### Multi-Source Manager

Save frequently used NAS paths as named sources:

1. Browse to a NAS root.
2. Click **[+]** and type a name (e.g. "NAS Lonestar").
3. Press Enter to save.

Switch between sources with the dropdown. Each source independently remembers its folder toggle states. Click **[-]** to remove a source (a confirmation prompt appears since the action cannot be undone).

On first launch, any previously saved single-path setting is automatically migrated into a named source.

### Date Range

Restrict searches to date folders within a window:

- **Start / End date** — only folders whose `YYYYMMDD` name falls within this range are scanned. Leave both blank to search all dates.
- A warning appears if the start date is after the end date (no results will match).

---

## Audit List Import

Drag-and-drop or browse to import an audit file.

### Recommended: Smart Search (IMEI + Machine + Date)

The fastest way to collect images is to include **IMEI**, **Machine**, and **Date** columns in your audit file (CSV or Excel). When all three columns are present, Smart Search goes directly to the exact folder on the NAS for each IMEI — reducing search time from minutes to seconds.

**Recommended audit file format:**

| IMEI | Machine | Date |
|---|---|---|
| 350308317018557 | M14 | 2026-05-14 |
| 350448886316469 | M21 | 2026-05-14 |
| 351101754222413 | M22 | 2026-05-14 |

The column headers can be anything — the parser identifies columns by their data patterns, not by header names. Column order does not matter. Additional columns are ignored. The IMEI column is always identified by the presence of 15-digit numeric values.

**Machine column** — recognizes these name formats:

| Value in file | Normalized to |
|---|---|
| M8, M10 | M8, M10 (exact) |
| M08, M-8, M-08 | M8 (strip leading zero / hyphen) |
| SG-M16, LAX-M08 | M16, M8 (site prefix stripped) |
| Machine 8 | M8 (extract number) |
| 08, 8 | M8 (bare number) |

**Date column** — recognizes these date formats:

| Format | Example |
|---|---|
| YYYYMMDD | 20260515 |
| YYYY-MM-DD | 2026-05-15 |
| YYYY/MM/DD | 2026/05/15 |
| MM/DD/YYYY | 05/15/2026 |
| MM-DD-YYYY | 05-15-2026 |
| M/D/YYYY | 5/15/2026 |
| M/D/YY | 5/15/26 |
| M/D/YY HH:MM | 5/14/26 11:57 (time stripped automatically) |

Any trailing time component (e.g. `11:57`, `11:57:00`, or ISO `T` separator) is stripped before parsing. For ambiguous date formats (MM/DD vs DD/MM), the parser samples all rows to determine which interpretation is correct. Defaults to MM/DD (US format) when fully ambiguous.

**After import**, the Audit panel shows detection quality with color-coded badges:
- **Green**: all rows parsed successfully
- **Orange**: 80%+ rows parsed (some values unrecognized)
- **Red**: less than 80% parsed (column detection may be unreliable)

**Auto-populate date range**: When a date column is detected, the Source panel's Start/End date fields are automatically filled with the earliest and latest dates from the audit data. This narrows the search window and provides visual confirmation that dates were parsed correctly. You can adjust the dates manually if needed.

**Auto-select machine folders**: When a machine column is detected, the Source panel automatically checks only the machine folders referenced in the audit data and unchecks the rest. For example, if the audit file only contains M14, M21, and M22 entries, only those three folders will be toggled on. This avoids scanning irrelevant machines and speeds up broad-scan fallback. If no machine column is detected, all machine folders remain in their previous toggle state.

**Partial hints**: The audit file does not need all three columns. Smart Search adapts based on what's available:

| Columns available | Search behavior |
|---|---|
| IMEI + Machine + Date | Direct folder lookup — fastest (seconds) |
| IMEI + Machine only | Broad scan narrowed to just the hinted machine per IMEI |
| IMEI only | Full broad scan across all selected machines (slowest) |

IMEIs with missing or unrecognized values automatically fall back to the next-broadest scan — no results are ever lost, those IMEIs just search slower.

**MR PASS / FAIL searches** also benefit from Smart Search. When hints are available, MR searches go directly to `Machine/ModelRecogImages/Date/` instead of discovering all date folders first.

If the detected columns are inaccurate, toggle **Smart Search OFF** to fall back to IMEI-only mode.

### Fallback: IMEI-Only Import

If your audit data only contains IMEIs (no Machine or Date columns), the tool falls back to a broad NAS scan — searching every date folder across all selected machines. This works but is significantly slower.

| Format | Behavior |
|---|---|
| **CSV** | Auto-detects the IMEI column by sampling the first 20 rows. Skips header rows. Handles comma, tab, and semicolon delimiters. |
| **XLSX / XLS** | Reads the first sheet. Auto-detects the IMEI column. Skips header rows. |
| **TXT** | One value per line. Each line is treated as a potential IMEI. Smart Search is not available for TXT files (single column). |

**IMEI validation**: exactly 15 numeric digits. Invalid entries and duplicates are counted and reported.

---

## Settings Reference

### Action

| Value | Behavior |
|---|---|
| **Copy** (default) | Duplicates matched folders to the destination. Source data is unchanged. |
| **Move** | Transfers folders and **deletes the source** after copy. A confirmation dialog warns before enabling. On next launch, action always resets to Copy for safety. |

> Move mode does **not** apply to MR image exports — MR images are always copied to protect shared `ModelRecogImages/` directories.

### Image Type

| Value | Behavior |
|---|---|
| **Both** (default) | Exports all image files from matched folders. |
| **BMP** | Exports only `.bmp` files. |
| **JPEG** | Exports only `.jpg` / `.jpeg` files. |

### Organize

Controls how exported folders are arranged at the destination:

| Mode | Structure | Example |
|---|---|---|
| **Flat** | All in one folder | `dest/350002267153742_192/` |
| **By Machine** | Grouped by source machine | `dest/M8/350002267153742_192/` |
| **By Date** | Grouped by scan date | `dest/20260515/350002267153742_192/` |
| **Machine > Date** | Two-level: machine then date | `dest/M8/20260515/350002267153742_192/` |
| **Date > Machine** | Two-level: date then machine | `dest/20260515/M8/350002267153742_192/` |
| **By IMEI** | Groups all instances of the same device | `dest/350002267153742/M8_20260515_192/` |

For **MR image exports**, each IMEI gets its own folder containing the matched `.png` file(s):

| Mode | MR Example |
|---|---|
| Flat | `dest/350002267153742/M8_20260515_Samsung-Galaxy_S24.png` |
| Machine > Date | `dest/M8/20260515/350002267153742/Samsung-Galaxy_S24.png` |
| By IMEI | `dest/350002267153742/M8_20260515_Samsung-Galaxy_S24.png` |

> **Tip:** Organize mode is independent of the search — you can change it after a search completes and before exporting. The export will use whichever mode is selected at the time you click **Export Results**.

### Duplicates

| Value | Behavior |
|---|---|
| **Skip** (default) | If the destination folder/file already exists, leave it untouched. |
| **Overwrite** | Replace existing destination folders/files with the new source data. |

### Scan Index

| Value | Behavior |
|---|---|
| **All** (default) | Include every scan index (`_1`, `_2`, `_3`, etc.). |
| **First scan only** | Only `_1` entries (the first time that device was scanned on that machine/date). |

### MR PASS

Collects **Model Recognition PASS** images — devices the AI correctly identified.

- Searches `Machine/ModelRecogImages/{date}/{Brand-Model}/` folders.
- Matches `.png` files whose filename contains a 15-digit IMEI from the audit list (format: `SG-{machine}-{code}-{IMEI}-{brand}-{model}.png`).
- Results show the Brand-Model folder name (e.g. `Apple-iPhone8`) in green in the results table.
- **Disables standard image collection** when enabled.

### MR FAIL

Collects **Model Recognition FAIL** images — devices the AI misidentified.

- Searches `Machine/ModelRecogImages/{date}/Error-Error/` folders.
- Same matching logic as MR PASS.
- Results show `Error-Error` in red in the results table.

> Both MR PASS and MR FAIL can be enabled simultaneously. The search combines results from both Brand-Model and Error-Error subfolders.

### AI Images Only

When enabled, exports only the `FD/` subfolder contents (AI detection images) from each matched IMEI folder. Standard scan images at the folder root are excluded.

When disabled, the full IMEI folder is exported including `FD/` as a subfolder.

### Destination

The local folder where exported images are written. Browse or type a path. Persisted across sessions.

---

## Results

After a search completes, the results panel shows:

- **Summary bar** — total IMEIs found vs. total in audit list, elapsed time.
- **Status dots** — green (complete), orange (incomplete: file count significantly below median), red (missing: not found on NAS).
- **Sortable table** — click any column header (IMEI, Machine, Date, Index, Files) to sort ascending/descending.
- **File breakdown** — each match shows total files with a `(Xb Yj)` breakdown of BMP and JPEG counts.
- **View Missing IMEIs** — toggles the table to show unmatched audit entries.
- **Save Missing IMEIs** — exports the missing list to a `.txt` or `.csv` file.

### Incomplete Detection

A match is flagged as incomplete (orange dot) when its file count is less than 50% of the median file count across all matches. This catches IMEI folders that exist but contain fewer images than typical.

---

## Export Logging

Every export generates a detailed log file in the app's user data directory:

```
%APPDATA%/Image Collection v2/logs/export-YYYYMMDD-HHmmss.log
```

Each log includes:
- **Header** — timestamp, destination, all settings, concurrency config.
- **Per-folder entries** — source path, destination path, each file copied with size, elapsed time.
- **Summary** — total files and bytes copied, throughput (MB/s), skipped/failed counts.

The tool keeps the **3 most recent** log files and rotates older ones automatically.

Click **View Log** in the status bar after an export to open the logs folder.

---

## Search History

The last 5 completed searches are stored and accessible from the **History** button in the action bar. Each entry shows:

- Date and time of the search
- Source name and NAS path
- Audit file name and IMEI count
- Match count and missing count
- Elapsed search time
- Date range (if filtered)
- MR badge (if MR toggles were active)

History persists across sessions.

---

## Theme

Toggle between **Dark** and **Light** mode using the sun/moon button in the title bar. Both themes use the Liquid Glass design language with translucent surfaces, blur effects, and smooth transitions. The preference persists across sessions.

---

## NAS Directory Structure

The tool expects this hierarchy on the NAS:

```
NAS_ROOT/                              (e.g. Z:\)
  M8/                                  Machine folder (Level 1)
    20260515/                           Date folder (Level 2, YYYYMMDD)
      350002267153742_192/              IMEI_Index folder (Level 3)
        image1.bmp                      Image files (Level 4)
        image2.jpg
        FD/                             AI detection images subfolder
          fd_image1.bmp
      350024510270586_85/
    20260514/
    ModelRecogImages/                   MR images (searched when MR toggles are ON)
      20260515/
        Apple-iPhone8/                  Brand-Model subfolder (MR PASS)
          SG-M008-075545-358627090247469-Apple-iPhone8.png
        Error-Error/                    Error subfolder (MR FAIL)
          SG-M008-074837-359814715825890-Apple-iPhoneXR.png
    Bin/                                Skipped during search
  M10/
  ...
  #recycle/                             Always hidden
  audits/                               Utility folder (unchecked by default)
```

**Naming conventions:**
- IMEI: always 15 numeric digits.
- Scan index: integer after the underscore (`_1` = first scan, `_2` = rescan, etc.).
- Date folders: always 8 digits in `YYYYMMDD` format.
- MR image filenames: `SG-{machine}-{code}-{IMEI}-{brand}-{model}.png` (IMEI is the 4th hyphen-delimited segment).

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm (included with Node.js)

### Development

```bash
git clone <repo-url>
cd Image-Collection-v2
npm install
npm run dev          # Launch with hot-reload
```

### Production Build

```bash
npm run build        # Compile main + preload + renderer
npm run pack         # Build + create unpacked directory (fast, for testing)
npm run dist         # Build + create NSIS installer (.exe)
```

The installer is output to `release/Image Collection v2 Setup X.X.X.exe`.

### Other Scripts

| Script | Description |
|---|---|
| `npm run typecheck` | Run TypeScript type-checking across main and renderer |
| `npm run lint` | Lint source files with ESLint |
| `npm run format` | Format source files with Prettier |

---

## Installation

Run the NSIS installer. It will:

- Install to `C:\Program Files\Image Collection v2\`
- Create a **Desktop shortcut** and a **Start Menu shortcut**
- Register in **Add/Remove Programs** for clean uninstall
- Optionally launch the app after installation (checkbox on the finish page)

No admin access is required after installation. The app stores settings and logs in `%APPDATA%/Image Collection v2/`.

### Uninstall

Use **Add/Remove Programs** (Settings > Apps > Installed apps). The uninstaller removes all files, shortcuts, registry entries, and app data — zero remnants.

---

## System Requirements

- **OS**: Windows 10 or later (64-bit)
- **NAS connectivity**: the NAS share must be mounted or accessible via UNC path (e.g. `\\NAS_Lonestar\share`)
- **Disk space**: ~200 MB for the application; destination drive needs enough space for exported images
- **No runtime dependencies**: Node.js is bundled with the Electron app

---

## Known Limitations

- **AutoMode** and **Rescan Image Collection** tabs are deferred pending implementation specs from the engineering team.
- The placeholder app icon (`resources/icon.ico`) is a generated teal square. Replace with a production icon before final distribution.
- Date range filtering operates on folder date names (`YYYYMMDD`). Intra-day time filtering is not supported — the NAS folder structure does not encode time.
- Export summary report with color-coded CSV/Excel output is planned but not yet implemented.

---

## Documentation

| Document | Description |
|---|---|
| [PRD](docs/PRD.md) | Product requirements — features, settings, behavior |
| [Architecture](docs/ARCHITECTURE.md) | Tech stack, services, IPC design, project structure |
| [UI Spec](docs/UI-SPEC.md) | Liquid Glass theme, layout, components, animations |
| [Milestones](docs/MILESTONES.md) | Development roadmap with stop-gap gates |
| [Directory Schema](docs/DIRECTORY-SCHEMA.md) | NAS folder hierarchy and naming conventions |
| [Test Procedure](docs/TEST-PROCEDURE.md) | Manual QA checklist for all features |
