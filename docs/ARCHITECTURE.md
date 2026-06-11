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
}

// IPC Channel:
// 'parse-audit-file' → accepts file path, returns AuditParseResult
```

**Parsing strategies:**
- **CSV**: Use csv-parse with auto-delimiter detection. Scan columns to find one containing 15-digit numeric values.
- **Excel**: Use xlsx to read the first sheet. Same column-detection strategy as CSV.
- **TXT**: Read line by line. Trim whitespace. Validate each line as a potential IMEI.

**IMEI validation**: `const isValidIMEI = /^\d{15}$/.test(value.trim())`

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
  mrFolder?: string;             // PASS/FAIL tag derived from the model name ('Error-Error' for FAIL)
  modelName?: string;            // Parsed from SG-*.png filename; falls back to source folder name
}

interface SearchResult {
  matches: SearchMatch[];
  missingIMEIs: string[];        // audit list entries with no match
  totalSearched: number;
  scanErrors: number;            // folders that failed to read (network/permission)
  elapsedMs: number;
}

// IPC Channels:
// 'search-imeis'        → begins search, returns SearchResult
// 'search-progress'     → stream: SearchProgress events
// 'search-matches'      → stream: SearchMatch[] batches (live results)
// 'cancel-search'       → cancels an in-progress search
```

**Concurrency**: Uses shared `pooled()` / `pooledVoid()` worker pools (from `src/shared/pool.ts`) with 48 concurrent NAS reads, tuned for the RS3617RPxs (12-drive RAID 5, 1 Gbps).

**Search algorithm — Standard mode (MR PASS OFF, MR FAIL OFF):**
1. Phase 1 — Discover date folders (parallel across machines via `pooled()`):
   a. Read subfolders, filter to date folders (`/^\d{8}$/`)
   b. Apply date range filter if specified
2. Phase 2 — Scan date folders for IMEI matches (parallel pool):
   a. For each date folder, read IMEI_Index subfolders
   b. For each IMEI_Index folder:
      - Extract IMEI via `parseIMEIFolder()`: split on underscore, validate first 15 chars are digits
      - Extract scan index: integer after the underscore
      - Apply scan index filter (`first_only` keeps only `_1`)
      - Check IMEI against audit list (Set lookup — O(1))
      - If match: count files by extension (bmp/jpeg/other)
   c. Stream matched batches to renderer via IPC
3. Build final result with missing IMEIs list

**Search algorithm — MR mode (MR PASS ON and/or MR FAIL ON):**

Enabling **either** MR PASS or MR FAIL activates MR mode by setting a `mrMode` flag on the `SearchContext`. MR mode is **not** a separate search path — it runs the exact same fast standard IMEI-folder search described above (`searchIMEIs` over `{machine}/{date}/{IMEI}_{index}/`, with full Smart Search targeting/fallback). The only difference is what gets captured and exported: from each matched IMEI folder the engine extracts the single Model Recognition image — the `SG-*.png` that lives **inside** that folder alongside the scan images, `DefectLog.xml`, and `Grade.json`.

MR mode does **not** scan `ModelRecogImages` at all. Those `ModelRecogImages/{Brand-Model}/` folders accumulate tens of thousands of files per model and time out over SMB (the 15s `readdir` timeout fires, yielding empty results and a hung UI). Because the per-device `SG-*.png` already lives in each small IMEI folder, the standard lookup gets the same image far faster. A device's grade (e.g. "Wrong Color") is only knowable from the audit file — never from the NAS — so the audit list itself is the filter; there is intentionally no "wrong color" toggle.

Capture happens in `buildMatchBatch`: while counting a matched folder's files, `countFiles()` / `countFilesRecursive()` also record the first `SG-*.png` they encounter, returning its `mrImageName` and `mrImagePath`. For an MR-mode match the engine then:
   - Parses the model from the `SG-*.png` filename (e.g. `Apple-iPhone8`)
   - Tags the match PASS (green) / FAIL (red) from that model name — `Error-Error` → `mr-fail`, anything else → `mr-pass` — and sets `mrFolder` and `modelName` accordingly
   - Exports only the `SG-*.png` (not the whole folder)
   - Reports a matched IMEI folder that contains no `SG-*.png` as missing (counted in the search log)

**Incomplete detection** (renderer-side, in `ResultsPanel.tsx`):
- Computed via `useMemo`: calculate median file count across all matches
- Flag matches with file count < 50% of median as incomplete (orange dot in UI)

### 3.3.1 Smart Search (Targeted Search Path)

When the audit file contains machine and/or date columns, the AuditParser populates `hints` and `hintMeta` on the parse result. The renderer passes these to the search engine via `SearchRequest.hints` and `SearchRequest.smartSearch`.

```typescript
interface AuditHint {
  machine?: string   // Normalized to NAS folder name, e.g. "M8", "M10"
  date?: string      // Normalized to YYYYMMDD format
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
```

**Targeted search algorithm** (when `smartSearch` is true and `hints` are available):

1. **Full hints** (machine + date): Go directly to `{rootPath}/{machine}/{date}/` instead of scanning all folders. This skips Phase 1 discovery entirely for hinted IMEIs.
2. **Machine-only hints**: Run a narrowed broad scan constrained to a single machine folder per group of IMEIs.
3. **No-hint fallback**: IMEIs without usable hints fall back to the standard full broad scan across all selected folders.

Smart Search also drives UI behavior in the Source panel:
- **Auto-select machine folders**: When hints reference specific machines, those folders are automatically toggled on in the folder grid. Auto-select is keyed by content so it re-runs when the hint set changes.
- **Auto-fill date range**: When hints contain date values, the date range filter is pre-populated. The End Date is set to **max(test date) + 1 day** to catch devices tested near midnight whose image folder rolled over to the next day.

The same targeted approach applies to MR mode — because MR mode reuses the standard IMEI-folder search, MR searches with full hints go directly to `{machine}/{hintDate}/{IMEI}_{index}/` and inherit the identical machine-only and broad fallbacks. The `SG-*.png` is then extracted from each matched folder (see §3.3, MR mode algorithm). MR mode does not touch `ModelRecogImages`.

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
  - `search-<timestamp>.log` — written on every search (added in v1.5)
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

### MR Image IMEI Extraction
```typescript
// From IMEISearchEngine.ts — extractMRImei()
// Filename: SG-M008-075545-358627090247469-Apple-iPhone8.png
// Segments:  0    1     2          3          4       5
function extractMRImei(fileName: string): string | null {
  const segments = fileName.replace(/\.png$/i, '').split('-');
  if (segments.length < 4) return null;
  const candidate = segments[3];
  return /^\d{15}$/.test(candidate) ? candidate : null;
}
```

### MR PASS/FAIL Classification
```typescript
// Named constant in IMEISearchEngine.ts
const MR_FAIL_MODEL = 'error-error';    // case-insensitive match

// PASS/FAIL is derived from the model name parsed out of the SG-*.png filename
// (NOT from any folder — ModelRecogImages is never scanned):
//   model === 'Error-Error' → MR FAIL (red)
//   any other model         → MR PASS (green)
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
