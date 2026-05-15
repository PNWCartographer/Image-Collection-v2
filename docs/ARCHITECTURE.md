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
│  │  │ FolderScanner  │  │               │  │ App Shell   │  │ │
│  │  │ AuditParser    │  │               │  │ SourcePanel │  │ │
│  │  │ IMEIMatcher    │  │               │  │ AuditPanel  │  │ │
│  │  │ FileExporter   │  │               │  │ SettingsBar │  │ │
│  │  │ SettingsStore  │  │               │  │ ResultsView │  │ │
│  │  │ ReportGen      │  │               │  │ ProgressBar │  │ │
│  │  └────────────────┘  │               │  │ ThemeToggle │  │ │
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
    isMachineFolder: boolean; // matches /^M\d+$/
    modifiedDate: Date;
  }[];
}

// IPC Channels:
// 'scanner:scan-root'      → scans Level 1 subfolders
// 'scanner:scan-machine'   → scans Level 2 subfolders (date folders) within a machine
// 'scanner:scan-date'      → scans Level 3 subfolders (IMEI_Index folders) within a date
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
// 'audit:parse' → accepts file path, returns AuditParseResult
```

**Parsing strategies:**
- **CSV**: Use csv-parse with auto-delimiter detection. Scan columns to find one containing 15-digit numeric values.
- **Excel**: Use xlsx to read the first sheet. Same column-detection strategy as CSV.
- **TXT**: Read line by line. Trim whitespace. Validate each line as a potential IMEI.

**IMEI validation**: `const isValidIMEI = /^\d{15}$/.test(value.trim())`

### 3.3 IMEIMatcher

Orchestrates the search across selected folders and matches against the audit list.

```typescript
interface SearchConfig {
  rootPath: string;
  selectedFolders: string[];     // e.g., ['M8', 'M10', 'M12']
  imeiList: string[];            // from AuditParser
  dateRange?: {
    start: string;               // YYYYMMDD
    end: string;                 // YYYYMMDD
  };
  scanIndexFilter: 'all' | 'first_only' | 'rescans_only';
  mrPass: boolean;                 // collect MR PASS images
  mrFail: boolean;                 // collect MR FAIL images (path TBD)
}

interface MatchResult {
  imei: string;
  machineName: string;
  dateFolder: string;
  scanIndex: number;
  sourcePath: string;
  fileCount: number;
  bmpCount: number;
  jpegCount: number;
  mrPassFile: string | null;       // MR PASS .png filename if found
  mrFailFiles: string[];           // MR FAIL filenames if found (TBD)
  totalSizeBytes: number;
  status: 'complete' | 'incomplete';
  hasMRImages: boolean;
}

interface SearchResult {
  matches: MatchResult[];
  missingIMEIs: string[];        // audit list entries with no match
  searchDurationMs: number;
  totalFoldersScanned: number;
}

// IPC Channels:
// 'search:start'     → begins search, returns SearchResult
// 'search:progress'  → stream: { percent, currentFolder, matchesSoFar }
// 'search:cancel'    → cancels an in-progress search
```

**Search algorithm — Standard mode (MR PASS OFF, MR FAIL OFF):**
1. For each selected folder in parallel (Promise.allSettled):
   a. Read subfolders, filter to date folders (`/^\d{8}$/`)
   b. Apply date range filter if specified
   c. For each date folder, read IMEI_Index subfolders
   d. For each IMEI_Index folder:
      - Extract IMEI: `folderName.split('_')[0]` (first 15 chars)
      - Extract scan index: `parseInt(folderName.split('_')[1])`
      - Apply scan index filter
      - Check IMEI against audit list (Set lookup — O(1))
      - If match: stat files, count by extension, calculate size
2. Aggregate results, identify missing IMEIs
3. Apply incomplete detection heuristic

**Search algorithm — MR mode (MR PASS ON and/or MR FAIL ON):**
1. For each selected folder in parallel (Promise.allSettled):
   a. Locate `{machine}/ModelRecogImages/` subfolder
   b. Read date subfolders within ModelRecogImages, filter to `^\d{8}$`
   c. Apply date range filter if specified
   d. For each date folder:
      - If MR PASS is ON: read all subfolders EXCEPT `Error-Error` (these are brand-model folders)
        - For each brand-model folder, list `.png` files
        - Extract IMEI from filename: `filename.split('-')[3]` (4th segment)
        - Check IMEI against audit list
        - If match: record file path, brand-model folder name, file size
      - If MR FAIL is ON: read `Error-Error/` subfolder
        - List `.png` files
        - Extract IMEI from filename: same method
        - Check IMEI against audit list
        - If match: record file path, file size, mark as MR fail
2. Aggregate results, identify missing IMEIs
3. No incomplete detection for MR mode (each IMEI produces one image file)

**Incomplete detection:**
- Calculate median file count across all matches
- Flag matches with file count < 50% of median as `'incomplete'`

### 3.4 FileExporter

Handles the actual file copy/move operations with progress tracking.

```typescript
interface ExportConfig {
  matches: MatchResult[];
  destinationRoot: string;
  action: 'copy' | 'move';
  imageType: 'bmp' | 'jpeg' | 'both';
  organization: 'flat' | 'by_machine' | 'by_date' | 'machine_date' | 'date_machine' | 'by_imei' | 'by_scan_index';
  duplicateHandling: 'skip' | 'overwrite';
  mrPass: boolean;                 // export MR PASS images only
  mrFail: boolean;                 // export MR FAIL images only (path TBD)
}

