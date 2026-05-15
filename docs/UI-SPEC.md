# Image Collection v2 — UI Design Specification

## 1. Liquid Glass Theme

The UI uses a "Liquid Glass" aesthetic: translucent frosted surfaces with depth, subtle layering, and smooth animations. Both dark and light variants are supported.

### 1.1 Design Tokens (CSS Variables)

```css
/* --- Shared tokens --- */
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-xl: 24px;

--blur-glass: 20px;
--blur-heavy: 40px;

--transition-fast: 150ms ease;
--transition-normal: 250ms ease;
--transition-slow: 400ms ease;

--font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-size-xs: 11px;
--font-size-sm: 13px;
--font-size-md: 15px;
--font-size-lg: 18px;
--font-size-xl: 24px;
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;

--accent-primary: #0ABAB5;      /* Teal — inherited from v1 branding */
--accent-hover: #08A19D;
--accent-active: #068F8A;

--status-green: #34C759;
--status-orange: #FF9500;
--status-red: #FF3B30;
```

#### Dark Theme
```css
[data-theme="dark"] {
  --bg-app: linear-gradient(135deg, #0a0e1a 0%, #1a1e2e 50%, #0d1117 100%);
  --bg-glass: rgba(255, 255, 255, 0.06);
  --bg-glass-hover: rgba(255, 255, 255, 0.10);
  --bg-glass-active: rgba(255, 255, 255, 0.14);
  --border-glass: rgba(255, 255, 255, 0.12);
  --border-glass-focus: rgba(10, 186, 181, 0.5);

  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.55);
  --text-tertiary: rgba(255, 255, 255, 0.35);
  --text-on-accent: #ffffff;

  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  --shadow-elevated: 0 16px 48px rgba(0, 0, 0, 0.5);
}
```

#### Light Theme
```css
[data-theme="light"] {
  --bg-app: linear-gradient(135deg, #e8ecf1 0%, #f0f3f7 50%, #e4e8ed 100%);
  --bg-glass: rgba(255, 255, 255, 0.65);
  --bg-glass-hover: rgba(255, 255, 255, 0.78);
  --bg-glass-active: rgba(255, 255, 255, 0.88);
  --border-glass: rgba(0, 0, 0, 0.08);
  --border-glass-focus: rgba(10, 186, 181, 0.5);

  --text-primary: rgba(0, 0, 0, 0.88);
  --text-secondary: rgba(0, 0, 0, 0.55);
  --text-tertiary: rgba(0, 0, 0, 0.35);
  --text-on-accent: #ffffff;

  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  --shadow-elevated: 0 16px 48px rgba(0, 0, 0, 0.12);
}
```

### 1.2 Glass Card Component

The primary container for all panels. Every major section is a Glass Card.

```css
.glass-card {
  background: var(--bg-glass);
  backdrop-filter: blur(var(--blur-glass));
  -webkit-backdrop-filter: blur(var(--blur-glass));
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-glass);
  padding: 20px 24px;
  transition: box-shadow var(--transition-normal),
              background var(--transition-normal);
}

.glass-card:hover {
  background: var(--bg-glass-hover);
}
```

### 1.3 Interactive Elements

**Buttons (pill-shaped):**
```css
.btn-primary {
  background: var(--accent-primary);
  color: var(--text-on-accent);
  border: none;
  border-radius: var(--radius-xl);
  padding: 10px 24px;
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-primary:hover {
  background: var(--accent-hover);
  box-shadow: 0 4px 16px rgba(10, 186, 181, 0.3);
  transform: translateY(-1px);
}

.btn-secondary {
  background: var(--bg-glass);
  color: var(--text-primary);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(10px);
}
```

**Toggle Switch (iOS-style):**
```css
.toggle-track {
  width: 44px;
  height: 24px;
  border-radius: 12px;
  background: var(--bg-glass-active);
  border: 1px solid var(--border-glass);
  position: relative;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.toggle-track[data-active="true"] {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.toggle-thumb {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  position: absolute;
  top: 1px;
  left: 1px;
  transition: transform var(--transition-fast);
}

.toggle-track[data-active="true"] .toggle-thumb {
  transform: translateX(20px);
}
```

**Select Dropdown (glass-styled):**
```css
.glass-select {
  background: var(--bg-glass);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  padding: 8px 32px 8px 12px;
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  appearance: none;
}

.glass-select:focus {
  border-color: var(--border-glass-focus);
  outline: none;
  box-shadow: 0 0 0 3px rgba(10, 186, 181, 0.15);
}
```

**Checkbox (glass-styled):**
```css
.glass-checkbox {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--border-glass);
  background: var(--bg-glass);
  backdrop-filter: blur(10px);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.glass-checkbox:checked {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}
```

### 1.4 Typography

