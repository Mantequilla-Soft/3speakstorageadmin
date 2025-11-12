import { MongoClient, Db, Collection } from 'mongodb';
import { ContentCreator, Video, CleanupCriteria } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

export class DatabaseService {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(): Promise<void> {
    try {
      this.client = new MongoClient(config.mongodb.uri);
      await this.client.connect();
      this.db = this.client.db(config.mongodb.dbName);
      logger.info('Connected to MongoDB');
    } catch (error) {
      logger.error('Failed to connect to MongoDB', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      logger.info('Disconnected from MongoDB');
    }
  }

  private getContentCreatorsCollection(): Collection<ContentCreator> {
    if (!this.db) throw new Error('Database not connected');
    return this.db.collection<ContentCreator>('contentcreators');
  }

  private getVideosCollection(): Collection<Video> {
    if (!this.db) throw new Error('Database not connected');
    return this.db.collection<Video>('videos');
  }

  async getBannedUsers(): Promise<ContentCreator[]> {
    const contentCreators = this.getContentCreatorsCollection();
    return await contentCreators.find({ banned: true }).toArray();
  }

  async getVideosForCleanup(type: 'banned-users' | 'stuck-uploads' | 'low-engagement' | 'admin-deleted' = 'stuck-uploads', options: {
    limit?: number;
    olderThanDays?: number;
    viewThreshold?: number;
  } = {}): Promise<any[]> {
    const videos = this.getVideosCollection();
    const { limit = 100, olderThanDays = 365, viewThreshold = 10 } = options;
    
    let query: any = { 
      $or: [
        { filename: { $exists: true, $nin: [null, ''] } },
        { ipfshash: { $exists: true, $nin: [null, ''] } }
      ]
    };
    
    // Exclude videos we've already cleaned up
    query.cleanedUp = { $ne: true };
    
    switch (type) {
      case 'banned-users':
        const bannedUsers = await this.getBannedUsers();
        const bannedUsernames = bannedUsers.map(user => user.username);
        query.owner = { $in: bannedUsernames };
        break;
        
      case 'stuck-uploads':
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        query.$and = [
          { status: { $nin: ['published', 'scheduled', 'deleted'] } }, // Exclude admin-deleted
          { created: { $lt: cutoffDate } }
        ];
        break;
        
      case 'admin-deleted':
        // Videos that Eddie marked as deleted but files might still exist
        query.status = 'deleted';
        break;
        
      case 'low-engagement':
        query.$and = [
          { status: 'published' },
          { 
            $or: [
              { views: { $lt: viewThreshold } },
              { views: { $exists: false } },
              { views: null }
            ]
          }
        ];
        break;
    }

    const result = await videos.find(query)
      .limit(limit)
      .sort({ created: 1 }) // Oldest first
      .toArray();

    logger.info(`Found ${result.length} videos for cleanup (type: ${type})`);
    return result;
  }

  async getVideosByOwner(owner: string, options: {
    includeCleaned?: boolean;
    limit?: number;
    statuses?: string[];
  } = {}): Promise<Video[]> {
    const videos = this.getVideosCollection();
    const { includeCleaned = false, limit = 0, statuses } = options;

    const query: any = {
      owner: { $regex: `^${owner}$`, $options: 'i' }
    };

    if (!includeCleaned) {
      query.cleanedUp = { $ne: true };
    }

    if (statuses && statuses.length > 0) {
      query.status = { $in: statuses };
    }

    logger.info(`Looking up videos for owner ${owner} (includeCleaned=${includeCleaned}, limit=${limit || 'none'})`);

    const cursor = videos.find(query).sort({ created: 1 });
    if (limit && limit > 0) {
      cursor.limit(limit);
    }

    const result = await cursor.toArray();
    logger.info(`Found ${result.length} videos for owner ${owner}`);
    return result;
  }

  async updateVideoStatus(videoId: string, status: 'published' | 'deleted' | 'uploaded' | 'encoding_ipfs' | 'processing' | 'failed' | 'draft'): Promise<void> {
    const videos = this.getVideosCollection();
    await videos.updateOne(
      { _id: videoId },
      { 
        $set: { 
          status,
          updatedAt: new Date()
        }
      }
    );
  }

  async batchUpdateVideoStatus(videoIds: string[], status: 'published' | 'deleted' | 'uploaded' | 'encoding_ipfs' | 'processing' | 'failed' | 'draft'): Promise<void> {
    const videos = this.getVideosCollection();
    await videos.updateMany(
      { _id: { $in: videoIds } },
      { 
        $set: { 
          status,
          updatedAt: new Date()
        }
      }
    );
  }

