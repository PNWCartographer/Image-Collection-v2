# Image Collection v2 — Technical Architecture

## 1. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Desktop Shell | Electron | Window management, native dialogs, system tray, notifications |
| UI Framework | React 18+ | Component-based renderer UI |
| Build Tool | Vite | Fast dev server, HMR, production bundling |
| Language | TypeScript | Type safety across main and renderer processes |
| Styling | CSS Modules + CSS Variables | Liquid Glass theming with dark/light mode |
| Animations | Framer Motion | Panel transitions, progress animations |
| Excel Parsing | xlsx (SheetJS) | Read .xlsx and .xls audit files |
| CSV Parsing | csv-parse | Stream-based CSV parsing with auto-detection |
| Settings Store | electron-store | Persistent JSON settings between sessions |
| Packaging | electron-builder | Windows installer (.exe / .msi) |
| Linting | ESLint + Prettier | Code quality and formatting |

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        Electron App                          │
│                                                              │
│  ┌─────────────────────┐      IPC       ┌─────────────────┐ │
│  │    Main Process      │◄────Bridge────►│ Renderer Process │ │
│  │    (Node.js)         │               │ (React + Vite)   │ │
│  │                      │               │                  │ │
│  │  ┌────────────────┐  │               │  ┌────────────┐  │ │
│  │  │ FolderScanner     │  │               │  │ App Shell      │  │ │
│  │  │ AuditParser       │  │               │  │ SourcePanel    │  │ │
│  │  │ IMEISearchEngine  │  │               │  │ AuditPanel     │  │ │
│  │  │ ExportEngine      │  │               │  │ SettingsPanel  │  │ │
│  │  │ Logger            │  │               │  │ ResultsPanel   │  │ │
│  │  │ electron-store    │  │               │  │ ProgressBar    │  │ │
│  │  └────────────────┘  │               │  │ ActionButtons  │  │ │
│  │                      │               │  └────────────┘  │ │
│  └─────────────────────┘               └─────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Main Process (Node.js)
Handles all file system operations, heavy computation, and OS integration. The renderer never touches the file system directly.

### Renderer Process (React)
Handles all UI rendering, user interactions, and state management. Communicates with the main process exclusively through IPC channels.

### IPC Bridge
Typed message passing between main and renderer. Uses Electron's `ipcMain.handle` / `ipcRenderer.invoke` for request-response, and `webContents.send` / `ipcRenderer.on` for event streams (progress updates).

---

## 3. Main Process Services

### 3.1 FolderScanner

Scans NAS directories and returns structured folder metadata.

```typescript
interface FolderScanResult {
  rootPath: string;
  folders: {
    name: string;
    path: string;
    isMachineFolder: boolean; // matches /^M\d+$/i
  }[];
}

// IPC Channel:
// 'scan-root' → scans Level 1 subfolders, returns FolderScanResult
```

