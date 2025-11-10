import { logger } from '../utils/logger';
import { DatabaseService } from '../services/database';
import { S3Service } from '../services/s3';
import { ProgressBar } from '../utils/progress';
import { Video } from '../types';

interface ReconcileOptions {
  username: string;
  batchSize: number;
  dryRun: boolean;
  noConfirm: boolean;
  includeOptimized: boolean;
}

interface ReconciliationResult {
  total: number;
  existing: number;
  missing: number;
  cleaned: number;
  errors: number;
  missingVideos: Array<{
    _id: string;
    permlink: string;
    title: string;
    status: string;
    size?: number;
  }>;
}

export async function reconcileS3Command(options: ReconcileOptions) {
  const dbService = new DatabaseService();
  const s3Service = new S3Service();
  
  try {
    await dbService.connect();
    logger.info('=== S3 STORAGE RECONCILIATION ===');
    logger.info(`Target user: ${options.username}`);
    
    // Find all S3 videos for the user using existing method
    const criteria = {
      type: 'account-specific',
      username: options.username,
      excludeCleaned: !options.includeOptimized,
      storageType: 's3' // Only S3 videos
    };

    logger.info(`🔍 Finding S3 videos for user: ${options.username}`);
    
    const videos = await dbService.getVideosByCriteria(criteria, 10000); // Large limit for user reconciliation
    logger.info(`📊 Found ${videos.length} S3 videos to reconcile`);

    if (videos.length === 0) {
      logger.info('✅ No S3 videos found for this user. Nothing to reconcile.');
      return;
    }

    const result: ReconciliationResult = {
      total: videos.length,
      existing: 0,
      missing: 0,
      cleaned: 0,
      errors: 0,
      missingVideos: []
    };

    // Filter S3 videos only (videos with filename but not IPFS hashes)
    const s3Videos = videos.filter((video: Video) => {
      return dbService.getVideoStorageType(video) === 's3';
    });

    if (s3Videos.length === 0) {
      logger.info('✅ No pure S3 videos found (all have IPFS hashes). Nothing to reconcile.');
      return;
    }

    logger.info(`🎯 Reconciling ${s3Videos.length} pure S3 videos`);
    
    if (options.dryRun) {
      logger.info('🔍 DRY RUN MODE - No changes will be made');
    }

    // Show confirmation if not in no-confirm mode
    if (!options.noConfirm && !options.dryRun) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>((resolve) => {
        readline.question(
          `⚠️  This will mark missing S3 videos as deleted for user "${options.username}". Continue? (yes/no): `,
          (answer: string) => {
            readline.close();
            resolve(answer.toLowerCase());
          }
        );
      });

      if (answer !== 'yes' && answer !== 'y') {
        logger.info('❌ Operation cancelled by user');
        return;
      }
    }

    const progress = new ProgressBar(s3Videos.length, 'Reconciling S3 videos');

    // Process videos in batches
    for (let i = 0; i < s3Videos.length; i += options.batchSize) {
      const batch = s3Videos.slice(i, i + options.batchSize);
      
      for (const video of batch) {
        try {
          progress.increment();
          
          const permlink = video.permlink;
          const filename = video.filename;
          
          logger.info(`🔍 Checking video: ${permlink} (${filename})`);
          
          // Check if any resolution manifest exists on S3
          const resolutions = ['360p', '480p', '720p', '1080p'];
          let exists = false;
          let foundResolution = '';
          
          // Check each resolution to see if any manifest exists
          for (const resolution of resolutions) {
            const manifestKey = `${permlink}/${resolution}.m3u8`;
            const manifestExists = await s3Service.objectExists(manifestKey);
            if (manifestExists) {
              exists = true;
              foundResolution = resolution;
              break; // Found at least one, video is available
            }
          }
          
          if (exists) {
            logger.info(`✅ Video exists: ${permlink} (found ${foundResolution} manifest)`);
            result.existing++;
          } else {
            logger.warn(`❌ Missing video: ${permlink} - No manifests found on S3`);
            result.missing++;
            
            // Add to missing videos list
            result.missingVideos.push({
              _id: video._id.toString(),
              permlink: video.permlink,
              title: video.title || 'Untitled',
              status: video.status || 'unknown',
              size: video.size
            });

            if (!options.dryRun) {
              // Mark video as cleaned up (missing from S3)
              await dbService.markVideoAsCleanedUp(video._id, {
                cleanupDate: new Date(),
                cleanupReason: 'S3 reconciliation - files missing from storage',
                storageType: 's3',
                originalStatus: video.status
              });
              
              logger.info(`🗑️  Marked as deleted: ${permlink}`);
              result.cleaned++;
            } else {
              logger.info(`🔍 DRY RUN: Would mark as deleted: ${permlink}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Error processing video ${video.permlink}:`, error);
          result.errors++;
        }
      }

      // Small delay between batches to prevent overwhelming the system
      if (i + options.batchSize < s3Videos.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    progress.complete('Reconciliation finished');

    // Summary report
    logger.info('');
    logger.info('=== RECONCILIATION SUMMARY ===');
    logger.info(`📊 Total S3 videos checked: ${result.total}`);
    logger.info(`✅ Videos existing on S3: ${result.existing}`);
    logger.info(`❌ Missing videos found: ${result.missing}`);
    
    if (!options.dryRun) {
      logger.info(`🗑️  Videos marked as deleted: ${result.cleaned}`);
    } else {
      logger.info(`🔍 Videos that would be marked as deleted: ${result.missing}`);
    }
    
    if (result.errors > 0) {
      logger.warn(`⚠️  Errors encountered: ${result.errors}`);
    }

    // List missing videos if any
    if (result.missingVideos.length > 0) {
      logger.info('');
      logger.info('=== MISSING VIDEOS DETAILS ===');
      for (const video of result.missingVideos) {
        const sizeStr = video.size ? ` (${(video.size / 1024 / 1024).toFixed(1)} MB)` : '';
        logger.info(`❌ ${video.permlink} - "${video.title}" [${video.status}]${sizeStr}`);
      }
    }

    // Storage impact calculation
    if (result.missing > 0) {
      const totalSizeMB = result.missingVideos
        .filter(v => v.size)
        .reduce((sum, v) => sum + (v.size || 0), 0) / 1024 / 1024;
      
      if (totalSizeMB > 0) {
        logger.info('');
        logger.info(`💾 Database storage cleaned: ${totalSizeMB.toFixed(1)} MB of phantom video records`);
      }
    }

    if (options.dryRun) {
      logger.info('');
      logger.info('💡 To execute the reconciliation, run without --dry-run flag');
    }

  } catch (error) {
    logger.error('Reconciliation failed:', error);
    throw error;
  } finally {
    await dbService.disconnect();
  }
}