# Image Collection v2

Desktop tool for bulk-collecting device images from NAS shared folders by IMEI number. Built for AGS production floor operators to parse audit lists and aggregate matching image folders.

## Tech Stack

- **Electron** — desktop shell, file system access, native dialogs
- **React + TypeScript** — UI components
- **Vite** — build tooling, hot module replacement
- **Liquid Glass UI** — translucent, frosted-glass themed interface (dark + light mode)

## Features

- Import audit lists (CSV, Excel, TXT) of 15-digit IMEIs
- Auto-scan NAS shared folders with toggleable subfolder selection
- Parallel IMEI matching across machine and date folders
- Configurable output organization (flat, by machine, by date, nested, by IMEI, by scan index)
- BMP / JPEG / Both image type filtering
- Model Recognition image toggle for bulk MR pulls
- Color-coded export summary report (green = complete, orange = incomplete, red = not found)
- Date range and scan index filters
- Multi-source support (multiple NAS/shared folder roots)
- Search history (last 5 searches with one-click re-run)
- Settings persistence with auto-refresh of folder lists on launch

## Documentation

| Document | Description |
|----------|-------------|
| [PRD](docs/PRD.md) | Product requirements — features, settings, behavior |
| [Architecture](docs/ARCHITECTURE.md) | Tech stack, services, IPC design, project structure |
| [UI Spec](docs/UI-SPEC.md) | Liquid Glass theme, layout, components, animations |
| [Milestones](docs/MILESTONES.md) | Development roadmap with stop-gap gates |
| [Directory Schema](docs/DIRECTORY-SCHEMA.md) | NAS folder hierarchy and naming conventions |

## Development

```bash
npm install
npm start        # Launch dev server + Electron
npm run build    # Production build
npm run package  # Create Windows installer
```

## Status

**In planning** — documentation complete, implementation not yet started. See [Milestones](docs/MILESTONES.md) for the development roadmap.

### Pending Items
- AutoMode functionality (awaiting v1 documentation)
- Rescan Image Collection tab (awaiting v1 documentation)
- MR image subfolder paths (awaiting screenshots)
- Additional coworker feature requests
