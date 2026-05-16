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
    isDateFolder: boolean;    // matches /^\d{8}$/
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
  format: 'csv' | 'xlsx' | 'xls' | 'txt';
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
  matchType?: 'standard' | 'mr-pass' | 'mr-fail';
  mrFolder?: string;             // Brand-Model folder or 'Error-Error'
}

interface SearchResult {
  matches: SearchMatch[];
  missingIMEIs: string[];        // audit list entries with no match
  totalSearched: number;
  elapsedMs: number;
  folderCount: number;
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
1. Phase 1 — Discover date folders inside `{machine}/ModelRecogImages/` per machine
2. Phase 2 — For each date folder:
   - Read Brand-Model and Error-Error subfolders
   - If MR PASS is ON: scan non-`Error-Error` folders
   - If MR FAIL is ON: scan `Error-Error/` folder
   - For each `.png` file, extract IMEI via `extractMRImei()`:
     - Filename format: `SG-{machine}-{code}-{IMEI}-{brand}-{model}.png`
     - Split on `-`, take segment index 3 (4th segment), validate 15 digits
   - Check IMEI against audit list; if match, record with matchType and mrFolder

**Incomplete detection** (renderer-side, in `ResultsPanel.tsx`):
- Computed via `useMemo`: calculate median file count across all matches
- Flag matches with file count < 50% of median as incomplete (orange dot in UI)

### 3.4 ExportEngine

Handles the actual file copy/move operations with progress tracking. File: `src/main/services/ExportEngine.ts`.

```typescript
interface ExportRequest {
  matches: SearchMatch[];
  destination: string;
  action: 'copy' | 'move';
  imageType: 'both' | 'bmp' | 'jpeg';
  organize: 'flat' | 'by-machine' | 'by-date' | 'machine-date' | 'date-machine' | 'by-imei';
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
```

**MR exports** use a separate `buildMRDestFilePath()` — each match is a single `.png` file.

**File operations:**
- **Copy**: Recursive `copyFolderParallel()` with file-level concurrency and image type filtering
- **Move**: Copy first, then `rm()` source on success. MR images are always copied (never deleted from shared `ModelRecogImages/`)
- **AI Images Only**: Pre-checks `FD/` subfolder existence via `fs.access()`; returns null (counted as failed) if missing
- **Duplicate handling**: `skip` checks destination existence before copy; `overwrite` removes existing destination first

### 3.5 Logger

Export logging with automatic rotation. File: `src/main/services/Logger.ts`.

- Generates timestamped log files in `%APPDATA%/image-collection-v2/logs/`
- Keeps the 3 most recent log files, rotates older ones
- `NoOpLogger` variant for testing (no file I/O)

### 3.6 Settings Store

Uses `electron-store` for typed settings access via generic `settingsGet`/`settingsSet` IPC handlers.

Settings are stored per-key (not a single monolithic object):
- `theme`: `'dark' | 'light'`
- `lang`: `'en' | 'zh'`
- `settingsPanel`: All SettingsPanel state (action, imageType, organize, etc.)
- `searchHistory`: Last 5 search entries
- `sources`: Multi-source configurations with per-source folder toggles
- Window bounds saved/restored by Electron main process

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
│   ├── ScanIndexFilter (All/First/Rescans dropdown)
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
| `ping` | Renderer → Main | Request/Response | Health check (returns 'pong') |

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
│   │   │   └── globals.css        # CSS variables, global styles, themes
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
│       ├── utils.ts               # formatElapsed, formatBytes
│       └── pool.ts                # Concurrent worker pool
├── package.json
├── tsconfig.node.json             # Main process TypeScript config
├── tsconfig.web.json              # Renderer TypeScript config
├── electron.vite.config.ts
├── electron-builder.yml
├── .gitignore
└── README.md
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

### MR Folder Classification
```typescript
// Named constants in IMEISearchEngine.ts
const MR_ROOT = 'modelrecogimages';     // case-insensitive match
const MR_FAIL_FOLDER = 'error-error';   // case-insensitive match

// Any subfolder that is NOT Error-Error → MR PASS (Brand-Model folder)
// Error-Error → MR FAIL
```

### Date Folder Detection
```typescript
const DATE_REGEX = /^\d{8}$/;  // Matches YYYYMMDD
```

### Cancellation Pattern
```typescript
// Per-operation token pattern — used in both search and export engines.
// Each new operation creates a fresh token; calling cancel() marks only the
// active token, so stale operations are unaffected.
let activeToken: CancelToken = { cancelled: false };
export function cancelSearch(): void { activeToken.cancelled = true; }
```

### Shared Concurrency Pool
```typescript
// From src/shared/pool.ts — used by both engines
async function pooled<T, R>(items: T[], concurrency: number, token: CancelToken,
  fn: (item: T) => Promise<R>): Promise<R[]>

async function pooledVoid<T>(items: T[], concurrency: number, token: CancelToken,
  fn: (item: T) => Promise<void>): Promise<void>
```
