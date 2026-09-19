Author: https://sibansal.dev/

# OneSync — Technical Specifications

## 1. Technology Stack

| Layer | Component | Version / Specification | Rationale |
|---|---|---|---|
| **Runtime / Shell** | Electron | ≥ 33.3 (darwin-arm64) | Native Apple Silicon desktop support, hardened runtime, `safeStorage` macOS Keychain integration |
| **Language** | TypeScript | Strict Mode, Node ≥ 20 | Static type safety across IPC, models, and file operations |
| **Build Tooling** | `electron-vite` | 2.3+ | Fast HMR, split main/preload/renderer pipelines |
| **UI Layer** | React | 18.3, Plain CSS | Fast virtual DOM, zero heavy UI frameworks, native CSS variables |
| **Authentication** | `@azure/msal-node` | 2.16+ | OAuth 2.0 PKCE with local loopback listener |
| **API Client** | Native `fetch` | Microsoft Graph v1.0 | Lightweight, direct streaming, zero heavy SDK overhead |
| **Database** | `better-sqlite3` | 11.8+ | Synchronous, zero async locking overhead, rock-solid removable drive safety |
| **Validation** | `zod` | 3.24+ | Schema validation for environment and IPC payloads |
| **Logging** | `electron-log` | 5.2+ | File output at `~/Library/Logs/OneSync/main.log` with credential redaction |
| **Test Engine** | `vitest` | 2.1+ | Lightning-fast test runner with ESM and mock support |

---

## 2. Environment Variables

| Variable | Default | Purpose | Mode Restrictions |
|---|---|---|---|
| `MAIN_VITE_MS_CLIENT_ID` | `00000000-0000-0000-0000-000000000000` | Entra ID App Client ID | Required for auth |
| `MAIN_VITE_MS_AUTHORITY` | `https://login.microsoftonline.com/common` | OAuth authority endpoint | Standard multi-tenant |
| `MAIN_VITE_GRAPH_BASE_URL` | `https://graph.microsoft.com/v1.0` | Graph REST endpoint | v1.0 stable |
| `MAIN_VITE_SYNC_CONCURRENCY` | `4` | Concurrency worker pool limit | Min 1, Max 16 |
| `MAIN_VITE_MAX_RETRIES` | `5` | Retries per transient error | Min 1, Max 10 |
| `MAIN_VITE_RETRY_BASE_DELAY_MS` | `1000` | Base exponential backoff delay | Min 100 ms |
| `MAIN_VITE_MASS_MOVE_THRESHOLD` | `0.3` (30%) | Deletion move confirmation threshold | 0.01 – 1.0 |
| `MAIN_VITE_USE_MOCK_DRIVE` | `false` | Enables offline in-memory MockDrive | **Forbidden in production** |
| `MAIN_VITE_ALLOW_INTERNAL_DESTINATION` | `false` | Allows non-`/Volumes/` destinations | **Forbidden in production** |
| `MAIN_VITE_CUSTOM_ICON_PATH` | (empty) | Optional path to custom icon image | Supported in all modes |
| `MAIN_VITE_LOG_LEVEL` | `info` | File & console log verbosity | `debug`, `info`, `warn`, `error` |
| `RENDERER_VITE_APP_NAME` | `OneSync` | App display name | UI Header |
| `RENDERER_VITE_AUTHOR_URL` | `https://sibansal.dev/` | Author URL | App Footer & links |

---

## 3. Database Schema (`state.db`)

SQLite configuration: `journal_mode=DELETE`, `synchronous=NORMAL` (optimal safety against sudden disconnects on removable media).

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  is_folder INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  fingerprint TEXT,
  hash_type TEXT,
  remote_modified TEXT,
  seen_run INTEGER,
  local_path TEXT,
  local_size INTEGER,
  local_mtime_ms INTEGER,
  synced_fingerprint TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  synced_at INTEGER
);

CREATE INDEX idx_items_parent ON items(parent_id);
CREATE INDEX idx_items_status ON items(status);

