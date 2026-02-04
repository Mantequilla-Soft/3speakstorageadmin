import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { S3Service } from '../services/s3';
import { CleanupCriteria, Video } from '../types';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressBar, ProgressSpinner } from '../utils/progress';
import { BatchProcessor } from '../utils/batch-processor';
import { ProgressManager } from '../utils/progress-manager';
import { UnifiedLogger } from '../utils/unified-logger';

interface CleanupOptions {
  bannedUsers?: boolean;
  age?: string;
  maxViews?: string;
  minViews?: string;
  orphaned?: boolean;
  status?: string;
  stuckDays?: string;
  storageType?: 'ipfs' | 's3' | 'unknown';
  dryRun?: boolean;
  confirm?: boolean;
  batchSize?: string;
}

interface VideoCleanupResult {
  ipfsUnpinned: boolean;
  s3Deleted: number;
  dbUpdated: boolean;
  storageFreed: number;
  error?: string;
}

async function processVideoCleanup(
  video: any, 
  db: DatabaseService, 
  ipfsService: IpfsService, 
  s3Service: S3Service, 
  cleanupType: string
): Promise<VideoCleanupResult> {
  const result: VideoCleanupResult = {
    ipfsUnpinned: false,
    s3Deleted: 0,
    dbUpdated: false,
    storageFreed: video.size || 0
  };

  const storageType = db.getVideoStorageType(video);

  // Clean up IPFS
  if (storageType === 'ipfs') {
    const hash = IpfsService.extractHashFromFilename(video.filename || '');
    if (hash) {
      const success = await ipfsService.unpinHash(hash);
      if (success) {
        result.ipfsUnpinned = true;
        logger.info(`Unpinned IPFS hash: ${hash} for video ${video._id}`);
      } else {
        throw new Error(`Failed to unpin IPFS ${hash} for video ${video._id}`);
      }
    }
  }

  // Clean up S3
  if (storageType === 's3') {
    const s3Paths = db.getS3Paths(video);
    let deletedCount = 0;
    
    // Delete individual files
    if (s3Paths.files.length > 0) {
      const batchResult = await s3Service.batchDelete(s3Paths.files);
      deletedCount += batchResult.success.length;
      logger.info(`Deleted ${batchResult.success.length} individual S3 files for video ${video._id}`);
    }
    
    // Delete prefixed folders
    for (const prefix of s3Paths.prefixes) {
      const prefixResult = await s3Service.deleteObjectsWithPrefix(prefix);
      deletedCount += prefixResult.deleted;
      logger.info(`Deleted ${prefixResult.deleted} S3 objects with prefix ${prefix} for video ${video._id}`);
    }
    
    result.s3Deleted = deletedCount;
  }

  // Update video status and add cleanup metadata
  const cleanupReason = cleanupType === 'admin-deleted' 
    ? `Automated cleanup: admin-marked deleted video`
    : cleanupType === 'banned-users' 
      ? `Automated cleanup: banned user video`
      : cleanupType === 'low-engagement' 
        ? `Automated cleanup: low engagement video`
        : `Automated cleanup: stuck upload (${video.status})`;
        
  await db.markVideoAsCleanedUp(video._id, {
    cleanupDate: new Date(),
    cleanupReason,
    storageType,
    originalStatus: video.status
  });
  
  result.dbUpdated = true;
  return result;
}

async function confirmCleanup(videos: Video[], criteria: any): Promise<boolean> {
  // In a real implementation, you'd use inquirer for interactive prompts
  // For now, we'll just log the confirmation request
  logger.info('=== CLEANUP CONFIRMATION REQUIRED ===');
  logger.info(`About to clean up ${videos.length} videos with criteria:`);
  Object.entries(criteria).forEach(([key, value]) => {
    logger.info(`  ${key}: ${value}`);
  });
  logger.info('This will permanently delete files from storage!');
  logger.info('Set --no-confirm to skip this prompt (not recommended)');
  
  // For safety, return false unless --no-confirm is explicitly set
  return false;
}

