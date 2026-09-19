Author: https://sibansal.dev/

# OneSync — Product Specifications

## 1. Problem Statement
Cloud storage services like Microsoft OneDrive offer massive storage capacity, but users with large media libraries, backups, or project archives face limited internal Mac SSD storage. Existing cloud synchronization tools often synchronize two-way (introducing deletion risks from accidental cloud removals), synchronize into internal user directories, or lack resilience when removable drives are unplugged. 

OneSync provides a bulletproof, **one-way mirror** of OneDrive onto an external volume (SSD, HDD, SD card), preserving local files even if they disappear from the cloud, and ensuring zero data corruption or unverified overwrites.

---

## 2. Personas
- **The Media Creator / Archivist:** Has hundreds of gigabytes of videos, raw photos, and audio files on OneDrive and wants a local physical clone on an external SSD without clogging their 256 GB / 512 GB MacBook internal drive.
- **The Security-Conscious Professional:** Demands that local files are never permanently deleted by automated cloud sync operations and needs transparent visibility into modified or conflicting files.
- **The Offline Traveler:** Requires an exact, read-only mirror of their OneDrive documents ready on an external disk before traveling without internet access.

---

## 3. Goals & Non-Goals

### Goals
- Maintain a faithful mirror of OneDrive root in `<SelectedFolder>/onedrive/`.
- Guarantee zero data loss: Any file no longer on OneDrive or altered locally is moved to `<SelectedFolder>/restored/`.
- Portability: Sync state database (`state.db`) resides on the external drive itself, allowing the drive to be moved between Macs.
- Safety: Explicit external volume detection, write probe validation, and mass-move guardrails.
- High Performance: Streaming transfers, concurrent multi-file downloads, range resumption, and inline cryptographic verification.

### Non-Goals
- Two-way sync: OneSync never uploads, edits, or deletes cloud files on OneDrive.
- Web interface or mobile companion app.
- Syncing OneDrive for Business SharePoint libraries or SharePoint sites (V1 focuses on personal / work OneDrive root).
- Background system daemon running as root.

---

## 4. User Stories & Acceptance Criteria

### US-1: Connect Microsoft Account
- **As a** user,
- **I want to** securely authenticate with my Microsoft OneDrive account using my default browser,
- **So that** I don't have to enter credentials into untrusted embedded webviews.
- **Acceptance Criteria:**
  - Clicking "Connect to OneDrive" launches the system default browser via OAuth 2.0 PKCE.
  - Redirect loopback receives the auth code, retrieves delegated tokens (`Files.Read`, `User.Read`, `offline_access`), and securely stores them in the macOS Keychain via Electron `safeStorage`.
  - Upon success, the UI transitions to destination selection.

### US-2: Select and Validate Destination
- **As a** user,
- **I want to** pick a folder on my external drive and have OneSync verify its suitability,
- **So that** I don't accidentally sync to internal storage or a read-only partition.
- **Acceptance Criteria:**
  - File picker opens directly in `/Volumes`.
  - Validation performs 5 automated checks: external volume check, distinct device check (`stat.dev`), write probe test, free space vs OneDrive quota check, and filesystem inspection (`diskutil info -plist`).
  - Blocks setup if the destination already contains an existing OneSync database associated with a different account.

### US-3: Live Dashboard & Controls
- **As a** user,
- **I want to** observe real-time sync progress, download speeds, and active file transfers,
- **So that** I can track synchronization and control execution.
- **Acceptance Criteria:**
  - Displays unique Job ID (e.g., `Job #1`, `Job #2`), phase indicator, files completed/total, bytes completed/total, transfer speed, and ETA.
  - Shows up to 8 concurrently active downloads with individual progress bars.
  - Action buttons: "Sync now", "Pause", "Resume", "Cancel", and "↻ Restart Sync" when cancelled.
  - Dedicated tabs for Activity logs, Failed items, Restored files, and Run history (with Job IDs and cancelled run status).

### US-4: Select OneDrive Source Folder
- **As a** user,
- **I want to** mirror either my entire OneDrive or choose a single specific directory (e.g., `/Documents`),
- **So that** I only download what I need without synchronizing unwanted cloud folders.
- **Acceptance Criteria:**
  - Can browse and select root OneDrive folders or input a custom directory path.
  - Switching source resets the delta link and accurately restricts the sync mirror to the chosen directory.

### US-5: Clear Database & Reset Index
- **As a** user,
- **I want to** clear my local sync database (`state.db`),
- **So that** I can start a fresh index scan from scratch without deleting existing files on disk.
- **Acceptance Criteria:**
  - Available in Settings menu (`⚙`).
  - Confirms action with user, closes and recreates fresh `state.db`, and resets pending sync state.

### US-6: Prevent System Sleep (Keep Awake)
- **As a** user,
- **I want to** toggle system sleep prevention directly from the dashboard header,
- **So that** my Mac stays awake during large file transfers without going into sleep mode.
- **Acceptance Criteria:**
  - Dedicated sun icon button placed directly adjacent to the settings button (`⚙`).
  - When enabled, the sun icon illuminates in radiant yellow/amber with an active glow, keeping the system awake via Electron's `powerSaveBlocker` (`prevent-app-suspension`).
  - When disabled, the sun icon is rendered in neutral outline style, allowing standard macOS power saving and sleep.
  - Hovering over the button displays an informative tooltip indicating the current sleep prevention status.
  - Preference persists across application restarts in `settings.json`.

---

## 5. Screen Specifications & States

