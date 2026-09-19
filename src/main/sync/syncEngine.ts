import { powerSaveBlocker } from 'electron';
import { join } from 'path';
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import type { RemoteDrive } from '../onedrive/remoteDrive';
import { AppDatabase } from '../db/database';
import { MetaRepo } from '../db/metaRepo';
import { ItemsRepo } from '../db/itemsRepo';
import { RestoredLogRepo, SyncRunsRepo } from '../db/logRepo';
import { resolveItemPaths } from '../fs/paths';
import { verifyMounted, testWritable, getFilesystemType, getAvailableSpace } from '../fs/volume';
import { statLocalBatch } from './localScanner';
import { planSync, type LocalSnapshotItem } from './planner';
import { executePlan } from './executor';
import { sweepOrphans } from './orphanSweeper';
import { config } from '../config';
import { logger } from '../logger';
import { SyncError } from '../utils/errors';
import type {
  SyncState,
  SyncProgress,
  SyncLogEntry,
  SyncPhase,
  DriveStatus,
  AccountInfo
} from '../../shared/types';

export interface SyncEngineListeners {
  onStateChange: (state: SyncState) => void;
  onProgress: (progress: SyncProgress) => void;
  onLog: (entry: SyncLogEntry) => void;
  onDriveStatus: (status: DriveStatus) => void;
}

export class SyncEngine {
  private baseFolder: string | null = null;
  private account: AccountInfo | null = null;
  private remoteDrive: RemoteDrive;
  private listeners: SyncEngineListeners;

  private appDb: AppDatabase | null = null;
  private metaRepo: MetaRepo | null = null;
  private itemsRepo: ItemsRepo | null = null;
  private restoredLogRepo: RestoredLogRepo | null = null;
  private syncRunsRepo: SyncRunsRepo | null = null;

  private currentPhase: SyncPhase = 'idle';
  private isRunning = false;
  private isPaused = false;
  private prePausedPhase: SyncPhase = 'scanning';
  private isWaitingMassMove = false;
  private pendingMassMoveResolve: ((allow: boolean) => void) | null = null;
  private pendingMovesCount = 0;

  private abortController: AbortController | null = null;
  private powerSaveBlockerId: number | null = null;
  private currentProgress: SyncProgress;