**Key logic:**
- Date folder detection: `const isDateFolder = /^\d{8}$/.test(folderName)`
- Machine folder detection: `const isMachineFolder = /^M\d+$/i.test(folderName)`
- Automatically skips folders in the skip list (#recycle, Bin, ModelRecogImages, etc.)

### 3.2 AuditParser

Parses audit files into arrays of validated IMEI strings.

```typescript
interface AuditParseResult {
  format: 'csv' | 'xlsx' | 'xls' | 'txt' | 'unknown';
  totalRows: number;
  validIMEIs: string[];       // deduplicated 15-digit strings
  invalidEntries: {
    line: number;
    value: string;
    reason: string;           // 'not_15_digits' | 'non_numeric' | 'empty'
  }[];
  duplicateCount: number;
  hints?: Record<string, AuditHint>;  // IMEI → machine/date/model/grade hints
  hintMeta?: HintDetectionMeta;       // detection diagnostics for the UI badges
  isMRAudit: boolean;                 // true when a grade column was detected
}

// IPC Channel:
// 'parse-audit-file' → accepts file path, returns AuditParseResult
```

**Parsing strategies:**
- **CSV**: Use csv-parse with auto-delimiter detection. Scan columns to find one containing 15-digit numeric values.
- **Excel**: Use xlsx to read the first sheet. Same column-detection strategy as CSV.
- **TXT**: Read line by line. Trim whitespace. Validate each line as a potential IMEI.

**IMEI validation**: `const isValidIMEI = /^\d{15}$/.test(value.trim())`

**OneDrive-safe read**: every file read is wrapped in a 20-second timeout (`withReadTimeout`). An unhydrated OneDrive "Files On-Demand" placeholder rejects with `AUDIT_FILE_DOWNLOADING` instead of hanging the parse.

**Hint-column detection** (`detectHintColumns`, multi-column formats only) — columns are identified by **data pattern**, not header name:
- **Machine** / **Date** columns: the column whose sampled values most often parse via `normalizeMachine` / `normalizeDate` (≥50% of sampled rows), with MM/DD vs DD/MM disambiguated across all rows.
- **Model** column: a column whose **header contains "model"**. Each value is reduced to the device model by `deviceModel()`, which drops the trailing color segment (`Apple-iPhone11-Purple` → `Apple-iPhone11`, only when the label has ≥3 hyphen parts).
- **Grade** column: a column whose **header contains "grade"**, or — as a content fallback when no such header exists — a column whose values match a grade vocabulary (`GRADE_WORDS` = wrong/pass/fail/error/mismatch/defect/reject/good). A detected grade column sets **`isMRAudit = true`**, which the renderer uses to auto-enable MR collection.

`buildHints` produces one `AuditHint` per IMEI carrying any detected `machine`, `date`, `model`, and `grade` (first occurrence wins on duplicate IMEIs).

### 3.3 IMEISearchEngine

Orchestrates the search across selected folders and matches against the audit list. File: `src/main/services/IMEISearchEngine.ts`.

```typescript
interface SearchRequest {
  rootPath: string;
  selectedFolders: string[];     // e.g., ['M8', 'M10', 'M12']
  imeis: string[];               // from AuditParser
  dateStart?: string;            // YYYY-MM-DD (HTML date input format)
  dateEnd?: string;              // YYYY-MM-DD
  scanIndexFilter: 'all' | 'first_only';
  mrPass?: boolean;              // collect MR PASS images
  mrFail?: boolean;              // collect MR FAIL images
}

interface SearchMatch {
  imei: string;
  machineName: string;
  date: string;                  // YYYYMMDD from folder name
  scanIndex: number;
  folderName: string;
  sourcePath: string;
  bmpCount: number;
  jpegCount: number;
  otherCount: number;
  totalFiles: number;
  matchType?: 'mr-pass' | 'mr-fail';  // undefined for standard matches
  mrFolder?: string;             // model/Error-Error tag for the MR match
  modelName?: string;            // device model: from the audit hint (Type B / exact-path probe) or parsed from a SG-*.png filename (Type A fallback)
}

interface SearchResult {
  matches: SearchMatch[];
  missingIMEIs: string[];        // audit list entries with no match
  totalSearched: number;
  scanErrors: number;            // folders that failed to read (network/permission)
  elapsedMs: number;
  logPath?: string;              // path to this search's diagnostic log
  scanErrorDetails?: string[];   // per-folder failure descriptions
  scanIndexFiltered?: number;    // IMEIs dropped by the first-only scan-index filter
}

// IPC Channels:
// 'search-imeis'        → begins search, returns SearchResult
// 'search-progress'     → stream: SearchProgress events
// 'search-matches'      → stream: SearchMatch[] batches (live results)
// 'cancel-search'       → cancels an in-progress search
```

**Concurrency**: Uses shared `pooled()` / `pooledVoid()` worker pools (from `src/shared/pool.ts`) with 48 concurrent NAS reads for broad enumeration, tuned for the RS3617RPxs (12-drive RAID 5, 1 Gbps). The server-side `dir` lookups and direct per-IMEI folder reads run at a more modest 16 concurrent each.

**Two device-folder layouts under `{machine}/{date}/`** (see DIRECTORY-SCHEMA.md):
- **Type A** — a full-scan folder named `{IMEI}_{index}` containing JPEG scan images, `DefectLog.xml`, `Grade.json`, `FD/`, and a `SG-*.png` MR image.
- **Type B** — an MR / CMC-upload ("wrong color") folder named **exactly `{IMEI}`** (no `_index`) containing a single timestamp-named `.png` (not `SG-*`) plus `CMCSentFlag.txt`, `Upload.success`, `UUID.key`.

The engine collects from both, and the dispatcher `searchIMEIs` chooses the path:

**`searchIMEIs` dispatcher (the universal exact-path probe):**

1. **MR mode** (`request.mrPass || request.mrFail`) **with hints** → `searchMRDirect` only (see below). No enumeration at all.
2. **Smart Search with hints** (standard or MR) → run a **universal exact-path probe first**: `collectMRDirect` over **all** hinted targets. This catches every Type B `{IMEI}` device instantly — even when MR was never enabled and the audit had no grade column to auto-enable it. Then **standard enumeration runs only for the IMEIs the probe did not find** (`request.imeis.filter(i => !foundIMEIs.has(i))`) — the Type A devices, which `ENOENT` on the probe (a fast, cheap miss) and fall through to `searchTargeted` → machine-only narrowed scans → full broad fallback. Type A devices therefore cost no more than before.
3. **Smart Search without hints** → a warning is logged and a full `searchBroad` runs.

**`searchMRDirect` / `collectMRDirect` (exact-path MR collection):**
- `buildHintedTargets(request)` turns each IMEI's machine+date hint into a `HintedTarget` (dropping IMEIs whose machine isn't selected or whose date is out of range; counting each drop reason for the log).
- `collectMRDirect` opens each target's **exact** path `{rootPath}/{machine}/{date}/{IMEI}/` via `readdirWithTimeout` and takes the first `.png` inside, **whatever its name**. Opening a fully known path never enumerates the (enormous) parent date folder — so it is instant regardless of folder size and immune to the SMB `readdir` saturation that timed out wildcard/listing approaches. The match carries `matchType: 'mr-pass'`, `scanIndex: 0`, and `modelName`/`mrFolder` from the audit hint's `model`. A target folder that exists but holds no `.png` increments `noMRImage`; an `ENOENT` (no `{IMEI}` folder here — i.e. a Type A device) is benign. Already-found IMEIs are skipped, which is exactly what lets the same routine serve as the probe ahead of enumeration.
- `ModelRecogImages/` is **never** scanned. Those `{Brand-Model}/` folders accumulate tens of thousands of files and time out over SMB; they are reference-only. The removed functions `searchMRImages` / `scanMRDateFolders` / `discoverMRDateFolders` (the abandoned v1.5.0 approach) no longer exist.

