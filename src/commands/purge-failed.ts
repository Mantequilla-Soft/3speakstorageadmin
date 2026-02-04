import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressBar } from '../utils/progress';
import { ProgressManager } from '../utils/progress-manager';
import { UnifiedLogger } from '../utils/unified-logger';

interface PurgeFailedOptions {
  dryRun?: boolean;
  confirm?: boolean;
  batchSize?: string;
  limit?: string;
}

export async function purgeFailedCommandWithProgress(operationId: string, options: PurgeFailedOptions): Promise<void> {
  const progressManager = ProgressManager.getInstance();
  
  try {
    await purgeFailedCommandInternal(options, progressManager, operationId);
    progressManager.completeOperation(operationId);
  } catch (error: any) {
    progressManager.errorOperation(operationId, error.message);
    throw error;
  }
}

export async function purgeFailedCommand(options: PurgeFailedOptions): Promise<void> {
  return purgeFailedCommandInternal(options);
}

async function purgeFailedCommandInternal(options: PurgeFailedOptions, progressManager?: ProgressManager, operationId?: string): Promise<void> {
  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  const isDryRun = options.dryRun !== false; // Default to true unless --no-dry-run is specified
  const uLog = new UnifiedLogger(progressManager, operationId);
  
  try {
    await db.connect();

    const limit = options.limit ? parseInt(options.limit, 10) : 0;
    const batchSize = Math.min(options.batchSize ? parseInt(options.batchSize, 10) : 100, 200); // Max 200 for safety

    uLog.info(`=== PURGE FAILED VIDEOS ===`);
    uLog.info(`🎯 Target: Videos with failed encoding/processing status`);
    uLog.info(`⚡ Action: Mark as deleted and unpin from IPFS`);
    
    if (isDryRun) {
      uLog.info('🔍 === DRY RUN MODE - No changes will be made ===');
    } else {
      uLog.info('⚠️  This will mark videos as deleted and unpin IPFS content!');
    }

    // Get failed videos (encoding_failed, failed, ipfs_pinning_failed)
    uLog.info('🔍 Finding failed videos in database...');
    const videos = await db.getVideosByCriteria({
      status: ['encoding_failed', 'failed', 'ipfs_pinning_failed']
    }, limit || 10000);

    if (videos.length === 0) {
      uLog.info('❌ No failed videos found in database');
      return;
    }

    uLog.info(`✅ Found ${videos.length} failed videos in database`);

    if (isDryRun) {
      uLog.previewHeader('FAILED VIDEOS PURGE');
      
      // Count by status and storage type
      const statusCounts: Record<string, number> = {};
      const storageCounts = { ipfs: 0, s3: 0, unknown: 0 };
      let totalSize = 0;

      for (const video of videos) {
        const status = video.status || 'unknown';
        statusCounts[status] = (statusCounts[status] || 0) + 1;
        
        const storageType = db.getVideoStorageType(video);
        storageCounts[storageType]++;
        
        totalSize += video.size || 0;
      }

      // Show sample videos
      const sampleSize = Math.min(10, videos.length);
      videos.slice(0, sampleSize).forEach((video, index) => {
        const storageType = db.getVideoStorageType(video);
        const additionalInfo = `💾 Storage: ${storageType} | Status: ${video.status}`;
        uLog.logVideoPreview(video, index, sampleSize, additionalInfo);
      });
      if (videos.length > 10) {
        uLog.info(`... and ${videos.length - 10} more videos`);
      }

      uLog.logPreviewSummary({
        totalVideos: videos.length,
        totalSizeGB: totalSize / (1024 ** 3),
        storageBreakdown: { ipfs: storageCounts.ipfs, s3: storageCounts.s3, unknown: storageCounts.unknown },
        additionalInfo: [
          `Status breakdown: ${Object.entries(statusCounts).map(([status, count]) => `${status}: ${count}`).join(', ')}`,
          `IPFS videos will be unpinned, all marked as deleted`
        ]
      });
      uLog.info(`💡 All videos will be marked as 'deleted' status`);
      uLog.info(`Use --no-dry-run to execute the failed videos purge`);
      
      return;
    }

    // Real purge mode
    if (!isDryRun && config.safety.requireConfirmation && options.confirm !== false) {
      uLog.info('⚠️ Failed videos purge requires explicit confirmation');
      uLog.info('💡 Use --no-confirm to skip confirmation (dangerous!)');
      return;
    }

    // Perform actual failed videos purge
    uLog.info(`⚡ Starting failed videos purge in batches of ${batchSize}`);

    const results = {
      processed: 0,
      markedAsDeleted: 0,
      ipfsUnpinned: 0,
      totalStorageFreed: 0,
      errors: [] as string[]
    };

    // Initialize progress tracking
    uLog.initProgress(videos.length, batchSize);

    // Process videos in batches
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      uLog.info(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videos.length / batchSize)}`);

      for (const video of batch) {
        try {
          const storageType = db.getVideoStorageType(video);
          const originalSize = video.size || 0;
          
          // Handle IPFS unpinning for IPFS videos
          if (storageType === 'ipfs') {
            const hash = IpfsService.extractHashFromFilename(video.filename || '');
            if (hash) {
              uLog.info(`📌 Unpinning IPFS video: ${video._id} (${hash})`);
              const success = await ipfsService.unpinHash(hash);
              if (success) {
                results.ipfsUnpinned++;
                results.totalStorageFreed += originalSize;
                uLog.info(`✅ Unpinned IPFS hash: ${hash}`);
              } else {
                uLog.warn(`⚠️ Failed to unpin IPFS hash: ${hash}`);
              }
            }
          }

          // Mark video as deleted
          await db.updateVideoStatus(video._id, 'deleted');
          
          // Add cleanup metadata
          await db.markVideoAsCleanedUp(video._id, {
            cleanupDate: new Date(),
            cleanupReason: `Failed video purge: Original status '${video.status}' - marked as deleted`,
            storageType,
            originalStatus: video.status || 'unknown'
          });

          results.markedAsDeleted++;
          results.processed++;

          const currentBatch = Math.floor((results.processed - 1) / batchSize) + 1;
          uLog.updateProgress(results.processed, currentBatch);
          uLog.info(`✅ ${video._id} - purged (${storageType})`);

        } catch (error: any) {
          const errMsg = `Error processing video ${video._id}: ${error.message}`;
          uLog.error(errMsg);
          results.errors.push(errMsg);
          results.processed++;
          const currentBatch = Math.floor((results.processed - 1) / batchSize) + 1;
          uLog.updateProgress(results.processed, currentBatch);
        }
      }

      // Small pause between batches
      if (i + batchSize < videos.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const storageFreedGB = (results.totalStorageFreed / (1024 ** 3)).toFixed(2);

    uLog.info('=== FAILED VIDEOS PURGE COMPLETED ===');
    uLog.info(`📊 Videos processed: ${results.processed}`);
    uLog.info(`🗑️ Marked as deleted: ${results.markedAsDeleted}`);
    uLog.info(`📌 IPFS hashes unpinned: ${results.ipfsUnpinned}`);
    uLog.info(`💾 IPFS storage freed: ${storageFreedGB} GB`);
    uLog.info(`⚠️ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      uLog.error('Errors encountered during purge:');
      results.errors.slice(0, 10).forEach(err => uLog.error(`  - ${err}`));
      if (results.errors.length > 10) {
        uLog.error(`  ... and ${results.errors.length - 10} more errors`);
      }
    }

    uLog.info('💡 Failed videos cleaned up - no longer cluttering the system');
    
  } catch (error: any) {
    uLog.error(`Failed videos purge command failed: ${error.message}`);
    throw error;
  } finally {
    await db.disconnect();
  }
}