  private async checkPauseAndCancel(): Promise<void> {
    if (this.abortController?.signal.aborted) {
      throw new SyncError({
        code: 'CANCELLED',
        message: 'Sync was cancelled by user',
        retriable: false
      });
    }

    if (this.isPaused) {
      while (this.isPaused && !this.abortController?.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (this.abortController?.signal.aborted) {
      throw new SyncError({
        code: 'CANCELLED',
        message: 'Sync was cancelled by user',
        retriable: false
      });
    }
  }

  constructor(remoteDrive: RemoteDrive, listeners: SyncEngineListeners) {
    this.remoteDrive = remoteDrive;
    this.listeners = listeners;
    this.currentProgress = this.createEmptyProgress();
  }

  public setDestination(folderPath: string | null): void {
    this.baseFolder = folderPath;
    if (this.appDb) {
      this.appDb.close();
      this.appDb = null;
    }
  }

  public setAccount(account: AccountInfo | null): void {
    this.account = account;
  }

  public setRemoteDrive(drive: RemoteDrive): void {
    this.remoteDrive = drive;
  }

  public getState(): SyncState {
    return {
      phase: this.currentPhase,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isWaitingMassMove: this.isWaitingMassMove,
      pendingMovesCount: this.pendingMovesCount,
      error: null
    };
  }

  public getProgress(): SyncProgress {
    return { ...this.currentProgress };
  }

  public getDb(): {
    itemsRepo: ItemsRepo;
    restoredLogRepo: RestoredLogRepo;
    syncRunsRepo: SyncRunsRepo;
  } {
    this.ensureDatabase();
    return {
      itemsRepo: this.itemsRepo!,
      restoredLogRepo: this.restoredLogRepo!,
      syncRunsRepo: this.syncRunsRepo!
    };
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    logger[level](message);
    this.listeners.onLog({
      timestamp: Date.now(),
      level,
      message
    });
  }

  private setPhase(phase: SyncPhase, error: string | null = null): void {
    this.currentPhase = phase;
    this.currentProgress.phase = phase;
    this.listeners.onStateChange({
      phase,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isWaitingMassMove: this.isWaitingMassMove,
      pendingMovesCount: this.pendingMovesCount,
      error
    });
  }

  private createEmptyProgress(): SyncProgress {
    return {
      phase: 'idle',
      filesDone: 0,
      totalFiles: 0,
      bytesDone: 0,
      totalBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      activeDownloads: [],
      downloadedCount: 0,
      upToDateCount: 0,
      restoredCount: 0,
      failedCount: 0
    };
  }

  private ensureDatabase(): void {
    if (!this.baseFolder) {
      throw new Error('Destination folder not configured');
    }
    if (!this.appDb) {
      this.appDb = new AppDatabase(this.baseFolder);
      const rawDb = this.appDb.open();
      this.metaRepo = new MetaRepo(rawDb);
      this.itemsRepo = new ItemsRepo(rawDb);
      this.restoredLogRepo = new RestoredLogRepo(rawDb);
      this.syncRunsRepo = new SyncRunsRepo(rawDb);
    }
  }

  private startPowerBlocker(): void {
    try {
      if (powerSaveBlocker && typeof powerSaveBlocker.start === 'function') {
        this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      }
    } catch {
      // ignore
    }
  }

  private stopPowerBlocker(): void {
    try {
      if (
        this.powerSaveBlockerId !== null &&
        powerSaveBlocker &&
        typeof powerSaveBlocker.stop === 'function'
      ) {
        powerSaveBlocker.stop(this.powerSaveBlockerId);
        this.powerSaveBlockerId = null;
      }
    } catch {
      // ignore
    }
  }

  public async startSync(options: { force?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
    if (this.isRunning) {
      return { success: false, error: 'Sync is already running' };
    }

    if (!this.baseFolder) {
      return { success: false, error: 'Please select a destination folder first' };
    }

    if (!this.account) {
      return { success: false, error: 'Please connect your OneDrive account first' };
    }

    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();
    this.currentProgress = this.createEmptyProgress();
    this.startPowerBlocker();

    let runId: number | null = null;
    let cleanDiscoveryCompleted = false;

    try {
      // ==========================================
      // STAGE 1: PREFLIGHT
      // ==========================================
      this.setPhase('preflight');
      this.emitLog('info', 'Stage 1: Preflight checks started');

      if (!verifyMounted(this.baseFolder)) {
        this.listeners.onDriveStatus({ connected: false, path: this.baseFolder });
        throw new SyncError({
          code: 'DRIVE_DISCONNECTED',
          message: 'External drive is not mounted at the selected destination.',
          retriable: false
        });
      }
      this.listeners.onDriveStatus({ connected: true, path: this.baseFolder });

      if (!testWritable(this.baseFolder)) {
        throw new SyncError({
          code: 'PERMISSION_DENIED',
          message: 'Destination folder is not writable (read-only volume or permission issue).',
          retriable: false
        });
      }

      this.ensureDatabase();
      runId = this.syncRunsRepo!.startRun();

      // Check account guard
      const existingAccount = this.metaRepo!.getAccountId();
      if (!existingAccount) {
        this.metaRepo!.setAccountId(this.account.id);
      } else if (existingAccount !== this.account.id) {
        throw new SyncError({
          code: 'FORBIDDEN',
          message: `Drive belongs to different OneDrive account (${existingAccount}). Aborting.`,
          retriable: false
        });
      }

      // Check free space (warning)
      const freeSpace = getAvailableSpace(this.baseFolder);
      if (freeSpace < 500 * 1024 * 1024) {
        this.emitLog('warn', `Low disk space on external volume: only ${Math.round(freeSpace / 1048576)} MB available.`);
      }

      // Clean stale .part files (> 7 days)
      this.cleanStalePartFiles();

      if (options.force) {
        this.itemsRepo!.resetFailedRetries();
      }

      // ==========================================
      // STAGE 2: DISCOVER
      // ==========================================
      this.setPhase('scanning');
      this.emitLog('info', 'Stage 2: Scanning OneDrive changes');

      const lastDeltaLink = this.metaRepo!.getDeltaLink();
      let totalDiscovered = 0;
      const deltaResult = await this.remoteDrive.listChanges(
        lastDeltaLink,
        (pageItems) => {
          this.itemsRepo!.upsertBatch(pageItems, runId!);
          totalDiscovered += pageItems.length;
          this.emitLog('info', `Discovered ${totalDiscovered} cloud items...`);
        },
        this.abortController.signal,
        () => this.checkPauseAndCancel()
      );

      // Empty-listing guard
      const currentTrackedCount = this.itemsRepo!.getCount();
      if (totalDiscovered === 0 && currentTrackedCount > 0 && deltaResult.isFullListing) {
        throw new SyncError({
          code: 'UNKNOWN',
          message: 'OneDrive returned no files — protective guard stopped sync to prevent touching local files.',
          retriable: false
        });
      }

      if (deltaResult.isFullListing) {
        this.itemsRepo!.deleteMissingInRun(runId);
      }

      cleanDiscoveryCompleted = true;

      // ==========================================
      // STAGE 3: PLAN
      // ==========================================
      this.setPhase('planning');
      this.emitLog('info', 'Stage 3: Planning synchronization');

      const allDbItems = this.itemsRepo!.getAllItems();
      const itemMap = new Map(allDbItems.map((i) => [i.id, { id: i.id, name: i.name, parentId: i.parent_id, isFolder: Boolean(i.is_folder) }]));
      const pathMap = resolveItemPaths(
        allDbItems.map((i) => ({ id: i.id, name: i.name, parentId: i.parent_id, isFolder: Boolean(i.is_folder) })),
        itemMap
      );

      // Collect desired paths for all files
      const desiredFilePaths: string[] = [];
      for (const item of allDbItems) {
        if (!item.is_folder) {
          const p = pathMap.get(item.id);
          if (p) desiredFilePaths.push(p);
          if (item.local_path && item.local_path !== p) {
            desiredFilePaths.push(item.local_path);
          }
        }
      }

      // Batched concurrent stat of local files
      const localStatMap = await statLocalBatch(this.baseFolder, desiredFilePaths, 32);

      // Convert to LocalSnapshotItem
      const localSnapshot = new Map<string, LocalSnapshotItem>();
      for (const [relPath, statEntry] of localStatMap.entries()) {
        localSnapshot.set(relPath, { ...statEntry });
      }

      const fsType = await getFilesystemType(this.baseFolder);
      const actions = planSync(allDbItems, pathMap, localSnapshot, {
        force: options.force,
        fsType,
        now: Date.now()
      });

      // Mass-move guard check
      const plannedConflictMoves = actions.filter(
        (a) => a.type === 'CONFLICT_MOVE_THEN_DOWNLOAD'
      ).length;

      const totalFilesTracked = allDbItems.filter((i) => !i.is_folder).length;
      const massMoveLimit = Math.max(20, Math.floor(config.massMoveThreshold * totalFilesTracked));

      if (plannedConflictMoves > massMoveLimit) {
        this.emitLog('warn', `Mass-move guard triggered: ${plannedConflictMoves} files scheduled to move to restored/`);
        this.isWaitingMassMove = true;
        this.pendingMovesCount = plannedConflictMoves;
        this.setPhase('paused');

        const allowed = await new Promise<boolean>((resolve) => {
          this.pendingMassMoveResolve = resolve;
        });

        this.isWaitingMassMove = false;
        this.pendingMassMoveResolve = null;

        if (!allowed) {
          throw new Error('Sync cancelled by user due to mass-move threshold.');
        }
      }

      await this.checkPauseAndCancel();

      // ==========================================
      // STAGE 4: EXECUTE
      // ==========================================
      this.setPhase('downloading');
      this.emitLog('info', `Stage 4: Downloading & syncing ${actions.length} planned items`);

      const execResult = await executePlan(actions, {
        baseFolder: this.baseFolder,
        remoteDrive: this.remoteDrive,
        itemsRepo: this.itemsRepo!,
        restoredLogRepo: this.restoredLogRepo!,
        concurrency: config.syncConcurrency,
        signal: this.abortController.signal,
        checkPause: () => this.checkPauseAndCancel(),
        onProgress: (p) => {
          this.currentProgress = {
            ...this.currentProgress,
            filesDone: p.filesDone,
            totalFiles: p.totalFiles,
            bytesDone: p.bytesDone,
            totalBytes: p.totalBytes,
            speedBytesPerSec: p.speedBytesPerSec,
            activeDownloads: p.activeDownloads,
            downloadedCount: p.downloadedCount,
            upToDateCount: p.upToDateCount,
            restoredCount: p.restoredCount,
            failedCount: p.failedCount
          };
          this.listeners.onProgress(this.currentProgress);
        }
      });

      await this.checkPauseAndCancel();

      // ==========================================
      // STAGE 5: SWEEP
      // ==========================================
      this.setPhase('sweeping');
      this.emitLog('info', 'Stage 5: Sweeping unmapped files to restored/');

      const expectedFilePaths = new Set<string>();
      const expectedFolderPaths = new Set<string>();

      for (const item of allDbItems) {
        const p = pathMap.get(item.id);
        if (p) {
          if (item.is_folder) {
            expectedFolderPaths.add(p.normalize('NFC'));
          } else {
            expectedFilePaths.add(p.normalize('NFC'));
          }
        }
      }

      const { movedCount: orphanMoved } = await sweepOrphans({
        baseFolder: this.baseFolder,
        expectedPaths: expectedFilePaths,
        expectedFolderPaths,
        restoredLogRepo: this.restoredLogRepo!,
        gatingAllowed: cleanDiscoveryCompleted && !this.abortController.signal.aborted,
        onFileRestored: (orig, rest) => {
          this.emitLog('info', `Moved ${orig} -> restored/${rest}`);
        }
      });

      // ==========================================
      // STAGE 6: FINISH
      // ==========================================
      this.setPhase('finishing');
      const now = Date.now();
      this.metaRepo!.setLastSyncAt(now);
      if (deltaResult.deltaLink) {
        this.metaRepo!.setDeltaLink(deltaResult.deltaLink);
      }

      const finalRestored = execResult.restored + orphanMoved;
      this.syncRunsRepo!.finishRun(runId, {
        status: 'completed',
        downloaded: execResult.downloaded,
        skipped: execResult.skipped,
        restored: finalRestored,
        failed: execResult.failed,
        bytes: execResult.bytes
      });

      this.emitLog(
        'info',
        `Sync completed: ${execResult.downloaded} downloaded, ${execResult.skipped} up to date, ${finalRestored} restored, ${execResult.failed} failed.`
      );

      this.currentProgress.restoredCount = finalRestored;
      this.setPhase('idle');
      return { success: true };
    } catch (err: unknown) {
      const isCancelled =
        this.abortController?.signal.aborted ||
        (err instanceof SyncError && err.code === 'CANCELLED') ||
        (err instanceof Error &&
          (err.name === 'AbortError' || err.message.toLowerCase().includes('cancelled')));

      if (isCancelled) {
        this.emitLog('info', 'Sync cancelled by user.');
        if (runId && this.syncRunsRepo) {
          this.syncRunsRepo.finishRun(runId, {
            status: 'failed',
            downloaded: this.currentProgress.downloadedCount,
            skipped: this.currentProgress.upToDateCount,
            restored: this.currentProgress.restoredCount,
            failed: this.currentProgress.failedCount,
            bytes: this.currentProgress.bytesDone
          });
        }
        this.setPhase('idle');
        return { success: false, error: 'Sync cancelled by user' };
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      this.emitLog('error', `Sync failed: ${errMsg}`);

      if (runId && this.syncRunsRepo) {
        this.syncRunsRepo.finishRun(runId, {
          status: 'failed',
          downloaded: this.currentProgress.downloadedCount,
          skipped: this.currentProgress.upToDateCount,
          restored: this.currentProgress.restoredCount,
          failed: this.currentProgress.failedCount,
          bytes: this.currentProgress.bytesDone
        });
      }

      this.setPhase('error', errMsg);
      return { success: false, error: errMsg };
    } finally {
      this.isRunning = false;
      this.isPaused = false;
      this.stopPowerBlocker();
      this.abortController = null;
    }
  }

  public pauseSync(): void {
    if (this.isRunning && !this.isPaused) {
      this.isPaused = true;
      this.prePausedPhase = this.currentPhase;
      this.setPhase('paused');
      this.emitLog('info', 'Sync paused by user');
    }
  }

  public resumeSync(): void {
    if (this.isRunning && this.isPaused) {
      this.isPaused = false;
      const targetPhase =
        this.prePausedPhase && this.prePausedPhase !== 'paused'
          ? this.prePausedPhase
          : 'downloading';
      this.setPhase(targetPhase);
      this.emitLog('info', 'Sync resumed');
    }
  }

  public cancelSync(): void {
    if (this.isRunning) {
      this.isPaused = false;
      this.abortController?.abort();
      this.emitLog('info', 'Cancelling active sync run...');
      if (this.pendingMassMoveResolve) {
        this.pendingMassMoveResolve(false);
      }
    }
  }

  public confirmMassMove(allow: boolean): void {
    if (this.pendingMassMoveResolve) {
      this.pendingMassMoveResolve(allow);
    }
  }

  private cleanStalePartFiles(): void {
    if (!this.baseFolder) return;
    const tmpDir = join(this.baseFolder, '.onesync', 'tmp');
    if (!existsSync(tmpDir)) return;

    try {
      const files = readdirSync(tmpDir);
      const now = Date.now();
      const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

      for (const file of files) {
        if (!file.endsWith('.part')) continue;
        const filePath = join(tmpDir, file);
        try {
          const s = statSync(filePath);
          if (now - s.mtimeMs > SEVEN_DAYS_MS) {
            unlinkSync(filePath);
            this.emitLog('info', `Cleaned stale .part file: ${file}`);
          }
        } catch {
          // ignore
        }
      }
    } catch (err) {
      logger.warn('Failed to clean stale .part files:', err);
    }
  }
}
