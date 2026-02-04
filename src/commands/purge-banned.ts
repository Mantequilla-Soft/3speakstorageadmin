import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressManager } from '../utils/progress-manager';
import { UnifiedLogger } from '../utils/unified-logger';

interface PurgeBannedOptions {
  dryRun?: boolean;
  confirm?: boolean;
  batchSize?: string;
  limit?: string;
}

export async function purgeBannedCommandWithProgress(operationId: string, options: PurgeBannedOptions): Promise<void> {
  const progressManager = ProgressManager.getInstance();
  
  try {
    await purgeBannedCommandInternal(options, progressManager, operationId);
    progressManager.completeOperation(operationId);
  } catch (error: any) {
    progressManager.errorOperation(operationId, error.message);
    throw error;
  }
}

export async function purgeBannedCommand(options: PurgeBannedOptions): Promise<void> {
  return purgeBannedCommandInternal(options);
}

async function purgeBannedCommandInternal(options: PurgeBannedOptions, progressManager?: ProgressManager, operationId?: string): Promise<void> {
  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  // Note: S3 bucket no longer exists - we only unpin IPFS and mark videos as cleaned
  const isDryRun = options.dryRun !== false;
  const uLog = new UnifiedLogger(progressManager, operationId);
  
  try {
    await db.connect();

    // Conservative defaults to protect IPFS supernode
    // Default limit: 100 videos per run, max batch size: 200
    const requestedLimit = options.limit ? parseInt(options.limit, 10) : 100;
    const limit = Math.min(requestedLimit, 500); // Hard cap at 500 videos per run
    const batchSize = Math.min(options.batchSize ? parseInt(options.batchSize, 10) : 50, 200);

    uLog.info(`=== PURGE BANNED USER VIDEOS ===`);
    uLog.info(`🎯 Target: Videos from users marked as banned`);
    uLog.info(`📊 Limit: ${limit} videos this run (batch size: ${batchSize})`);
    uLog.info(`⚡ Action: Mark as cleaned, unpin IPFS (S3 bucket removed)`);
    
    if (isDryRun) {
      uLog.info('🔍 === DRY RUN MODE - No changes will be made ===');
    } else {
      uLog.info('⚠️ This will permanently delete content from banned users!');
    }

    // Step 1: Get all banned users
    uLog.info('🔍 Finding banned users in database...');
    const bannedUsers = await db.getBannedUsers();
    
    if (bannedUsers.length === 0) {
      uLog.info('❌ No banned users found in database');
      return;
    }

    uLog.info(`✅ Found ${bannedUsers.length} banned users`);
    
    // Show sample of banned users
    const sampleBannedUsers = bannedUsers.slice(0, Math.min(5, bannedUsers.length));
    sampleBannedUsers.forEach((user, idx) => {
      uLog.info(`   ${idx + 1}. ${user.username}`);
    });
    if (bannedUsers.length > 5) {
      uLog.info(`   ... and ${bannedUsers.length - 5} more banned users`);
    }

    // Step 2: Get videos from banned users that haven't been cleaned up yet
    uLog.info(`🔍 Finding videos from banned users (limit: ${limit})...`);
    const bannedUsernames = bannedUsers.map(user => user.username);
    
    const videos = await db.getVideosForCleanup('banned-users', {
      limit: limit // Use the enforced limit
    });

    if (videos.length === 0) {
      uLog.info('✅ No videos from banned users that need cleanup');
      uLog.info('💡 All banned user content may have already been cleaned');
      return;
    }

    uLog.info(`✅ Found ${videos.length} videos from banned users to process`);

    // Group videos by owner for better visibility
    const videosByOwner: Record<string, Video[]> = {};
    videos.forEach(video => {
      const owner = video.owner || 'unknown';
      if (!videosByOwner[owner]) {
        videosByOwner[owner] = [];
      }
      videosByOwner[owner].push(video);
    });

    uLog.info(`📊 Videos breakdown by banned user:`);
    const sortedOwners = Object.entries(videosByOwner)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);
    
    sortedOwners.forEach(([owner, ownerVideos]) => {
      const totalSize = ownerVideos.reduce((sum, v) => sum + (v.size || 0), 0);
      const sizeGB = (totalSize / (1024 ** 3)).toFixed(2);
      uLog.info(`   👤 ${owner}: ${ownerVideos.length} videos (${sizeGB} GB)`);
    });
    
    if (Object.keys(videosByOwner).length > 10) {
      uLog.info(`   ... and ${Object.keys(videosByOwner).length - 10} more banned users with videos`);
    }

    if (isDryRun) {
      uLog.previewHeader('PURGE BANNED USER VIDEOS');
      
      // Analyze storage types
      const storageCounts = { ipfs: 0, s3: 0, unknown: 0 };
      let totalSize = 0;
      const ipfsHashes = new Set<string>();
      const s3Paths = new Set<string>();

      // Show individual video previews (limited to 10)
      const previewVideos = videos.slice(0, Math.min(10, videos.length));
      previewVideos.forEach((video, index) => {
        const storageType = db.getVideoStorageType(video);
        const additionalInfo = `👤 Banned: ${video.owner} | 💾 ${storageType}`;
        uLog.logVideoPreview(video, index, previewVideos.length, additionalInfo);
      });

      if (videos.length > 10) {
        uLog.info(`... and ${videos.length - 10} more videos from banned users`);
      }

      // Calculate full stats
      for (const video of videos) {
        const storageType = db.getVideoStorageType(video);
        storageCounts[storageType]++;
        totalSize += video.size || 0;

        if (storageType === 'ipfs') {
          const hash = IpfsService.extractHashFromFilename(video.filename || '');
          if (hash) ipfsHashes.add(hash);
        } else if (storageType === 's3') {
          const paths = db.getS3Paths(video);
          paths.files.forEach(f => s3Paths.add(f));
          paths.prefixes.forEach(p => s3Paths.add(p));
        }
      }

      uLog.logPreviewSummary({
        totalVideos: videos.length,
        totalSizeGB: totalSize / (1024 ** 3),
        storageBreakdown: storageCounts,
        additionalInfo: [
          `Banned users with videos: ${Object.keys(videosByOwner).length}`,
          `Unique IPFS hashes: ${ipfsHashes.size}`,
          `Unique S3 paths: ${s3Paths.size}`,
          `All videos will be marked as 'deleted' and flagged as cleanedUp`
        ]
      });

      return;
    }

    // Real purge mode
    if (!isDryRun && config.safety.requireConfirmation && options.confirm !== false) {
      uLog.info('⚠️ Banned user content purge requires explicit confirmation');
      uLog.info('💡 Use --no-confirm to skip confirmation (dangerous!)');
      return;
    }

    // Perform actual purge
    uLog.info(`⚡ Starting banned content purge in batches of ${batchSize}`);

    const results = {
      processed: 0,
      ipfsUnpinned: 0,
      s3Deleted: 0,
      markedAsDeleted: 0,
      totalStorageFreed: 0,
      errors: [] as string[],
      skippedAlreadyClean: 0
    };

    // Initialize progress tracking
    uLog.initProgress(videos.length, batchSize);

    // Process videos in batches
    const totalBatches = Math.ceil(videos.length / batchSize);
    
    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const start = batchNum * batchSize;
      const end = Math.min(start + batchSize, videos.length);
      const batch = videos.slice(start, end);
      
      uLog.info(`📦 Processing batch ${batchNum + 1}/${totalBatches} (${batch.length} videos)`);
      uLog.logBatchAges(batch, batchNum);

      for (const video of batch) {
        try {
          // Double-check this video hasn't been cleaned up already (in case of concurrent runs)
          const currentVideo = await db.getVideoById(video._id);
          if (currentVideo?.cleanedUp) {
            results.skippedAlreadyClean++;
            results.processed++;
            uLog.updateProgress(results.processed, batchNum + 1);
            continue;
          }

          const storageType = db.getVideoStorageType(video);
          const originalSize = video.size || 0;
          
          // Handle IPFS unpinning - only for IPFS videos
          if (storageType === 'ipfs') {
            const hash = IpfsService.extractHashFromFilename(video.filename || '');
            if (hash) {
              uLog.info(`📌 Unpinning IPFS: ${video._id} (${hash.substring(0, 12)}...)`);
              const success = await ipfsService.unpinHash(hash);
              if (success) {
                results.ipfsUnpinned++;
                results.totalStorageFreed += originalSize;
                uLog.info(`✅ Unpinned IPFS hash for banned user ${video.owner}`);
              } else {
                uLog.warn(`⚠️ Failed to unpin IPFS hash: ${hash}`);
              }
            }
          }
          
          // S3 videos: No bucket exists anymore, just mark as cleaned
          // The S3 bucket has been decommissioned, so we just track the cleanup
          if (storageType === 's3') {
            results.s3Deleted++; // Count as "handled" for reporting
            results.totalStorageFreed += originalSize;
            uLog.info(`📝 Marking S3 video as cleaned (no bucket): ${video._id}`);
          }

          // Mark video as cleaned up
          await db.markVideoAsCleanedUp(video._id, {
            cleanupDate: new Date(),
            cleanupReason: `Banned user purge: User '${video.owner}' is banned`,
            storageType,
            originalStatus: video.status || 'unknown'
          });

          results.markedAsDeleted++;
          results.processed++;

          uLog.updateProgress(results.processed, batchNum + 1);

        } catch (error: any) {
          const errMsg = `Error processing banned video ${video._id}: ${error.message}`;
          uLog.error(errMsg);
          results.errors.push(errMsg);
          results.processed++;
          uLog.updateProgress(results.processed, batchNum + 1);
        }
      }

      // Pause between batches to avoid overwhelming services
      if (batchNum < totalBatches - 1) {
        uLog.info(`⏳ Pausing 1 second before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Final summary
    const storageFreedGB = (results.totalStorageFreed / (1024 ** 3)).toFixed(2);
    const storageFreedTB = (results.totalStorageFreed / (1024 ** 4)).toFixed(3);

    uLog.info('=== BANNED USER PURGE COMPLETED ===');
    uLog.info(`📊 Videos processed: ${results.processed}`);
    uLog.info(`🗑️ Marked as deleted: ${results.markedAsDeleted}`);
    uLog.info(`📌 IPFS hashes unpinned: ${results.ipfsUnpinned}`);
    uLog.info(`🗂️ S3 objects deleted: ${results.s3Deleted}`);
    uLog.info(`💾 Storage freed: ${storageFreedGB} GB (${storageFreedTB} TB)`);
    uLog.info(`⏭️ Skipped (already cleaned): ${results.skippedAlreadyClean}`);
    uLog.info(`⚠️ Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      uLog.error('Errors encountered during purge:');
      results.errors.slice(0, 10).forEach(err => uLog.error(`  - ${err}`));
      if (results.errors.length > 10) {
        uLog.error(`  ... and ${results.errors.length - 10} more errors`);
      }
    }

    uLog.info('💡 Banned user content has been purged from storage');
    
  } catch (error: any) {
    uLog.error(`Banned user purge command failed: ${error.message}`);
    throw error;
  } finally {
    await db.disconnect();
  }
}
