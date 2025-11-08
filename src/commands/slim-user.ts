import { DatabaseService } from '../services/database';
import { S3Service } from '../services/s3';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import { ProgressBar } from '../utils/progress';

interface SlimUserOptions {
  username?: string;
  olderThanMonths?: string;
  batchSize?: string;
  dryRun?: boolean;
  confirm?: boolean;
  includeCleaned?: boolean;
}

function formatBytes(bytes: number): { gb: string; tb: string } {
  const gb = (bytes / (1024 ** 3)).toFixed(2);
  const tb = (bytes / (1024 ** 4)).toFixed(3);
  return { gb, tb };
}

function calculateCostSavings(bytesFreed: number): {
  dailyCost: number;
  monthlyCost: number;
  annualCost: number;
} {
  const gbFreed = bytesFreed / (1024 ** 3);
  const dailyCost = gbFreed * 0.00022754; // Eddie's rate from check-account-storage.js
  const monthlyCost = dailyCost * 30;
  const annualCost = dailyCost * 365;
  
  return { dailyCost, monthlyCost, annualCost };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function slimUserCommand(options: SlimUserOptions): Promise<void> {
  const username = options.username?.trim();
  if (!username) {
    logger.error('The --username option is required for slim-user');
    return;
  }

  const olderThanMonths = options.olderThanMonths ? parseInt(options.olderThanMonths, 10) : 6;
  if (Number.isNaN(olderThanMonths) || olderThanMonths <= 0) {
    logger.error('Invalid --older-than-months value. Please provide a positive number.');
    return;
  }

  const batchSizeInput = options.batchSize ? parseInt(options.batchSize, 10) : 25;
  if (Number.isNaN(batchSizeInput) || batchSizeInput <= 0) {
    logger.error('Invalid batch size specified. Please provide a positive number.');
    return;
  }
  const batchSize = Math.min(batchSizeInput, 200);

  const includeCleaned = options.includeCleaned === true;

  const db = new DatabaseService();
  const s3Service = new S3Service();

  try {
    await db.connect();

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - olderThanMonths);

    logger.info('=== SLIM USER ANALYSIS ===');
    logger.info(`Target account: ${username}`);
    logger.info(`Age threshold: Videos older than ${olderThanMonths} months (before ${cutoffDate.toISOString().split('T')[0]})`);
    logger.info(`Include already optimized: ${includeCleaned}`);

    // Get all user videos
    const allVideos = await db.getVideosByOwner(username, { includeCleaned });
    
    if (allVideos.length === 0) {
      logger.info(`No videos found for account ${username}`);
      return;
    }

    // Filter by age and S3 storage type
    const eligibleVideos = allVideos.filter(video => {
      // Must be older than threshold
      if (!video.created || new Date(video.created) >= cutoffDate) {
        return false;
      }
      
      // Must be S3-based (not IPFS)
      const storageType = db.getVideoStorageType(video);
      if (storageType !== 's3') {
        return false;
      }
      
      // Skip if already optimized (unless includeCleaned is true)
      if (!includeCleaned && (video as any).optimizedStorage) {
        return false;
      }

      return true;
    });

    if (eligibleVideos.length === 0) {
      logger.info(`No eligible videos found for ${username} older than ${olderThanMonths} months`);
      return;
    }

    // Calculate potential savings
    let totalCurrentSize = 0;
    let estimatedSavings = 0;
    const resolutionsToDelete = ['1080p', '720p', '360p'];

    for (const video of eligibleVideos) {
      totalCurrentSize += video.size || 0;
      // Estimate 70% savings (based on storage diet testing)
      estimatedSavings += (video.size || 0) * 0.7;
    }

    const currentStorage = formatBytes(totalCurrentSize);
    const savingsStorage = formatBytes(estimatedSavings);
    const costSavings = calculateCostSavings(estimatedSavings);

    logger.info(`Eligible videos found: ${eligibleVideos.length}`);
    logger.info(`Current storage: ${currentStorage.gb} GB (${currentStorage.tb} TB)`);
    logger.info(`Estimated savings: ${savingsStorage.gb} GB (${savingsStorage.tb} TB) - ~70% reduction`);
    logger.info(`💰 Cost savings: $${costSavings.dailyCost.toFixed(4)}/day, $${costSavings.monthlyCost.toFixed(2)}/month, $${costSavings.annualCost.toFixed(2)}/year`);

    // Show sample videos
    const sampleSize = Math.min(5, eligibleVideos.length);
    logger.info('Sample eligible videos:');
    for (let i = 0; i < sampleSize; i++) {
      const video = eligibleVideos[i];
      const title = video.title || video.permlink || video._id;
      const age = new Date(video.created!);
      logger.info(`  ${i + 1}. ${title} | ${age.toISOString().split('T')[0]} | ${((video.size || 0) / (1024 ** 2)).toFixed(2)} MB`);
    }

    if (options.dryRun) {
      logger.info('Dry run completed. No changes were made.');
      logger.info('Re-run without --dry-run (and with --no-confirm) to execute the optimization.');
      return;
    }

    if (config.safety.requireConfirmation && options.confirm !== false) {
      logger.info('Confirmation required. Re-run with --no-confirm to execute this optimization.');
      return;
    }

    logger.info(`Starting storage optimization for ${username} (${olderThanMonths}+ month old videos)`);
    logger.info(`Deleting resolutions: ${resolutionsToDelete.join(', ')} + source files`);
    logger.info(`Keeping: 480p playlist + segments + thumbnails`);

    const results = {
      processed: 0,
      batches: 0,
      s3ObjectsDeleted: 0,
      dbUpdated: 0,
      totalStorageFreed: 0,
      errors: [] as string[],
    };

    const progressBar = new ProgressBar(eligibleVideos.length, `Optimizing ${username}`);

    for (let i = 0; i < eligibleVideos.length; i += batchSize) {
      const batch = eligibleVideos.slice(i, i + batchSize);
      results.batches++;

      for (const video of batch) {
        try {
          const label = (video.title || video.permlink || video._id).substring(0, 30);
          let videoStorageFreed = 0;

          // Use the specialized method that excludes 480p content
          const s3Paths = db.getS3PathsForSlim(video);
          
          // All files and prefixes returned are safe to delete (480p excluded)
          const filesToDelete = s3Paths.files;
          const prefixesToDelete = s3Paths.prefixes;

          // Delete individual files
          for (const filePath of filesToDelete) {
            const success = await s3Service.deleteObject(filePath);
            if (success) {
              results.s3ObjectsDeleted++;
            }
          }

          // Delete HLS segment folders
          for (const prefix of prefixesToDelete) {
            const result = await s3Service.deleteObjectsWithPrefix(prefix);
            results.s3ObjectsDeleted += result.deleted;
          }

          // Estimate storage freed (70% of original size)
          videoStorageFreed = (video.size || 0) * 0.7;

          // Mark as optimized in database
          await db.markVideoAsCleanedUp(video._id, {
            cleanupDate: new Date(),
            cleanupReason: `slim-user:${username}:${olderThanMonths}months`,
            storageType: 's3',
            originalStatus: video.status,
            optimizationType: 'storage-diet-user'
          });

          results.dbUpdated++;
          results.processed++;
          results.totalStorageFreed += videoStorageFreed;

          progressBar.increment(`[optimized] ${label}`);

        } catch (error: any) {
          const message = `Failed to optimize video ${video._id}: ${error.message || error}`;
          logger.error(message, error);
          results.errors.push(message);
          results.processed++;
          progressBar.increment('error');
        }
      }

      if (i + batchSize < eligibleVideos.length) {
        await sleep(1000);
      }
    }

    progressBar.complete('User optimization finished');
    console.log('');

    const finalStorage = formatBytes(results.totalStorageFreed);
    const finalCostSavings = calculateCostSavings(results.totalStorageFreed);

    logger.info('=== SLIM USER COMPLETED ===');
    logger.info(`Account: ${username}`);
    logger.info(`Age threshold: ${olderThanMonths}+ months`);
    logger.info(`Videos processed: ${results.processed}`);
    logger.info(`Batches: ${results.batches}`);
    logger.info(`S3 objects deleted: ${results.s3ObjectsDeleted}`);
    logger.info(`Database records updated: ${results.dbUpdated}`);
    logger.info(`💾 STORAGE FREED: ${finalStorage.gb} GB (${finalStorage.tb} TB)`);
    logger.info(`💰 COST SAVINGS: $${finalCostSavings.dailyCost.toFixed(4)}/day | $${finalCostSavings.monthlyCost.toFixed(2)}/month | $${finalCostSavings.annualCost.toFixed(2)}/year`);
    logger.info(`Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      logger.error('Errors encountered during optimization:');
      results.errors.forEach(err => logger.error(`  - ${err}`));
    }

  } catch (error) {
    logger.error('Slim user command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}