**`searchTargeted` (standard Type A collection, server-side wildcard):**
- Groups hinted IMEIs by `machine/date`. For each group it calls `findMatchingIMEIFolders(datePath, imeis)`, which runs `cmd /c dir /b /a:d {datePath}\{IMEI}_*` (batched ≤60 patterns to stay under the command-line limit). The wildcard is applied **on the NAS**, so each device's `{IMEI}_{index}` folder is returned **without enumerating** the date folder — fast no matter how many subfolders it holds. It runs in a **child process**, so a slow NAS never pins Node's `fs` thread pool (the orphaned-`readdir` problem that also lagged the UI). IMEIs are validated 15-digit, so the patterns are injection-safe. A read error here does **not** trigger a broad rescan — those IMEIs are reported missing with the error logged. (Non-Windows dev/test falls back to a names-only listing.)
- Matched folders are counted via `buildMatchBatch` → `countFiles` (bounded at 8 concurrent reads per worker), which also captures any `SG-*.png` so a Type A device collected on this path still carries a parsed `modelName` and PASS/FAIL tag.

**`searchBroad` (no-hint fallback):**
1. Discover date folders (parallel across machines): names-only `readdir`, filter to `^\d{8}$`, apply date range, skip `SKIP_FOLDERS` (`#recycle`, `$recycle.bin`, `modelrecogimages`, `version_control`).
2. Scan each date folder (`scanDateFolder`, names-only): recognise `{IMEI}_{index}` by pattern, apply the scan-index filter, match against the audit Set (O(1)), then `buildMatchBatch`.

