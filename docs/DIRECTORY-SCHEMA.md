# NAS Directory Schema Reference

This document describes the production NAS folder hierarchy that Image Collection v2 navigates when searching for device images.

---

## Directory Tree

```
NAS_ROOT (e.g., Z:\ mapped to \\NAS_Lonestar)
│
├── M8/                              ← Machine folder (Level 1)
│   │
│   ├── 20260515/                    ← Date folder (Level 2) — YYYYMMDD format
│   │   │
│   │   ├── 350019048184200_181/     ← TYPE A: full-scan folder {IMEI}_{index} (Level 3)
│   │   │   ├── FD/                 ← AI detection images subfolder
│   │   │   ├── 0_0_20260506114113669.jpg    ← Device scan images (Level 4)
│   │   │   ├── 1_0_20260506114113732.jpg
│   │   │   ├── 2_0_20260506114113828.jpg
│   │   │   ├── ...                          ← ~20 numbered .jpg scan images
│   │   │   ├── SG-M008-114100-350019048184200-Apple-iPhone13ProMax.png  ← MR image
│   │   │   ├── ai_check.json       ← Metadata: AI check results
│   │   │   ├── CMCSentFlag.txt     ← Metadata: CMC sent flag
│   │   │   ├── DefectLog.xml       ← Metadata: defect log (~145 KB)
│   │   │   ├── Grade.json          ← Metadata: grading result
│   │   │   └── Upload.success      ← Metadata: upload confirmation
│   │   ├── 350024510270586_85/
│   │   │
│   │   ├── 358627090247469/         ← TYPE B: MR / CMC-upload folder {IMEI} (no _index)
│   │   │   ├── 20260515082041.png   ←   a single timestamp-named .png (NOT SG-*)
│   │   │   ├── CMCSentFlag.txt       ←   CMC sent flag
│   │   │   ├── Upload.success        ←   upload confirmation
│   │   │   └── UUID.key              ←   transaction key
│   │   └── 350118652588373_32/
│   ├── 20260514/
│   ├── ...
│   │
│   ├── ModelRecogImages/            ← MR image repository (NOT scanned by the tool — too large to enumerate; see note below)
│   │   ├── 20260515/               ← Date folder (same YYYYMMDD pattern)
│   │   │   ├── Apple-iPhone8/      ← Brand-Model folder (MR PASS results)
│   │   │   │   ├── SG-M008-075545-358627090247469-Apple-iPhone8.png
│   │   │   │   ├── SG-M008-101608-356473106659633-Apple-iPhone8.png
│   │   │   │   └── ...
│   │   │   ├── Apple-iPhone11/
│   │   │   ├── Apple-iPhone11Pro/
│   │   │   ├── Apple-iPhoneX/
│   │   │   ├── Apple-iPhoneXR/
│   │   │   ├── Apple-iPhone6/
│   │   │   ├── Apple-iPhone7/
│   │   │   ├── Samsung-GalaxyA42/
│   │   │   ├── Samsung-GalaxyNote20/
│   │   │   ├── Samsung-GalaxyS8/
│   │   │   ├── Samsung-GalaxyS21/
│   │   │   └── Error-Error/        ← MR FAIL results (WrongPlacement, etc.)
│   │   │       ├── SG-M008-074837-359814715825890-Apple-....png
│   │   │       ├── SG-M008-082225-350490660050674-Samsung-....png
│   │   │       ├── SG-M008-082041-356883112690606-Motorola-....png
│   │   │       └── ...
│   │   └── 20260514/
│   │
│   ├── GRR Scans/                   ← GRR scan data folder (SKIP during search)
│   └── Bin/                         ← Bin folder (SKIP during search)
│
├── M10/                             ← Machine folder
├── M12/
├── M13/
├── M14/
├── M15/
├── M16/
├── M17/
├── M20/
├── M21/
├── M22/
├── M23/
├── M24/
├── M34/
├── M35/
├── M38/
├── M39/
│
├── #recycle/                        ← System folder (ALWAYS SKIP)
├── audits/                          ← Utility folder (user-toggleable, skip by default)
├── crackimages/                     ← Utility folder (user-toggleable, skip by default)
├── GRR Images/                      ← Utility folder (user-toggleable, skip by default)
└── version_control/                 ← Utility folder (user-toggleable, skip by default)
```

