import { DatabaseService } from '../services/database';
import { IpfsService } from '../services/ipfs';
import { S3Service } from '../services/s3';
import { CleanupCriteria, Video } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

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

export async function cleanupCommand(options: CleanupOptions): Promise<void> {
  const db = new DatabaseService();
  const ipfsService = new IpfsService();
  const s3Service = new S3Service();
  
  try {
    await db.connect();
    
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
      videos = await db.getVideosForCleanup('admin-deleted', { 
        limit: options.batchSize ? parseInt(options.batchSize, 10) : 100 
      });
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
      logger.info(`No videos found for cleanup type: ${cleanupType}`);
      return;
    }

    logger.info(`Found ${videos.length} videos for cleanup (type: ${cleanupType})`);
    
    // Apply storage type filter if specified
    let filteredVideos = videos;
    if (options.storageType) {
      filteredVideos = videos.filter(video => {
        const storageType = db.getVideoStorageType(video);
        return storageType === options.storageType;
      });
      logger.info(`After storage type filter: ${filteredVideos.length} videos`);
    }

    if (filteredVideos.length === 0) {
      logger.info('No videos remaining after filters');
      return;
    }

    // Dry run mode - just show what would be deleted
    // Only run in dry-run mode if explicitly requested with --dry-run flag
    const isDryRun = options.dryRun === true;
    
    if (isDryRun) {
      logger.info('=== DRY RUN MODE - No changes will be made ===');
      
      const analysis = {
        ipfsHashes: [] as string[],
        s3Keys: [] as string[],
        totalSize: 0
      };

      filteredVideos.forEach(video => {
        const storageType = db.getVideoStorageType(video);
        logger.info(`Would clean up: ${video._id}`);
        logger.info(`  Title: ${video.title || 'No title'}`);
        logger.info(`  Owner: ${video.owner}`);
        logger.info(`  Status: ${video.status}`);
        logger.info(`  Storage: ${storageType}`);
        logger.info(`  Size: ${((video.size || 0) / (1024 * 1024)).toFixed(2)} MB`);
        
        if (storageType === 'ipfs') {
          const hash = IpfsService.extractHashFromFilename(video.filename || '');
          if (hash) {
            analysis.ipfsHashes.push(hash);
            logger.info(`  IPFS Hash: ${hash}`);
          }
        } else if (storageType === 's3') {
          const s3Paths = db.getS3Paths(video);
          const totalPaths = s3Paths.files.length + s3Paths.prefixes.length;
          if (totalPaths > 0) {
            analysis.s3Keys.push(...s3Paths.files, ...s3Paths.prefixes);
            logger.info(`  S3 Files (${s3Paths.files.length}) + Prefixes (${s3Paths.prefixes.length}):`);
            s3Paths.files.forEach(path => logger.info(`    File: ${path}`));
            s3Paths.prefixes.forEach(path => logger.info(`    Folder: ${path}*`));
          }
        }
        
        analysis.totalSize += video.size || 0;
        logger.info('---');
      });

      const totalSizeGB = (analysis.totalSize / (1024 * 1024 * 1024)).toFixed(2);
      logger.info(`=== DRY RUN SUMMARY ===`);
      logger.info(`Total videos: ${filteredVideos.length}`);
      logger.info(`IPFS hashes to unpin: ${analysis.ipfsHashes.length}`);
      logger.info(`S3 objects to delete: ${analysis.s3Keys.length}`);
      logger.info(`Total storage to free: ${totalSizeGB} GB`);
      logger.info(`Use --no-dry-run to execute the cleanup`);
      
      return;
    }

    // Real cleanup mode
    if (config.safety.requireConfirmation && options.confirm !== false) {
      const mockCriteria = { type: cleanupType, count: filteredVideos.length };
      const confirmed = await confirmCleanup(filteredVideos, mockCriteria);
      if (!confirmed) {
        logger.info('Cleanup cancelled - confirmation required');
        logger.info('Use --no-confirm to skip confirmation (dangerous!)');
        return;
      }
    }

    // Perform actual cleanup
    const batchSize = options.batchSize ? parseInt(options.batchSize, 10) : config.safety.maxBatchSize;
    logger.info(`Starting cleanup in batches of ${batchSize}`);

    const results = {
      processed: 0,
      ipfsUnpinned: 0,
      s3Deleted: 0,
      dbUpdated: 0,
      totalStorageFreed: 0,
      errors: [] as string[]
    };

    // Process videos in batches
    for (let i = 0; i < filteredVideos.length; i += batchSize) {
      const batch = filteredVideos.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filteredVideos.length / batchSize)}`);

      for (const video of batch) {
        try {
          const storageType = db.getVideoStorageType(video);
          
          // Clean up IPFS
          if (storageType === 'ipfs') {
            const hash = IpfsService.extractHashFromFilename(video.filename || '');
            if (hash) {
              const success = await ipfsService.unpinHash(hash);
              if (success) {
                results.ipfsUnpinned++;
              } else {
                results.errors.push(`Failed to unpin IPFS ${hash} for video ${video._id}`);
              }
            }
          }
          
          // Clean up S3 (permlink-based structure with HLS segments)
          else if (storageType === 's3') {
            const s3Paths = db.getS3Paths(video);
            let deletedCount = 0;
            let totalAttempts = 0;
            
            // Delete individual files (m3u8 playlists, source files)
            for (const filePath of s3Paths.files) {
              totalAttempts++;
              const success = await s3Service.deleteObject(filePath);
              if (success) {
                deletedCount++;
              }
            }
            
            // Delete all files in HLS segment folders using prefix deletion
            for (const prefix of s3Paths.prefixes) {
              const result = await s3Service.deleteObjectsWithPrefix(prefix);
              deletedCount += result.deleted;
              totalAttempts += result.deleted + result.errors;
            }
            
            if (deletedCount > 0) {
              results.s3Deleted += deletedCount;
              logger.info(`Deleted ${deletedCount} S3 objects for video ${video._id} (${video.permlink || 'no-permlink'})`);
            } else {
              logger.info(`No S3 objects found for video ${video._id} (${video.permlink || 'no-permlink'}) - may already be cleaned`);
            }
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
          results.dbUpdated++;
          results.processed++;
          
          // Add to total storage freed
          results.totalStorageFreed += video.size || 0;

        } catch (error: any) {
          logger.error(`Error processing video ${video._id}`, error);
          results.errors.push(`Error processing ${video._id}: ${error.message}`);
        }
      }

      // Pause between batches
      if (i + batchSize < filteredVideos.length) {
        logger.info('Pausing between batches...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Final results
    const storageFreedGB = (results.totalStorageFreed / (1024 * 1024 * 1024)).toFixed(2);
    const storageFreedTB = (results.totalStorageFreed / (1024 * 1024 * 1024 * 1024)).toFixed(3);
    
    logger.info('=== CLEANUP COMPLETED ===');
    logger.info(`Videos processed: ${results.processed}`);
    logger.info(`IPFS hashes unpinned: ${results.ipfsUnpinned}`);
    logger.info(`S3 objects deleted: ${results.s3Deleted}`);
    logger.info(`Database records updated: ${results.dbUpdated}`);
    logger.info(`💾 STORAGE FREED: ${storageFreedGB} GB (${storageFreedTB} TB)`);
    logger.info(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      logger.error('Errors encountered:');
      results.errors.forEach(error => logger.error(`  ${error}`));
    }
    
  } catch (error) {
    logger.error('Cleanup command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}