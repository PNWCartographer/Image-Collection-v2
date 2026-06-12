# Image Collection v2 — Development Milestones

Each milestone has a **gate** — a specific, testable condition that must pass before moving to the next milestone. Gates serve as stop-gaps to ensure nothing is overlooked.

---

## Milestone 0: Project Scaffolding
> **Gate**: `npm start` opens an Electron window with React rendering "Hello World"

| # | Task | Details |
|---|------|---------|
| 0.1 | Initialize Electron + React + Vite | Use electron-vite or manual Vite config for main/renderer |
| 0.2 | Configure TypeScript | tsconfig for main process (Node) and renderer (DOM) |
| 0.3 | Configure ESLint + Prettier | Consistent code style from day one |
| 0.4 | Set up IPC bridge | Create preload.ts with contextBridge, verify main ↔ renderer communication |
| 0.5 | Verify dev workflow | Hot reload works in renderer; main process restarts on change |
| 0.6 | Update .gitignore | Add Electron-specific entries (dist/, out/, .env.local) |

**Checkpoint**: Run `npm start`. An Electron window opens showing a React component. Console logs confirm IPC bridge is functional.

---

## Milestone 1: Liquid Glass UI Shell
> **Gate**: All panels visible with glass theming, tooltips display on hover for every setting

| # | Task | Details |
|---|------|---------|
| 1.1 | Create GlassCard component | Backdrop blur, translucent background, rounded corners, shadow |
| 1.2 | Set up CSS variables | All design tokens from UI-SPEC.md (colors, radii, typography, shadows) |
| 1.3 | Build dark theme | Dark variant CSS variables |
| 1.4 | Build light theme | Light variant CSS variables |
| 1.5 | Build layout skeleton | Source Panel, Audit Panel, Settings Panel, Results Panel, Progress, Actions |
| 1.6 | Create Tooltip component | Glass-styled tooltip with ⓘ trigger icon |
| 1.7 | Wire tooltips to every setting | All tooltip content from UI-SPEC.md |
| 1.8 | Create custom TitleBar | Frameless window with drag region, minimize/maximize/close, theme toggle |
| 1.9 | Create reusable form components | Toggle switch, Select dropdown, Checkbox — all glass-styled |
| 1.10 | Add Framer Motion | Panel entrance animations, button hover effects |

**Checkpoint**: All panels render with correct glass styling. Hover any setting's ⓘ icon → tooltip appears with correct text. Toggle between dark/light theme → all colors update smoothly.

---

## Milestone 2: Shared Folder Scanner
> **Gate**: Select Z:\ → folder toggle grid populates with M8, M10, M12… in real time

| # | Task | Details |
|---|------|---------|
| 2.1 | Create FolderScanner service | Main process service that reads first-level subdirectories |
| 2.2 | Create folder browser dialog | Native Electron dialog.showOpenDialog for folder selection |
| 2.3 | Wire IPC channel `scanner:scan-root` | Renderer requests scan, main returns folder list |
| 2.4 | Build FolderToggleGrid component | CSS Grid of checkboxes, auto-populated from scan results |
| 2.5 | Implement Select All / Deselect All | Toggle button that checks/unchecks all folder checkboxes |
| 2.6 | Implement Refresh button (⟳) | Re-scans without restarting, updates toggle grid, preserves existing states |
| 2.7 | Persist shared folder path | Save to electron-store, reload on next launch |
| 2.8 | Auto-scan on launch | If saved path exists, scan it automatically and populate toggles |

**Checkpoint**: Open app → if Z:\ was previously selected, toggle grid shows all NAS folders. Click Refresh → list updates. Select a new folder → grid repopulates. Close and reopen → same folder selected.

---

## Milestone 3: Audit File Parser
> **Gate**: Load a CSV, XLSX, and TXT audit file → correct IMEI count displayed for each

| # | Task | Details |
|---|------|---------|
| 3.1 | Create AuditParser service | Main process service with format detection and parsing |
| 3.2 | CSV parser | csv-parse with auto-delimiter; auto-detect IMEI column |
| 3.3 | Excel parser | xlsx (SheetJS) for .xlsx and .xls; auto-detect IMEI column |
| 3.4 | TXT parser | Line-by-line read; trim whitespace; validate each line |
| 3.5 | IMEI validation | Regex `/^\d{15}$/`; report invalid entries with line numbers |
| 3.6 | Duplicate detection | Flag duplicate IMEIs within the file; deduplicate for search |
| 3.7 | Build AuditPanel UI | File path input, Browse button, import summary display |
| 3.8 | Drag-and-drop import | Drop zone with visual feedback (border change, text change) |
| 3.9 | Wire IPC channel `audit:parse` | Renderer sends file path, main returns parse result |
| 3.10 | Error handling | Show user-friendly messages for corrupt files, wrong format, empty files |

