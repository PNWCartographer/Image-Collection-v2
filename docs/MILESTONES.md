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
                     ├─► M10b (MR FAIL) ┘
                     └─► M11 (Pending) [blocked on v1 docs]
```
