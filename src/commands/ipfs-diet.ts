import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressManager } from '../utils/progress-manager';
import { UnifiedLogger } from '../utils/unified-logger';

interface IpfsDietOptions {
  olderThanMonths?: string;
  viewThreshold?: string;
  batchSize?: string;
  dryRun?: boolean;
  confirm?: boolean;
}

export async function ipfsDietCommandWithProgress(operationId: string, options: IpfsDietOptions): Promise<void> {
  const progressManager = ProgressManager.getInstance();
  
  try {
    const result = await ipfsDietCommandInternal(options, progressManager, operationId);
    progressManager.completeOperation(operationId);
  } catch (error: any) {
    progressManager.errorOperation(operationId, error.message);
    throw error;
  }
}

export async function ipfsDietCommand(options: IpfsDietOptions): Promise<void> {
  return ipfsDietCommandInternal(options);
}

async function ipfsDietCommandInternal(options: IpfsDietOptions, progressManager?: ProgressManager, operationId?: string): Promise<void> {
  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  const isDryRun = options.dryRun !== false; // Default to dry run for safety
  const uLog = new UnifiedLogger(progressManager, operationId);
  
  try {
    await db.connect();

    const olderThanMonths = options.olderThanMonths ? parseInt(options.olderThanMonths, 10) : 6;
    const viewThreshold = options.viewThreshold ? parseInt(options.viewThreshold, 10) : 500;
    const olderThanDays = olderThanMonths * 30;

    uLog.info(`=== IPFS DIET: Unpin Low-Engagement IPFS Videos ===`);
    uLog.info(`🎯 Target: IPFS videos older than ${olderThanMonths} months with <${viewThreshold} views`);
    uLog.info(`⚡ Action: Unpin IPFS hashes to free up storage (videos become inaccessible)`);
    
    if (isDryRun) {
      uLog.info('🔍 === DRY RUN MODE - No changes will be made ===');
    } else {
      uLog.info('⚠️ This will permanently unpin IPFS content!');
    }

    uLog.info(`🔍 Querying videos with criteria, limit: ${options.batchSize ? parseInt(options.batchSize, 10) : 25}`);

    // Get low-engagement IPFS videos
    const videos = await db.getVideosByCriteria({
      type: 'low-engagement',
      olderThanDays,
      viewThreshold,
      storageType: 'ipfs', // Only IPFS videos can be unpinned
      limit: options.batchSize ? parseInt(options.batchSize, 10) : 25
    });

    if (videos.length === 0) {
      uLog.info('❌ No IPFS videos found matching criteria for IPFS diet');
      uLog.info('💡 This is where most storage savings happen - old IPFS videos');
      return;
    }

    uLog.info(`✅ Found ${videos.length} IPFS videos for diet optimization`);

    if (isDryRun) {
      uLog.previewHeader('IPFS DIET - UNPIN LOW-ENGAGEMENT VIDEOS');
      
      const analysis = {
        videosToUnpin: 0,
        hashesToUnpin: [] as string[],
        totalCurrentSize: 0,
        estimatedSavings: 0
      };

      // Show individual videos in preview
      videos.slice(0, Math.min(10, videos.length)).forEach((video, index) => {
        const hash = IpfsService.extractHashFromFilename(video.filename || '');
        
        if (hash) {
          const additionalInfo = `👀 Views: ${video.views || 0} | 🔗 IPFS: ${hash.substring(0, 12)}...`;
          uLog.logVideoPreview(video, index, Math.min(10, videos.length), additionalInfo);
          
          analysis.hashesToUnpin.push(hash);
          analysis.totalCurrentSize += video.size || 0;
          analysis.estimatedSavings += video.size || 0; // 100% freed when unpinned
          analysis.videosToUnpin++;
        } else {
          uLog.info(`❌ [${index + 1}/${Math.min(10, videos.length)}] ${video.title || video._id}: No IPFS hash found`);
        }
      });

      if (videos.length > 10) {
        uLog.info(`... and ${videos.length - 10} more videos`);
        
        // Process remaining videos for stats only
        for (let i = 10; i < videos.length; i++) {
          const video = videos[i];
          const hash = IpfsService.extractHashFromFilename(video.filename || '');
          if (hash) {
            analysis.hashesToUnpin.push(hash);
            analysis.totalCurrentSize += video.size || 0;
            analysis.estimatedSavings += video.size || 0;
            analysis.videosToUnpin++;
          }
        }
      }

      const ages = videos.map(v => v.created ? Math.floor((Date.now() - new Date(v.created).getTime()) / (1000 * 60 * 60 * 24)) : 0).filter(age => age > 0);
      const oldestAge = ages.length ? Math.max(...ages) : 0;
      const newestAge = ages.length ? Math.min(...ages) : 0;

      uLog.logPreviewSummary({
        totalVideos: analysis.videosToUnpin,
        totalSizeGB: analysis.estimatedSavings / (1024 ** 3),
        ageInfo: { oldest: oldestAge, newest: newestAge },
        additionalInfo: [
          `⚠️ WARNING: Videos will become INACCESSIBLE after unpinning!`,
          `This is an IPFS diet - low engagement videos older than ${olderThanMonths} months with <${viewThreshold} views`,
          `100% of storage will be freed when IPFS content is unpinned`,
          `Videos remain in database but files become unavailable`
        ]
      });
      
      if (progressManager && operationId) {
        progressManager.completeOperation(operationId);
      }
      
      return;
    }

    // Real optimization mode
    if (config.safety.requireConfirmation && options.confirm !== false) {
      uLog.info('IPFS diet requires explicit confirmation');
      uLog.info('Use --no-confirm to skip confirmation (dangerous!)');
      return;
    }

    // Perform actual IPFS diet
    const batchSize = options.batchSize ? parseInt(options.batchSize, 10) : 25;
    uLog.info(`🚀 Starting IPFS diet operation in batches of ${batchSize}`);
    
    // Initialize progress tracking
    uLog.initProgress(videos.length, batchSize);

    const results = {
      processed: 0,
      hashesUnpinned: 0,
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
          const hash = IpfsService.extractHashFromFilename(video.filename || '');
          
          if (!hash) {
            uLog.info(`⚠️ Skipping ${video._id}: No IPFS hash found`);
            continue;
          }
          
          const originalSize = video.size || 0;
          const sizeMB = (originalSize / (1024 * 1024)).toFixed(2);
          
          uLog.info(`🔄 Unpinning: ${video.title || video._id}`);
          uLog.info(`   👤 Owner: ${video.owner} | 🗂️ ID: ${video._id}`);
          uLog.info(`   📊 IPFS Hash: ${hash}`);
          uLog.info(`   💾 Size: ${sizeMB} MB`);
          
          // Unpin the IPFS hash
          const success = await ipfsService.unpinHash(hash);
          
          if (success) {
            results.hashesUnpinned++;
            results.totalStorageFreed += originalSize;
            
            uLog.info(`✅ Successfully unpinned: ${hash.substring(0, 12)}... (${sizeMB} MB freed)`);
            
            // Mark video as cleaned up
            await db.markVideoAsCleanedUp(video._id, {
              cleanupDate: new Date(),
              cleanupReason: `IPFS diet: Unpinned low-engagement content (older than ${olderThanMonths} months, <${viewThreshold} views)`,
              storageType: 'ipfs',
              originalStatus: video.status,
              optimizationType: 'ipfs-diet-unpin'
            });
            
          } else {
            uLog.error(`❌ Failed to unpin ${video._id}: ${hash}`);
            results.errors.push(`Failed to unpin ${video._id}: ${hash}`);
          }

          results.processed++;

        } catch (error: any) {
          uLog.error(`💥 Error processing video ${video._id}: ${error.message}`);
          results.errors.push(`Error processing ${video._id}: ${error.message}`);
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
      uLog.info(`📈 Progress: ${processedSoFar}/${videos.length} videos (${progressPercent}%) | 💾 ${freedSoFarMB} MB freed so far`);

      // Pause between batches to avoid overwhelming IPFS node
      if (i + batchSize < videos.length) {
        uLog.info('⏸️ Pausing between batches for IPFS stability...');
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second pause for IPFS
      }
    }

    // Final results
    const storageFreedGB = (results.totalStorageFreed / (1024 * 1024 * 1024)).toFixed(2);
    const storageFreedTB = (results.totalStorageFreed / (1024 * 1024 * 1024 * 1024)).toFixed(3);
    
    uLog.info('🎉 === IPFS DIET COMPLETED ===');
    uLog.info(`📼 IPFS videos processed: ${results.processed}`);
    uLog.info(`📌 IPFS hashes unpinned: ${results.hashesUnpinned}`);
    uLog.info(`💾 IPFS STORAGE FREED: ${storageFreedGB} GB (${storageFreedTB} TB)`);
    uLog.info(`⚠️ Unpinned videos are no longer accessible via IPFS`);
    uLog.info(`💡 Run 'ipfs repo gc' to actually free disk space`);
    uLog.info(`❌ Errors encountered: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      uLog.error('🚨 Errors encountered during operation:');
      results.errors.forEach(error => uLog.error(`  • ${error}`));
    }
    
  } catch (error) {
    logger.error('IPFS diet command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}