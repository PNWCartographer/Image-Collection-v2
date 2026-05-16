# Image Collection v2 — Test Procedure

**Covers:** Milestones 0–4 + bilingual support + portable build  
**Last updated:** 2026-05-15

---

## Prerequisites

- Copy the `release/win-unpacked/` folder to a machine with NAS access
- Have a shared folder root available (e.g. `Z:\` mapped to NAS)
- Have at least one audit file ready (CSV, XLSX, or TXT with 15-digit IMEIs)

---

## 1. App Launch & Window

| # | Test | Expected |
|---|------|----------|
| 1.1 | Double-click `Image Collection v2.exe` | App opens with dark theme, frameless window, custom titlebar |
| 1.2 | Drag the titlebar area | Window moves |
| 1.3 | Click minimize (─) | Window minimizes to taskbar |
| 1.4 | Click maximize (□) | Window toggles between maximized and restored |
| 1.5 | Resize window by dragging edges | Window resizes, minimum 900x600 enforced |
| 1.6 | Close and reopen the app | Window reopens at the same size and position as when closed |

---

## 2. Theme Toggle

| # | Test | Expected |
|---|------|----------|
| 2.1 | Click the sun/moon icon in titlebar | Theme switches between dark and light mode |
| 2.2 | Verify all panels update | Glass cards, text, inputs, buttons all reflect new theme |
| 2.3 | Close and reopen the app | Theme preference persists (same theme active) |

---

## 3. Language Toggle

| # | Test | Expected |
|---|------|----------|
| 3.1 | Click "Lang - Chinese" button in Source panel | All UI text switches to Chinese |
| 3.2 | Verify button now reads "Lang - Eng" | Button label shows opposite language |
| 3.3 | Verify all panels translated | Source, Audit, Settings, Results titles and labels in Chinese |
| 3.4 | Verify Settings tooltips in Chinese | Hover every tooltip icon in Settings — all should display Chinese text |
| 3.5 | Verify Organize dropdown in Chinese | Open Organize dropdown — labels and descriptions in Chinese |
| 3.6 | Verify MR toggle labels in Chinese | MR PASS shows "MR 通过", MR FAIL shows "MR 失败" |
| 3.7 | Verify utility folder names translated | Non-machine folders show Chinese label with original name in parentheses (e.g. "审计 (audits)") |
| 3.8 | Verify machine folder names unchanged | M8, M10, M12, etc. stay as-is in both languages |
| 3.9 | Click "Lang - Eng" to switch back | All text returns to English |
| 3.10 | Close and reopen | Language preference persists |

---

## 4. Source Panel — Folder Scanning

| # | Test | Expected |
|---|------|----------|
| 4.1 | Click Browse, select shared folder root | Path appears in text field, subfolders populate in checkbox grid |
| 4.2 | Verify machine folders auto-checked | Folders matching M{number} pattern are checked by default |
| 4.3 | Verify non-machine folders unchecked | Utility folders (audits, crackimages, etc.) unchecked by default |
| 4.4 | Verify folder count shown | "Search Folders (N)" shows correct count |
| 4.5 | Verify machine folder sort order | M8 appears before M10 (numeric sort, not alphabetical) |
| 4.6 | Toggle individual folder checkboxes | Checkbox toggles on/off per folder |
| 4.7 | Click "Select All" | All folders check; button changes to "Deselect All" |
| 4.8 | Click "Deselect All" | All folders uncheck; button changes to "Select All" |
| 4.9 | Click Refresh | Grid re-scans and repopulates (detects newly added/removed folders) |
| 4.10 | Type/paste a path and press Enter | Scans the typed path |
| 4.11 | Close and reopen | Last-used path auto-loads, folder toggles restored per path |
| 4.12 | Hover Select All tooltip | Shows explanation in current language |
| 4.13 | Hover Refresh tooltip | Shows explanation in current language |

---

## 5. Source Panel — Date Range

| # | Test | Expected |
|---|------|----------|
| 5.1 | Click date picker for Start Date | Calendar opens, can select a date |
| 5.2 | Click date picker for End Date | Calendar opens, can select a date |
| 5.3 | Set start date after end date | Search still runs (searches empty range, returns no matches) |
| 5.4 | Leave both dates blank | No date range filter applied (all dates searched) |
| 5.5 | Hover date range tooltip | Shows explanation in current language |

---

## 6. Audit Panel — File Import

| # | Test | Expected |
|---|------|----------|
| 6.1 | Click Browse, select a CSV file | File loads, format badge shows "CSV", IMEI count displayed |
| 6.2 | Click Browse, select an XLSX file | File loads, format badge shows "Excel", IMEI count displayed |
| 6.3 | Click Browse, select a TXT file | File loads, format badge shows "TXT", IMEI count displayed |
| 6.4 | Drag and drop a CSV onto the dropzone | File loads same as Browse |
| 6.5 | Drag and drop an XLSX onto the dropzone | File loads same as Browse |
| 6.6 | Verify IMEI count accuracy | Count matches the number of unique 15-digit numeric entries in the file |
| 6.7 | Load file with invalid entries | Warning shows "N invalid entries skipped" |
| 6.8 | Load file with duplicate IMEIs | Warning shows "N duplicates found" |
| 6.9 | Load a malformed/empty file | Error message displayed, no crash |
| 6.10 | Verify file name displayed | "File:" row shows the loaded filename |
| 6.11 | Hover over dropzone while dragging | Dropzone border highlights, text changes to "Drop to import" |

---

## 7. Settings Panel

| # | Test | Expected |
|---|------|----------|
| 7.1 | Change Action dropdown (Copy/Move) | Selection updates |
| 7.2 | Change Image Type dropdown (Both/BMP/JPEG) | Selection updates |
| 7.3 | Open Organize dropdown | Custom dropdown opens with 6 options, each with description |
| 7.4 | Select each Organize option | Selected option highlights, dropdown closes, trigger button updates |
| 7.5 | Click outside open Organize dropdown | Dropdown closes |
| 7.6 | Change Duplicates dropdown (Skip/Overwrite) | Selection updates |
| 7.7 | Change Scan Index dropdown (All/First scan only) | Selection updates |
| 7.8 | Toggle MR PASS on/off | iOS-style toggle animates |
| 7.9 | Toggle MR FAIL on/off | iOS-style toggle animates |
| 7.10 | Toggle AI Images Only on/off | iOS-style toggle animates |
| 7.11 | Click Destination Browse | Folder picker opens, selected path appears |
| 7.12 | Hover every tooltip icon (7 total) | Each tooltip appears with readable text, correct language, no overlap with other panels |
| 7.13 | Verify Organize dropdown renders above Results panel | Dropdown not clipped or hidden behind panels below |

---

## 8. IMEI Search

| # | Test | Expected |
|---|------|----------|
| 8.1 | Load audit file + select folders, click Start Search | Progress bar appears, status bar shows current machine/date being scanned |
| 8.2 | Watch progress bar during search | Percent increases, shows "Scanning M8/20260515" style label |
| 8.3 | Watch progress sublabel | Shows "N/M folders · X matches" updating in real time |
| 8.4 | Wait for search to complete | Progress bar disappears, Results table populates, status bar shows summary |
| 8.5 | Verify status bar after search | Shows "Search complete · N IMEIs found · M matches · Xs" |
| 8.6 | Verify Results summary line | Shows "Found: X / Y IMEIs (Z total matches) · elapsed" |
| 8.7 | Verify green/orange/red dot counts | Green = complete, Orange = incomplete (low file count), Red = missing |
| 8.8 | Click Cancel Search mid-scan | Search stops, partial results shown |
| 8.9 | Start Search button shows "Cancel Search" during scan | Button turns red with cancel label |
| 8.10 | After cancel, Start Search button returns | Can run a new search |

---

## 9. Search — Date Range Filter

| # | Test | Expected |
|---|------|----------|
| 9.1 | Set start date to a recent date, leave end blank | Only date folders >= start date searched |
| 9.2 | Set end date, leave start blank | Only date folders <= end date searched |
| 9.3 | Set both start and end date | Only date folders within range searched |
| 9.4 | Set dates that exclude all data | Search completes with 0 matches, all IMEIs in missing list |

---

## 10. Search — Scan Index Filter

| # | Test | Expected |
|---|------|----------|
| 10.1 | Set Scan Index to "All", run search | Results include all scan indices (_1, _2, _3, etc.) |
| 10.2 | Set Scan Index to "First scan only", run search | Results only include _1 entries |
| 10.3 | Compare match counts between All and First | First scan only should have equal or fewer matches |

---

## 11. Results Panel

| # | Test | Expected |
|---|------|----------|
| 11.1 | Click IMEI column header | Rows sort by IMEI ascending; click again for descending |
| 11.2 | Click Machine column header | Rows sort by machine name |
| 11.3 | Click Date column header | Rows sort by date |
| 11.4 | Click Index column header | Rows sort by scan index (numeric) |
| 11.5 | Click Files column header | Rows sort by total file count |
| 11.6 | Verify sort arrow indicator | Active sort column shows ▲ or ▼ |
| 11.7 | Verify file count breakdown | Files column shows total with (Nb Nj) for bmp and jpeg counts |
| 11.8 | Click "View Missing IMEIs (N)" | Table switches to missing IMEI list in red text |
| 11.9 | Click "View Matches" | Table switches back to match results |
| 11.10 | Scroll results table | Table is scrollable when results exceed visible area |
| 11.11 | Hover over table rows | Row highlights on hover |

---

## 12. Action Buttons

| # | Test | Expected |
|---|------|----------|
| 12.1 | No audit + no folders selected | Start Search button disabled (dimmed) |
| 12.2 | Audit loaded + folders selected | Start Search button enabled |
| 12.3 | No search results | Export Results button disabled |
| 12.4 | After successful search with matches | Export Results button enabled |
| 12.5 | Click Clear | Audit result cleared, search results cleared, status returns to "Ready" |

---

## 13. Tooltips (Global)

| # | Test | Expected |
|---|------|----------|
| 13.1 | Hover any tooltip icon | Tooltip appears near icon, readable text on solid opaque background |
| 13.2 | Tooltip does not get cut off by panel edges | Portal renders at viewport level, always visible |
| 13.3 | Tooltip does not overlap other panels | z-index 10000, renders above everything |
| 13.4 | Move mouse away from tooltip icon | Tooltip disappears |
| 13.5 | Switch to Chinese and re-check all tooltips | All tooltip text in Chinese |

---

## 14. Panel Animations

| # | Test | Expected |
|---|------|----------|
| 14.1 | Launch app fresh | Panels fade/slide in sequentially (Source first, then Audit, Settings, Results) |
| 14.2 | Transitions are smooth | No jank, 200-300ms timing |

---

## 15. Edge Cases

| # | Test | Expected |
|---|------|----------|
| 15.1 | Select a folder with no date subfolders | Search completes quickly with 0 matches |
| 15.2 | Load an audit file with 0 valid IMEIs | IMEI count shows 0, Start Search disabled |
| 15.3 | Select shared folder that doesn't exist | Graceful error, no crash |
| 15.4 | Run search with all folders deselected | Start Search disabled |
| 15.5 | Run search on a very large folder set | Progress bar updates smoothly, app remains responsive |
| 15.6 | Load multiple audit files in sequence | Previous result replaced by new one each time |
| 15.7 | Run multiple searches in sequence | Previous results replaced, no stale data |

---

## Not Yet Testable (Future Milestones)

- **Export Summary Report** — color-coded CSV/Excel (Milestone 6b)
- **NSIS installer** — full install/uninstall (Milestone 12)
