import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { S3Service } from '../services/s3';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressBar } from '../utils/progress';
import { ProgressManager } from '../utils/progress-manager';
import { UnifiedLogger } from '../utils/unified-logger';

interface NukeAccountOptions {
  username?: string;
  dryRun?: boolean;
  confirm?: boolean;
  batchSize?: string;
  includeCleaned?: boolean;
  limit?: string;
  status?: string;
}

const IPFS_HASH_REGEX = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

function formatBytes(bytes: number): { gb: string; tb: string } {
  const gb = (bytes / (1024 ** 3)).toFixed(2);
  const tb = (bytes / (1024 ** 4)).toFixed(3);
  return { gb, tb };
}

function collectIpfsHashes(video: Video): string[] {
  const hashes = new Set<string>();
  const candidates: Array<string | undefined | null> = [
    (video as any).ipfshash,
    video.filename,
    video.video_v2,
    (video as any).video_v1,
    (video as any).videoManifest,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'string') {
      continue;
    }
    const extracted = IpfsService.extractHashFromFilename(candidate);
    if (extracted && IPFS_HASH_REGEX.test(extracted)) {
      hashes.add(extracted);
      continue;
    }
    const trimmed = candidate.trim();
    if (IPFS_HASH_REGEX.test(trimmed)) {
      hashes.add(trimmed);
    }
  }

  return Array.from(hashes);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function nukeAccountCommandWithProgress(operationId: string, options: NukeAccountOptions): Promise<void> {
  const progressManager = ProgressManager.getInstance();
  
  try {
    await nukeAccountCommandInternal(options, progressManager, operationId);
    progressManager.completeOperation(operationId);
  } catch (error: any) {
    progressManager.errorOperation(operationId, error.message);
    throw error;
  }
}

export async function nukeAccountCommand(options: NukeAccountOptions): Promise<void> {
  return nukeAccountCommandInternal(options);
}

