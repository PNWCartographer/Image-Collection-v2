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
│   │   ├── 350019048184200_181/     ← IMEI_Index folder (Level 3)
│   │   │   ├── FD/                 ← Subfolder (purpose TBD)
│   │   │   ├── 0_0_20260506114113669.jpg    ← Device scan images (Level 4)
│   │   │   ├── 1_0_20260506114113732.jpg
│   │   │   ├── 2_0_20260506114113828.jpg
│   │   │   ├── ...                          ← ~20 numbered .jpg scan images
│   │   │   ├── SG-M008-114100-350019048184200-Apple-iPhone13ProMax.png  ← MR image (copy)
│   │   │   ├── ai_check.json       ← Metadata: AI check results
│   │   │   ├── CMCSentFlag.txt     ← Metadata: CMC sent flag
│   │   │   ├── DefectLog.xml       ← Metadata: defect log (~145 KB)
│   │   │   ├── Grade.json          ← Metadata: grading result
│   │   │   └── Upload.success      ← Metadata: upload confirmation
│   │   ├── 350024510270586_85/
│   │   └── 350118652588373_32/
│   ├── 20260514/
│   ├── ...
│   │
│   ├── ModelRecogImages/            ← MR image repository (searched when MR toggles are ON)
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
- **Tool behavior**: During standard image search, only date folders are traversed. When MR toggles are active, the tool additionally searches `ModelRecogImages/` (see §ModelRecogImages).

### Level 3 — IMEI_Index Folders
- **What**: Subdirectories within each date folder, one per scanned device
- **Naming convention**: `{15-digit IMEI}_{scan index}`
  - Example: `350002267153742_192`
  - IMEI portion: `350002267153742` (first 15 characters, always numeric)
  - Separator: underscore `_`
  - Scan index: `192` (sequential number for that machine on that date)
- **Scan index meaning**: The index represents the device's position in the scanning sequence for that machine and date. Device `_1` was the first scanned that day, `_2` was the second, and so on.
- **Tool behavior**: The tool extracts the IMEI by splitting the folder name on `_` and taking the first 15 characters. This is matched against the audit list.

### Level 4 — IMEI Folder Contents
- **What**: Files and subfolders inside each IMEI_Index folder

**Device Scan Images (JPEG):**
- Naming pattern: `{position}_{sub}_{timestamp}.jpg`
  - Example: `0_0_20260506114113669.jpg`
  - Position: camera/angle index (0–20+)
  - Sub: sub-index within that position
  - Timestamp: `YYYYMMDDHHmmssSSS` (date + time + milliseconds)
- Typically ~20 images per device, ranging from 27 KB to 3,121 KB each

**Model Recognition (MR) Image (per-device copy):**
- **Location**: Directly in the IMEI folder root
- **File type**: `.png`
- **Naming pattern**: `SG-{machine}-{code}-{IMEI}-{brand}-{model}.png`
  - Example: `SG-M008-114100-350019048184200-Apple-iPhone13ProMax.png`
- **Note**: This is a copy of the MR image that also exists in the `ModelRecogImages/` tree. The authoritative PASS/FAIL categorization is in `ModelRecogImages/` (see §ModelRecogImages below).

**Subfolders:**
- `FD/` — subfolder present in IMEI folders (contents/purpose TBD)

**Metadata Files (not collected during image export):**
| File | Type | Description |
|------|------|-------------|
| `ai_check.json` | JSON | AI check results (~5 KB) |
| `Grade.json` | JSON | Device grading result (~1 KB) |
| `DefectLog.xml` | XML | Defect log with detailed inspection data (~145 KB) |
| `CMCSentFlag.txt` | Text | CMC transmission flag (~1 KB) |
| `Upload.success` | Flag | Indicates successful upload to upstream systems |

- **Tool behavior**: During standard image export, the Image Type filter determines which file extensions are collected. Metadata files (`.json`, `.xml`, `.txt`, `.success`) are excluded from image exports unless explicitly included in a future feature.

---

## ModelRecogImages Directory Structure

The `ModelRecogImages/` folder exists under each machine folder and contains the authoritative, AI-categorized collection of Model Recognition images. This is a **separate search path** from the standard IMEI folder tree — the tool searches here when MR PASS or MR FAIL toggles are active.

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