---

## Level Definitions

### Level 0 — NAS Root
- **What**: The mount point of the NAS share
- **Examples**: `Z:\` (mapped drive), `\\NAS_Lonestar` (UNC path)
- **Tool behavior**: User selects this as the "Shared Folder" root. All scanning starts here.

### Level 1 — Machine & Utility Folders
- **What**: First-level subdirectories under the NAS root
- **Machine folders**: Named with `M` prefix followed by a number (M8, M10, M12–M17, M20–M24, M34, M35, M38, M39). Each represents a physical scanning machine on the production floor.
- **Utility folders**: #recycle, audits, crackimages, GRR Images, version_control. These are not machine folders and typically should not be searched for IMEI images.
- **Tool behavior**: Auto-scanned and displayed as toggleable checkboxes. Users select which folders to include in the search.

### Level 2 — Date & Special Folders (under machines)
- **What**: Subdirectories within each machine folder
- **Date folders**: Named in `YYYYMMDD` format (e.g., 20260515). Each represents one day's production scans on that machine.
- **Special folders**:
  - `ModelRecogImages` — MR image repository organized by AI recognition result (see §ModelRecogImages below)
  - `GRR Scans` — Gauge repeatability scan data
  - `Bin` — Machine bin folder
- **Detection rule**: Date folders match the regex `^\d{8}$` — exactly 8 digits. Anything else is a special folder.
- **Tool behavior**: The tool never enumerates a date folder when it can avoid it (a production date folder can hold thousands of device subfolders, and a plain SMB listing times out). Instead it goes straight to each device folder by exact path (Type B) or resolves the folder via a server-side wildcard (Type A) — see §Level 3. `ModelRecogImages/` is **never** scanned (too large to enumerate over SMB); it is reference-only.

### Level 3 — Device Folders (two layouts)

Each date folder holds one subfolder per scanned device, in **one of two layouts**. The tool collects from both.

**Type A — full-scan folder `{IMEI}_{index}`**
- Naming convention: `{15-digit IMEI}_{scan index}` — e.g. `350002267153742_192`
  - IMEI portion: first 15 characters, always numeric
  - Scan index: the integer after the underscore — the device's position in that machine/date's scan sequence (`_1` was first, `_2` second, …)
- Contents: the full set of JPEG scan images plus `DefectLog.xml`, `Grade.json`, `FD/`, and a `SG-*.png` MR image (see Level 4).
- **Tool behavior**: resolved by a **server-side wildcard** — `findMatchingIMEIFolders` runs `cmd /c dir /b /a:d {datePath}\{IMEI}_*` so the NAS returns the matching folder without enumerating the date folder. IMEI is then taken from the folder name (split on `_`) and matched against the audit list.

**Type B — MR / CMC-upload folder `{IMEI}` (wrong-color devices)**
- Naming convention: the folder name is **exactly the 15-digit IMEI**, with **no `_index` suffix** — e.g. `358627090247469`.
- Contents: a single **timestamp-named `.png`** (e.g. `20260515082041.png`, **not** `SG-*`), plus `CMCSentFlag.txt`, `Upload.success`, and `UUID.key`. No JPEG scan set, no `Grade.json`, no `FD/`.
- These are how devices uploaded to CMC by Model Recognition (e.g. "Wrong Color" grades) are stored.
- **Tool behavior**: opened by **exact path** — `collectMRDirect` opens `{root}/{machine}/{date}/{IMEI}/` directly (the path is fully known from the audit's IMEI + Machine + Date) and takes the `.png` inside, whatever its name. No listing, no wildcard.

### Level 4 — Device Folder Contents

#### Type A folder contents

- **What**: Files and subfolders inside each `{IMEI}_{index}` folder

**Device Scan Images (JPEG):**
- Naming pattern: `{position}_{sub}_{timestamp}.jpg`
  - Example: `0_0_20260506114113669.jpg`
  - Position: camera/angle index (0–20+)
  - Sub: sub-index within that position
  - Timestamp: `YYYYMMDDHHmmssSSS` (date + time + milliseconds)
- Typically ~20 images per device, ranging from 27 KB to 3,121 KB each

**Model Recognition (MR) Image (per-device copy):**
- **Location**: Directly in the `{IMEI}_{index}` folder root
- **File type**: `.png`
- **Naming pattern**: `SG-{machine}-{code}-{IMEI}-{brand}-{model}.png`
  - Example: `SG-M008-114100-350019048184200-Apple-iPhone13ProMax.png`
- When a Type A device is collected on the standard path, `countFilesRecursive` captures this `SG-*.png` and parses the `{brand}-{model}` segment so the match carries a model name and a PASS/FAIL tag (`Error-Error` → FAIL, anything else → PASS). The tool does **not** read the separate `ModelRecogImages/` tree. (Note: the primary MR collection path is the Type B exact-path probe below, which does not depend on this file.)

**Subfolders:**
- `FD/` — AI detection images. Contains images used/generated by the AI defect detection system. Included automatically in standard IMEI folder exports. When "AI Images Only" toggle is ON, the tool collects only `FD/` contents and skips root-level scan images.

**Metadata Files (not collected during image export):**
| File | Type | Description |
|------|------|-------------|
| `ai_check.json` | JSON | AI check results (~5 KB) |
| `Grade.json` | JSON | Device grading result (~1 KB) |
| `DefectLog.xml` | XML | Defect log with detailed inspection data (~145 KB) |
| `CMCSentFlag.txt` | Text | CMC transmission flag (~1 KB) |
| `Upload.success` | Flag | Indicates successful upload to upstream systems |

- **Tool behavior**: During standard image export, the Image Type filter determines which file extensions are collected. Metadata files (`.json`, `.xml`, `.txt`, `.success`) are excluded from image exports unless explicitly included in a future feature.

#### Type B folder contents

- **What**: Files inside each bare `{IMEI}` folder (no `_index`)

**MR upload image (the collected file):**
- **Location**: directly in the `{IMEI}` folder root
- **File type**: `.png`, **timestamp-named** (e.g. `20260515082041.png`) — **not** the `SG-*` pattern
- **This is the file MR collection takes.** `collectMRDirect` takes the first `.png` in the folder regardless of its name. The device model is **not** in this filename — it comes from the audit's Model column instead.

**Metadata files (not collected):**
| File | Type | Description |
|------|------|-------------|
| `CMCSentFlag.txt` | Text | CMC transmission flag |
| `Upload.success` | Flag | Indicates successful upload to upstream systems |
| `UUID.key` | Key | Per-transaction identifier |

---

## ModelRecogImages Directory Structure

The `ModelRecogImages/` folder exists under each machine folder and contains an AI-categorized collection of Model Recognition images, organized by recognized model. This section documents that on-disk layout for reference.

> **Important: the tool does NOT scan `ModelRecogImages/`.** The `{Brand-Model}/` folders here accumulate **tens of thousands** of files per model and time out over SMB (the 15s `readdir` timeout fires, producing empty results and a hung UI). An earlier v1.5.0 draft scanned this tree; that approach was abandoned and this section is retained for **reference only**. MR collection instead opens each wrong-color device's **Type B `{IMEI}` folder by exact path** (see §Level 3) and takes the timestamp-named `.png` inside — no enumeration of this tree or of the date folder. The device model comes from the audit's Model column; a device's grade (e.g. "Wrong Color") is knowable only from the audit file, so the audit list is the filter and there is no "wrong color" toggle.

### Path Structure

```
{Machine}/ModelRecogImages/{YYYYMMDD}/{Brand-Model}/  → MR PASS images
{Machine}/ModelRecogImages/{YYYYMMDD}/Error-Error/     → MR FAIL images
```

### Hierarchy

| Level | Content | Example | Detection |
|-------|---------|---------|-----------|
| 1 | Machine folder | `M8/` | Same as standard search |
| 2 | `ModelRecogImages` | `M8/ModelRecogImages/` | Exact name match |
| 3 | Date folder | `ModelRecogImages/20260515/` | Regex `^\d{8}$` |
| 4a | Brand-Model folder (PASS) | `20260515/Apple-iPhone8/` | Any folder name that is NOT `Error-Error` |
| 4b | Error-Error folder (FAIL) | `20260515/Error-Error/` | Exact name `Error-Error` |
| 5 | MR image files (`.png`) | `SG-M008-075545-358627090247469-Apple-iPhone8.png` | Same naming pattern as IMEI folder MR images |

### Midnight rollover (auto End-Date +1)

A device tested near midnight can have its folder filed under the **next day** relative to its audit/test date. To avoid false "missing" results, when a date column is detected the auto-populated End Date is set to max(test date) + 1 day, so the search still reaches a rolled-over folder. Missing/non-existent date folders (ENOENT) are benign and **not** counted as scan errors. This applies to all searches, exact-path MR collection included (the End-Date hint widens which dates each `{IMEI}` target is built for).

### MR PASS (Brand-Model Folders)

Devices where AI **correctly identified** the model are sorted into folders named `{Brand}-{Model}`:

**Known Brand-Model folder names** (from production data):
- `Apple-iPhone6`, `Apple-iPhone7`, `Apple-iPhone8`, `Apple-iPhone11`, `Apple-iPhone11Pro`, `Apple-iPhoneX`, `Apple-iPhoneXR`
- `Samsung-GalaxyA42`, `Samsung-GalaxyNote20`, `Samsung-GalaxyS8`, `Samsung-GalaxyS21`
- Additional models will appear as new device types are scanned

**On-disk rule**: Within `ModelRecogImages/`, any folder NOT named `Error-Error` is a brand-model folder. The same naming carries into the `{model}` segment of every `SG-*.png` filename, which is what the tool actually reads — a model of anything other than `Error-Error` tags the match **PASS**.

### MR FAIL (Error-Error Folder)

Devices where AI **failed** model recognition are placed in a folder named exactly `Error-Error`:

**Fail reasons** (all grouped into Error-Error):
- Wrong placement
- Wrong color
- Wrong model
- General MR fail

**Contents**: Same `.png` naming pattern as PASS images. The filenames still contain the brand parsed by the system, though this may be incorrect for misidentified devices.

### MR Filename Format and Model/PASS-FAIL Parsing

The per-device `SG-*.png` (in the IMEI folder) and the copies in `ModelRecogImages/` share one filename pattern:

```
SG-{machine}-{code}-{IMEI}-{brand}-{model}.png
```

```
SG-M008-075545-358627090247469-Apple-iPhone8.png
 0    1      2              3      4        5
              └── code      └── IMEI  └── brand └── model