Matched batches stream to the renderer via IPC throughout; `buildResult` then diffs the audit list against `foundIMEIs` for the missing list and writes the final log summary.

**Incomplete detection** (renderer-side, in `ResultsPanel.tsx`):
- Computed via `useMemo`: calculate median file count across all matches
- Flag matches with file count < 50% of median as incomplete (orange dot in UI)

### 3.3.1 Smart Search & Hints

When the audit file contains machine, date, model, and/or grade columns, the AuditParser populates `hints` and `hintMeta` on the parse result. The renderer passes these to the search engine via `SearchRequest.hints` and `SearchRequest.smartSearch`.

```typescript
interface AuditHint {
  machine?: string   // Normalized to NAS folder name, e.g. "M8", "M10"
  date?: string      // Normalized to YYYYMMDD format
  model?: string     // Device model, color stripped (e.g. "Apple-iPhone11")
  grade?: string     // Raw grade value (e.g. "Grade-D2C" / "Wrong Color")
}

interface HintDetectionMeta {
  machineColumn: string | null      // Original header name, null if not detected
  dateColumn: string | null         // Original header name, null if not detected
  machineValidCount: number         // How many rows had a parseable machine value
  dateValidCount: number            // How many rows had a parseable date value
  totalHintedRows: number           // Total data rows examined
  dateFormatGuess: string | null    // Detected date format, e.g. "YYYY-MM-DD", "MM/DD/YYYY"
}

// On SearchRequest:
//   hints?: Record<string, AuditHint>   — IMEI → hint mapping
//   smartSearch?: boolean               — enables targeted search when true
//   mrPass?, mrFail?: boolean           — MR collection toggles
```

**How hints drive the search** (full dispatch logic in §3.3):
1. **Full hints** (machine + date): the exact-path probe / `searchMRDirect` opens `{rootPath}/{machine}/{date}/{IMEI}/` directly (Type B), and `searchTargeted` resolves `{IMEI}_{index}` by server-side wildcard for any Type A device the probe missed.
2. **Machine-only hints**: a narrowed broad scan constrained to that one machine.
3. **No usable hints**: full broad scan across all selected folders.

IMEIs always degrade to the next-broadest scan rather than being lost.

**Auto-detect MR audit + model** (renderer behavior driven by the parse result):
- When `AuditParseResult.isMRAudit` is true (a grade column was detected), the renderer **force-enables MR collection** (`forceMR`) regardless of the MR PASS / MR FAIL toggle positions, and shows a confirmation banner. The operator no longer needs to know which toggle to set.
- The `model` hint flows through `buildHintedTargets` onto each match's `modelName`, so **By Model** and **Machine → Model** organization work for MR collection audits even though the Type B `.png` filename carries no model.

Smart Search also drives Source-panel UI:
- **Auto-select machine folders**: machines referenced by hints are toggled on; auto-select is keyed by content so it re-runs when the hint set changes.
- **Auto-fill date range**: pre-populates Start/End; the End Date is set to **max(test date) + 1 day** to catch devices tested near midnight whose folder rolled over.

**Committed date-range state**: The search reads the date range from committed React state directly at search time, rather than a ref that could still hold the pre-auto-populate value. Combined with content-keyed machine auto-select, this means changing a setting or toggle no longer requires re-uploading the audit file for the next search to use the right filters.

### 3.4 ExportEngine

Handles the actual file copy/move operations with progress tracking. File: `src/main/services/ExportEngine.ts`.