**Checkpoint**: Drop a .csv file → "CSV detected · 1,247 IMEIs loaded · 3 invalid". Browse to .xlsx → correct count. Load .txt → correct count. Load a file with bad data → invalid entries reported.

---

## Milestone 4: IMEI Search Engine
> **Gate**: Search returns correct matches with working progress bar, date range filter, and scan index filter

| # | Task | Details |
|---|------|---------|
| 4.1 | Create IMEIMatcher service | Main process orchestrator for the full search pipeline |
| 4.2 | Date folder filter | Only traverse folders matching `/^\d{8}$/` |
| 4.3 | IMEI extraction | `folderName.split('_')[0]` → 15-digit IMEI |
| 4.4 | Scan index extraction | `parseInt(folderName.split('_')[1])` |
| 4.5 | Audit list matching | Set-based O(1) lookup for each extracted IMEI |
| 4.6 | Parallel machine scanning | Promise.allSettled across selected machine folders |
| 4.7 | Date range filter | Optional start/end dates; skip date folders outside range |
| 4.8 | Scan index filter | All / First only (_1) |
| 4.9 | File count & size stats | Stat each matched IMEI folder: count files by type, total size |
| 4.10 | Missing IMEI detection | Diff audit list against found IMEIs → list missing entries |
| 4.11 | Incomplete detection | Calculate median file count; flag <50% as incomplete |
| 4.12 | Progress reporting | IPC events: percent, current folder, matches so far |
| 4.13 | Search cancellation | Support cancellation via AbortController or flag |
| 4.14 | Wire IPC channels | `search:start`, `search:progress`, `search:cancel` |

**Checkpoint**: Load audit list with 1,000 IMEIs. Select 5 machine folders. Click Search → progress bar advances, results populate. Apply date range → only matching dates searched. Set scan index to "First only" → only _1 folders returned. Verify matched IMEIs are correct.

---

## Milestone 5: Results Preview & Missing Report
> **Gate**: User can review all matches, sort them, and see which IMEIs are missing before exporting

| # | Task | Details |
|---|------|---------|
| 5.1 | Build ResultsSummary | "Found X / Y IMEIs" with color-coded status dots |
| 5.2 | Build ResultsList | Scrollable table with columns: IMEI, Machine, Date, Index, Files |
| 5.3 | Table sorting | Click column header to sort ascending/descending |
| 5.4 | Color-coded rows | Green (complete), orange (incomplete with ⚠ icon) |
| 5.5 | Build MissingIMEIModal | Glass-styled modal listing all not-found IMEIs |
| 5.6 | Export missing list | Button to save missing IMEIs as .txt or .csv |
| 5.7 | Result count breakdown | "● X complete · ● Y incomplete · ● Z missing" |

**Checkpoint**: After search, results table shows all matches with correct data. Click column headers → table re-sorts. Click "View Missing IMEIs" → modal opens with correct list. Click "Export List" → file saved.

---

## Milestone 6: Export Engine
> **Gate**: Export produces correctly organized output folders with correct image types

| # | Task | Details |
|---|------|---------|
| 6.1 | Create FileExporter service | Main process service for copy/move operations |
| 6.2 | Copy operation | Recursive folder copy with file type filtering |
| 6.3 | Move operation | fs.rename with cross-device fallback (copy + verify + delete) |
| 6.4 | Image type filter | During copy: skip files not matching selected extension |
| 6.5 | Flat organization | Copy to `dest/IMEI_index/` |
| 6.6 | By Machine organization | Copy to `dest/Machine/IMEI_index/` |
| 6.7 | By Date organization | Copy to `dest/Date/IMEI_index/` |
| 6.8 | Machine → Date organization | Copy to `dest/Machine/Date/IMEI_index/` |
| 6.9 | Date → Machine organization | Copy to `dest/Date/Machine/IMEI_index/` |
| 6.10 | By IMEI organization | Copy to `dest/IMEI/Machine_Date_Index/` |
| 6.11 | By Scan Index organization | Copy to `dest/scan_N/IMEI_index/` |
| 6.12 | Duplicate handling | Skip: check existence. Overwrite: remove then copy. |
| 6.13 | Progress reporting | IPC events: percent, current IMEI, files copied, bytes transferred |
| 6.14 | Export cancellation | Cancel mid-export; clean up partial folders |
| 6.15 | Destination folder dialog | Native folder picker for export destination |

**Checkpoint**: Export 10 matched IMEIs with each organization mode. Verify folder structure matches spec. Export with "BMP only" → no .jpg files in output. Use "Move" → source folders removed after successful transfer.

---

## Milestone 6b: Export Summary Report
> **Gate**: After export, a color-coded Excel report is generated with accurate status for every IMEI