CREATE TABLE restored_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_path TEXT NOT NULL,
  restored_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  moved_at INTEGER NOT NULL
);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  downloaded INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  restored INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0,
  bytes INTEGER DEFAULT 0
);
```

---

## 4. Graph Endpoints & Handling

### Endpoints
- `GET /me`: Account profile (id, displayName, userPrincipalName).
- `GET /me/drive`: Root drive quota (`quota.used`, `quota.total`).
- `GET /me/drive/root/children`: Enumeration of root folders for source directory picker.
- `GET /me/drive/root/delta?$select=id,name,size,file,folder,parentReference,deleted,lastModifiedDateTime,eTag,cTag,package,remoteItem,root`: Delta changes tracking across entire drive.
- `GET /me/drive/root:/{folder}:/delta?$select=...`: Scoped delta query when a specific source folder is selected.
- `GET /me/drive/items/{id}?$select=id,@microsoft.graph.downloadUrl`: Pre-download direct link retrieval.

### Gotchas & Defenses
- **Source Folder Scoping:** When a single directory is selected (e.g. `/Documents`), Graph API is queried via `GET /me/drive/root:/Documents:/delta`. Changing source folder resets `delta_link` to initiate a full re-scan of the new folder.
- **Job ID Tracking:** Every sync job is assigned an incremental `Job #<id>` tied directly to `sync_runs.id`. This Job ID is included in `SyncState` and `SyncProgress` and surfaced across all logs and UI views.
- **Paging:** Delta tokens are saved only after traversing all `@odata.nextLink` until `@odata.deltaLink`.
- **Missing Paths:** `parentReference.path` is omitted in delta tokens; relative paths are reconstructed via in-memory parent-id walking.
- **Hierarchy Out-of-Order:** Children may be listed before parents; rows are upserted first, and path derivation occurs during planning.
- **410 Gone:** Delta link expired. Treated by clearing `delta_link` and executing a full enumeration using `seen_run` reconciliation.
- **Pre-authenticated Download URLs:** Download URLs expire in ~1 hour. Always fetched immediately prior to initiating download and requested **without** Authorization headers.
- **Throttling:** HTTP 429 and 503 responses respect `Retry-After` headers via a global shared resume gate across all workers.
- **App Identification:** Sent with header `User-Agent: ISV|sibansal.dev|OneSync/1.0.0`.

---

## 5. Sync Decision Matrix

Definitions:
- `P`: Desired local relative path in `onedrive/`
- `L`: On-disk stat representation at `P`
- `D`: Recorded DB row state for item
- **Fingerprint**: `hash ?? cTag ?? eTag`
- **Healthy**: Regular file, `size == D.local_size`, and `abs(mtime - D.local_mtime_ms) <= 2000 ms`
- **Pre-existing Health Check**: For files present on disk without a prior DB record (`!hasDbRecord`), health is verified via: matching size + physical block allocation (`blocks > 0` or undefined) + fast sub-millisecond boundary seek & read probe (`probeFileReadable` reading head 4 KB and tail 4 KB in < 0.2 ms regardless of size, even on files > 10 GB). This probe executes **exclusively on pre-existing files**, avoiding any disk I/O overhead on files already synced and tracked in the database.

| # | Situation | Action |
|---|---|---|
| 1 | `status = failed_permanent` and fingerprint unchanged | `SKIP` (report in Failed tab) |
| 2 | `status = failed`, `next_retry_at` in future, run not forced | `SKIP` (report as waiting) |
| 3 | `D.local_path ≠ P`, old file exists & healthy, fingerprint unchanged | `RENAME` old → `P` |
| 4 | `P` is a directory on disk (type conflict) | Move to `restored/` (`type_conflict`), then `DOWNLOAD` |
| 5 | `L` missing on disk | `DOWNLOAD` |
| 6 | `L` exists, fingerprint unchanged, healthy | `SKIP` |
| 7 | `L` exists, fingerprint unchanged, size matches, mtime differs | Hash-verify `L`: match → update DB (`SKIP`); mismatch → move to `restored/` (`local_modified`), then `DOWNLOAD` |
| 8 | `L` exists, fingerprint changed, `L` matches `D` (unmodified locally) | `DOWNLOAD` (atomic replacement) |
| 9 | `L` exists, fingerprint changed and `L` differs from `D`, or size/hash mismatch | Move to `restored/` (`local_modified`), then `DOWNLOAD` |
| 10 | `L` exists but no DB record (pre-existing file in dir) | If healthy (matching size, non-hollow block allocation, and passing head+tail boundary probe): mark as `SKIP` (recorded in DB as `synced`, no action on file); if mismatch or unreadable: move to `restored/` (`untracked_conflict`), then `DOWNLOAD` |