```

When a **Type A** device is collected on the standard fallback path, the tool already knows the IMEI from the folder name; `extractModelFromMRFilename` parses the **model** (segment 4 onward, e.g. `Apple-iPhone8`) from the `SG-*.png` filename to set the match's model name and PASS/FAIL tag (`Error-Error` → FAIL, anything else → PASS). Type B exact-path matches do not use this — their model comes from the audit's Model column.

### Collection Behavior (v1.5.7)

MR collection no longer scans `ModelRecogImages/` and no longer depends on the `SG-*.png` model segment. The path is decided by the dispatcher `searchIMEIs`:

- **Universal exact-path probe** — on **every** Smart Search (even with both MR toggles OFF), `collectMRDirect` is run first over all hinted targets, opening each `{machine}/{date}/{IMEI}/` Type B folder by exact path. Wrong-color / MR-upload devices are therefore collected **regardless of the MR toggles or whether the audit had a grade column**. Type A devices `ENOENT` here (fast) and fall through to standard enumeration only for the IMEIs the probe didn't find.
- **Auto-enable** — when the audit has a grade column (`isMRAudit`), the renderer force-enables MR collection with a banner; the operator need not set a toggle.
- **PASS/FAIL** — exact-path matches are tagged `mr-pass` with the model from the audit hint. (A Type A device collected on the fallback path is tagged `mr-fail` only if its captured `SG-*.png` model matches `Error-Error`.)

| Scenario | Path taken | Files collected |
|----------|-----------|-----------------|
| Both MR toggles OFF, Type B device in list | Exact-path probe opens `{machine}/{date}/{IMEI}/` | The timestamp-named `.png` (collected even with MR off) |
| Both MR toggles OFF, Type A device in list | Probe ENOENTs → server-side wildcard `{IMEI}_*` | Full folder per Image Type setting |
| Either MR toggle ON (or grade column → auto-enabled) | `searchMRDirect`: exact-path `{machine}/{date}/{IMEI}/` only | The `.png` from each Type B folder, tagged PASS/FAIL |

---

## Naming Conventions Summary

| Element | Pattern | Example | Regex |
|---------|---------|---------|-------|
| Machine folder | `M` + number | M8, M20, M34 | `^M\d+$` |
| Date folder | YYYYMMDD | 20260515 | `^\d{8}$` |
| Type A folder | 15 digits + `_` + index | 350019048184200_181 | `^\d{15}_\d+$` |
| Type B folder | 15 digits, no suffix | 358627090247469 | `^\d{15}$` |
| Scan image (JPEG) | `pos_sub_timestamp.jpg` | 0_0_20260506114113669.jpg | `^\d+_\d+_\d+\.jpg$` |
| MR image, Type A (PNG) | `SG-machine-code-IMEI-brand-model.png` | SG-M008-075545-358627090247469-Apple-iPhone8.png | `^SG-M\d+-\d+-\d{15}-.+\.png$` |
| MR image, Type B (PNG) | timestamp `.png` (any name) | 20260515082041.png | `\.png$` |
| Brand-Model folder | `Brand-Model` | Apple-iPhone8, Samsung-GalaxyS21 | `^[A-Za-z]+-[A-Za-z0-9]+$` |
| Error-Error folder | Exact name | Error-Error | `^Error-Error$` |
| BMP image | any name + .bmp | (varies) | `\.bmp$` |

---

## Default Skip List

These folders are skipped during IMEI search by default:

| Folder | Level | Reason |
|--------|-------|--------|
| `#recycle` | 1 (root) | NAS system recycle bin — always skip |
| `Bin` | 2 (under machine) | Machine bin folder — not date-organized IMEI data |
| `ModelRecogImages` | 2 (under machine) | **Never scanned** — too large to enumerate over SMB. MR mode reads the per-device `SG-*.png` from each IMEI folder instead |
| `GRR Scans` | 2 (under machine) | Gauge repeatability scan data — always skip |
| `audits` | 1 (root) | Audit file storage — not image data |
| `crackimages` | 1 (root) | Crack image reference data — not standard IMEI scans |
| `GRR Images` | 1 (root) | Gauge repeatability reference images |
| `version_control` | 1 (root) | Software version control — not image data |

The skip list is applied automatically. Level 1 utility folders appear in the toggle list but are unchecked by default. `version_control` and `ModelRecogImages` are in the engine's hard `SKIP_FOLDERS` set; the other Level 2 special folders (`Bin`, `GRR Scans`) are filtered out by the date-folder regex and never traversed.

> `ModelRecogImages` is **never** scanned. MR collection opens each wrong-color device's Type B `{IMEI}` folder by exact path and takes the timestamp-named `.png` inside (no enumeration of this tree or the date folder). Scanning the `ModelRecogImages/{Brand-Model}/` folders directly was tried in a v1.5.0 draft and abandoned — they hold tens of thousands of files and time out over SMB.