| # | Task | Details |
|---|------|---------|
| 6b.1 | Create ReportGenerator service | Generate .xlsx using ExcelJS or xlsx-style |
| 6b.2 | Report columns | IMEI, Status, Source Machine, Source Date, Scan Index, File Count, Total Size, Destination Path |
| 6b.3 | Color coding | Green fill for complete, orange for incomplete, red for not found |
| 6b.4 | Summary statistics header | Total searched, found, incomplete, missing, durations |
| 6b.5 | Missing IMEIs section | Separate rows at bottom for audit list entries with no match |
| 6b.6 | Auto-save report | Save alongside exported folders or user-chosen location |
| 6b.7 | Optional separate missing file | Export missing-IMEIs-only as .txt/.csv |

**Checkpoint**: Complete an export → report file appears. Open in Excel → rows are color-coded correctly. Summary stats match the UI counts. Missing IMEIs listed in red.

---

## Milestone 7: Dark/Light Mode & Theming
> **Gate**: Toggle between dark and light mode; close and reopen → same theme active

| # | Task | Details |
|---|------|---------|
| 7.1 | Dark theme implementation | Apply dark CSS variables from UI-SPEC.md |
| 7.2 | Light theme implementation | Apply light CSS variables |
| 7.3 | Theme toggle UI | Sun/moon icon in title bar |
| 7.4 | Smooth transition | 300ms CSS transition on theme change |
| 7.5 | Persist theme preference | Save to electron-store |
| 7.6 | System theme detection | Optional: follow `prefers-color-scheme` |

**Checkpoint**: Click theme toggle → all colors transition smoothly. Close app → reopen → same theme. Change Windows dark mode → app follows (if system theme option is enabled).

---

## Milestone 8: Multi-Source & Search History
> **Gate**: Switch between two NAS sources with different toggle states; recall and re-run a previous search

| # | Task | Details |
|---|------|---------|
| 8.1 | Source data model | Array of sources, each with id, name, rootPath, folderToggles |
| 8.2 | Add Source dialog | Name the source, select root folder |
| 8.3 | Source switcher dropdown | In Source Panel header; switch active source |
| 8.4 | Per-source toggle persistence | Each source saves its own folder checkbox states |
| 8.5 | Remove / rename source | Edit and delete sources from the switcher |
| 8.6 | Search history data model | Last 5 entries: audit path, source, folders, filters, result summary |
| 8.7 | Search history UI | Dropdown or sidebar in Results panel |
| 8.8 | One-click re-run | Load audit file + apply saved settings + start search |
| 8.9 | History pruning | Remove entries if audit file no longer exists at saved path |

**Checkpoint**: Add two sources (NAS and local). Switch between them → toggle states are independent. Run a search → appears in history. Click history entry → settings restored and search re-runs.

---

## Milestone 9: Settings & Polish
> **Gate**: Close and reopen app → all settings restored; folder list refreshed from disk

| # | Task | Details |
|---|------|---------|
| 9.1 | Full settings persistence | All dropdowns, toggles, paths, window bounds |
| 9.2 | Launch refresh | Re-scan active source on startup; merge with saved toggles |
| 9.3 | New folder handling | New subfolders on NAS default to unchecked |
| 9.4 | Removed folder handling | Folders no longer on disk pruned from saved state |
| 9.5 | Error handling polish | User-friendly messages for: NAS unreachable, file locked, disk full, etc. |
| 9.6 | Performance optimization | Cache folder scans, throttle IPC progress events, debounce UI updates |
| 9.7 | Search timing display | "Last search: 1m 23s" in status bar |
| 9.8 | Completion notification | Optional Windows toast notification when long operations finish |

**Checkpoint**: Configure all settings, change window size, close app. Reopen → everything restored. Add a new folder on NAS → refresh shows it unchecked. Remove a folder → refresh removes it from list. Disconnect NAS → clear error message shown.

---

## Milestone 10: Model Recognition Image Collection
> **Gate**: MR PASS toggle → exports only MR PASS `.png` files; MR FAIL toggle → exports only MR FAIL images; both OFF → normal collection

> **⚠ Superseded — see Milestone 16 for current behavior.** The `ModelRecogImages/` traversal in the 10a/10b tasks below was the original MR approach. It was **abandoned** because the `{Brand-Model}/` folders hold tens of thousands of files and time out over SMB. An interim design (M15, v1.5.1) reused the standard IMEI-folder search and extracted the per-device `SG-*.png`; that too was superseded once the real layout was confirmed. **Current (M16, v1.5.4–v1.5.7):** wrong-color devices are a bare `{IMEI}` folder opened by exact path; `ModelRecogImages` is never scanned and the audit list (grade column) drives collection. The 10a/10b rows below are retained for historical context only.

### 10a: MR PASS Images (READY TO BUILD)