---

## 6. Download Procedure & Hash Verification

1. Verify destination free space ≥ `item.size + 104857600` (100 MB reserve).
2. Fetch fresh pre-signed download URL.
3. Destination temporary file: `.onesync/tmp/<itemId>-<fingerprintPrefix8>.part`.
4. Resumption check: If `.part` exists and `0 < current_size < item.size`, resume via `Range: bytes=<current_size>-`. If server responds `200 OK` instead of `206 Partial Content`, truncate file and restart.
5. Stream bytes via `stream/promises.pipeline` directly to disk, feeding incremental hash calculators (`quickXorHash`, `sha1`, `sha256`).
6. Validate total byte count against expected size. Validate calculated hash against remote hash.
7. Update modified time with `fs.utimes(partPath, remoteModified, remoteModified)`.
8. Atomically move `.part` file to final `onedrive/<P>` using `fs.rename`.
9. Update SQLite row in a single immediate transaction.

---

## 7. Error Taxonomy & Handling

| Error Code | Retriable | Action & Strategy |
|---|---|---|
| `NETWORK`, `SERVER_5XX` | Yes | In-file retry: `min(1000 · 2ⁿ, 60000) + jitter`, up to 5 attempts |
| `THROTTLED` | Yes | Global gate waits `Retry-After` seconds before resuming any downloads |
| `AUTH_EXPIRED` | Once | Silent refresh; on failure, enter run-level pause waiting for user sign-in |
| `DOWNLOAD_URL_EXPIRED` | Yes | Re-fetch fresh URL and resume download at current byte offset |
| `HASH_MISMATCH`, `SIZE_MISMATCH` | Yes | Delete partial file, re-download from byte 0 |
| `REMOTE_NOT_FOUND` | No | Item deleted on OneDrive during sync run; skip and await next delta |
| `FORBIDDEN` | No | Mark as `failed_permanent` until remote fingerprint alters |
| `DISK_FULL` (`ENOSPC`) | No | Immediate run-level pause with banner, retains valid downloads |
| `DRIVE_DISCONNECTED` | No | Immediate run-level pause, retains temporary parts, monitors `/Volumes` |
| `FS_LIMIT`, `PATH_TOO_LONG` | No | Mark as `failed_permanent` with descriptive feedback |

---

## 8. Filesystem Compatibility

- **APFS:** Native macOS filesystem, full support for nanosecond timestamps, extended attributes, and UTF-8 NFC unicode paths.
- **exFAT:** Coarse timestamps (2-second granularity, compensated by ±2 s tolerance window), supports large files (> 4 GiB).
- **FAT32:** 4 GiB single-file limit. Files exceeding 4 GiB trigger `FS_LIMIT` permanent failure with user instruction to reformat.
- **NTFS:** Read-only by default on macOS. Write probe detects and blocks destination setup.

---

## 9. Performance Targets
- **Planning Scale:** Plan 100,000 files from SQLite in < 10 seconds.
- **Local Stat Batches:** Scan 100,000 local files using concurrent batches (32 files per batch) in < 60 seconds.
- **Memory Footprint:** Peak RSS < 300 MB throughout multi-hour downloads.
- **UI Responsiveness:** Progress event updates throttled to ≤ 4 fps to prevent IPC flooding.

---

## 10. Security Model
- **Process Isolation:** Renderer runs with `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- **Content Security Policy (CSP):** Disallows inline scripts and external origins (except Google Fonts and local IPC).
- **Credential Storage:** MSAL tokens stored in `userData/token-cache.bin` encrypted via `safeStorage` (backed by macOS Keychain).
- **URL Whitelist:** `shell.openExternal` restricted strictly to `https://sibansal.dev/` and `https://login.microsoftonline.com/`.

---

## 11. Decisions Log