| Element | Size | Weight | Color |
|---------|------|--------|-------|
| Window title | --font-size-lg | semibold | --text-primary |
| Card title | --font-size-md | semibold | --text-primary |
| Label | --font-size-sm | medium | --text-secondary |
| Body text | --font-size-sm | normal | --text-primary |
| Caption / count | --font-size-xs | normal | --text-tertiary |
| Button text | --font-size-sm | semibold | varies |

---

## 2. Layout

### 2.1 Window

- **Default size**: 900px wide x 800px tall
- **Minimum size**: 720px x 600px
- **Resizable**: yes
- **Custom title bar**: frameless window with custom drag region, minimize/maximize/close buttons
- **Background**: `var(--bg-app)` gradient fills the entire window

### 2.2 Panel Layout

Single-column scrollable layout with glass card panels stacked vertically with 16px gaps.

```
┌───────────────────────────────────────────────────────┐
│  ⬡ Image Collection v2          [☀/🌙] [─] [□] [✕]  │ ← Title bar (drag region)
│───────────────────────────────────────────────────────│
│                                                       │
│  ┌─ Source ──────────────────────────────────────┐    │
│  │ Source: [NAS_Lonestar (Z:\)        ▾] [+ Add] │    │ ← Source switcher
│  │                                               │    │
│  │ Shared Folder: [Z:\                   ] [📁]  │    │ ← Path input
│  │                                               │    │
│  │ Search Folders:        [Select All] [⟳ Refresh]│    │
│  │ ┌─────────────────────────────────────────┐   │    │
│  │ │ ☑ M8    ☑ M10   ☑ M12   ☑ M13         │   │    │ ← Toggle grid
│  │ │ ☑ M14   ☑ M15   ☑ M16   ☑ M17         │   │    │   (auto-populated)
│  │ │ ☑ M20   ☑ M21   ☑ M22   ☑ M23         │   │    │
│  │ │ ☑ M24   ☑ M34   ☑ M35   ☐ M38         │   │    │
│  │ │ ☐ M39   ☐ audits  ☐ crackimages       │   │    │
│  │ └─────────────────────────────────────────┘   │    │
│  │                                               │    │
│  │ Date Range:  [Start ____] to [End ____]  ⓘ   │    │ ← Optional filter
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  ┌─ Audit List ──────────────────────────────────┐    │
│  │                                               │    │
│  │  ┌──────────────────────────────────────┐     │    │
│  │  │     📄 Drag & drop audit file here    │     │    │ ← Drop zone
│  │  │     or click Browse to select         │     │    │
│  │  └──────────────────────────────────────┘     │    │
│  │                                               │    │
│  │  File: audit_may15.csv  [📁 Browse]           │    │
│  │  Format: CSV · 1,247 IMEIs loaded · 3 invalid │    │ ← Import summary
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  ┌─ Settings ────────────────────────────────────┐    │
│  │                                               │    │
│  │  Action      [Copy ▾] ⓘ    Image Type [Both ▾] ⓘ│  │ ← 2-column grid
│  │  Organize    [By Date ▾] ⓘ  Duplicates [Skip ▾] ⓘ│  │   ⓘ = tooltip icon
│  │  Scan Index  [All ▾] ⓘ                        │  │
│  │  MR PASS  [OFF ◯━━] ⓘ  MR FAIL [OFF ◯━━] ⓘ │  │
│  │                                               │    │
│  │  Destination [C:\exports\may15     ] [📁]     │    │
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  ┌─ Results ─────────────────────────────────────┐    │
│  │                                               │    │
│  │  Found: 1,182 / 1,247 IMEIs                  │    │ ← Summary
│  │  ● 1,150 complete  ● 32 incomplete  ● 65 missing│  │
│  │                                               │    │
│  │  ┌──────┬────────┬────────┬─────┬──────────┐  │    │
│  │  │ IMEI │Machine │ Date   │Index│ Files    │  │    │ ← Sortable table
│  │  ├──────┼────────┼────────┼─────┼──────────┤  │    │
│  │  │ 3500…│  M8    │05/15/26│ 192 │ 12 files │  │    │
│  │  │ 3500…│  M10   │05/14/26│  45 │  8 files │  │    │
│  │  │ 3501…│  M8    │05/13/26│  32 │  3 files⚠│  │    │ ← ⚠ = incomplete
│  │  │ ...  │  ...   │  ...   │ ... │  ...     │  │    │
│  │  └──────┴────────┴────────┴─────┴──────────┘  │    │
│  │                                               │    │
│  │  [View Missing IMEIs]  [Search History ▾]     │    │
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  ┌─ Progress ────────────────────────────────────┐    │
│  │  [████████████████████░░░░░░] 78% · Exporting… │   │ ← Progress bar
│  │  Elapsed: 1m 23s · 943 / 1,182 folders        │    │
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  [ 🔍 Start Search ]  [ 📦 Export Results ]  [ Clear ]│ ← Action buttons
│                                                       │
│───────────────────────────────────────────────────────│
│  Ready · Last search: 1m 23s · 1,182 results         │ ← Status bar
└───────────────────────────────────────────────────────┘
```

