import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressBar } from '../utils/progress';
import { ProgressManager } from '../utils/progress-manager';
import { UnifiedLogger } from '../utils/unified-logger';

interface PurgeAbandonedOptions {
  dryRun?: boolean;
  confirm?: boolean;
  batchSize?: string;
  limit?: string;
  olderThanDays?: string;
}

export async function purgeAbandonedCommandWithProgress(operationId: string, options: PurgeAbandonedOptions): Promise<void> {
  const progressManager = ProgressManager.getInstance();
  
  try {
    const result = await purgeAbandonedCommandInternal(options, progressManager, operationId);
    progressManager.completeOperation(operationId);
  } catch (error: any) {
    progressManager.errorOperation(operationId, error.message);
    throw error;
  }
}

export async function purgeAbandonedCommand(options: PurgeAbandonedOptions): Promise<void> {
  return purgeAbandonedCommandInternal(options);
}

async function purgeAbandonedCommandInternal(options: PurgeAbandonedOptions, progressManager?: ProgressManager, operationId?: string): Promise<void> {
  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  const isDryRun = options.dryRun !== false; // Default to true unless --no-dry-run is specified
  const uLog = new UnifiedLogger(progressManager, operationId);
  
  try {
    await db.connect();

    const limit = options.limit ? parseInt(options.limit, 10) : (options.batchSize ? parseInt(options.batchSize, 10) : 50);
    const batchSize = Math.min(options.batchSize ? parseInt(options.batchSize, 10) : 25, 200); // Max 200 for safety
    const olderThanDays = options.olderThanDays ? parseInt(options.olderThanDays, 10) : 7;

    uLog.info(`=== PURGE ABANDONED MANUAL PUBLISH VIDEOS ===`);
    uLog.info(`🎯 Target: Videos stuck in 'publish_manual' status for ${olderThanDays}+ days`);
    uLog.info(`⚡ Action: Mark as deleted and unpin from IPFS`);
    
    if (isDryRun) {
      uLog.info('🔍 === DRY RUN MODE - No changes will be made ===');
    } else {
      uLog.info('⚠️ This will mark videos as deleted and unpin IPFS content!');
    }

    // Get abandoned publish_manual videos
    uLog.info(`🔍 Finding abandoned publish_manual videos (limit: ${limit})...`);
    const videos = await db.getVideosByCriteria({
      status: ['publish_manual'],
      ageThresholdDays: olderThanDays
    }, limit);

    if (videos.length === 0) {
      uLog.info(`❌ No abandoned publish_manual videos found (older than ${olderThanDays} days)`);
      return;
    }

    uLog.info(`✅ Found ${videos.length} abandoned publish_manual videos`);

    if (isDryRun) {
      uLog.previewHeader('PURGE ABANDONED VIDEOS');
      
      // Analyze the videos
      const storageCounts = { ipfs: 0, s3: 0, unknown: 0 };
      let totalSize = 0;
      let oldestAge = 0;
      let newestAge = Infinity;

      // Show individual videos in preview
      videos.slice(0, Math.min(10, videos.length)).forEach((video, index) => {
        const storageType = db.getVideoStorageType(video);
        const additionalInfo = `💾 Storage: ${storageType}`;
        uLog.logVideoPreview(video, index, Math.min(10, videos.length), additionalInfo);
      });

      if (videos.length > 10) {
        uLog.info(`... and ${videos.length - 10} more videos`);
      }

      // Calculate summary stats
      for (const video of videos) {
        const storageType = db.getVideoStorageType(video);
        storageCounts[storageType]++;
        
        totalSize += video.size || 0;
        
        if (video.created) {
          const ageInDays = Math.floor((Date.now() - video.created.getTime()) / (1000 * 60 * 60 * 24));
          oldestAge = Math.max(oldestAge, ageInDays);
          newestAge = Math.min(newestAge, ageInDays);
        }
      }

      uLog.logPreviewSummary({
        totalVideos: videos.length,
        totalSizeGB: totalSize / (1024 ** 3),
        storageBreakdown: storageCounts,
        ageInfo: { oldest: oldestAge, newest: newestAge === Infinity ? 0 : newestAge },
        additionalInfo: [
          `These videos have been stuck in 'publish_manual' status for ${olderThanDays}+ days`,
          `All videos will be marked as 'deleted' status`,
          `IPFS content will be unpinned to free storage space`
        ]
      });
      
      if (progressManager && operationId) {
        progressManager.completeOperation(operationId);
      }
      
      return;
    }

    // Real purge mode
    if (!isDryRun && config.safety.requireConfirmation && options.confirm !== false) {
      uLog.info('Abandoned videos purge requires explicit confirmation');
      uLog.info('Use --no-confirm to skip confirmation (dangerous!)');
      return;
    }

    // Perform actual abandoned videos purge
    uLog.info(`🚀 Starting abandoned videos purge in batches of ${batchSize}`);
    
    // Initialize progress tracking
    uLog.initProgress(videos.length, batchSize);

    const results = {
      processed: 0,
      markedAsDeleted: 0,
      ipfsUnpinned: 0,
      totalStorageFreed: 0,
      errors: [] as string[]
    };

    // Process videos in batches
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(videos.length / batchSize);
      
      uLog.info(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} videos)`);

      for (const video of batch) {
        try {
          const storageType = db.getVideoStorageType(video);
          const originalSize = video.size || 0;
          const ageInDays = Math.floor((Date.now() - video.created.getTime()) / (1000 * 60 * 60 * 24));
          const sizeMB = (originalSize / (1024 * 1024)).toFixed(1);
          
          uLog.info(`🔄 Processing: ${video.title || video._id}`);
          uLog.info(`   👤 Owner: ${video.owner} | ⏰ Age: ${ageInDays} days | 💾 ${sizeMB} MB`);
          
          // Handle IPFS unpinning for IPFS videos
          if (storageType === 'ipfs') {
            const hash = IpfsService.extractHashFromFilename(video.filename || '');
            if (hash) {
              uLog.info(`📌 Unpinning IPFS video: ${hash.substring(0, 12)}...`);
              const success = await ipfsService.unpinHash(hash);
              if (success) {
                results.ipfsUnpinned++;
                results.totalStorageFreed += originalSize;
                uLog.info(`✅ IPFS unpinned: ${sizeMB} MB freed`);
              } else {
                uLog.error(`❌ Failed to unpin IPFS hash: ${hash.substring(0, 12)}...`);
              }
            }
          }

          // Mark video as deleted
          await db.updateVideoStatus(video._id, 'deleted');
          
          // Add cleanup metadata
          await db.markVideoAsCleanedUp(video._id, {
            cleanupDate: new Date(),
            cleanupReason: `Abandoned manual publish purge: Video stuck in 'publish_manual' for ${ageInDays} days`,
            storageType,
            originalStatus: video.status || 'publish_manual'
          });

          results.markedAsDeleted++;
          results.processed++;

          uLog.info(`🗑️ Marked as deleted: ${video._id} (${ageInDays}d old, ${storageType})`);

        } catch (error: any) {
          uLog.error(`💥 Error processing video ${video._id}: ${error.message}`);
          results.errors.push(`Error processing ${video._id}: ${error.message}`);
          results.processed++;
        }
        
        // Update progress after each video
        uLog.updateProgress(results.processed);
      }

      // Progress update between batches
      const processedSoFar = Math.min(i + batchSize, videos.length);
      const progressPercent = Math.round((processedSoFar / videos.length) * 100);
      const freedSoFarMB = (results.totalStorageFreed / (1024 * 1024)).toFixed(1);
      const currentBatchNum = Math.floor(i / batchSize) + 1;
      
      uLog.updateProgress(processedSoFar, currentBatchNum);
      uLog.info(`📈 Progress: ${processedSoFar}/${videos.length} videos (${progressPercent}%) | 💾 ${freedSoFarMB} MB freed`);

      // Small pause between batches
      if (i + batchSize < videos.length) {
        uLog.info('⏸️ Pausing between batches...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const storageFreedGB = (results.totalStorageFreed / (1024 ** 3)).toFixed(2);

    uLog.info('🎉 === ABANDONED VIDEOS PURGE COMPLETED ===');
    uLog.info(`📼 Videos processed: ${results.processed}`);
    uLog.info(`🗑️ Marked as deleted: ${results.markedAsDeleted}`);
    uLog.info(`📌 IPFS hashes unpinned: ${results.ipfsUnpinned}`);
    uLog.info(`💾 IPFS storage freed: ${storageFreedGB} GB`);
    uLog.info(`❌ Errors encountered: ${results.errors.length}`);

    if (results.errors.length > 0) {
      uLog.error('🚨 Errors encountered during purge:');
      results.errors.slice(0, 10).forEach(err => uLog.error(`  • ${err}`));
      if (results.errors.length > 10) {
        uLog.error(`  ... and ${results.errors.length - 10} more errors`);
      }
    }

    uLog.info('💡 Abandoned videos cleaned up - storage freed for active content');
    
  } catch (error) {
    logger.error('Abandoned videos purge command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}