export async function cleanupCommandWithProgress(operationId: string, options: CleanupOptions): Promise<void> {
  const progressManager = ProgressManager.getInstance();
  
  try {
    const result = await cleanupCommandInternal(options, progressManager, operationId);
    progressManager.completeOperation(operationId);
  } catch (error: any) {
    progressManager.errorOperation(operationId, error.message);
    throw error;
  }
}

export async function cleanupCommand(options: CleanupOptions): Promise<void> {
  return cleanupCommandInternal(options);
}

async function cleanupCommandInternal(options: CleanupOptions, progressManager?: ProgressManager, operationId?: string): Promise<void> {
  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  const s3Service = new S3Service();
  const uLog = new UnifiedLogger(progressManager, operationId);
  
  try {
    await db.connect();
    
    // Show cutover date notice
    uLog.info(`📅 Cutover Date: ${CUTOVER_DATE.toISOString().split('T')[0]}`);
    uLog.info(`ℹ️  Only managing content uploaded after cutover (old repo is read-only)`);
    uLog.info('');
    
    // Determine cleanup type and get videos
    let cleanupType: 'banned-users' | 'stuck-uploads' | 'admin-deleted' | 'low-engagement' = 'stuck-uploads';
    let videos: any[] = [];
    
    if (options.bannedUsers) {
      cleanupType = 'banned-users';
      videos = await db.getVideosForCleanup('banned-users', { 
        limit: options.batchSize ? parseInt(options.batchSize, 10) : 100 
      });
    } else if (options.status === 'deleted') {
      cleanupType = 'admin-deleted';
      // Use getVideosByCriteria for better consistency with list command
      const criteria: any = { 
        status: ['deleted'],
        excludeCleaned: true // Don't process videos we've already cleaned
      };
      if (options.storageType) {
        criteria.storageType = options.storageType;
      }
      videos = await db.getVideosByCriteria(criteria, options.batchSize ? parseInt(options.batchSize, 10) : 100);
    } else if (options.maxViews) {
      cleanupType = 'low-engagement';
      videos = await db.getVideosForCleanup('low-engagement', { 
        limit: options.batchSize ? parseInt(options.batchSize, 10) : 100,
        viewThreshold: parseInt(options.maxViews, 10) 
      });
    } else {
      // Default: stuck uploads
      const days = options.age ? parseInt(options.age, 10) : 
                   options.stuckDays ? parseInt(options.stuckDays, 10) : 365;
      videos = await db.getVideosForCleanup('stuck-uploads', { 
        limit: options.batchSize ? parseInt(options.batchSize, 10) : 100,
        olderThanDays: days
      });
    }
    
    if (videos.length === 0) {
      uLog.info(`❌ No videos found for cleanup type: ${cleanupType}`);
      return;
    }

    uLog.info(`✅ Found ${videos.length} videos for cleanup (type: ${cleanupType})`);
    
    // Apply storage type filter if specified (for non-admin-deleted cleanup types)
    let filteredVideos = videos;
    if (options.storageType && cleanupType !== 'admin-deleted') {
      filteredVideos = videos.filter(video => {
        const storageType = db.getVideoStorageType(video);

        return storageType === options.storageType;
      });
      uLog.info(`🔍 After storage type filter: ${filteredVideos.length} videos`);
    }

    if (filteredVideos.length === 0) {
      uLog.info('❌ No videos remaining after filters');
      return;
    }

    // Dry run mode - just show what would be deleted
    // Only run in dry-run mode if explicitly requested with --dry-run flag
    const isDryRun = options.dryRun === true;
    
    if (isDryRun) {
      uLog.previewHeader('CLEANUP VIDEOS');
      
      const analysis = {
        ipfsHashes: [] as string[],
        s3Keys: [] as string[],
        totalSize: 0
      };

      // Show individual videos in preview (limit to first 10)
      filteredVideos.slice(0, Math.min(10, filteredVideos.length)).forEach((video, index) => {
        const storageType = db.getVideoStorageType(video);
        let additionalInfo = `💾 Storage: ${storageType}`;
        
        if (storageType === 'ipfs') {
          const hash = IpfsService.extractHashFromFilename(video.filename || '');
          if (hash) {
            analysis.ipfsHashes.push(hash);
            additionalInfo += ` | 🔗 IPFS: ${hash.substring(0, 12)}...`;
          }
        } else if (storageType === 's3') {
          const s3Paths = db.getS3Paths(video);
          const totalPaths = s3Paths.files.length + s3Paths.prefixes.length;
          if (totalPaths > 0) {
            analysis.s3Keys.push(...s3Paths.files, ...s3Paths.prefixes);
            additionalInfo += ` | 🗂️ S3: ${totalPaths} objects`;
          }
        }
        
        uLog.logVideoPreview(video, index, Math.min(10, filteredVideos.length), additionalInfo);
        analysis.totalSize += video.size || 0;
      });

      if (filteredVideos.length > 10) {
        uLog.info(`... and ${filteredVideos.length - 10} more videos`);
        
        // Process remaining videos for stats only
        for (let i = 10; i < filteredVideos.length; i++) {
          const video = filteredVideos[i];
          const storageType = db.getVideoStorageType(video);
          
          if (storageType === 'ipfs') {
            const hash = IpfsService.extractHashFromFilename(video.filename || '');
            if (hash) analysis.ipfsHashes.push(hash);
          } else if (storageType === 's3') {
            const s3Paths = db.getS3Paths(video);
            analysis.s3Keys.push(...s3Paths.files, ...s3Paths.prefixes);
          }
          
          analysis.totalSize += video.size || 0;
        }
      }

      // Only calculate age info for cleanup types where age matters (not for deleted videos)
      let ageInfo = undefined;
      if (cleanupType !== 'admin-deleted') {
        const ages = filteredVideos.map(v => v.created ? Math.floor((Date.now() - new Date(v.created).getTime()) / (1000 * 60 * 60 * 24)) : 0).filter(age => age > 0);
        const oldestAge = ages.length ? Math.max(...ages) : 0;
        const newestAge = ages.length ? Math.min(...ages) : 0;
        ageInfo = { oldest: oldestAge, newest: newestAge };
      }
      
      uLog.logPreviewSummary({
        totalVideos: filteredVideos.length,
        totalSizeGB: analysis.totalSize / (1024 ** 3),
        storageBreakdown: {
          ipfs: analysis.ipfsHashes.length,
          s3: analysis.s3Keys.length,
          other: filteredVideos.length - analysis.ipfsHashes.length - analysis.s3Keys.length
        },
        ageInfo,
        additionalInfo: [
          `Cleanup type: ${cleanupType}`,
          cleanupType === 'admin-deleted' ? `All deleted videos will be cleaned regardless of age` : null,
          `IPFS hashes will be unpinned to free storage`,
          `S3 objects will be permanently deleted`,
          `Database records will be marked as cleaned`
        ].filter((s): s is string => s !== null)
      });
      
      if (progressManager && operationId) {
        progressManager.completeOperation(operationId);
      }
      
      return;
    }

    // Real cleanup mode
    if (config.safety.requireConfirmation && options.confirm !== false) {
      const mockCriteria = { type: cleanupType, count: filteredVideos.length };
      const confirmed = await confirmCleanup(filteredVideos, mockCriteria);
      if (!confirmed) {
        uLog.info('Cleanup cancelled - confirmation required');
        uLog.info('Use --no-confirm to skip confirmation (dangerous!)');
        return;
      }
    }

    // Perform actual cleanup
    const batchSize = options.batchSize ? parseInt(options.batchSize, 10) : Math.min(config.safety.maxBatchSize, 50);
    uLog.info(`🚀 Starting cleanup in batches of ${batchSize}`);
    
    // Initialize progress tracking
    uLog.initProgress(filteredVideos.length, batchSize);

    const results = {
      processed: 0,
      ipfsUnpinned: 0,
      s3Deleted: 0,
      dbUpdated: 0,
      totalStorageFreed: 0,
      errors: [] as string[]
    };

    // Process videos in batches with UnifiedLogger progress tracking
    for (let i = 0; i < filteredVideos.length; i += batchSize) {
      const batch = filteredVideos.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(filteredVideos.length / batchSize);
      
      uLog.info(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} videos)`);
      
      // Show age range for this batch for peace of mind
      uLog.logBatchAges(batch, Math.floor(i / batchSize));

      for (const video of batch) {
        try {
          const sizeMB = (video.size || 0) / (1024 * 1024);
          uLog.info(`🔄 Processing: ${video.title || video._id}`);
          uLog.info(`   👤 Owner: ${video.owner} | 📅 Created: ${video.created ? new Date(video.created).toLocaleDateString() : 'Unknown'} | 💾 ${sizeMB.toFixed(1)} MB`);
          
          const result = await processVideoCleanup(video, db, ipfsService, s3Service, cleanupType);
          results.processed++;
          results.ipfsUnpinned += result.ipfsUnpinned ? 1 : 0;
          results.s3Deleted += result.s3Deleted;
          results.dbUpdated += result.dbUpdated ? 1 : 0;
          results.totalStorageFreed += result.storageFreed;
          
          if (result.error) {
            uLog.error(`❌ Error: ${result.error}`);
          } else {
            const storageType = db.getVideoStorageType(video);
            uLog.info(`✅ Cleaned: ${storageType} storage | ${(result.storageFreed / (1024 * 1024)).toFixed(1)} MB freed`);
          }

        } catch (error: any) {
          results.errors.push(`Error processing ${video._id}: ${error.message}`);
          uLog.error(`💥 Error processing ${video._id}: ${error.message}`);
        }
        
        // Update progress after each video
        uLog.updateProgress(results.processed);
      }

      // Progress update between batches
      const processedSoFar = Math.min(i + batchSize, filteredVideos.length);
      const progressPercent = Math.round((processedSoFar / filteredVideos.length) * 100);
      const freedSoFarMB = (results.totalStorageFreed / (1024 * 1024)).toFixed(1);
      
      uLog.updateProgress(processedSoFar, batchNum);
      uLog.info(`📈 Progress: ${processedSoFar}/${filteredVideos.length} videos (${progressPercent}%) | 💾 ${freedSoFarMB} MB freed`);

      // Pause between batches
      if (i + batchSize < filteredVideos.length) {
        uLog.info('⏸️ Pausing between batches...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Final results
    const storageFreedGB = (results.totalStorageFreed / (1024 * 1024 * 1024)).toFixed(2);
    const storageFreedTB = (results.totalStorageFreed / (1024 * 1024 * 1024 * 1024)).toFixed(3);
    
    uLog.info('🎉 === CLEANUP COMPLETED ===');
    uLog.info(`📼 Videos processed: ${results.processed}`);
    uLog.info(`🔗 IPFS hashes unpinned: ${results.ipfsUnpinned}`);
    uLog.info(`🗂️ S3 objects deleted: ${results.s3Deleted}`);
    uLog.info(`📊 Database records updated: ${results.dbUpdated}`);
    uLog.info(`💾 STORAGE FREED: ${storageFreedGB} GB (${storageFreedTB} TB)`);
    uLog.info(`❌ Errors encountered: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      uLog.error('🚨 Errors encountered during cleanup:');
      results.errors.slice(0, 10).forEach(error => uLog.error(`  • ${error}`));
      if (results.errors.length > 10) {
        uLog.error(`  ... and ${results.errors.length - 10} more errors`);
      }
    }
    
  } catch (error) {
    logger.error('Cleanup command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}