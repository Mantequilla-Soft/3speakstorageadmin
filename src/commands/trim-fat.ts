import { DatabaseService } from '../services/database';
import { S3Service } from '../services/s3';
import { IpfsService } from '../services/ipfs';
import { Video } from '../types';
import { logger } from '../utils/logger';
import { config, CUTOVER_DATE } from '../config';
import { ProgressBar } from '../utils/progress';

interface TrimFatOptions {
  username?: string;
  olderThanMonths?: string;
  viewThreshold?: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function trimFatCommand(options: TrimFatOptions): Promise<void> {
  const username = options.username?.trim();
  if (!username) {
    logger.error('The --username option is required for trim-fat');
    return;
  }

  const olderThanMonths = options.olderThanMonths ? parseInt(options.olderThanMonths, 10) : 0;
  const viewThreshold = options.viewThreshold ? parseInt(options.viewThreshold, 10) : 999999;
  
  if (olderThanMonths < 0 || olderThanMonths > 120) {
    logger.error('Invalid --older-than-months value. Please provide a number between 0 and 120.');
    return;
  }

  if (viewThreshold < 1) {
    logger.error('Invalid --view-threshold value. Please provide a positive number.');
    return;
  }

  const db = new DatabaseService();
  const s3Service = new S3Service();
  const ipfsService = new IpfsService();
  const isDryRun = options.dryRun === true; // Only dry run when explicitly specified

  try {
    await db.connect();

    const olderThanDays = olderThanMonths * 30;

    logger.info(`=== TRIM FAT: Account-Specific Content Cleanup ===`);
    logger.info(`Target account: ${username}`);
    
    if (olderThanMonths > 0 && viewThreshold < 999999) {
      logger.info(`Criteria: Videos older than ${olderThanMonths} months AND less than ${viewThreshold} views`);
    } else if (olderThanMonths > 0) {
      logger.info(`Criteria: Videos older than ${olderThanMonths} months (${Math.floor(olderThanMonths / 12)} years)`);
    } else {
      logger.info(`Criteria: Videos with less than ${viewThreshold} views (any age)`);
    }
    
    logger.info(`Action: Delete S3 files, unpin IPFS hashes (content becomes inaccessible)`);
    
    if (isDryRun) {
      logger.info('=== DRY RUN MODE - No changes will be made ===');
    } else {
      logger.info('⚠️  This will permanently remove content!');
    }

    // Get videos for the specific account
    const criteria: any = {
      type: 'account-specific',
      username: username,
      limit: options.batchSize ? parseInt(options.batchSize, 10) : 25
    };

    // Add age filter if specified
    if (olderThanMonths > 0) {
      criteria.olderThanDays = olderThanDays;
    }

    // Add view threshold if specified  
    if (viewThreshold < 999999) {
      criteria.viewThreshold = viewThreshold;
    }

    // Include already cleaned videos?
    if (!options.includeCleaned) {
      criteria.excludeCleaned = true;
    }

    const videos = await db.getVideosByCriteria(criteria);

    if (videos.length === 0) {
      logger.info(`No videos found for account '${username}' matching criteria`);
      logger.info('💡 Account is already lean or criteria too restrictive');
      return;
    }

    logger.info(`Found ${videos.length} videos for account '${username}' matching trim criteria`);

    if (isDryRun) {
      logger.info('=== DRY RUN ANALYSIS ===');
      
      const analysis = {
        s3Videos: 0,
        ipfsVideos: 0,
        unknownVideos: 0,
        totalCurrentSize: 0,
        estimatedSavings: 0,
        s3ObjectsToDelete: 0,
        ipfsHashesToUnpin: 0
      };

      for (const video of videos) {
        const storageType = db.getVideoStorageType(video);
        const videoSize = video.size || 0;
        
        logger.info(`Would remove: ${video._id} (${video.permlink})`);
        logger.info(`  Title: ${video.title || 'No title'}`);
        logger.info(`  Owner: ${video.owner}`);
        logger.info(`  Age: ${Math.floor((Date.now() - video.created.getTime()) / (1000 * 60 * 60 * 24))} days`);
        logger.info(`  Views: ${video.views || 0}`);
        logger.info(`  Size: ${((videoSize) / (1024 * 1024)).toFixed(2)} MB`);
        logger.info(`  Storage: ${storageType.toUpperCase()}`);
        
        analysis.totalCurrentSize += videoSize;
        analysis.estimatedSavings += videoSize;
        
        if (storageType === 's3') {
          analysis.s3Videos++;
          const s3Paths = db.getS3Paths(video);
          analysis.s3ObjectsToDelete += s3Paths.files.length + s3Paths.prefixes.length;
          logger.info(`  Action: DELETE S3 files (${s3Paths.files.length + s3Paths.prefixes.length} objects)`);
        } else if (storageType === 'ipfs') {
          analysis.ipfsVideos++;
          const hash = IpfsService.extractHashFromFilename(video.filename || '');
          if (hash) {
            analysis.ipfsHashesToUnpin++;
            logger.info(`  Action: UNPIN IPFS hash ${hash}`);
          }
        } else {
          analysis.unknownVideos++;
          logger.info(`  Action: SKIP (unknown storage type)`);
        }
        
        logger.info('---');
      }

      const currentSizeGB = (analysis.totalCurrentSize / (1024 * 1024 * 1024)).toFixed(2);
      const savingsGB = (analysis.estimatedSavings / (1024 * 1024 * 1024)).toFixed(2);
      const savingsTB = (analysis.estimatedSavings / (1024 * 1024 * 1024 * 1024)).toFixed(3);
      
      logger.info(`=== TRIM FAT PREVIEW ===`);
      logger.info(`Account: ${username}`);
      logger.info(`S3 videos to delete: ${analysis.s3Videos}`);
      logger.info(`IPFS videos to unpin: ${analysis.ipfsVideos}`);
      logger.info(`Unknown/skipped: ${analysis.unknownVideos}`);
      logger.info(`S3 objects to delete: ${analysis.s3ObjectsToDelete}`);
      logger.info(`IPFS hashes to unpin: ${analysis.ipfsHashesToUnpin}`);
      logger.info(`Current total size: ${currentSizeGB} GB`);
      logger.info(`💾 ESTIMATED STORAGE FREED: ${savingsGB} GB (${savingsTB} TB)`);
      logger.info(`⚠️  WARNING: Content will become inaccessible!`);
      logger.info(`Use --no-dry-run to execute the fat trimming`);
      
      return;
    }

    // Real trimming mode - check for explicit confirmation
    if (config.safety.requireConfirmation && options.confirm !== false) {
      logger.info('🚨 Trim fat requires explicit confirmation to proceed');
      logger.info('💡 Use --no-confirm to skip confirmation and execute fat trimming');
      logger.info('⚠️  Running without --no-confirm will NOT perform storage cleanup!');
      logger.info('📊 Found videos that would be processed, but exiting due to safety confirmation');
      return;
    }

    // Perform actual fat trimming
    const batchSize = options.batchSize ? parseInt(options.batchSize, 10) : 25;
    logger.info(`Starting account fat trimming in batches of ${batchSize}`);

    const results = {
      processed: 0,
      s3ObjectsDeleted: 0,
      ipfsUnpinned: 0,
      totalStorageFreed: 0,
      errors: [] as string[]
    };

    const progressBar = new ProgressBar(videos.length, 'Trimming account fat');

    // Process videos in batches
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videos.length / batchSize)}`);

      for (const video of batch) {
        try {
          const storageType = db.getVideoStorageType(video);
          const videoTitle = video.title || video.permlink || video._id;
          progressBar.update(results.processed, `${videoTitle.substring(0, 30)}...`);
          
          const originalSize = video.size || 0;
          
          // Handle S3 videos
          if (storageType === 's3') {
            const s3Paths = db.getS3Paths(video);
            let deletedCount = 0;
            let totalAttempts = 0;

            logger.info(`Trimming S3 video: ${video._id} (${video.permlink})`);
            logger.info(`  Size: ${((originalSize) / (1024 * 1024)).toFixed(2)} MB`);
            
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

            results.s3ObjectsDeleted += deletedCount;
            results.totalStorageFreed += originalSize;
            
            logger.info(`✅ Trimmed S3 video ${video._id}: ${deletedCount}/${totalAttempts} objects deleted (${((originalSize) / (1024 * 1024)).toFixed(2)} MB freed)`);
          }
          
          // Handle IPFS videos
          else if (storageType === 'ipfs') {
            const hash = IpfsService.extractHashFromFilename(video.filename || '');
            
            if (hash) {
              logger.info(`Trimming IPFS video: ${video._id} (${video.permlink})`);
              logger.info(`  Hash: ${hash}`);
              logger.info(`  Size: ${((originalSize) / (1024 * 1024)).toFixed(2)} MB`);
              
              const success = await ipfsService.unpinHash(hash);
              
              if (success) {
                results.ipfsUnpinned++;
                results.totalStorageFreed += originalSize;
                logger.info(`✅ Trimmed IPFS video ${video._id}: hash unpinned (${((originalSize) / (1024 * 1024)).toFixed(2)} MB freed)`);
              } else {
                logger.error(`Failed to unpin IPFS hash for ${video._id}: ${hash}`);
                results.errors.push(`Failed to unpin ${video._id}: ${hash}`);
              }
            } else {
              logger.info(`Skipping ${video._id}: No IPFS hash found`);
            }
          }
          
          // Mark video as cleaned up
          await db.markVideoAsCleanedUp(video._id, {
            cleanupDate: new Date(),
            cleanupReason: `Account fat trimming: ${username} (${olderThanMonths > 0 ? `${olderThanMonths} months old` : 'any age'}, ${viewThreshold < 999999 ? `<${viewThreshold} views` : 'any views'})`,
            storageType: storageType,
            originalStatus: video.status,
            optimizationType: 'account-fat-trimming'
          });

          results.processed++;

        } catch (error: any) {
          logger.error(`Error processing video ${video._id}`, error);
          results.errors.push(`Error processing ${video._id}: ${error.message}`);
        }
      }

      // Pause between batches
      if (i + batchSize < videos.length) {
        logger.info('Pausing between batches...');
        await sleep(2000);
      }
    }

    progressBar.complete();

    // Final results
    const storageFreedGB = (results.totalStorageFreed / (1024 * 1024 * 1024)).toFixed(2);
    const storageFreedTB = (results.totalStorageFreed / (1024 * 1024 * 1024 * 1024)).toFixed(3);
    
    logger.info('=== ACCOUNT FAT TRIMMING COMPLETED ===');
    logger.info(`Account: ${username}`);
    logger.info(`Videos processed: ${results.processed}`);
    logger.info(`S3 objects deleted: ${results.s3ObjectsDeleted}`);
    logger.info(`IPFS hashes unpinned: ${results.ipfsUnpinned}`);
    logger.info(`✂️ 💾 STORAGE FREED: ${storageFreedGB} GB (${storageFreedTB} TB)`);
    logger.info(`Account fat successfully trimmed!`);
    logger.info(`Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      logger.error('Errors encountered:');
      results.errors.forEach(error => logger.error(`  ${error}`));
    }
    
  } catch (error) {
    logger.error('Trim fat command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}