```typescript
interface ExportRequest {
  matches: SearchMatch[];
  destination: string;
  action: 'copy' | 'move';
  imageType: 'both' | 'bmp' | 'jpeg';
  organize: 'flat' | 'by-machine' | 'by-date' | 'machine-date' | 'date-machine' | 'by-imei' | 'machine-model';
  duplicates: 'skip' | 'overwrite';
  aiImages: boolean;               // export only FD/ subfolder contents
}

interface ExportResult {
  exported: number;
  skipped: number;
  failed: number;
  failedItems: { imei: string; sourcePath: string; error: string }[];
  elapsedMs: number;
  destinationPath: string;
  logPath: string;
}

// IPC Channels:
// 'export-results'     → begins export, returns ExportResult
// 'export-progress'    → stream: ExportProgress events
// 'cancel-export'      → cancels active export
```

**Concurrency**: 8 folders × 4 file copies = 32 concurrent NAS reads via `pooledVoid()`.

**Destination path construction by organization mode:**
```
flat:           dest/{IMEI}_{index}/
by-machine:     dest/{machine}/{IMEI}_{index}/
by-date:        dest/{date}/{IMEI}_{index}/
machine-date:   dest/{machine}/{date}/{IMEI}_{index}/
date-machine:   dest/{date}/{machine}/{IMEI}_{index}/
by-imei:        dest/{IMEI}/{machine}_{date}_{index}/
machine-model:  dest/{machine}/{model}/{IMEI}_{index}/
```

For `machine-model`, `{model}` is parsed from the match's SG-*.png filename (e.g. `Apple-iPhone13Pro`), falling back to the source folder name when unavailable.

**MR exports** use a separate `buildMRDestFilePath()` — each match is a single `.png` file. Under `machine-model` the MR layout is `dest/{machine}/<Model|Error-Error>/{IMEI}/<date>_<tag>.png`, where the model/Error-Error level comes from `modelName`/`mrFolder` and the tag reflects the PASS/FAIL classification.

**File operations:**
- **Copy**: Recursive `copyFolderParallel()` with file-level concurrency and image type filtering
- **Move**: Copy first, then `rm()` source on success. MR images are always copied (the `SG-*.png` is never deleted from its source IMEI folder)
- **AI Images Only**: Pre-checks `FD/` subfolder existence via `pathExists()`; returns null (counted as failed) if missing
- **Destination validation**: `mkdir(destination, { recursive: true })` runs before any copy/move work starts; throws immediately if the path is inaccessible
- **Duplicate handling**: `skip` checks destination existence before copy; `overwrite` removes existing destination first

### 3.5 Logger

Rotating diagnostic logging shared by **both** the export and search engines. File: `src/main/services/Logger.ts`.

- Generates timestamped log files in `%APPDATA%/Image Collection v2/logs/`
- Two independent log families, each keeping its **3 most recent** files and rotating older ones:
  - `export-<timestamp>.log` — written on every export
  - `search-<timestamp>.log` — written on every search; lines are flushed **synchronously** so the log is readable mid-run or after a cancel (a buffered log looked empty)
- Falls back to a no-op logger (no file I/O) when log file creation fails, so logging never blocks an operation

**Search log contents** (`search-<timestamp>.log`):
- Request summary: search mode (standard vs MR), IMEI count, hint count, SmartSearch flag, MR PASS/FAIL flags, scan-index filter, date range, selected folders, root path
- Path decision: which path ran (targeted vs full-discovery), with per-machine folder counts and drop-reason counters
- Fallback transitions (e.g. targeted → per-machine fallback → broad), and scan errors encountered
- Final summary: matches, missing, foldersScanned, scanErrors, elapsed

The renderer's status-bar "View Log" link opens the logs folder.

### 3.6 Settings Store

Uses `electron-store` for typed settings access via generic `settingsGet`/`settingsSet` IPC handlers.

Settings are stored per-key (not a single monolithic object):
- `theme`: `'dark' | 'light'`
- `lang`: `'en' | 'zh-TW' | 'zh-CN'`
- `settingsPanel`: All SettingsPanel state (action, imageType, organize, etc.)
- `searchHistory`: Last 5 search entries
- `sources`: Multi-source configurations with per-source folder toggles (array of `SourceConfig`)
- Window bounds saved/restored by Electron main process

