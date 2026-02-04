import { DatabaseService } from '../services/database';
import { logger } from '../utils/logger';
import { CUTOVER_DATE } from '../config';

interface StatsOptions {
  detailed?: boolean;
}

export async function statsCommand(options: StatsOptions): Promise<void> {
  const db = new DatabaseService();
  
  try {
    await db.connect();
    
    logger.info('=== 3Speak Storage Statistics ===');
    logger.info(`📅 Cutover Date: ${CUTOVER_DATE.toISOString().split('T')[0]} (dual-daemon migration)`);
    
    // Get comprehensive stats with old/new separation
    const compStats = await db.getComprehensiveStats();
    
    logger.info('\n--- Repository Split ---');
    logger.info(`  🆕 New Repo (Manageable): ${compStats.newRepoVideos} videos, ${compStats.newRepoSizeGB} GB`);
    logger.info(`  📦 Old Repo (Read-Only Archive): ${compStats.oldRepoVideos} videos, ${compStats.oldRepoSizeGB} GB`);
    logger.info(`  📊 Total: ${compStats.totalVideos} videos, ${compStats.totalSizeGB} GB`);
    
    // Get basic video stats by status
    const stats = await db.getVideoStats();
    
    logger.info('\n--- Videos by Status ---');
    let totalVideos = 0;
    let totalSize = 0;
    let totalViews = 0;
    
    stats.forEach((stat: any) => {
      totalVideos += stat.count;
      totalSize += stat.totalSize || 0;
      totalViews += stat.totalViews || 0;
      
      const sizeGB = ((stat.totalSize || 0) / (1024 * 1024 * 1024)).toFixed(2);
      logger.info(`  ${stat._id}: ${stat.count} videos, ${stat.totalViews || 0} views, ${sizeGB} GB`);
    });
    
    const totalSizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(2);
    logger.info(`\n--- Totals ---`);
    logger.info(`  Total Videos: ${totalVideos}`);
    logger.info(`  Total Views: ${totalViews}`);
    logger.info(`  Total Size: ${totalSizeGB} GB`);
    
    // Get banned user count
    const bannedUsers = await db.getBannedUsers();
    logger.info(`  Banned Users: ${bannedUsers.length}`);
    
    // Get stuck videos (now only from new repo)
    const stuckVideos = await db.getStuckVideos();
    logger.info(`  Stuck Videos (30+ days, new repo only): ${stuckVideos.length}`);
    
    // Get cleanup statistics
    const cleanupStats = await db.getCleanupStats();
    logger.info(`  Videos Cleaned Up: ${cleanupStats.totalCleaned}`);
    logger.info(`  Recent Cleanups (7 days): ${cleanupStats.recentCleanups}`);
    
    if (options.detailed) {
      logger.info('\n--- Detailed Analysis ---');
      
      // Analyze storage types
      const allVideos = await db.getVideosByCriteria({});
      const storageTypes = {
        ipfs: 0,
        s3: 0,
        unknown: 0
      };
      
      allVideos.forEach(video => {
        const type = db.getVideoStorageType(video);
        storageTypes[type]++;
      });
      
      logger.info(`  IPFS Videos: ${storageTypes.ipfs}`);
      logger.info(`  S3 Videos: ${storageTypes.s3}`);
      logger.info(`  Unknown Storage: ${storageTypes.unknown}`);
      
      // Show some stuck video examples
      if (stuckVideos.length > 0) {
        logger.info('\n--- Sample Stuck Videos ---');
        stuckVideos.slice(0, 5).forEach(video => {
          logger.info(`  ${video._id} - ${video.owner} - ${video.status} - ${video.created.toISOString()}`);
        });
        if (stuckVideos.length > 5) {
          logger.info(`  ... and ${stuckVideos.length - 5} more`);
        }
      }

      // Show cleanup breakdown
      logger.info('\n--- Cleanup History ---');
      logger.info(`Total cleaned up: ${cleanupStats.totalCleaned}`);
      
      if (Object.keys(cleanupStats.cleanedByStorageType).length > 0) {
        logger.info('By Storage Type:');
        Object.entries(cleanupStats.cleanedByStorageType).forEach(([type, count]) => {
          logger.info(`  ${type}: ${count} videos`);
        });
      }
      
      if (Object.keys(cleanupStats.cleanedByReason).length > 0) {
        logger.info('By Cleanup Reason (recent):');
        Object.entries(cleanupStats.cleanedByReason).slice(0, 3).forEach(([reason, count]) => {
          logger.info(`  ${reason.substring(0, 50)}...: ${count} videos`);
        });
      }
    }
    
  } catch (error) {
    logger.error('Stats command failed', error);
    throw error;
  } finally {
    await db.disconnect();
  }
}