// IPC Channels:
// 'export:start'    → begins export
// 'export:progress' → stream: { percent, currentIMEI, filesCopied, bytesTransferred }
// 'export:cancel'   → cancels export
// 'export:complete' → returns ExportSummary
```

**Destination path construction by organization mode:**
```
flat:           dest/{IMEI}_{index}/
by_machine:     dest/{machine}/{IMEI}_{index}/
by_date:        dest/{date}/{IMEI}_{index}/
machine_date:   dest/{machine}/{date}/{IMEI}_{index}/
date_machine:   dest/{date}/{machine}/{IMEI}_{index}/
by_imei:        dest/{IMEI}/{machine}_{date}_{index}/
by_scan_index:  dest/scan_{index}/{IMEI}_{index}/
```

**File operations:**
- **Copy**: Recursive directory copy using `fs.cp` (Node 16+) or manual recursive copy
- **Move**: `fs.rename` when same device; falls back to copy + delete for cross-device (NAS → local)
- **Image type filter**: During copy, skip files that don't match the selected extension filter
- **Cross-device safety**: Verify copy integrity (file count + size match) before deleting source on move operations

### 3.5 ReportGenerator

Generates the export summary report.

```typescript
interface ReportConfig {
  matches: MatchResult[];
  missingIMEIs: string[];
  exportConfig: ExportConfig;
  exportDurationMs: number;
  searchDurationMs: number;
}

// IPC Channel:
// 'report:generate' → creates report file at specified path
```

**Output format**: Excel (.xlsx) with color-coded rows using xlsx-style or ExcelJS:
- Green fill: status = 'complete'
- Orange fill: status = 'incomplete'
- Red fill: not found (missing IMEIs section)

### 3.6 SettingsStore

Wraps electron-store for typed settings access.

```typescript
interface AppSettings {
  sources: {
    id: string;
    name: string;
    rootPath: string;
    folderToggles: Record<string, boolean>;
  }[];
  activeSourceId: string;
  lastDestination: string;
  action: 'copy' | 'move';
  imageType: 'bmp' | 'jpeg' | 'both';
  organization: string;
  duplicateHandling: 'skip' | 'overwrite';
  mrPass: boolean;
  mrFail: boolean;
  incompleteDetectionSecondary: boolean;
  theme: 'dark' | 'light' | 'system';
  searchHistory: SearchHistoryEntry[];
  windowBounds: { x: number; y: number; width: number; height: number };
}
```

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
│   ├── MRFailToggle (MR FAIL image switch — path TBD)
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
| `scanner:refresh` | Renderer → Main | Request/Response | Re-scan current root |
| `audit:parse` | Renderer → Main | Request/Response | Parse audit file |
| `search:start` | Renderer → Main | Request/Response | Begin IMEI search |
| `search:progress` | Main → Renderer | Event Stream | Search progress updates |
| `search:cancel` | Renderer → Main | Fire-and-forget | Cancel active search |
| `export:start` | Renderer → Main | Request/Response | Begin file export |
| `export:progress` | Main → Renderer | Event Stream | Export progress updates |
| `export:cancel` | Renderer → Main | Fire-and-forget | Cancel active export |
| `report:generate` | Renderer → Main | Request/Response | Generate summary report |
| `settings:get` | Renderer → Main | Request/Response | Load settings |
| `settings:set` | Renderer → Main | Request/Response | Save settings |
| `dialog:open-folder` | Renderer → Main | Request/Response | Open native folder picker |
| `dialog:open-file` | Renderer → Main | Request/Response | Open native file picker |

---

## 6. Project Structure

```
image-collection-v2/
├── docs/                          # Project documentation
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── UI-SPEC.md
│   ├── MILESTONES.md
│   └── DIRECTORY-SCHEMA.md
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.ts               # App entry point, window creation
│   │   ├── ipc.ts                 # IPC channel handlers
│   │   ├── services/
│   │   │   ├── FolderScanner.ts
│   │   │   ├── AuditParser.ts
│   │   │   ├── IMEIMatcher.ts
│   │   │   ├── FileExporter.ts
│   │   │   ├── ReportGenerator.ts
│   │   │   └── SettingsStore.ts
│   │   └── preload.ts             # Context bridge for IPC
│   ├── renderer/                  # React renderer process
│   │   ├── index.html
│   │   ├── main.tsx               # React entry point
│   │   ├── App.tsx                # Root component
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── TitleBar.tsx
│   │   │   │   ├── GlassCard.tsx
│   │   │   │   └── StatusBar.tsx
│   │   │   ├── source/
│   │   │   │   ├── SourcePanel.tsx
│   │   │   │   ├── SourceSwitcher.tsx
│   │   │   │   ├── FolderToggleGrid.tsx
│   │   │   │   └── DateRangeFilter.tsx
│   │   │   ├── audit/
│   │   │   │   ├── AuditPanel.tsx
│   │   │   │   └── ImportSummary.tsx
│   │   │   ├── settings/
│   │   │   │   ├── SettingsPanel.tsx
│   │   │   │   └── Tooltip.tsx
│   │   │   ├── results/
│   │   │   │   ├── ResultsPanel.tsx
│   │   │   │   ├── ResultsList.tsx
│   │   │   │   ├── MissingIMEIModal.tsx
│   │   │   │   └── SearchHistory.tsx
│   │   │   └── common/
│   │   │       ├── ProgressBar.tsx
│   │   │       ├── ActionButtons.tsx
│   │   │       ├── Toggle.tsx
│   │   │       └── Select.tsx
│   │   ├── hooks/
│   │   │   ├── useIPC.ts          # IPC communication hook
│   │   │   ├── useSettings.ts     # Settings state hook
│   │   │   └── useTheme.ts        # Theme management hook
│   │   ├── styles/
│   │   │   ├── globals.css        # CSS variables, resets
│   │   │   ├── glass.module.css   # Liquid Glass component styles
│   │   │   ├── dark.css           # Dark theme overrides
│   │   │   └── light.css          # Light theme overrides
│   │   └── types/
│   │       └── ipc.ts             # Shared IPC type definitions
│   └── shared/                    # Types shared between main and renderer
│       └── types.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
├── .gitignore
└── README.md
```

---

## 7. Key Design Decisions

### IMEI Extraction
```typescript
function extractIMEI(folderName: string): string | null {
  const parts = folderName.split('_');
  if (parts.length < 2) return null;
  const imei = parts[0];
  return /^\d{15}$/.test(imei) ? imei : null;
}