```typescript
interface SourceConfig {
  id: string                              // Unique identifier (generated via generateId())
  name: string                            // User-visible label
  rootPath: string                        // Absolute path to the NAS root
  folderToggles: Record<string, boolean>  // Per-folder on/off state, keyed by folder name
}
```

The `sources` setting stores an array of `SourceConfig` objects. The SourcePanel's `SourceSwitcher` dropdown lets users add, rename, remove, and switch between sources. Each source persists its own root path and folder toggle state independently.

---

## 4. Renderer Components

```
App
├── TitleBar (custom window controls, theme toggle)
├── SourcePanel
│   ├── SourceSwitcher (dropdown for multi-source)
│   ├── FolderBrowser (path input + browse button)
│   ├── FolderToggleGrid (checkbox grid with Select All / Refresh)
│   └── DateRangeFilter (optional start/end date pickers)
├── AuditPanel
│   ├── FileImport (browse button + drag-drop zone)
│   └── ImportSummary (format, count, warnings)
├── SettingsPanel
│   ├── ActionSelect (Move/Copy dropdown)
│   ├── ImageTypeSelect (BMP/JPEG/Both dropdown)
│   ├── OrganizationSelect (nesting depth dropdown)
│   ├── DuplicateSelect (Skip/Overwrite dropdown)
│   ├── MRPassToggle (MR PASS image switch)
│   ├── MRFailToggle (MR FAIL image switch)
│   ├── AIImagesToggle (AI detection images only switch)
│   ├── ScanIndexFilter (All/First only dropdown)
│   └── DestinationBrowser (path input + browse button)
├── ResultsPanel
│   ├── ResultsSummary (found/missing counts)
│   ├── ResultsList (scrollable, sortable table)
│   ├── MissingIMEIModal (list of not-found IMEIs)
│   └── SearchHistoryDropdown
├── ProgressBar (percent, current operation, elapsed time)
├── ActionButtons (Start Search, Export Results, Clear)
└── StatusBar (status message, last search time)
```

---

## 5. IPC Channel Reference

| Channel | Direction | Type | Description |
|---------|-----------|------|-------------|
| `scanner:scan-root` | Renderer → Main | Request/Response | Scan first-level subfolders |
| `audit:parse` | Renderer → Main | Request/Response | Parse audit file |
| `search:start` | Renderer → Main | Request/Response | Begin IMEI search, returns SearchResult |
| `search:progress` | Main → Renderer | Event Stream | SearchProgress updates during scan |
| `search:matches` | Main → Renderer | Event Stream | SearchMatch[] batches (live streaming) |
| `search:cancel` | Renderer → Main | Fire-and-forget | Cancel active search |
| `export:start` | Renderer → Main | Request/Response | Begin file export, returns ExportResult |
| `export:progress` | Main → Renderer | Event Stream | ExportProgress updates during export |
| `export:cancel` | Renderer → Main | Fire-and-forget | Cancel active export |
| `settings:get` | Renderer → Main | Request/Response | Load a settings key |
| `settings:set` | Renderer → Main | Request/Response | Save a settings key |
| `dialog:open-folder` | Renderer → Main | Request/Response | Open native folder picker |
| `dialog:open-file` | Renderer → Main | Request/Response | Open native file picker |
| `dialog:save-file` | Renderer → Main | Request/Response | Save file dialog (missing IMEIs export) |
| `logs:open-folder` | Renderer → Main | Fire-and-forget | Open logs folder in explorer |
| `window:minimize` | Renderer → Main | Fire-and-forget | Minimize window |
| `window:maximize` | Renderer → Main | Fire-and-forget | Toggle maximize/restore |
| `window:close` | Renderer → Main | Fire-and-forget | Close window |

---

## 6. Project Structure