async function nukeAccountCommandInternal(options: NukeAccountOptions, progressManager?: ProgressManager, operationId?: string): Promise<void> {
  const uLog = new UnifiedLogger(progressManager, operationId);
  const username = options.username?.trim();
  if (!username) {
    uLog.error('The --username option is required for nuke-account');
    return;
  }

  const includeCleaned = options.includeCleaned === true;
  const limit = options.limit ? parseInt(options.limit, 10) : 0;
  if (options.limit && (Number.isNaN(limit) || limit < 0)) {
    uLog.error('Invalid limit specified. Please provide a positive number.');
    return;
  }

  const batchSizeInput = options.batchSize ? parseInt(options.batchSize, 10) : 25;
  if (Number.isNaN(batchSizeInput) || batchSizeInput <= 0) {
    uLog.error('Invalid batch size specified. Please provide a positive number.');
    return;
  }
  const batchSize = Math.min(batchSizeInput, 500);
  if (batchSizeInput > 500) {
    uLog.warn(`Batch size capped at 500 for safety. Using ${batchSize}.`);
  }

  const statusFilter = options.status
    ? options.status.split(',').map(status => status.trim()).filter(Boolean)
    : undefined;

  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  const s3Service = new S3Service();

  try {
    await db.connect();

    uLog.info(`📅 Cutover Date: ${CUTOVER_DATE.toISOString().split('T')[0]}`);
    uLog.info(`ℹ️  Only managing content uploaded after cutover (old repo is read-only)`);
    uLog.info('');

    const videos = await db.getVideosByOwner(username, {
      includeCleaned,
      limit,
      statuses: statusFilter,
    });

    if (videos.length === 0) {
      uLog.info(`❌ No videos found for account ${username}. Nothing to do.`);
      return;
    }

    const statusCounts: Record<string, number> = {};
    const storageCounts: Record<'ipfs' | 's3' | 'unknown', number> = {
      ipfs: 0,
      s3: 0,
      unknown: 0,
    };
    const uniqueS3Files = new Set<string>();
    const uniqueS3Prefixes = new Set<string>();
    const uniqueIpfsHashes = new Set<string>();

    let totalBytes = 0;
    let alreadyCleaned = 0;

    videos.forEach(video => {
      const statusKey = video.status || 'unknown';
      statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1;

      const storageType = db.getVideoStorageType(video);
      storageCounts[storageType] = (storageCounts[storageType] || 0) + 1;

      if (video.cleanedUp) {
        alreadyCleaned++;
      }

      totalBytes += video.size || 0;

      const s3Paths = db.getS3Paths(video);
      s3Paths.files.forEach(path => uniqueS3Files.add(path));
      s3Paths.prefixes.forEach(prefix => uniqueS3Prefixes.add(prefix));

      collectIpfsHashes(video).forEach(hash => uniqueIpfsHashes.add(hash));
    });

    const { gb, tb } = formatBytes(totalBytes);

    uLog.info('=== NUKE ACCOUNT SUMMARY ===');
    uLog.info(`🎯 Target account: ${username}`);
    uLog.info(`📼 Total videos found: ${videos.length}`);
    uLog.info(`✅ Already marked as cleaned: ${alreadyCleaned}`);
    uLog.info(`💾 Recorded storage size: ${gb} GB (${tb} TB)`);
    uLog.info(`🗂️ Storage types -> S3: ${storageCounts.s3}, IPFS: ${storageCounts.ipfs}, Unknown: ${storageCounts.unknown}`);
    uLog.info(`📁 Unique S3 files targeted: ${uniqueS3Files.size}`);
    uLog.info(`📂 Unique S3 prefixes targeted: ${uniqueS3Prefixes.size}`);
    uLog.info(`📌 Unique IPFS hashes targeted: ${uniqueIpfsHashes.size}`);
    uLog.info('📊 Status breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      uLog.info(`  - ${status}: ${count}`);
    });

    const sampleSize = Math.min(5, videos.length);
    if (sampleSize > 0) {
      uLog.info('📹 Sample videos:');
      for (let i = 0; i < sampleSize; i++) {
        const video = videos[i];
        uLog.logVideoPreview(video, i, sampleSize);
      }
    }

    if (options.dryRun) {
      uLog.previewHeader(`NUKE ACCOUNT: ${username}`);
      uLog.logPreviewSummary({
        totalVideos: videos.length,
        totalSizeGB: totalBytes / (1024 ** 3),
        storageBreakdown: { s3: storageCounts.s3, ipfs: storageCounts.ipfs, unknown: storageCounts.unknown },
        additionalInfo: [
          `S3 files to delete: ${uniqueS3Files.size}`,
          `S3 prefixes to delete: ${uniqueS3Prefixes.size}`,
          `IPFS hashes to unpin: ${uniqueIpfsHashes.size}`
        ]
      });
      return;
    }

    if (config.safety.requireConfirmation && options.confirm !== false) {
      uLog.info('⚠️ Confirmation required. Re-run with --no-confirm to execute this destructive operation.');
      return;
    }

    uLog.warn(`💣 Proceeding to permanently delete all videos for account ${username}`);
    uLog.warn('⚠️ This will delete S3 objects, unpin IPFS hashes, and mark all videos as deleted.');

    const results = {
      processed: 0,
      batches: 0,
      s3ObjectsDeleted: 0,
      ipfsHashesUnpinned: 0,
      dbUpdated: 0,
      totalStorageBytes: 0,
      errors: [] as string[],
      skippedDuplicates: 0,
    };

    const processedS3Files = new Set<string>();
    const processedS3Prefixes = new Set<string>();
    const processedIpfsHashes = new Set<string>();

    // Initialize progress tracking
    uLog.initProgress(videos.length, batchSize);

    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      results.batches++;
      uLog.info(`📦 Processing batch ${results.batches}/${Math.ceil(videos.length / batchSize)} (${batch.length} videos)`);
      uLog.logBatchAges(batch, results.batches - 1);

      for (const video of batch) {
        try {
          const label = (video.title || video.permlink || video._id).substring(0, 40);
          const storageType = db.getVideoStorageType(video);

          const s3Paths = db.getS3Paths(video);
          for (const filePath of s3Paths.files) {
            if (!filePath || processedS3Files.has(filePath)) {
              if (processedS3Files.has(filePath)) {
                results.skippedDuplicates++;
              }
              continue;
            }
            processedS3Files.add(filePath);
            const success = await s3Service.deleteObject(filePath);
            if (success) {
              results.s3ObjectsDeleted++;
            }
          }

          for (const prefix of s3Paths.prefixes) {
            if (!prefix || processedS3Prefixes.has(prefix)) {
              if (processedS3Prefixes.has(prefix)) {
                results.skippedDuplicates++;
              }
              continue;
            }
            processedS3Prefixes.add(prefix);
            const outcome = await s3Service.deleteObjectsWithPrefix(prefix);
            results.s3ObjectsDeleted += outcome.deleted;
          }

          const ipfsHashes = collectIpfsHashes(video);
          for (const hash of ipfsHashes) {
            if (processedIpfsHashes.has(hash)) {
              results.skippedDuplicates++;
              continue;
            }
            processedIpfsHashes.add(hash);
            const success = await ipfsService.unpinHash(hash);
            if (success) {
              results.ipfsHashesUnpinned++;
            }
          }

          const cleanupReason = `nuke-account:${username}`;
          await db.markVideoAsCleanedUp(video._id, {
            cleanupDate: new Date(),
            cleanupReason,
            storageType,
            originalStatus: video.status,
          });
          results.dbUpdated++;
          results.totalStorageBytes += video.size || 0;
          results.processed++;

          uLog.updateProgress(results.processed, results.batches);
          uLog.info(`✅ [${storageType}] ${label}`);
        } catch (error: any) {
          const message = `Failed to process video ${video._id}: ${error.message || error}`;
          uLog.error(message);
          results.errors.push(message);
          results.processed++;
          uLog.updateProgress(results.processed, results.batches);
        }
      }

      if (i + batchSize < videos.length) {
        await sleep(1000);
      }
    }

    const processedStorage = formatBytes(results.totalStorageBytes);

    uLog.info('=== NUKE ACCOUNT COMPLETED ===');
    uLog.info(`👤 Account: ${username}`);
    uLog.info(`📼 Videos processed: ${results.processed}`);
    uLog.info(`📦 Batches: ${results.batches}`);
    uLog.info(`🗑️ S3 objects deleted: ${results.s3ObjectsDeleted}`);
    uLog.info(`📌 IPFS hashes unpinned: ${results.ipfsHashesUnpinned}`);
    uLog.info(`📝 Database records updated: ${results.dbUpdated}`);
    uLog.info(`💾 Targeted storage: ${processedStorage.gb} GB (${processedStorage.tb} TB)`);
    uLog.info(`🔄 Duplicate storage references skipped: ${results.skippedDuplicates}`);
    uLog.info(`⚠️ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      uLog.error('Errors encountered during nuke:');
      results.errors.forEach(err => uLog.error(`  - ${err}`));
    }
  } catch (error: any) {
    uLog.error(`Nuke account command failed: ${error.message}`);
    throw error;
  } finally {
    await db.disconnect();
  }
}