function extractScanIndex(folderName: string): number | null {
  const parts = folderName.split('_');
  if (parts.length < 2) return null;
  const index = parseInt(parts[1], 10);
  return isNaN(index) ? null : index;
}
```

### MR Image Detection & IMEI Extraction
```typescript
const MR_IMAGE_REGEX = /^SG-M\d+-\d+-\d{15}-.+\.png$/;

function isMRImage(filename: string): boolean {
  return MR_IMAGE_REGEX.test(filename);
}

function extractIMEIFromMRFilename(filename: string): string | null {
  // SG-M008-075545-358627090247469-Apple-iPhone8.png
  //   0      1       2          3          4       5
  const parts = filename.replace(/\.png$/, '').split('-');
  if (parts.length < 4) return null;
  const imei = parts[3];
  return /^\d{15}$/.test(imei) ? imei : null;
}

function parseMRFilename(filename: string): {
  machine: string;
  code: string;
  imei: string;
  brand: string;
  model: string;
} | null {
  const match = filename.match(
    /^SG-(M\d+)-(\d+)-(\d{15})-([^-]+)-(.+)\.png$/
  );
  if (!match) return null;
  return {
    machine: match[1],
    code: match[2],
    imei: match[3],
    brand: match[4],
    model: match[5],
  };
}

function isMRPassFolder(folderName: string): boolean {
  return folderName !== 'Error-Error';
}

function isMRFailFolder(folderName: string): boolean {
  return folderName === 'Error-Error';
}
```

### Date Folder Detection
```typescript
const DATE_FOLDER_REGEX = /^\d{8}$/;

function isDateFolder(name: string): boolean {
  return DATE_FOLDER_REGEX.test(name);
}
```

### Cross-Device Move Safety
```typescript
async function safeMove(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true });
      // Verify before deleting
      const srcStats = await getDirectoryStats(src);
      const destStats = await getDirectoryStats(dest);
      if (srcStats.fileCount === destStats.fileCount &&
          srcStats.totalSize === destStats.totalSize) {
        await fs.rm(src, { recursive: true });
      } else {
        throw new Error('Move verification failed: source and destination mismatch');
      }
    } else {
      throw err;
    }
  }
}
```

### Parallel Machine Scanning
```typescript
async function searchMachines(folders: string[], imeiSet: Set<string>): Promise<MatchResult[]> {
  const results = await Promise.allSettled(
    folders.map(folder => scanMachineFolder(folder, imeiSet))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<MatchResult[]> => r.status === 'fulfilled')
    .flatMap(r => r.value);
}
```
