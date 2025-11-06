import { S3Client, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { config } from '../config';
import { logger } from '../utils/logger';

export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor() {
    this.bucketName = config.s3.bucketName;
    
    this.s3Client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      forcePathStyle: true, // Required for Wasabi
    });

    logger.info(`S3 Service initialized for bucket: ${this.bucketName}`);
  }

  /**
   * Check if an object exists in S3
   */
  async objectExists(key: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      logger.error(`Error checking object existence for ${key}`, error);
      throw error;
    }
  }

  /**
   * Delete a single object from S3
   */
  async deleteObject(key: string): Promise<boolean> {
    try {
      logger.info(`Attempting to delete S3 object: ${key}`);

      // First check if object exists
      const exists = await this.objectExists(key);
      if (!exists) {
        logger.info(`Object ${key} does not exist, skipping`);
        return true;
      }

      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      if (response.$metadata.httpStatusCode === 204 || response.$metadata.httpStatusCode === 200) {
        logger.info(`Successfully deleted S3 object: ${key}`);
        return true;
      } else {
        logger.error(`Failed to delete ${key}: HTTP ${response.$metadata.httpStatusCode}`);
        return false;
      }
    } catch (error: any) {
      logger.error(`Failed to delete S3 object ${key}`, {
        error: error.message,
        code: error.code,
        statusCode: error.$metadata?.httpStatusCode
      });
      return false;
    }
  }

  /**
   * List all objects with a specific prefix (for HLS folders)
   */
  async listObjectsWithPrefix(prefix: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: 1000
      });

      const response = await this.s3Client.send(command);
      const keys = response.Contents?.map(obj => obj.Key || '') || [];
      
      logger.info(`Found ${keys.length} objects with prefix: ${prefix}`);
      return keys.filter(key => key !== ''); // Remove any empty keys
    } catch (error: any) {
      logger.error(`Failed to list objects with prefix ${prefix}`, error);
      return [];
    }
  }

  /**
   * Delete all objects with a specific prefix (for HLS folders and segments)
   */
  async deleteObjectsWithPrefix(prefix: string): Promise<{ deleted: number; errors: number }> {
    try {
      const objectKeys = await this.listObjectsWithPrefix(prefix);
      
      if (objectKeys.length === 0) {
        logger.info(`No objects found with prefix: ${prefix}`);
        return { deleted: 0, errors: 0 };
      }

      logger.info(`Deleting ${objectKeys.length} objects with prefix: ${prefix}`);
      
      let deleted = 0;
      let errors = 0;

      // Delete in batches to avoid overwhelming S3
      const batchSize = 10;
      for (let i = 0; i < objectKeys.length; i += batchSize) {
        const batch = objectKeys.slice(i, i + batchSize);
        
        const results = await Promise.all(
          batch.map(key => this.deleteObject(key))
        );
        
        results.forEach(success => {
          if (success) deleted++;
          else errors++;
        });
      }

      logger.info(`Prefix ${prefix}: ${deleted} deleted, ${errors} errors`);
      return { deleted, errors };
    } catch (error: any) {
      logger.error(`Failed to delete objects with prefix ${prefix}`, error);
      return { deleted: 0, errors: 1 };
    }
  }

  /**
   * Get object metadata (size, last modified, etc.)
   */
  async getObjectInfo(key: string): Promise<{
    exists: boolean;
    size?: number;
    lastModified?: Date;
  }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      return {
        exists: true,
        size: response.ContentLength,
        lastModified: response.LastModified
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      logger.error(`Error getting object info for ${key}`, error);
      throw error;
    }
  }

  /**
   * Batch delete multiple objects with progress tracking
   */
  async batchDelete(keys: string[], batchSize: number = 10): Promise<{
    success: string[];
    failed: string[];
    notFound: string[];
  }> {
    const result = {
      success: [] as string[],
      failed: [] as string[],
      notFound: [] as string[]
    };

    logger.info(`Starting batch delete of ${keys.length} objects in batches of ${batchSize}`);

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(keys.length / batchSize)}`);

      for (const key of batch) {
        try {
          // Check if exists first
          const exists = await this.objectExists(key);
          if (!exists) {
            result.notFound.push(key);
            continue;
          }

          const success = await this.deleteObject(key);
          if (success) {
            result.success.push(key);
          } else {
            result.failed.push(key);
          }
        } catch (error) {
          logger.error(`Error deleting ${key}`, error);
          result.failed.push(key);
        }

        // Small delay between operations
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Longer delay between batches
      if (i + batchSize < keys.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    logger.info(`Batch delete completed: ${result.success.length} success, ${result.failed.length} failed, ${result.notFound.length} not found`);
    return result;
  }

  /**
   * List objects with a specific prefix (for analysis)
   */
  async listObjects(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys
      });

      const response = await this.s3Client.send(command);
      return response.Contents?.map(obj => obj.Key!) || [];
    } catch (error) {
      logger.error('Failed to list S3 objects', error);
      throw error;
    }
  }

  /**
   * Get S3 service connection info
   */
  async getServiceInfo(): Promise<{
    bucketName: string;
    endpoint: string;
    region: string;
    accessible: boolean;
  }> {
    try {
      // Try to list objects to verify connection
      await this.listObjects('', 1);
      
      return {
        bucketName: this.bucketName,
        endpoint: config.s3.endpoint || 'default',
        region: config.s3.region,
        accessible: true
      };
    } catch (error) {
      logger.error('S3 service not accessible', error);
      return {
        bucketName: this.bucketName,
        endpoint: config.s3.endpoint || 'default',
        region: config.s3.region,
        accessible: false
      };
    }
  }

  /**
   * Calculate storage usage for given object keys
   */
  async calculateStorageUsage(keys: string[]): Promise<{
    totalSize: number;
    objectCount: number;
    averageSize: number;
  }> {
    let totalSize = 0;
    let objectCount = 0;

    logger.info(`Calculating storage usage for ${keys.length} objects`);

    for (const key of keys) {
      try {
        const info = await this.getObjectInfo(key);
        if (info.exists && info.size) {
          totalSize += info.size;
          objectCount++;
        }
      } catch (error) {
        logger.warn(`Could not get size for ${key}`, error);
      }

      // Rate limit to avoid overwhelming the service
      if (objectCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const averageSize = objectCount > 0 ? totalSize / objectCount : 0;

    return {
      totalSize,
      objectCount,
      averageSize
    };
  }
}