| # | Task | Details |
|---|------|---------|
| 10a.1 | ModelRecogImages traversal | Locate `{machine}/ModelRecogImages/` → traverse date subfolders → list brand-model subfolders (exclude `Error-Error`) |
| 10a.2 | MR PASS toggle in Settings | iOS-style toggle switch with tooltip |
| 10a.3 | MR PASS IMEI extraction | Extract IMEI from `.png` filenames: `filename.split('-')[3]` (4th segment) |
| 10a.4 | MR PASS search + audit matching | List `.png` files in each brand-model folder, extract IMEIs, match against audit list |
| 10a.5 | MR PASS export | When toggle ON: export matched `.png` files from brand-model folders |
| 10a.6 | MR PASS in results | Results list shows brand-model folder name and parsed brand+model from filename |
| 10a.7 | MR PASS in export report | Report includes MR PASS status, brand, model, source brand-model folder |

**Checkpoint**: Enable MR PASS toggle → search scans `ModelRecogImages/{date}/Apple-iPhone8/` etc. → finds `.png` files with matching IMEIs → exports only those files. Disable → normal JPEG/BMP collection from IMEI_Index folders. Report shows brand+model.

### 10b: MR FAIL Images (READY TO BUILD)

| # | Task | Details |
|---|------|---------|
| 10b.1 | MR FAIL toggle in Settings | iOS-style toggle switch with tooltip |
| 10b.2 | Error-Error folder detection | Under `ModelRecogImages/{date}/`, locate `Error-Error/` subfolder |
| 10b.3 | MR FAIL IMEI extraction | Extract IMEI from `.png` filenames in Error-Error: `filename.split('-')[3]` |
| 10b.4 | MR FAIL search + audit matching | List `.png` files in Error-Error, extract IMEIs, match against audit list |
| 10b.5 | MR FAIL export | When toggle ON: export matched `.png` files from Error-Error |
| 10b.6 | MR FAIL in export report | Report marks these as MR FAIL; includes parsed brand/model from filename |

**Checkpoint**: Enable MR FAIL toggle → search scans `ModelRecogImages/{date}/Error-Error/` → finds `.png` files with matching IMEIs → exports only those files. Report shows MR FAIL status.

---

## Milestone 11: Pending Features
> **Gate**: Depends on v1 documentation delivery

| # | Task | Details |
|---|------|---------|
| 11.1 | Coworker feature requests | To be incorporated after initial analysis period |

---

## Milestone 12: Packaging & Distribution
> **Gate**: Install from .exe → app appears in Start Menu + Desktop → runs and connects to NAS → uninstall via Add/Remove Programs → zero remnants

