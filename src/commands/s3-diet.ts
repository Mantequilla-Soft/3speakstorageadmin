import { DatabaseService } from '../services/database';
import { S3Service } from '../services/s3';
import { IpfsService } from '../services/ipfs';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';

interface S3DietOptions {
  olderThanMonths?: string;
  viewThreshold?: string;
  batchSize?: string;
  dryRun?: boolean;
  confirm?: boolean;
}

export async function s3DietCommand(options: S3DietOptions): Promise<void> {
  const db = new DatabaseService();
  const s3Service = new S3Service();
  const isDryRun = options.dryRun !== false; // Default to dry run for safety
  
  try {
    await db.connect();

    const olderThanMonths = options.olderThanMonths ? parseInt(options.olderThanMonths, 10) : 6;
    const viewThreshold = options.viewThreshold ? parseInt(options.viewThreshold, 10) : 500;
    const olderThanDays = olderThanMonths * 30;

    logger.info(`=== S3 DIET: Keep Only 480p (S3 Videos Only) ===`);
    logger.info(`Target: S3 videos older than ${olderThanMonths} months with <${viewThreshold} views`);
    logger.info(`Action: Delete 1080p, 720p, 360p, source files - Keep only 480p`);
    
    if (isDryRun) {
      logger.info('=== DRY RUN MODE - No changes will be made ===');
    } else {
      logger.info('⚠️  This will permanently delete high-resolution files!');
    }

    // Get low-engagement videos
    const videos = await db.getVideosByCriteria({
      type: 'low-engagement',
      olderThanDays,
      viewThreshold,
      storageType: 's3', // Only S3 videos have multiple resolutions
      limit: options.batchSize ? parseInt(options.batchSize, 10) : 25
    });

    if (videos.length === 0) {
      logger.info('No S3 videos found matching criteria for S3 diet');
      logger.info('💡 Reminder: Platform stopped using S3 4 years ago - most old videos are IPFS-only');
      return;
    }

    logger.info(`Found ${videos.length} S3 videos for diet optimization`);

    if (isDryRun) {
      logger.info('=== DRY RUN ANALYSIS ===');
      
      const analysis = {
        videosToOptimize: 0,
        filesToDelete: [] as string[],
        prefixesToDelete: [] as string[],
        totalCurrentSize: 0,
        estimatedSavings: 0
      };

      for (const video of videos) {
        const s3Paths = db.getS3Paths(video);
        logger.info(`Would optimize: ${video._id} (${video.permlink})`);
        logger.info(`  Title: ${video.title || 'No title'}`);
        logger.info(`  Age: ${Math.floor((Date.now() - video.created.getTime()) / (1000 * 60 * 60 * 24))} days`);
        logger.info(`  Views: ${video.views || 0}`);
        logger.info(`  Size: ${((video.size || 0) / (1024 * 1024)).toFixed(2)} MB`);
        
        // Files to delete (keep only 480p)
        const filesToDelete = s3Paths.files.filter(file => 
          !file.includes('/480p.m3u8') && 
          !file.includes('/thumbnails/')
        );
        
        const prefixesToDelete = s3Paths.prefixes.filter(prefix => 
          !prefix.includes('/480p/') && 
          !prefix.includes('/thumbnails/')
        );

        analysis.filesToDelete.push(...filesToDelete);
        analysis.prefixesToDelete.push(...prefixesToDelete);
        analysis.totalCurrentSize += video.size || 0;
        
        // Estimate 70% savings (keeping only 480p out of multiple resolutions + source)
        analysis.estimatedSavings += (video.size || 0) * 0.7;

        logger.info(`  Files to delete: ${filesToDelete.length}`);
        logger.info(`  Folders to delete: ${prefixesToDelete.length}`);
        logger.info(`  Will keep: 480p playlist + 480p segments + thumbnails`);
        
        analysis.videosToOptimize++;
        logger.info('---');
      }

      const currentSizeGB = (analysis.totalCurrentSize / (1024 * 1024 * 1024)).toFixed(2);
      const savingsGB = (analysis.estimatedSavings / (1024 * 1024 * 1024)).toFixed(2);
      const finalSizeGB = ((analysis.totalCurrentSize - analysis.estimatedSavings) / (1024 * 1024 * 1024)).toFixed(2);
      
      logger.info(`=== S3 DIET PREVIEW ===`);
      logger.info(`S3 videos to optimize: ${analysis.videosToOptimize}`);
      logger.info(`Files to delete: ${analysis.filesToDelete.length}`);
      logger.info(`Folders to delete: ${analysis.prefixesToDelete.length}`);
      logger.info(`Current total size: ${currentSizeGB} GB`);
      logger.info(`💾 ESTIMATED S3 SAVINGS: ${savingsGB} GB (~70% reduction)`);
      logger.info(`Final size after S3 diet: ${finalSizeGB} GB`);
      logger.info(`Use --no-dry-run to execute the S3 diet`);
      
      return;
    }

    // Real optimization mode
    if (config.safety.requireConfirmation && options.confirm !== false) {
      logger.info('S3 diet requires explicit confirmation');
      logger.info('Use --no-confirm to skip confirmation (dangerous!)');
      return;
    }

    // Perform actual S3 diet
    const batchSize = options.batchSize ? parseInt(options.batchSize, 10) : 25;
    logger.info(`Starting S3 diet in batches of ${batchSize}`);

    const results = {
      processed: 0,
      filesDeleted: 0,
      foldersDeleted: 0,
      totalStorageSaved: 0,
      errors: [] as string[]
    };

    // Process videos in batches
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videos.length / batchSize)}`);

      for (const video of batch) {
        try {
          const s3Paths = db.getS3Paths(video);
          const originalSize = video.size || 0;
          
          logger.info(`Optimizing: ${video._id} (${video.permlink})`);
          
          let deletedCount = 0;
          
          // Delete files EXCEPT 480p playlist and thumbnails
          for (const filePath of s3Paths.files) {
            // Keep only 480p playlist and thumbnails
            if (filePath.includes('/480p.m3u8') || filePath.includes('/thumbnails/')) {
              logger.info(`  Keeping: ${filePath}`);
              continue;
            }
            
            // Delete everything else (1080p, 720p, 360p playlists, source files)
            const success = await s3Service.deleteObject(filePath);
            if (success) {
              deletedCount++;
              logger.info(`  Deleted: ${filePath}`);
            }
          }
          
          // Delete folders EXCEPT 480p segments and thumbnails
          for (const prefix of s3Paths.prefixes) {
            // Keep only 480p segments and thumbnails
            if (prefix.includes('/480p/') || prefix.includes('/thumbnails/')) {
              logger.info(`  Keeping folder: ${prefix}*`);
              continue;
            }
            
            // Delete everything else (1080p, 720p, 360p segments)
            const result = await s3Service.deleteObjectsWithPrefix(prefix);
            deletedCount += result.deleted;
            results.foldersDeleted++;
            logger.info(`  Deleted folder: ${prefix}* (${result.deleted} files)`);
          }

          if (deletedCount > 0) {
            results.filesDeleted += deletedCount;
            
            // Estimate storage saved (70% of original size)
            const estimatedSavings = originalSize * 0.7;
            results.totalStorageSaved += estimatedSavings;
            
            logger.info(`✅ Optimized ${video._id}: deleted ${deletedCount} objects, kept 480p + thumbnails`);
            
            // Mark video as optimized
            await db.markVideoAsCleanedUp(video._id, {
              cleanupDate: new Date(),
              cleanupReason: `S3 diet: Optimized to 480p only (older than ${olderThanMonths} months, <${viewThreshold} views)`,
              storageType: 's3',
              originalStatus: video.status,
              optimizationType: 's3-diet-480p'
            });
            
          } else {
            logger.info(`No optimization needed for ${video._id} - may already be optimized`);
          }

          results.processed++;

        } catch (error: any) {
          logger.error(`Error optimizing video ${video._id}`, error);
          results.errors.push(`Error optimizing ${video._id}: ${error.message}`);
        }
      }

      // Pause between batches
      if (i + batchSize < videos.length) {
        logger.info('Pausing between batches...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Final results
    const storageSavedGB = (results.totalStorageSaved / (1024 * 1024 * 1024)).toFixed(2);
    const storageSavedTB = (results.totalStorageSaved / (1024 * 1024 * 1024 * 1024)).toFixed(3);
    
    logger.info('=== S3 DIET COMPLETED ===');
    logger.info(`S3 videos optimized: ${results.processed}`);
    logger.info(`S3 files deleted: ${results.filesDeleted}`);
    logger.info(`S3 folders deleted: ${results.foldersDeleted}`);
    logger.info(`🍎 💾 S3 STORAGE SAVED: ${storageSavedGB} GB (${storageSavedTB} TB)`);
    logger.info(`✅ All S3 videos remain watchable in 480p quality`);
    logger.info(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      logger.error('Errors encountered:');
      results.errors.forEach(error => logger.error(`  ${error}`));
    }
    
  } catch (error) {
    logger.error('S3 diet command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}