```
image-collection-v2/
├── docs/                          # Project documentation
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── UI-SPEC.md
│   ├── MILESTONES.md
│   ├── DIRECTORY-SCHEMA.md
│   └── TEST-PROCEDURE.md
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.ts               # App entry, window creation, IPC handlers
│   │   ├── preload.ts             # Context bridge for IPC
│   │   └── services/
│   │       ├── FolderScanner.ts
│   │       ├── AuditParser.ts
│   │       ├── IMEISearchEngine.ts
│   │       ├── ExportEngine.ts
│   │       ├── Logger.ts
│   │       └── SettingsStore.ts
│   ├── renderer/                  # React renderer process
│   │   ├── index.html
│   │   ├── main.tsx               # React entry point (with ErrorBoundary)
│   │   ├── App.tsx                # Root component, state management
│   │   ├── App.module.css
│   │   ├── styles/
│   │   │   ├── globals.css        # CSS variables, global styles, themes
│   │   │   └── controls.module.css # Shared input/button styles (composed by panels)
│   │   ├── hooks/
│   │   │   └── useClickOutside.ts # Shared hook for dropdown dismiss
│   │   └── components/
│   │       ├── layout/
│   │       │   ├── TitleBar.tsx + .module.css
│   │       │   ├── GlassCard.tsx + .module.css
│   │       │   └── StatusBar.tsx + .module.css
│   │       ├── source/
│   │       │   └── SourcePanel.tsx + .module.css
│   │       ├── audit/
│   │       │   └── AuditPanel.tsx + .module.css
│   │       ├── settings/
│   │       │   └── SettingsPanel.tsx + .module.css
│   │       ├── results/
│   │       │   └── ResultsPanel.tsx + .module.css
│   │       └── common/
│   │           ├── ProgressBar.tsx + .module.css
│   │           ├── ActionButtons.tsx + .module.css
│   │           ├── ErrorBoundary.tsx
│   │           ├── Toggle.tsx + .module.css
│   │           ├── Select.tsx + .module.css
│   │           └── Tooltip.tsx + .module.css
│   └── shared/                    # Shared between main and renderer
│       ├── types.ts               # All TypeScript interfaces
│       ├── utils.ts               # formatElapsed, formatBytes, generateId,
│       │                          #   addDaysToYMD (auto End-Date +1 day)
│       ├── pool.ts                # Concurrent worker pool
│       └── i18n.ts                # Translation strings (en, zh-TW, zh-CN)
├── package.json
├── tsconfig.node.json             # Main process TypeScript config
├── tsconfig.web.json              # Renderer TypeScript config
├── electron.vite.config.ts
├── electron-builder.yml
├── .gitignore
├── .prettierrc
├── README.md
├── README.zh-TW.md
└── README.zh-CN.md
```

---

## 7. Key Design Decisions

### IMEI Extraction (Standard Search)
```typescript
// From IMEISearchEngine.ts — parseIMEIFolder()
function parseIMEIFolder(name: string): { imei: string; scanIndex: number } | null {
  const underscoreIdx = name.indexOf('_');
  if (underscoreIdx === -1) return null;
  const imeiPart = name.substring(0, underscoreIdx);
  if (!/^\d{15}$/.test(imeiPart)) return null;
  const scanIndex = parseInt(name.substring(underscoreIdx + 1), 10);
  return isNaN(scanIndex) ? null : { imei: imeiPart, scanIndex };
}
```

### Exact-Path MR Collection (Type B `{IMEI}` folders)
```typescript
// From IMEISearchEngine.ts — collectMRDirect()
// The folder name IS the IMEI (no _index), so the path is fully known from the
// audit hint. Open it directly and take the first .png — whatever its name.
const folderPath = join(request.rootPath, t.machine, t.date, t.imei);
const files = await readdirWithTimeout(folderPath, { withFileTypes: true });
const png = files.find((f) => f.isFile() && f.name.toLowerCase().endsWith('.png'));
// Opening a known path never enumerates the giant parent date folder → instant,
// and immune to the SMB readdir saturation that timed out listing approaches.
// modelName/mrFolder come from the audit hint's `model`, not the filename.
```