| # | Task | Details |
|---|------|---------|
| 12.1 | Configure electron-builder | Windows target: NSIS installer |
| 12.2 | Install path | `C:\Program Files\Image Collection v2\` (standard ProgramFiles) |
| 12.3 | Installer shortcuts | Desktop shortcut (checkbox, default ON), Start Menu shortcut (checkbox, default ON) |
| 12.4 | Uninstaller | Removes ALL files, shortcuts, registry entries, and app data — clean uninstall with no remnants |
| 12.5 | Register in Add/Remove Programs | Uninstaller appears in Windows Programs and Features |
| 12.6 | App icon and branding | .ico for exe, installer, and shortcuts |
| 12.7 | Production build | Optimize: minify, tree-shake, remove dev dependencies |
| 12.8 | Target machine testing | Test on actual production floor PCs (verify NAS access, permissions, no Node.js dependency) |
| 12.9 | Code signing | Optional: sign the .exe to avoid SmartScreen warnings |

**Checkpoint**: Build installer. Install on a clean Windows machine → app in Start Menu + Desktop. Launch → connects to NAS, runs a full search+export cycle. Uninstall via Add/Remove Programs → zero files, shortcuts, or registry entries left behind.

---

## Milestone 13: Comprehensive README
> **Gate**: A new user can read the README and understand every feature, setting, and toggle without outside help

| # | Task | Details |
|---|------|---------|
| 13.1 | Quick Start section | Installation, first launch, basic workflow |
| 13.2 | Features overview | Bullet-point summary of all capabilities |
| 13.3 | Source configuration docs | Shared folder, multi-source, folder toggles |
| 13.4 | Audit list import docs | Supported formats (CSV, XLSX, TXT), IMEI validation rules, drag-and-drop |
| 13.5 | Search filters docs | Date range filter, scan index filter |
| 13.6 | Export settings docs | Action (Move/Copy), Image Type, Organization mode (all 7), Duplicates |
| 13.7 | MR & AI toggle docs | MR PASS, MR FAIL, AI Images Only — what each does, when to use |
| 13.8 | Export report docs | Color coding reference (green/orange/red), report columns |
| 13.9 | Output organization examples | Folder structure diagrams for each of the 7 modes |
| 13.10 | Theme & preferences docs | Dark/light mode, search history, settings persistence |
| 13.11 | Installation & uninstall | Step-by-step instructions for install and clean uninstall |
| 13.12 | System requirements | Windows version, NAS connectivity, disk space |
| 13.13 | Troubleshooting | Common issues: NAS unreachable, permissions, file locks |
| 13.14 | Known limitations | Pending features, platform restrictions |

**Checkpoint**: Hand README to someone unfamiliar with the tool. They can install, configure a source, import an audit list, run a search, export results, and understand the report — all from the README alone.

---

## Milestone 14: Auto-Update System
> **Gate**: App checks for updates on launch → shows update dialog when newer version available → user clicks Update → new version installs and relaunches without manual uninstall

**Status**: Blocked — awaiting IT approval for update file hosting location.

**IT Request (submitted 2026-05-28)**: Need a static HTTPS endpoint to host 3 files per release (`latest.yml`, `.exe` installer, `.blockmap`). Options presented: internal IIS server or external domain (`darksquare.dev`). Awaiting response.

| # | Task | Details |
|---|------|---------|
| 14.1 | IT approval for hosting | Get approved hosting URL — internal server (IIS) or external domain |
| 14.2 | Configure electron-builder publish | Add `publish` block with `generic` provider pointing to approved URL |
| 14.3 | Add electron-updater dependency | `npm install electron-updater` |
| 14.4 | Implement update check on launch | `autoUpdater.checkForUpdates()` in main process after window ready |
| 14.5 | Build update notification dialog | Glass-styled dialog: version info, changelog summary, "Update Now" / "Later" buttons |
| 14.6 | Handle download progress | Progress bar in update dialog during download |
| 14.7 | Install and relaunch | `autoUpdater.quitAndInstall()` on user confirmation — NSIS overwrites in-place |
| 14.8 | Error handling | Graceful fallback if update server unreachable (silent fail, no crash) |
| 14.9 | URL whitelisting | Coordinate with IT to whitelist the hosting URL on production floor PCs |
| 14.10 | Release workflow documentation | Document the 3-file upload process for each new version |
| 14.11 | End-to-end testing | Test full update cycle: old version → detects new → downloads → installs → launches |

**Checkpoint**: Install v1.4.0 on a production PC. Upload v1.5.0 files to hosting endpoint. Launch app → "Update available: v1.5.0" dialog appears. Click "Update Now" → app downloads, installs, and relaunches at v1.5.0. No manual uninstall required. If hosting is unreachable → app launches normally with no error.

---

## Milestone 15: MR Search Reliability & Diagnostics
> **Gate**: A search produces a `search-*.log` showing the path decision (targeted vs full-discovery) + per-machine folder counts; MR collection runs the fast IMEI-folder search and returns each audit IMEI's `SG-*.png` (tagged PASS/FAIL); toggling a setting does not require re-uploading the audit file

> **⚠ The MR-collection mechanism in 15.3/15.4 (extract `SG-*.png` from each `{IMEI}_{index}` folder) was an interim design, superseded by Milestone 16 (v1.5.4–v1.5.7).** A File Station check showed wrong-color devices are actually stored as a bare `{IMEI}` folder (no `_index`) holding a timestamp-named `.png` — so the `{IMEI}_*` + `SG-*.png` lookup found nothing for them. MR collection now opens that `{IMEI}` folder by **exact path**. The non-MR items in this milestone (15.1/15.2 logging & View Log, 15.5 auto End-Date +1, 15.6 OneDrive timeout, 15.7 Machine→Model, 15.8 stale-state) all still hold. See M16 for the current MR behavior.

| # | Task | Details |
|---|------|---------|
| 15.1 | Search logging | Write a rotating `search-<timestamp>.log` to `%APPDATA%/Image Collection v2/logs/` on every search (keep 3 most recent, separate from export logs). Record search mode (standard/MR), IMEI/hint counts, SmartSearch + MR flags, scan-index filter, date range, selected folders, root path, the path taken (targeted vs full-discovery) with per-machine folder counts and drop-reason counters, fallback transitions, scan errors, and a final summary (matches, missing, foldersScanned, scanErrors, elapsed) |
| 15.2 | "View Log" opens the logs folder | Status-bar "View Log" link opens the logs folder in Explorer (both search and export logs live there, 3 most recent each) |
| 15.3 | MR reuses the standard search + extracts `SG-*.png` | The earlier v1.5.0 plan to scan both the recognized-model and `Error-Error` folders under `ModelRecogImages` was **abandoned** — those model folders hold tens of thousands of files and time out over SMB (15s readdir → empty results + UI hang). Instead, enabling **either** MR PASS or MR FAIL sets an `mrMode` flag on the SearchContext and runs the **same fast standard IMEI-folder search**; `buildMatchBatch` then extracts the single `SG-*.png` from each matched IMEI folder. `ModelRecogImages` is not scanned. Results are tagged PASS (green) / FAIL (red) from the parsed model name (`Error-Error` → FAIL). Only the `SG-*.png` is exported; a matched folder with no `SG-*.png` is reported missing. The audit list is the filter — there is intentionally NO "wrong color" toggle. (`searchMRImages`/`scanMRDateFolders`/`discoverMRDateFolders` were removed.) |
| 15.4 | `SG-*.png` capture in file counting | `countFiles`/`countFilesRecursive` capture the first `SG-*.png` they encounter in a matched folder, returning its `mrImageName`/`mrImagePath` so MR mode can tag and export it without a second directory read |
| 15.5 | Auto End-Date +1 (midnight rollover) | Devices tested near midnight can land in the next day's folder. Auto-populated End Date is now max(test date) + 1 day (via `addDaysToYMD`), so the standard search reaches the rolled-over folder; MR mode inherits this. Missing/non-existent folders (ENOENT) are benign and not counted as scan errors. (No MR-specific ±1-day folder probing — `expandDateRange` was removed.) |
| 15.6 | OneDrive-safe audit read | Audit-file read has a 20s timeout; an unhydrated OneDrive "Files On-Demand" placeholder fails fast with a clear retryable error ("file still downloading — right-click → Always keep on this device") instead of hanging |
| 15.7 | Machine → Model organize mode | New `machine-model` mode → `dest/M8/Apple-iPhone13Pro/IMEI_index/` (standard) and `dest/M8/<Model\|Error-Error>/IMEI/<date>_<tag>.png` (MR). Model parsed from the SG-*.png filename; MR matches carry a `modelName`, falling back to the source folder name |
| 15.8 | Stale-state fix | The date range is read from committed React state at search time (not a ref that could be stale right after auto-populate); machine auto-select is keyed by content. Changing a setting/toggle no longer requires re-uploading the audit file |

**Checkpoint**: Run an MR search → a `search-*.log` is written showing whether the targeted or full-discovery path ran, with per-machine folder counts and the final summary, and the run completes in seconds (no `ModelRecogImages` enumeration). Each matched device's `SG-*.png` is collected and tagged PASS/FAIL from its model name; a device with no `SG-*.png` is reported missing. Toggle MR PASS/FAIL or change the date range without re-uploading the audit file → the next search still works. Export with Machine → Model → folders nest as `dest/{machine}/{model}/...`.

---

## Milestone 16: Exact-Path & Audit-Driven MR Collection (v1.5.4 → v1.5.7)
> **Gate**: An MR collection audit (wrong-color list) collects every listed device by opening its exact `{machine}/{date}/{IMEI}/` folder — and does so **even with both MR toggles OFF and no special settings** — while Type A `{IMEI}_{index}` devices still collect normally and no faster path regresses.

This milestone replaces the Milestone 15 SG-`*`.png-extraction mechanism after the real on-disk layout was confirmed. It builds up across four releases.

| # | Task | Details |
|---|------|---------|
| 16.1 | Exact-path MR collection (v1.5.4) | Wrong-color / MR-upload devices are stored as a bare `{IMEI}` folder (no `_index`) with a **timestamp-named `.png`** (not `SG-*`). `searchMRDirect` → `buildHintedTargets` + `collectMRDirect` open each `{root}/{machine}/{date}/{IMEI}/` by **exact path** (fully known from the audit's IMEI + Machine + Date) and take the `.png` inside, whatever its name. No wildcard, no listing of the giant date folder → instant and immune to the concurrency saturation that timed out listing/`dir` approaches. `searchMRImages`/`scanMRDateFolders`/`discoverMRDateFolders` removed. |
| 16.2 | Server-side wildcard for Type A (v1.5.3) | Standard `{IMEI}_{index}` lookups resolve each folder via `findMatchingIMEIFolders` running `cmd /c dir /b /a:d {datePath}\{IMEI}_*` in a child process — the NAS applies the wildcard so the folder is found without enumerating the date folder, and a slow NAS never pins Node's fs thread pool. A read error reports those IMEIs missing instead of triggering a broad rescan. |
| 16.3 | Auto-detect MR audit + model (v1.5.5) | `AuditParser` detects a **grade column** (header contains "grade", or values match a grade vocabulary) → `AuditParseResult.isMRAudit = true`; the renderer **force-enables MR collection** (`forceMR`) with a banner, regardless of the toggles. It also detects a **model column** (header contains "model"), reduces each value to the device model via `deviceModel()` (drops the trailing color segment, e.g. `Apple-iPhone11-Purple` → `Apple-iPhone11`) into `AuditHint.model`, which flows onto each match's `modelName` for By Model / Machine→Model. The raw `grade` is captured on the hint too. |
| 16.4 | All organize modes for MR matches (v1.5.5/v1.5.7) | MR matches are no longer Flat-only — By Machine, By Date, Machine→Model, By Model, etc. all work. The model level comes from the audit's Model column; without a Model column only By Model / Machine→Model fall back to an `Unknown` folder (other modes unaffected). |
| 16.5 | Universal exact-path probe / bulletproof collection (v1.5.7) | The dispatcher `searchIMEIs` runs `collectMRDirect` over **all** hinted targets **first on every Smart Search** — even non-MR/standard. Type B `{IMEI}` devices are collected **regardless of the MR toggle or a grade column**. Type A `{IMEI}_{index}` devices `ENOENT` on the probe (fast) and only those fall through to the standard server-side-wildcard enumeration, so the standard path is no slower. |

**Checkpoint**: Load a wrong-color audit (IMEI + Machine + Date + Grade + Model) with **both MR toggles OFF** → the banner appears, MR auto-enables, and every listed device is collected by opening its `{IMEI}` folder directly; the run is instant (no date-folder listing, no `ModelRecogImages`). Export with Machine → Model → `dest/M12/Apple-iPhone11/{IMEI}/<file>.png`. Remove the Model column and re-run → still collected; By Model lands them under `Unknown`. Confirm a standard (Type A) audit still collects full folders via the `{IMEI}_*` server-side lookup at the same speed as before.

---

## Milestone 17: Audit-Parser Data-Loss Prevention (v1.5.8)
> **Gate**: A real audit list cannot silently lose IMEIs to formatting/encoding edge cases — every recoverable 15-digit IMEI is collected — while a clean production list parses **identically** to before (402 rows → 397 unique + 5 duplicates flagged).

Hardens `AuditParser` against the ways a real-world spreadsheet can mangle a column without the operator noticing. Every change is additive and range/format-guarded so clean files are unaffected.

| # | Task | Details |
|---|------|---------|
| 17.1 | Separator-tolerant IMEI normalization | `normalizeIMEI` strips spaces and dashes before validation (`35-998765-432109-8` / `3539 7910 2606 579` → `359987654321098`). Applied uniformly in `extractIMEIs`, `findIMEIColumn`, `buildHints`, and the `hasHeader` checks of all three parsers, so a formatted column is recovered instead of dropping every row. The de-dup set and duplicate flagging key off the normalized value. |
| 17.2 | Scientific-notation recovery (Excel) | A 15-digit IMEI stored as a number renders as `3.50308E+14`. `parseExcel` now reads the sheet **twice** — formatted (`raw:false`) and raw (`raw:true`) — and `recoverScientificCells` replaces any cell that *looks* scientific with the raw integer value (`String(Math.round(rawVal))`), exact because 15 digits < 2^53. Only scientific-formatted numeric cells are touched. |
| 17.3 | Excel serial-date interpretation | `normalizeDate` recognizes a bare serial day-number (e.g. `46180`) via the 1899-12-30 epoch using `Date.UTC` math, range-bounded to serials ~2009–2064 and a 2000–2099 result year so ordinary integers and the existing 8-digit `YYYYMMDD` are never misread. All prior formats (`YYYYMMDD`, `YYYY-MM-DD`, `M/D/YY`, with/without time) unchanged. The midnight end-date+1 safety (renderer `suggestedDateRange`) is preserved. |
| 17.4 | Encoding-robust text read | `decodeTextBuffer` honours a UTF-16 LE/BE BOM (`0xFF 0xFE` / `0xFE 0xFF`, with `swap16` for BE) and a UTF-8 BOM; `parseCSV`/`parseTXT` now read the file as a Buffer and decode through it, so a "Unicode Text" CSV/TXT no longer parses as garbled bytes that match nothing. Defaults to UTF-8 for un-marked files. |
| 17.5 | Duplicate → most-recent hint | `buildHints` keeps the hint (Machine/Date/Model/Grade) from the **latest** date for a repeated IMEI (`hint.date > existing.date`, lexical = chronological on `YYYYMMDD`), while `extractIMEIs` continues to flag every duplicate in the results. No behavioural change for unique IMEIs. |

**Checkpoint**: The production `CollectMRImage-06102026.xlsx` still yields 402 rows / 397 unique / 5 duplicates with identical Machine/Date/Model/Grade hints. Synthetic rows confirm: a dashed IMEI, a scientific-notation IMEI (from a numeric cell), a serial-date cell, and a UTF-16-encoded CSV are each recovered; a duplicate IMEI's hint follows the most-recent date. `npm run typecheck` and lint pass.

---

## Milestone 18: Post-Audit Cleanup & MR Unification (v1.5.9)
> **Gate**: A read-only multi-agent audit's confirmed findings are resolved **without changing how a valid audit collects** — the production list still parses 402/397/5 and exact-path MR collection is unchanged — while a divergent legacy MR path and several dead-code items are removed.

Driven by a 6-dimension read-only audit (dead/zombie code, search engine, parser, export/FS, IPC/types, renderer) with adversarial verification of every removable finding.

| # | Task | Details |
|---|------|---------|
| 18.1 | Retire the legacy SG-`*`.png MR branch | The standard-scan MR emission in `buildMatchBatch` (the superseded second MR implementation — Type-A `{IMEI}_index` + `SG-*.png` only, reachable when MR ran without hints) is removed, along with `SearchContext.mrMode` and the `FileCountResult.mrImageName/mrImagePath` fields. The live `modelName` extraction (`extractModelFromMRFilename`, used for By-Model / Machine→Model organization of standard folders) is **kept**. `collectMRDirect` (the exact-path engine) is untouched. |
| 18.2 | MR routing is toggle-independent | The dispatcher routes MR to exact-path (`searchMRDirect`) whenever the audit carries hints, regardless of the Smart Search toggle (the renderer now sends hints for an MR audit even with Smart Search off). MR without any hints surfaces an `mr-no-hints` notice (`SearchResult.notice`) instead of a broad scan that cannot locate MR images. |
| 18.3 | Dead-code removal | Removed: `expandDateRange` (utils), the `ExportLogger` value alias (Logger — the type alias is kept), `scanDateFolder().entryCount`, the `lastDestination` electron-store default, and the write-only `AuditHint.grade` field (`isMRAudit` still derives from grade-column detection). |
| 18.4 | Parser data-integrity hardening | `parseExcel` picks the worksheet with the most IMEIs (`pickBestSheet`) so a cover/notes sheet can't hide the data; header detection adds a keyword check (`looksLikeHeaderRow`) so a numeric-looking header can't be misread as data; an undecidable M/D vs D/M order is flagged "assumed" in `dateFormatGuess`. The MR filename-collision risk is eliminated structurally by 18.1 (one match per IMEI, IMEI always in the path). |
| 18.5 | Robustness + doc accuracy | The "Save Missing IMEIs" write is wrapped so a failure surfaces instead of an unhandled rejection. Stale `SG-*.png` comments, type docs, and the MR PASS / MR FAIL tooltips were corrected to the exact-path behavior; the `buildDestPath` JSDoc was reattached and given the `machine-model` mode. |

**Checkpoint**: `npm run typecheck` + lint pass; the production audit still parses 402/397/5 with identical hints; a repo-wide grep confirms zero references to every removed symbol; an MR audit (hints present) still routes to `searchMRDirect` and collects by exact path. Verified.

---

## Milestone 19: Date-less MR Collection (v1.5.10)
> **Gate**: An MR audit that lacks a Date column (or any hint columns) still collects every device — by exact-path probing the selected machine folder(s) across the selected date range — with **no folder enumeration**, while a fully-hinted audit is still one exact lookup per device.

Driven by a field report: a real MR list (`CollectMRImage-06112026.xlsx`) had Model + IMEI + Machine but **no** StartTime/Date column, so every device dropped as `noHint` and 0 images collected.

| # | Task | Details |
|---|------|---------|
| 19.1 | Date-range exact-path expansion | `buildMRProbeTargets` replaces the date-required `buildHintedTargets` for MR. Per IMEI: machine = the hinted machine (if its folder is selected) else every selected folder; date = the hinted date (if in range) else every day in the selected range (`datesInRange`, capped at 400 days). The cartesian product is probed by exact path — `Machine/{date}/{IMEI}/` — so a device with no date is found on whichever day it was tested, and a bare IMEI list collects given selected machines + a range. No directory listing, so it stays NAS-safe at any range width. |
| 19.2 | Single-lookup fast path preserved | A device with machine + in-range date yields exactly one target (`expanded=false`) — the dated production list (397/397) builds 397 targets, identical to before. |
| 19.3 | Concurrent-probe dedup | `collectMRDirect` re-checks `foundIMEIs` before emitting a match, so the multi-date probe can't emit a device twice. |
| 19.4 | Honest no-targets notice | MR routing is unconditional (`mrMode → searchMRDirect`); if nothing can be probed (no machines selected and no date source), a `mr-no-targets` notice tells the operator to select machine folder(s) and set a date range. |
| 19.5 | Blank-row warning fix | `buildHints` counts only valid-IMEI rows toward `totalHintedRows`, so empty trailing spreadsheet rows no longer inflate the "N IMEIs have unrecognized machine values" warning (a clean 130-device file reads 130/130). |

**Checkpoint**: The no-date file (130 IMEIs, M17/M21, no Date column) builds 2,080 exact-path probes (130 × 1 machine × 16 days, `expanded=true`) and collects; the dated file builds 397 single-lookup targets (`expanded=false`, unchanged). typecheck + lint pass.

---

## Milestone Dependency Map

```
M0 (Scaffold)
 └─► M1 (UI Shell)
      ├─► M2 (Folder Scanner)
      │    └─► M4 (Search Engine) ──► M5 (Results) ──► M6 (Export) ──► M6b (Report)
      ├─► M3 (Audit Parser) ────────────────────┘
      └─► M7 (Theming)
           └─► M8 (Multi-Source + History)
                └─► M9 (Polish)
                     ├─► M10a (MR PASS) ─┬─► M12 (Packaging) ──► M13 (README)
                     ├─► M10b (MR FAIL) ┤         │
                     │                  └─► M15 (MR Reliability & Diagnostics)
                     │                          └─► M16 (Exact-Path & Audit-Driven MR)
                     ├─► M11 (Pending)             │
                     └──────────────────► M14 (Auto-Update) [blocked on IT approval]
```