### 2.3 Component Spacing

| Element | Spacing |
|---------|---------|
| Panel gap (between glass cards) | 16px |
| Card internal padding | 20px horizontal, 16px vertical |
| Label-to-control gap | 8px |
| Control-to-control gap (horizontal) | 16px |
| Control-to-control gap (vertical) | 12px |
| Checkbox grid gap | 8px vertical, 16px horizontal |
| Section divider margin | 12px top/bottom |

---

## 3. Tooltips

Every setting control has a tooltip icon (ⓘ) that displays on hover.

**Tooltip style:**
```css
.tooltip {
  background: var(--bg-glass-active);
  backdrop-filter: blur(var(--blur-glass));
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  max-width: 280px;
  box-shadow: var(--shadow-elevated);
  animation: tooltipFade 200ms ease;
}
```

**Tooltip Content:**

| Setting | Tooltip Text |
|---------|-------------|
| Action | **Move** transfers folders and removes them from the source. **Copy** duplicates folders, leaving the source unchanged. |
| Image Type | **BMP**: collect .bmp images only. **JPEG**: collect .jpg/.jpeg only. **Both**: collect all image types from matched folders. |
| Organize | Choose how exported folders are structured. **Flat**: single folder. **By Machine/Date**: one level of grouping. **Machine→Date** or **Date→Machine**: two-level nesting. **By IMEI**: groups all scans of the same device. **By Scan Index**: separates first scans from rescans. |
| Duplicates | **Skip**: if an IMEI folder already exists at the destination, leave it untouched. **Overwrite**: replace existing destination folders with the new source data. |
| MR PASS | Collects Model Recognition PASS images — devices the AI correctly identified. Searches `ModelRecogImages/{date}/{Brand-Model}/` folders for `.png` files matching audit list IMEIs. Disables standard image collection. |
| MR FAIL | Collects Model Recognition FAIL images — devices the AI misidentified (wrong placement, wrong color, wrong model). Searches `ModelRecogImages/{date}/Error-Error/` for `.png` files matching audit list IMEIs. |
| Scan Index | **All**: include every scan. **First scan only**: only _1 entries (first time scanned). **Rescans only**: only _2 and above (devices that were re-scanned). |
| Date Range | Restrict the search to date folders within the specified range. Leave blank to search all dates. |
| Select All | Toggle all detected folders on or off for searching. |
| Refresh | Re-scan the shared folder to detect any new or removed subfolders since last check. |

---

## 4. Interactions & States

### 4.1 Drag-and-Drop Audit Import

- **Idle**: Dashed border, subtle prompt text
- **Drag over**: Border becomes solid accent color, background pulses gently, text changes to "Drop to import"
- **Processing**: Spinner replaces text while parsing
- **Loaded**: Shows file name, format badge, IMEI count

### 4.2 Search Flow

1. User clicks **Start Search** → button text changes to "Searching...", shows spinner, becomes cancelable
2. Progress bar appears with percentage, current folder name, elapsed time
3. On complete: results populate in Results panel, summary bar updates, action buttons re-enable
4. **Export Results** button becomes active only after search completes with results

### 4.3 Missing IMEI Modal

- Opens as a glass-styled overlay/modal
- Shows scrollable list of IMEIs not found
- **Export List** button to save missing IMEIs as a .txt or .csv file
- Close button or click-outside to dismiss

### 4.4 Theme Toggle

- Sun/moon icon in the title bar area
- Click toggles between dark and light
- Smooth CSS transition (300ms) on all themed properties
- System theme detection via `prefers-color-scheme` media query (optional setting)

---

## 5. Responsive Behavior

- Window resizes: panels stretch horizontally, checkbox grid reflows
- Minimum width (720px): settings switch from 2-column to 1-column layout
- Results table: horizontal scroll if columns overflow
- Folder toggle grid: CSS Grid with `auto-fill, minmax(120px, 1fr)` for natural reflow

---

## 6. Animations (Framer Motion)

| Animation | Trigger | Duration | Easing |
|-----------|---------|----------|--------|
| Panel entrance | App load | 300ms staggered | ease-out |
| Progress bar fill | Export/search progress | continuous | linear |
| Tooltip show/hide | Hover ⓘ icon | 200ms | ease |
| Modal open | Click "View Missing" | 250ms | ease-out |
| Modal close | Click close/outside | 200ms | ease-in |
| Theme transition | Toggle theme | 300ms | ease |
| Button hover lift | Hover primary button | 150ms | ease |
| Drag-over pulse | Drag file over drop zone | 600ms loop | ease-in-out |
| Toggle switch | Click toggle | 150ms | spring |