### Server-Side Wildcard Lookup (Type A `{IMEI}_index` folders)
```typescript
// From IMEISearchEngine.ts — findMatchingIMEIFolders()
// Ask the NAS to return just the matching folder, without enumerating the date
// folder (which can hold thousands of subfolders → plain readdir times out).
// Runs in a child process so a slow NAS never pins Node's fs thread pool.
await execFileAsync('cmd', ['/d', '/c', 'dir', '/b', '/a:d', ...patterns], { ... });
// patterns: {datePath}\{IMEI}_*  (batched ≤60; IMEIs are validated 15-digit, so
// the patterns are injection-safe). A read error does NOT trigger a broad rescan.
```

### MR PASS/FAIL Classification
```typescript
// PASS/FAIL is derived from a model name, never from scanning ModelRecogImages:
//   model === 'Error-Error' → MR FAIL (red)
//   any other model         → MR PASS (green)
// Exact-path probe (Type B): every device is tagged mr-pass — its model comes
//   from the audit hint and a wrong-color device's true model is a real model.
// Type A fallback (buildMatchBatch): a SG-*.png captured by countFilesRecursive
//   is tested with /error[-_]?error/i to set mr-fail vs mr-pass.
```

### Date Folder Detection
```typescript
// Shared constant from src/shared/utils.ts
const DATE_FOLDER_REGEX = /^\d{8}$/;  // Matches YYYYMMDD
```

### Auto End-Date +1 (midnight rollover)
```typescript
// From src/shared/utils.ts — a device tested near midnight can have its image
// folder dated the next day, so the auto-populated End Date is pushed out one day.

// Shift a YYYYMMDD string by N calendar days (handles month/year boundaries).
function addDaysToYMD(ymd: string, delta: number): string
```
When a date column is detected, the auto-populated End Date is set to
max(hinted date) + 1 day (via `addDaysToYMD`) so the search still reaches a folder
that rolled over to the following day. Missing/non-existent folders (ENOENT) are
treated as benign and not counted as scan errors.

### Cancellation Pattern
```typescript
// Per-operation token pattern — used in both search and export engines.
// Starting a new operation auto-cancels any in-flight operation, then creates
// a fresh token. Calling cancel() marks only the active token.
function createSearchContext(imeis: string[]): SearchContext {
  activeToken.cancelled = true;       // Cancel previous operation
  const token = { cancelled: false };
  activeToken = token;
  return { token, /* ... */ };
}
export function cancelSearch(): void { activeToken.cancelled = true; }
```

### Scan Error Tracking
```typescript
// SearchContext tracks folders that failed to read (network drops, permission
// errors) separately from missing IMEIs. The count surfaces in the status bar
// so users know some "missing" IMEIs may be due to access failures, not
// genuinely absent data.
interface SearchContext {
  // ...
  scanErrors: number;   // incremented in catch blocks during folder scans
}
```

### CSS Architecture
```
globals.css        — Design tokens (shared across themes):
                       Layout:  --radius-*, --blur-glass, --blur-subtle, --blur-overlay
                       Accent:  --accent-primary, --accent-shadow, --focus-ring
                       Status:  --status-green/orange/red, --status-*-bg, --status-red-border
                       Type:    --font-*, --transition-*
                     Theme-scoped tokens defined inside [data-theme="dark"|"light"]:
                       --bg-*, --text-*, --border-*, --shadow-*
controls.module.css — Shared .input / .browseBtn styles (CSS Modules composes)
*.module.css       — Panel-level styles compose from controls.module.css;
                     all colors reference tokens — no hardcoded hex/rgba
```

### Error Feedback
Search and export IPC failures surface via an in-app error banner (App.tsx)
instead of being silently swallowed. The banner auto-clears on the next operation.

### Destination Validation
ExportEngine validates the destination path is writable (`mkdir` with
`recursive: true`) before starting any file operations, failing fast with a
descriptive error instead of copying partial results.

### Shared Concurrency Pool
```typescript
// From src/shared/pool.ts — used by both engines
async function pooled<T, R>(items: T[], concurrency: number, token: CancelToken,
  fn: (item: T) => Promise<R>): Promise<R[]>

async function pooledVoid<T>(items: T[], concurrency: number, token: CancelToken,
  fn: (item: T) => Promise<void>): Promise<void>
```