1. **Hash Verification Precedence:** When remote metadata supplies multiple hashes, verification checks `sha256Hash` first, then `sha1Hash`, then `quickXorHash`.
2. **Path Sanitization Format:** Control characters, invalid characters (`: * ? " < > | \`), and trailing spaces/periods are stripped or replaced with `_`. When two cloud items collide after sanitization, a deterministic suffix ` (<first 6 chars of item id>)` is appended before the extension.
3. **Power Management:** Uses Electron `powerSaveBlocker.start('prevent-app-suspension')` throughout active sync runs to prevent macOS sleeping mid-download.
4. **Volume Polling Frequency:** When the configured external destination is missing, `/Volumes` is polled every 3,000 ms.
5. **Zero-Byte File Handling:** Zero-byte files are touched locally via `fs.openSync` without making outbound download requests.
6. **Database Corruption Recovery:** If `state.db` fails initialization or SQLite `integrity_check`, the corrupted file is renamed to `state.db.corrupt-<timestamp>` and a fresh database is created. Local files already present in `onedrive/` are adopted by fingerprint match without re-downloading.
7. **Preflight Mount Verification:** Drive mount check (`verifyMounted`) and write probe execute prior to SQLite database creation to avoid creating orphaned directories on `/Volumes` if the external drive is detached.
8. **Test Execution Environment:** To guarantee 100% binary ABI compatibility with native modules compiled for Electron (`better-sqlite3`), Vitest runs inside Electron's Node runtime via `ELECTRON_RUN_AS_NODE=1 electron ./node_modules/vitest/vitest.mjs run`.
9. **Custom App Icon Resolution:** Supports custom icon via `MAIN_VITE_CUSTOM_ICON_PATH`, `build/icon.png`, or `build/icon.icns`. Sets macOS dock icon dynamically on startup.
10. **Frameless Window Draggability:** To ensure seamless macOS window movement with `titleBarStyle: 'hiddenInset'`, a dedicated `.app-titlebar` is positioned at the top of `App.tsx` with `-webkit-app-region: drag` and 78px padding for traffic lights, while interactive controls use `.no-drag`.
11. **IPC Idempotency & Safe Registration:** Electron throws uncaught exceptions if `ipcMain.handle()` is invoked for an already registered channel (e.g. upon window recreation or reactivation). All IPC handlers are registered idempotently using `safeHandle()` with module-level service singletons and dynamic `activeMainWindow` rebinding.
12. **Explicit Cancel & Restart:** Cancelling a sync marks the run status explicitly as `'cancelled'`, cleanly halts stream pipelines and abort controllers without retry penalties, and enables a dedicated '↻ Restart Sync' action on the dashboard.
13. **Local Database Clearing:** Added explicit database clearing to re-index files from scratch without touching any synced data on disk or in the cloud.
14. **Window Geometry & Dynamic Console Height:** The main window opens at `1024 x 840 px` with an enforced minimum height of `800 px` (`width: 900, minHeight: 800`) to guarantee ample viewports for activity logs and tables. The lower Activity Console section utilizes dynamic flex layout (`flex: 1 1 auto`) to expand downwards and claim all available vertical window space.
15. **Async Cancellation Teardown & State Querying:** Sync engine exposes `cancelSyncAndWait(): Promise<void>` so the cancellation IPC handler awaits complete pipeline termination before replying. The engine's `finally` block guarantees an authoritative dispatch of `onStateChange({ isRunning: false, isCancelled: true })`. On window mount or refresh, the UI queries live state via `window.onesync.getSyncState()`, preventing desynchronization and ensuring the restart button is always surfaced cleanly.
16. **User-Toggled System Sleep Prevention (Keep Awake):** Users can toggle system sleep prevention at any time via a dedicated sun icon button in the header next to the settings button. When active (glowing yellow/amber sun), Electron's `powerSaveBlocker` activates with `'prevent-app-suspension'`, preventing macOS from suspending or sleeping while syncing or idling (allowing screens to sleep). The toggle state is persisted in `settings.json` across restarts, loaded on launch, and cleaned up on application exit (`app.on('will-quit')`). Hovering over the button displays an informative tooltip indicating the current sleep prevention status.
17. **Preexisting File Preservation & Orphan Sweep Equivalence Guard:** When a file is present on disk in `onedrive/` but not yet indexed in `state.db` (e.g. after database clearing or fresh setup), the planner directly marks matching files as `SKIP` without moving or downloading duplicates. In Stage 5 (Sweep), `sweepOrphans` utilizes case-insensitive path comparison (matching APFS case-preserving behavior on macOS) and evaluates an equivalence guard against discovered cloud items: any preexisting file whose relative path and file size match an item on OneDrive is preserved in place and marked as synced in the database rather than being moved to `restored/`. Root folder references in Microsoft Graph API delta payloads are normalized with `parentId: null` and excluded from path segment prepending.

