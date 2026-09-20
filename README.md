Author: https://sibansal.dev/

# OneSync

> A high-performance macOS (Apple Silicon) desktop application that mirrors OneDrive to an external drive with atomic safety, zero cloud-deletion risks, and portable SQLite state tracking.

[![Author](https://img.shields.io/badge/Author-sibansal.dev-blue)](https://sibansal.dev/)
[![Platform](https://img.shields.io/badge/Platform-macOS%20arm64-black)](https://apple.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Features

- **Strict One-Way Mirroring:** Only reads from OneDrive (`Files.Read`, `User.Read`, `offline_access`). Never uploads, edits, or deletes anything in your cloud OneDrive.
- **Flexible Source Selection:** Mirror your entire OneDrive root (`/`) or select a single directory (e.g. `/Documents`) directly from the dashboard.
- **Job ID Tracking & History:** Every synchronization run is tracked with a unique incremental Job ID (`Job #1`, `Job #2`, ...) displayed across real-time progress, logs, and history tables.
- **Instant Cancel & Restart:** Clean, instantaneous cancellation without retry loops, with a prominent "↻ Restart Sync" button to resume immediately.
- **Clear Database & Re-index:** Reset local SQLite tracking index (`state.db`) at any time to perform a complete re-scan without deleting existing disk files.
- **Data Protection Guarantee:** Local files are never deleted. Anything removed from OneDrive or locally modified is safely moved to `<SelectedFolder>/restored/`.
- **Atomic Downloads & Resumption:** Files are downloaded into `<SelectedFolder>/.onesync/tmp/*.part`, verified via cryptographic hashes (SHA-256, SHA-1, QuickXorHash), and atomically renamed. Broken downloads resume with HTTP Range requests.
- **External Volume Verification:** Checks that destinations are genuinely mounted external drives under `/Volumes/` with a distinct filesystem device (`stat.dev`), preventing accidental filling of internal storage.
- **Drive-Portable SQLite Database:** Sync state is recorded in `<SelectedFolder>/.onesync/state.db` using crash-safe synchronous modes, traveling with your external drive.
- **Modern Dynamic Layout:** Designed for macOS with dark aesthetics, minimum 800 px window height, and dynamic downward expansion for activity console logs and audit tables.
- **Prevent System Sleep (Keep Awake):** Toggle system sleep prevention right from the dashboard header with a single click. When active (yellow sun), Electron `powerSaveBlocker` keeps macOS awake during long sync sessions.
- **Apple Silicon Optimized:** Native `darwin-arm64` binary with hardened runtime and macOS Keychain integration via Electron `safeStorage`.


---

## 📦 Installation

Install the latest OneSync release directly on macOS Apple Silicon without Gatekeeper warnings:

```bash
curl -fsSL https://raw.githubusercontent.com/sibansal/onesync/release/v1.0.0-beta.1/scripts/install.sh | bash
```

*This downloads the latest Apple Silicon release, installs `OneSync.app` into `/Applications`, and automatically removes the macOS browser quarantine attribute.*

---

## ⚙️ Requirements

- macOS Apple Silicon (M1/M2/M3/M4)
- Node.js ≥ 20 (specified in `.nvmrc` for development)
- External drive formatted as APFS or exFAT (FAT32 supported with 4 GiB single-file limit)
- Azure Application Client ID (Microsoft Entra ID Public Client)

---

## 🚀 Development & Build

1. **Clone repository and setup Node:**
   ```bash
   git clone https://github.com/sibansal/onesync.git
   cd onesync
   nvm use
   npm install
   ```

2. **Configure Environment:**
   ```bash
   cp .env.example .env.development
   ```
   Configure your Microsoft Client ID in `.env.development`:
   ```ini
   MAIN_VITE_MS_CLIENT_ID=your-azure-client-id-here
   ```
   *(See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for step-by-step Azure App Registration instructions).*

3. **Run in Development Mode:**
   ```bash
   npm run dev
   ```

---

## 📜 Available Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Starts application in development mode with hot module replacement |
| `npm run build` | Compiles main, preload, and renderer bundles for production |
| `npm run typecheck` | Validates TypeScript types across node and web workspaces |
| `npm run lint` | Runs ESLint analysis on all code files |
| `npm run format` | Auto-formats codebase using Prettier |
| `npm test` | Runs unit and integration test suite via Vitest |
| `npm run check` | Runs full suite: typecheck, lint, and test |
| `npm run postinstall` | Rebuilds native `better-sqlite3` bindings for Electron arm64 |
| `npm run pack` | Packages unpacked application directory for rapid smoke testing |
| `npm run dist:mac` | Builds production Apple Silicon DMG and ZIP bundles in `dist/` |
| `npm run release:mac` | Production release pipeline: check, build, sign, notarize, checksum |

---

## 📁 Project Layout

```
onesync/
├─ src/
│  ├─ main/
│  │  ├─ index.ts                 # App lifecycle, window, single-instance lock
│  │  ├─ ipc.ts                   # Type-safe IPC handlers with Zod validation
│  │  ├─ config.ts                # Immutable configuration with runtime verification
│  │  ├─ logger.ts                # Electron logger with token & URL redaction
│  │  ├─ settingsStore.ts         # User preferences store in userData
│  │  ├─ auth/                    # MSAL Public Client and safeStorage Keychain cache
│  │  ├─ onedrive/                # RemoteDrive interface, Graph API, MockDrive
│  │  ├─ db/                      # SQLite schema, migrations, items/meta repos
│  │  ├─ sync/                    # Engine, pure planner, downloader, sweeper
│  │  ├─ fs/                      # Volume verification, path sanitization, safe moves
│  │  └─ utils/                   # QuickXorHash, exponential backoff, worker pool
│  ├─ preload/index.ts            # Secure contextBridge API (`window.onesync`)
│  ├─ renderer/                   # React 18 UI (Screens, components, hooks, styles)
│  └─ shared/                     # Shared types and IPC channel identifiers
├─ tests/                         # Vitest test suite (E1–E18 scenarios, planner, etc.)
├─ docs/                          # Comprehensive technical & architectural docs
└─ electron-builder.yml           # macOS packaging and hardened runtime config
```

---

## 🔄 How Sync Works in 6 Steps

1. **Preflight Check:** Confirms the external volume is mounted, writable, and not the root device (`/`). Verifies the SQLite database integrity and validates that the folder belongs to the active account.
2. **Discover Changes:** Queries Microsoft Graph Delta API (`/me/drive/root/delta`) across pages to retrieve new, changed, or deleted items, updating the local catalog.
3. **Pure-Function Planning:** Evaluates the 10-row decision matrix comparing remote state, local disk stat snapshot, and previous sync records without side effects.
4. **Concurrent Atomic Download:** Downloads missing or modified files concurrently (sorted smallest-first) into `.onesync/tmp/*.part`, hashes content on the fly, verifies size and integrity, and atomically moves to `onedrive/`.
5. **Safe Orphan Sweeping:** Moves files on the disk that no longer exist on OneDrive into `<SelectedFolder>/restored/` with collision prevention, leaving ignore lists intact.
6. **Persistence & Finish:** Updates sync metadata, run logs, and releases power suspension locks.

---

## ❓ Troubleshooting & FAQ

- **Volume fails write test:** If your drive is NTFS, macOS mounts it as read-only by default. Reformat to APFS or exFAT.
- **Large file fails on FAT32:** Files ≥ 4 GiB cannot be stored on FAT32 volumes. Format the drive as exFAT or APFS.
- **Missing tokens or authentication error:** Clear `~/Library/Application Support/onesync/token-cache.bin` to restart fresh.
- **Where are logs located?** Log files are maintained at `~/Library/Logs/OneSync/main.log`.

---

## 📚 Documentation

- [Product Specifications](docs/PRODUCT_SPECS.md)
- [Technical Specifications & Decisions](docs/TECHNICAL_SPECS.md)
- [Architecture & State Machine](docs/ARCHITECTURE.md)
- [Deployment & Code Signing Guide](docs/DEPLOYMENT.md)

---

## 📄 License & Author

Created by **[sibansal.dev](https://sibansal.dev/)**. Released under the [MIT License](LICENSE).