  async markVideoAsCleanedUp(videoId: string, cleanupInfo: {
    cleanupDate: Date;
    cleanupReason: string;
    storageType: 'ipfs' | 's3' | 'unknown';
    originalStatus: string;
    optimizationType?: string;
  }): Promise<void> {
    const videos = this.getVideosCollection();
    
    // First check if this video was already manually deleted by admin
    const existing = await videos.findOne({ _id: videoId });
    const wasAlreadyDeleted = existing?.status === 'deleted';
    
    await videos.updateOne(
      { _id: videoId },
      { 
        $set: { 
          // Keep status as 'deleted' if already deleted, otherwise set to deleted
          status: 'deleted',
          updatedAt: new Date(),
          cleanupDate: cleanupInfo.cleanupDate,
          cleanupReason: cleanupInfo.cleanupReason,
          cleanupStorageType: cleanupInfo.storageType,
          originalStatus: cleanupInfo.originalStatus,
          cleanedUp: true,
          // Track if this was manually deleted before our cleanup
          wasManuallyDeleted: wasAlreadyDeleted
        }
      }
    );
    
    const deleteType = wasAlreadyDeleted ? 'admin-deleted' : 'stuck-upload';
    logger.info(`Marked video ${videoId} as cleaned up (${deleteType}): ${cleanupInfo.cleanupReason}`);
  }

  async updateVideoOptimizationFlag(videoId: string, optimizationInfo: {
    optimizedDate: Date;
    optimizationType: string;
    optimizedBy: string;
    storageReduction: number;
  }): Promise<void> {
    const videos = this.getVideosCollection();
    
    await videos.updateOne(
      { _id: videoId },
      { 
        $set: { 
          // DO NOT change status - video remains published
          updatedAt: new Date(),
          optimizedStorage: true,
          optimizedDate: optimizationInfo.optimizedDate,
          optimizationType: optimizationInfo.optimizationType,
          optimizedBy: optimizationInfo.optimizedBy,
          storageReduction: optimizationInfo.storageReduction
        }
      }
    );
    
    logger.info(`Marked video ${videoId} as storage-optimized: ${optimizationInfo.optimizedBy} (saved ${(optimizationInfo.storageReduction / (1024**2)).toFixed(2)} MB)`);
  }

  /**
   * Find a video by its permlink and optionally owner
   */
  async findVideoByPermlink(permlink: string, owner?: string): Promise<Video | null> {
    const videos = this.getVideosCollection();
    
    const query: any = { permlink: permlink };
    
    // If owner is specified, add it to the query for more precise matching
    if (owner) {
      query.owner = owner;
    }
    
    const video = await videos.findOne(query);
    return video;
  }