### MR PASS (Brand-Model Folders)

Devices where AI **correctly identified** the model are sorted into folders named `{Brand}-{Model}`:

**Known Brand-Model folder names** (from production data):
- `Apple-iPhone6`, `Apple-iPhone7`, `Apple-iPhone8`, `Apple-iPhone11`, `Apple-iPhone11Pro`, `Apple-iPhoneX`, `Apple-iPhoneXR`
- `Samsung-GalaxyA42`, `Samsung-GalaxyNote20`, `Samsung-GalaxyS8`, `Samsung-GalaxyS21`
- Additional models will appear as new device types are scanned

**Detection rule**: Any subfolder under a date folder within `ModelRecogImages/` that is NOT named `Error-Error` is a PASS brand-model folder.

### MR FAIL (Error-Error Folder)

Devices where AI **failed** model recognition are placed in a folder named exactly `Error-Error`:

**Fail reasons** (all grouped into Error-Error):
- Wrong placement
- Wrong color
- Wrong model
- General MR fail

**Contents**: Same `.png` naming pattern as PASS images. The filenames still contain the brand parsed by the system, though this may be incorrect for misidentified devices.

### IMEI Extraction from MR Filenames

MR image filenames in `ModelRecogImages/` follow the same pattern as in IMEI folders:

```
SG-{machine}-{code}-{IMEI}-{brand}-{model}.png
```

The IMEI is extracted by splitting the filename on `-` and taking the 4th segment (index 3):

```
SG-M008-075545-358627090247469-Apple-iPhone8.png
 0    1      2              3      4        5
              └── code      └── IMEI  └── brand └── model
```

This IMEI is matched against the audit list to determine which MR images to collect.

### Search Behavior by Toggle

| MR PASS | MR FAIL | Search Path | Files Collected |
|---------|---------|-------------|-----------------|
| OFF | OFF | Standard: `{machine}/{date}/{IMEI_index}/` | Device scan images (.jpg/.bmp) |
| ON | OFF | `{machine}/ModelRecogImages/{date}/{Brand-Model}/` | MR PASS `.png` files matching audit list |
| OFF | ON | `{machine}/ModelRecogImages/{date}/Error-Error/` | MR FAIL `.png` files matching audit list |
| ON | ON | Both paths above | MR PASS + MR FAIL `.png` files matching audit list |

---

## Naming Conventions Summary

| Element | Pattern | Example | Regex |
|---------|---------|---------|-------|
| Machine folder | `M` + number | M8, M20, M34 | `^M\d+$` |
| Date folder | YYYYMMDD | 20260515 | `^\d{8}$` |
| IMEI_Index folder | 15 digits + `_` + index | 350019048184200_181 | `^\d{15}_\d+$` |
| Scan image (JPEG) | `pos_sub_timestamp.jpg` | 0_0_20260506114113669.jpg | `^\d+_\d+_\d+\.jpg$` |
| MR image (PNG) | `SG-machine-code-IMEI-brand-model.png` | SG-M008-075545-358627090247469-Apple-iPhone8.png | `^SG-M\d+-\d+-\d{15}-.+\.png$` |
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
| `ModelRecogImages` | 2 (under machine) | Searched ONLY when MR PASS or MR FAIL toggles are active — skipped during standard image search |
| `GRR Scans` | 2 (under machine) | Gauge repeatability scan data — always skip |
| `audits` | 1 (root) | Audit file storage — not image data |
| `crackimages` | 1 (root) | Crack image reference data — not standard IMEI scans |
| `GRR Images` | 1 (root) | Gauge repeatability reference images |
| `version_control` | 1 (root) | Software version control — not image data |

The skip list is applied automatically during **standard image search**. Level 1 utility folders appear in the toggle list but are unchecked by default. Level 2 special folders are filtered out by the date-folder regex and never traversed during standard search.

**Exception**: `ModelRecogImages` is searched when MR PASS or MR FAIL toggles are active. In this mode, the tool enters `ModelRecogImages/`, traverses its date folders, and searches brand-model or Error-Error subfolders for matching IMEI images.
