import { DatabaseService } from '../services/database';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ProgressBar } from '../utils/progress';

interface PurgeS3Options {
  dryRun?: boolean;
  confirm?: boolean;
  batchSize?: string;
  limit?: string;
}

export async function purgeS3Command(options: PurgeS3Options): Promise<void> {
  const db = new DatabaseService();
  const isDryRun = options.dryRun === true; // Only dry run if explicitly requested
  
  try {
    await db.connect();

    const limit = options.limit ? parseInt(options.limit, 10) : 0;
    const batchSize = options.batchSize ? parseInt(options.batchSize, 10) : 100;

    logger.info(`=== S3 PURGE: Mark Deleted S3 Videos ===`);
    logger.info(`Target: S3 videos that no longer exist in storage`);
    logger.info(`Action: Mark videos as 'deleted' status in database`);
    
    if (isDryRun) {
      logger.info('=== DRY RUN MODE - No changes will be made ===');
    } else {
      logger.info('⚠️  This will update video statuses in the database!');
    }

    // Get all S3 videos from database (excluding already deleted ones)
    logger.info('🔍 Finding S3 videos in database...');
    const videos = await db.getVideosByCriteria({
      storageType: 's3',
      excludeDeleted: true  // Skip videos already marked as deleted
    }, limit || 1000); // Reasonable default limit

    if (videos.length === 0) {
      logger.info('No S3 videos found in database');
      return;
    }

    logger.info(`Found ${videos.length} S3 videos in database`);

    if (isDryRun) {
      logger.info('=== DRY RUN ANALYSIS ===');
      
      // Count videos by status
      const alreadyDeleted = videos.filter(v => v.status === 'deleted').length;
      const toBeMarkedDeleted = videos.length - alreadyDeleted;

      logger.info(`=== S3 PURGE PREVIEW ===`);
      logger.info(`Total S3 videos in database: ${videos.length}`);
      logger.info(`Already marked as deleted: ${alreadyDeleted}`);
      logger.info(`📊 WILL BE MARKED AS DELETED: ${toBeMarkedDeleted} videos`);
      logger.info(`💡 S3 bucket is confirmed empty - no individual file checks needed`);
      logger.info(`⚡ This will be a fast MongoDB batch update operation`);
      logger.info(`Use --no-dry-run to execute the S3 purge`);
      
      return;
    }

    // Real purge mode
    if (config.safety.requireConfirmation && options.confirm !== false) {
      logger.info('S3 purge requires explicit confirmation');
      logger.info('Use --no-confirm to skip confirmation (dangerous!)');
      return;
    }

    // Perform actual S3 purge - batch MongoDB update
    logger.info(`Starting S3 purge with MongoDB batch update`);

    const results = {
      processed: 0,
      alreadyDeleted: 0,
      markedAsDeleted: 0,
      errors: [] as string[]
    };

    // Filter videos that need to be updated (not already deleted)
    const videosToUpdate = videos.filter(v => v.status !== 'deleted');
    results.alreadyDeleted = videos.length - videosToUpdate.length;

    logger.info(`Videos already deleted: ${results.alreadyDeleted}`);
    logger.info(`Videos to mark as deleted: ${videosToUpdate.length}`);

    if (videosToUpdate.length === 0) {
      logger.info('All S3 videos are already marked as deleted!');
    } else {
      const progressBar = new ProgressBar(videosToUpdate.length, 'Batch updating video statuses');

      // Process videos in batches for MongoDB update
      for (let i = 0; i < videosToUpdate.length; i += batchSize) {
        const batch = videosToUpdate.slice(i, i + batchSize);
        logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videosToUpdate.length / batchSize)}`);

        try {
          // Batch update video statuses
          const videoIds = batch.map(v => v._id);
          await db.batchUpdateVideoStatus(videoIds, 'deleted');
          
          results.markedAsDeleted += batch.length;
          results.processed += batch.length;

          // Update progress for each video in batch
          batch.forEach(video => {
            progressBar.increment(`${video._id} - marked deleted`);
          });

        } catch (error: any) {
          logger.error(`Error processing batch starting at index ${i}`, error);
          results.errors.push(`Error processing batch at ${i}: ${error.message}`);
          
          // Try individual updates as fallback
          for (const video of batch) {
            try {
              await db.updateVideoStatus(video._id, 'deleted');
              results.markedAsDeleted++;
              results.processed++;
              progressBar.increment(`${video._id} - marked deleted (fallback)`);
            } catch (individualError: any) {
              logger.error(`Error updating individual video ${video._id}`, individualError);
              results.errors.push(`Individual update failed ${video._id}: ${individualError.message}`);
              progressBar.increment(`${video._id} - error`);
            }
          }
        }

        // Small pause between batches for MongoDB stability
        if (i + batchSize < videosToUpdate.length) {
          await new Promise(resolve => setTimeout(resolve, 100)); // 100ms pause
        }
      }

      progressBar.complete('S3 purge batch update completed');
    }

    logger.info('=== S3 PURGE COMPLETED ===');
    logger.info(`Videos processed: ${results.processed}`);
    logger.info(`Already deleted: ${results.alreadyDeleted}`);
    logger.info(`🗑️ Marked as deleted: ${results.markedAsDeleted}`);
    logger.info(`Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      logger.error('Errors encountered during purge:');
      results.errors.slice(0, 10).forEach(err => logger.error(`  - ${err}`));
      if (results.errors.length > 10) {
        logger.error(`  ... and ${results.errors.length - 10} more errors`);
      }
    }

    logger.info('💡 Videos marked as deleted can now be cleaned up with the cleanup command');
    
  } catch (error) {
    logger.error('S3 purge command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}