  async getVideoStats(): Promise<any> {
    const videos = this.getVideosCollection();
    return await videos.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalViews: { $sum: '$views' },
          totalSize: { $sum: '$size' }
        }
      }
    ]).toArray();
  }

  async getStuckVideos(olderThanDays: number = 30): Promise<Video[]> {
    const videos = this.getVideosCollection();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    return await videos.find({
      status: { $in: ['uploaded', 'encoding_ipfs', 'processing'] },
      created: { $lt: cutoffDate }
    }).toArray();
  }

  // Helper method to identify video storage type
  getVideoStorageType(video: Video): 'ipfs' | 's3' | 'unknown' {
    if (video.filename?.startsWith('ipfs://')) {
      return 'ipfs';
    } else if (video.filename && this.isRealS3Filename(video.filename)) {
      return 's3';
    }
    return 'unknown';
  }

  // Helper method to determine if a filename represents a real S3 file
  private isRealS3Filename(filename: string): boolean {
    // Exclude common non-S3 patterns
    if (!filename || 
        filename === 'null' || 
        filename === 'undefined' || 
        filename.startsWith('ipfs://')) {
      return false;
    }

    // Real S3 filenames should have file extensions or be proper paths
    // Examples: "video.mp4", "uploads/abc123/video.mp4", "processed/def456.m3u8"
    const hasFileExtension = /\.[a-zA-Z0-9]{2,5}$/.test(filename);
    const hasSlashPath = filename.includes('/');
    
    // If it's just a 32-character hex string (like upload session ID), it's probably not S3
    const isJustHash = /^[a-f0-9]{32}$/.test(filename);
    
    // Real S3 files should have extension or path, but not be just a hash
    return (hasFileExtension || hasSlashPath) && !isJustHash;
  }

  // Helper method to get S3 paths for videos (permlink-based + original files)
  getS3Paths(video: Video): { files: string[]; prefixes: string[] } {
    const files: string[] = [];
    const prefixes: string[] = [];
    
    // For newer videos, use permlink-based structure (processed/encoded videos)
    if (video.permlink) {
      // Individual files (m3u8 playlists)
      files.push(
        `${video.permlink}/1080p.m3u8`,
        `${video.permlink}/720p.m3u8`,
        `${video.permlink}/480p.m3u8`,
        `${video.permlink}/360p.m3u8`,
        `${video.permlink}/default.m3u8`
      );
      
      // Prefixes for HLS segment folders (will delete all .ts files inside)
      prefixes.push(
        `${video.permlink}/1080p/`, // Contains 001.ts, 002.ts, etc.
        `${video.permlink}/720p/`,
        `${video.permlink}/480p/`,
        `${video.permlink}/360p/`,
        `${video.permlink}/thumbnails/`,
        `${video.permlink}/` // Base folder (catch any other files)
      );
    }

    // Add the processed video filename if it exists and is S3
    if (video.filename && !video.filename.startsWith('ipfs://')) {
      files.push(video.filename);
    }
    
    // CRITICAL: Add the original source video file
    if (video.originalFilename && !video.originalFilename.startsWith('ipfs://')) {
      files.push(video.originalFilename);
      
      // Also check for common original video patterns in S3
      // Some systems might store originals with prefixes
      const originalBasename = video.originalFilename.split('/').pop();
      if (originalBasename) {
        files.push(`originals/${originalBasename}`);
        files.push(`uploads/${originalBasename}`);
        files.push(`raw/${originalBasename}`);
      }
    }

    return { files, prefixes };
  }

  // Helper method to get S3 paths for slim operations - delete everything except the resolution to keep
  getS3PathsForSlim(video: Video, resolutionsToDelete: string[]): { files: string[]; prefixes: string[] } {
    const files: string[] = [];
    const prefixes: string[] = [];
    
    // For newer videos, use permlink-based structure (processed/encoded videos)
    if (video.permlink) {
      // Delete playlists for unwanted resolutions (NEVER delete default.m3u8 - we'll update it instead)
      resolutionsToDelete.forEach(resolution => {
        files.push(`${video.permlink}/${resolution}.m3u8`);
        prefixes.push(`${video.permlink}/${resolution}/`);
      });
    }

    // Add the original source video file (always delete source to save space)
    if (video.originalFilename && !video.originalFilename.startsWith('ipfs://')) {
      files.push(video.originalFilename);
      
      // Also check for common original video patterns in S3
      const originalBasename = video.originalFilename.split('/').pop();
      if (originalBasename) {
        files.push(`originals/${originalBasename}`);
        files.push(`uploads/${originalBasename}`);
        files.push(`raw/${originalBasename}`);
      }
    }

    // Add the processed video filename (usually the source file, safe to delete)
    if (video.filename && !video.filename.startsWith('ipfs://')) {
      files.push(video.filename);
    }

    return { files, prefixes };
  }

  // Legacy method for backward compatibility  
  getS3Filename(video: Video): string | null {
    const paths = this.getS3Paths(video);
    return paths.files.length > 0 ? paths.files[0] : null;
  }

  // Helper method to get IPFS hash from filename
  getIpfsHash(video: Video): string | null {
    if (video.filename?.startsWith('ipfs://')) {
      return video.filename.replace('ipfs://', '');
    }
    return null;
  }

  async getCleanupStats(): Promise<{
    totalCleaned: number;
    cleanedByReason: { [reason: string]: number };
    cleanedByStorageType: { [type: string]: number };
    recentCleanups: number; // Last 7 days
  }> {
    const videos = this.getVideosCollection();
    
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [totalResult, byReason, byStorageType, recentResult] = await Promise.all([
      // Total cleaned
      videos.countDocuments({ cleanedUp: true }),
      
      // By cleanup reason
      videos.aggregate([
        { $match: { cleanedUp: true } },
        { $group: { _id: '$cleanupReason', count: { $sum: 1 } } }
      ]).toArray(),
      
      // By storage type
      videos.aggregate([
        { $match: { cleanedUp: true } },
        { $group: { _id: '$cleanupStorageType', count: { $sum: 1 } } }
      ]).toArray(),
      
      // Recent cleanups
      videos.countDocuments({ 
        cleanedUp: true,
        cleanupDate: { $gte: sevenDaysAgo }
      })
    ]);

    const cleanedByReason: { [reason: string]: number } = {};
    byReason.forEach((item: any) => {
      cleanedByReason[item._id || 'Unknown'] = item.count;
    });

    const cleanedByStorageType: { [type: string]: number } = {};
    byStorageType.forEach((item: any) => {
      cleanedByStorageType[item._id || 'Unknown'] = item.count;
    });

    return {
      totalCleaned: totalResult,
      cleanedByReason,
      cleanedByStorageType,
      recentCleanups: recentResult
    };
  }

  // Legacy method for backward compatibility with list and stats commands
  async getVideosByCriteria(criteria: any, limit: number = 1000): Promise<any[]> {
    const videos = this.getVideosCollection();
    
    let query: any = {};
    
    if (criteria.bannedUsers) {
      const bannedUsers = await this.getBannedUsers();
      const bannedUsernames = bannedUsers.map(user => user.username);
      query.owner = { $in: bannedUsernames };
    }

    // Account-specific queries (for trim-fat command)
    if (criteria.type === 'account-specific' && criteria.username) {
      query.owner = criteria.username;
      
      // Apply age filter if specified
      if (criteria.olderThanDays && criteria.olderThanDays > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - criteria.olderThanDays);
        query.created = { $lt: cutoffDate };
      }
      
      // Apply view threshold filter if specified
      if (criteria.viewThreshold && criteria.viewThreshold < 999999) {
        query.$or = [
          { views: { $lt: criteria.viewThreshold } },
          { views: { $exists: false } },
          { views: null }
        ];
      }
      
      // Exclude already cleaned videos unless requested
      if (criteria.excludeCleaned) {
        query.cleanupMetadata = { $exists: false };
      }
    }
    
    if (criteria.ageThresholdDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - criteria.ageThresholdDays);
      query.created = { $lt: cutoffDate };
    }
    
    if (criteria.maxViews !== undefined) {
      query.$or = [
        { views: { $lt: criteria.maxViews } },
        { views: { $exists: false } },
        { views: null }
      ];
    }
    
    if (criteria.minViews !== undefined) {
      query.views = { $gte: criteria.minViews };
    }
    
    if (criteria.status && criteria.status.length > 0) {
      query.status = { $in: criteria.status };
    }
    
    // Exclude already deleted videos for purge operations
    if (criteria.excludeDeleted) {
      query.status = { $ne: 'deleted' };
    }
    
    if (criteria.orphaned) {
      query.$and = [
        { $or: [
          { filename: { $exists: false } },
          { filename: null },
          { filename: '' }
        ]},
        { $or: [
          { ipfshash: { $exists: false } },
          { ipfshash: null },
          { ipfshash: '' }
        ]}
      ];
    }

    // Filter by storage type
    if (criteria.storageType) {
      switch (criteria.storageType) {
        case 'ipfs':
          query.filename = { $regex: '^ipfs://' };
          break;
        case 's3':
          // Real S3 files: have filename but not ipfs://, and match S3 patterns
          query.$and = [
            ...(query.$and || []),
            { 
              filename: { 
                $exists: true, 
                $nin: [null, '', 'null', 'undefined'],
                $not: { $regex: '^ipfs://' }
              }
            },
            // Must have file extension OR path structure (real S3 files)
            { $or: [
              { filename: { $regex: '\\.[a-zA-Z0-9]{2,5}$' } }, // Has file extension
              { filename: { $regex: '/' } } // Has path structure
            ]},
            // Exclude simple hash patterns (upload session IDs)
            { filename: { $not: { $regex: '^[a-f0-9]{32}$' } } }
          ];
          break;
        case 'unknown':
          query.$or = [
            { filename: { $exists: false } },
            { filename: null },
            { filename: '' },
            { filename: 'null' },
            { filename: 'undefined' },
            // Hash-like patterns that aren't real S3 files
            { $and: [
              { filename: { $not: { $regex: '^ipfs://' } } },
              { filename: { $regex: '^[a-f0-9]{32}$' } }
            ]}
          ];
          break;
      }
    }

    // Apply limit and timeout to prevent hanging
    logger.info(`Querying videos with criteria, limit: ${limit}`);
    const result = await videos.find(query)
      .limit(limit)
      .sort({ created: -1 }) // Newest first for better performance
      .maxTimeMS(30000) // 30 second timeout
      .toArray();

    logger.info(`Found ${result.length} videos matching criteria`);
    
    // If storage type filtering was requested, validate results client-side too
    if (criteria.storageType && result.length > 0) {
      const filteredResults = result.filter(video => {
        const detectedType = this.getVideoStorageType(video);
        return detectedType === criteria.storageType;
      });
      
      if (filteredResults.length !== result.length) {
        logger.info(`Storage type filter: ${result.length} → ${filteredResults.length} videos (removed ${result.length - filteredResults.length} misclassified)`);
      }
      
      return filteredResults;
    }

    return result;
  }
}