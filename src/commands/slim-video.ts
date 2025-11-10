import { Command } from 'commander';
import { DatabaseService } from '../services/database';
import { S3Service } from '../services/s3';
import { logger } from '../utils/logger';
import { config } from '../config';

interface SlimVideoOptions {
  dryRun?: boolean;
  confirm?: boolean;
}

export function registerSlimVideoCommand(program: Command): void {
  program
    .command('slim-video')
    .description('Optimize storage for a specific video by keeping only the smallest resolution')
    .argument('<url>', '3Speak video URL (e.g., https://3speak.tv/watch?v=mes/zlsjctuz)')
    .option('--dry-run', 'Show what would be done without making changes', false)
    .option('--no-confirm', 'Skip confirmation prompt', false)
    .action(async (url: string, options: SlimVideoOptions) => {
      await slimVideoCommand(url, options);
    });
}

export async function slimVideoCommand(url: string, options: SlimVideoOptions): Promise<void> {
  const db = new DatabaseService();
  const s3Service = new S3Service();

  try {
    await db.connect();
    
    logger.info('=== SLIM SINGLE VIDEO ===');
    logger.info(`Target URL: ${url}`);
    
    // Parse the 3Speak URL to extract username and permlink
    const { username, permlink } = parse3SpeakUrl(url);
    
    if (!username || !permlink) {
      logger.error(`Invalid 3Speak URL format. Expected: https://3speak.tv/watch?v=username/permlink`);
      return;
    }
    
    logger.info(`Parsed - Username: ${username}, Permlink: ${permlink}`);
    
    // Find the video in the database
    const video = await db.findVideoByPermlink(permlink, username);
    
    if (!video) {
      logger.error(`Video not found: ${username}/${permlink}`);
      return;
    }
    
    logger.info(`📺 Found video: ${video.title || video.permlink}`);
    logger.info(`🆔 Video ID: ${video._id}`);
    logger.info(`👤 Owner: ${video.owner}`);
    logger.info(`📊 Status: ${video.status}`);
    logger.info(`💾 Size: ${video.size ? ((video.size / (1024 ** 2)).toFixed(2) + ' MB') : 'Unknown'}`);
    
    // Check storage type and show info
    const storageType = db.getVideoStorageType(video);
    logger.info(`🏪 Storage type: ${storageType.toUpperCase()}`);
    if (storageType !== 's3') {
      if (storageType === 'ipfs') {
        logger.info(`📁 Video is stored on IPFS - cannot be optimized with this tool.`);
        logger.info(`💡 IPFS videos are already efficiently stored and don't have multiple resolutions to optimize.`);
      } else {
        logger.error(`❌ Video storage type '${storageType}' is not supported. Only S3 videos can be optimized.`);
      }
      return;
    }
    
    // Check if already optimized
    if ((video as any).optimizedStorage) {
      logger.warn(`Video is already marked as optimized. Proceeding anyway...`);
    }
    
    // Analyze available resolutions
    logger.info('🔍 Analyzing available video resolutions...');
    const resolutionAnalysis = await s3Service.getAvailableResolutions(permlink);
    
    if (resolutionAnalysis.available.length === 0) {
      logger.error(`No video resolutions found for ${permlink}`);
      return;
    }
    
    logger.info(`📊 Available resolutions: ${resolutionAnalysis.available.join(', ')}`);
    logger.info(`🎯 Smallest resolution: ${resolutionAnalysis.smallest}`);
    
    if (resolutionAnalysis.toDelete.length === 0) {
      logger.info(`✨ Video is already optimized! Only ${resolutionAnalysis.smallest} resolution exists.`);
      return;
    }
    
    logger.info(`🗑️  Will delete: ${resolutionAnalysis.toDelete.join(', ')}`);
    
    // Calculate potential storage savings
    const estimatedSavings = (video.size || 0) * 0.8; // Estimate 80% savings
    const savingsFormatted = (estimatedSavings / (1024 ** 2)).toFixed(2);
    
    logger.info(`💾 Estimated storage savings: ${savingsFormatted} MB (~80% reduction)`);
    
    if (options.dryRun) {
      logger.info('✅ Dry run completed. No changes were made.');
      logger.info('Re-run without --dry-run (and with --no-confirm) to execute the optimization.');
      return;
    }
    
    if (config.safety.requireConfirmation && options.confirm !== false) {
      logger.info('⚠️  Confirmation required. Re-run with --no-confirm to execute this optimization.');
      return;
    }
    
    logger.info(`🚀 Starting optimization for ${username}/${permlink}`);
    logger.info(`📝 Strategy: Keep ${resolutionAnalysis.smallest}, delete ${resolutionAnalysis.toDelete.join(', ')}`);
    
    // Get paths for content to delete
    const s3Paths = db.getS3PathsForSlim(video, resolutionAnalysis.toDelete);
    
    let deletedObjects = 0;
    
    // Delete individual files (playlists)
    logger.info('🗑️  Deleting resolution playlists...');
    for (const filePath of s3Paths.files) {
      const success = await s3Service.deleteObject(filePath);
      if (success) {
        deletedObjects++;
      }
    }
    
    // Delete HLS segment folders for unwanted resolutions
    logger.info('🗑️  Deleting video segments...');
    for (const prefix of s3Paths.prefixes) {
      logger.info(`Deleting segments in: ${prefix}`);
      const result = await s3Service.deleteObjectsWithPrefix(prefix);
      deletedObjects += result.deleted;
      logger.info(`Deleted ${result.deleted} segments`);
    }
    
    // Update master playlist to only reference the smallest resolution
    logger.info(`📝 Updating master playlist to reference only ${resolutionAnalysis.smallest}...`);
    const playlistUpdated = await s3Service.updateMasterPlaylistForSmallest(permlink, resolutionAnalysis.smallest!);
    
    if (!playlistUpdated) {
      logger.error(`❌ Failed to update master playlist for ${permlink} - video may not play correctly`);
      return;
    }
    
    // Mark video as optimized in database
    logger.info('📊 Updating database record...');
    await db.updateVideoOptimizationFlag(video._id, {
      optimizedDate: new Date(),
      optimizationType: 'storage-slim-video',
      optimizedBy: `slim-video:${username}/${permlink}`,
      storageReduction: estimatedSavings
    });
    
    logger.info('✅ Video optimization completed successfully!');
    logger.info(`🗑️  Deleted objects: ${deletedObjects}`);
    logger.info(`💾 Estimated storage freed: ${savingsFormatted} MB`);
    logger.info(`🎥 Video should still be playable at: ${url}`);
    logger.info(`📱 Master playlist now references only ${resolutionAnalysis.smallest} resolution`);
    
  } catch (error: any) {
    logger.error('Failed to optimize video', error);
  } finally {
    await db.disconnect();
  }
}

/**
 * Parse a 3Speak URL to extract username and permlink
 * Supports formats like:
 * - https://3speak.tv/watch?v=username/permlink
 * - https://3speak.online/watch?v=username/permlink
 * - username/permlink (direct format)
 */
function parse3SpeakUrl(url: string): { username: string | null; permlink: string | null } {
  try {
    // Handle direct username/permlink format
    if (!url.includes('http') && url.includes('/')) {
      const parts = url.split('/');
      if (parts.length === 2) {
        return { username: parts[0], permlink: parts[1] };
      }
    }
    
    // Handle full URL format
    const urlObj = new URL(url);
    const videoParam = urlObj.searchParams.get('v');
    
    if (!videoParam) {
      return { username: null, permlink: null };
    }
    
    const parts = videoParam.split('/');
    if (parts.length !== 2) {
      return { username: null, permlink: null };
    }
    
    return { username: parts[0], permlink: parts[1] };
  } catch (error) {
    // If URL parsing fails, try direct format
    if (url.includes('/')) {
      const parts = url.split('/');
      if (parts.length === 2) {
        return { username: parts[0], permlink: parts[1] };
      }
    }
    
    return { username: null, permlink: null };
  }
}