```
+-----------------------------------------------------------------+
|                        SCREEN FLOW                              |
|                                                                 |
|   +------------------+     OAuth      +---------------------+   |
|   | 1. ConnectScreen | -------------> | 2. DestinationScreen|   |
|   +------------------+                +---------------------+   |
|                                                  |              |
|                                          Valid   v              |
|                                       +---------------------+   |
|                                       | 3. DashboardScreen  |   |
|                                       +---------------------+   |
+-----------------------------------------------------------------+
```

### Screen 1: Connect
- **Idle State:** Shows OneSync logo, explanation, and "Connect to OneDrive" button.
- **Pending State:** Shows "Waiting for browser sign-in..." with spinner and "Cancel" button.
- **Error State:** Displays user-friendly error message (e.g., timeout, network drop) and "Try Again" button.

### Screen 2: Choose Destination
- **Account Summary:** Displays user name, email, and OneDrive quota (used vs total).
- **Folder Picker:** Native folder selector button defaulting to `/Volumes`.
- **Validation Checklist:**
  - ✔ Volume is external (`/Volumes/...`)
  - ✔ Distinct device from root filesystem
  - ✔ Writable filesystem (tested via write-probe)
  - ✔ Filesystem type (APFS / exFAT / FAT32)
  - ✔ Available free space vs OneDrive size
  - ✔ OneSync state database status
- **CTA:** "Start syncing" button enabled only when all mandatory checks pass.

### Screen 3: Dashboard
- **Window Geometry:** Defaults to 1024 × 840 px with an enforced minimum height of 800 px (and 900 px width), ensuring activity console tables dynamically expand downwards to utilize the full available height.
- **Header:** Account details, destination path, volume status indicator (green dot when connected, red when missing), last sync timestamp, and single directory source selector (`Entire OneDrive (/)` or specific directory).
- **Control Bar:** Primary sync actions ("Sync now", "Pause/Resume", "Cancel", and "↻ Restart Sync" upon cancellation). Includes a "Cancelling..." transitional state while pipeline teardown completes.
- **Metrics Bar:** Counters for Downloaded, Already up to date, Moved to restored, and Failed items.
- **Active Streams:** Real-time transfer list (up to 8 files) with instantaneous speeds and per-job ID indicator (`Job #<id>`).
- **Tabbed Inspector:**
  - **Activity:** Ring buffer of latest 200 system log messages with downward-expanding console height.
  - **Failed:** Table of failed items with failure reason, retry count, and "Retry failed" button.
  - **Restored:** Chronological audit log of files moved to `restored/` with "Show in Finder" action.
  - **History:** List of previous sync runs with Job ID, timestamp, duration, bytes synced, and colored status badges (`COMPLETED`, `CANCELLED`, `FAILED`).


---

## 6. Edge Cases & Expected Behaviors

| Edge Case | Expected System Behavior |
|---|---|
| **Drive unplugged mid-sync** | Sync halts instantly with run-level pause, displays warning banner "Connect your drive", retains `.part` files, and automatically resumes once drive is re-attached. |
| **FAT32 4 GiB limit exceeded** | Marks file as permanently failed with `FS_LIMIT` error; provides message advising formatting as APFS/exFAT. Continues sync for remaining files. |
| **OneDrive reports 0 files with non-empty local DB** | Triggers empty-listing guard, halts sync, and displays protective alert preventing local disk wipe. |
| **Mass-move triggered (>30% files deleted)** | Pauses run, opens confirmation dialog detailing number of items to be moved to `restored/`, and proceeds only upon explicit user consent. |
| **Network disconnection during transfer** | Uses exponential backoff with jitter up to `MAX_RETRIES`. If retries exhaust, marks file for next sync cycle without halting other transfers. |
| **User modified file locally** | Detected by modified mtime/size or hash mismatch. Original local file is preserved by moving to `restored/` (`local_modified`), and fresh cloud file is downloaded. |
| **Pre-existing local files in destination dir** | If a file exists in the destination folder before being added to DB and is healthy (matching size, non-hollow block allocation, and verified via a fast boundary seek & read probe of head 4 KB + tail 4 KB taking < 0.2 ms even for files > 10 GB), it is marked as skipped with no action taken on the file. This health probe is evaluated exclusively on pre-existing files to ensure zero disk overhead on files already synced. During Stage 5 (Sweep), any existing local file matching a OneDrive cloud item (including case-insensitively on macOS APFS) is verified with this fast health check and preserved in place as synced rather than swept to `restored/`. Only genuinely unmapped, corrupted, or mismatched files are moved to `restored/`. |
| **Application reboot with saved source folder** | Restoring saved settings on reboot compares against the persisted `source_folder` in `state.db`. If the source folder has not changed, the catalog and delta link remain untouched, preventing unexpected database wipes or mass moves to `restored/`. |
| **Different OneDrive account on same drive folder** | Detects mismatched `meta.account_id` in `state.db`. Refuses to start sync to prevent account data interleaving. |

---

## 7. Success Metrics
- **Zero Accidental Data Loss:** 0 reported incidents of local user files being deleted.
- **Sync Reliability:** > 99.5% completion rate across runs under normal network conditions.
- **Scan Latency:** Planning time for 50,000 files completes under 5 seconds.
- **Resource Footprint:** Memory footprint (RSS) stays under 250 MB during full multi-gigabyte transfers.

---

## 8. Product Roadmap
- **v1.1:** Auto-sync trigger on external drive mount.
- **v1.2:** Menu-bar mini-dashboard and system notifications.
- **v1.3:** Multi-folder selective sync configuration.
- **v1.4:** Support for shared OneDrive folders and organizational SharePoint document libraries.
- **v2.0:** Multi-account profiles and automated background scheduling.
- **v2.1:** Cross-platform support for Windows and Linux external storage.
