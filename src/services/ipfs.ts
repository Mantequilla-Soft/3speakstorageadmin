import axios, { AxiosResponse } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface IpfsPin {
  hash: string;
  type: string;
}

export interface IpfsPinResponse {
  Keys: { [hash: string]: { Type: string } };
}

export class IpfsService {
  private baseUrl: string;

  constructor() {
    // Use production IPFS service endpoint
    this.baseUrl = 'http://65.21.201.94:5002/api/v0';
  }

  /**
   * Check if a hash is currently pinned
   */
  async isPinned(hash: string): Promise<boolean> {
    try {
      const response = await axios.post(`${this.baseUrl}/pin/ls`, null, {
        params: {
          arg: hash,
          type: 'all'
        },
        timeout: 10000
      });

      const data: IpfsPinResponse = response.data;
      return hash in data.Keys;
    } catch (error: any) {
      if (error.response?.status === 500 && error.response?.data?.Message?.includes('not pinned')) {
        return false;
      }
      // Handle timeout errors as "not pinned" - likely the hash doesn't exist
      if (error.code === 'ECONNABORTED' && error.message?.includes('timeout')) {
        logger.info(`Timeout checking pin status for ${hash} - assuming not pinned`);
        return false;
      }
      logger.error(`Failed to check pin status for ${hash}`, error);
      throw error;
    }
  }

  /**
   * Unpin a hash from IPFS
   */
  async unpinHash(hash: string): Promise<boolean> {
    try {
      logger.info(`Attempting to unpin IPFS hash: ${hash}`);

      // First check if it's actually pinned
      const isPinned = await this.isPinned(hash);
      if (!isPinned) {
        logger.info(`Hash ${hash} is not pinned, skipping`);
        return true;
      }

      const response = await axios.post(`${this.baseUrl}/pin/rm`, null, {
        params: {
          arg: hash,
          recursive: true
        },
        timeout: 30000
      });

      if (response.status === 200) {
        logger.info(`Successfully unpinned IPFS hash: ${hash}`);
        return true;
      } else {
        logger.error(`Failed to unpin ${hash}: HTTP ${response.status}`);
        return false;
      }
    } catch (error: any) {
      logger.error(`Failed to unpin IPFS hash ${hash}`, {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      return false;
    }
  }

  /**
   * Get list of all pinned hashes (for analysis)
   */
  async listPinnedHashes(): Promise<string[]> {
    try {
      const response = await axios.post(`${this.baseUrl}/pin/ls`, null, {
        params: {
          type: 'recursive'
        },
        timeout: 60000
      });

      const data: IpfsPinResponse = response.data;
      return Object.keys(data.Keys);
    } catch (error) {
      logger.error('Failed to list pinned hashes', error);
      throw error;
    }
  }

  /**
   * Extract IPFS hash from various 3speak formats
   */
  static extractHashFromFilename(filename: string): string | null {
    if (!filename) return null;

    // Handle "ipfs://QmHash" format
    if (filename.startsWith('ipfs://')) {
      const hash = filename.replace('ipfs://', '');
      // Remove any path after the hash (e.g., "/manifest.m3u8")
      return hash.split('/')[0];
    }

    // Handle direct hash format
    if (filename.match(/^Qm[a-zA-Z0-9]{44}$/)) {
      return filename;
    }

    // Handle "ipfs://QmHash/manifest.m3u8" format  
    if (filename.includes('/')) {
      const parts = filename.split('/');
      const potentialHash = parts[0].replace('ipfs://', '');
      if (potentialHash.match(/^Qm[a-zA-Z0-9]{44}$/)) {
        return potentialHash;
      }
    }

    return null;
  }

  /**
   * Batch unpin multiple hashes with progress tracking
   */
  async batchUnpin(hashes: string[], batchSize: number = 10): Promise<{
    success: string[];
    failed: string[];
    skipped: string[];
  }> {
    const result = {
      success: [] as string[],
      failed: [] as string[],
      skipped: [] as string[]
    };

    logger.info(`Starting batch unpin of ${hashes.length} hashes in batches of ${batchSize}`);

    for (let i = 0; i < hashes.length; i += batchSize) {
      const batch = hashes.slice(i, i + batchSize);
      logger.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(hashes.length / batchSize)}`);

      for (const hash of batch) {
        try {
          const success = await this.unpinHash(hash);
          if (success) {
            result.success.push(hash);
          } else {
            result.failed.push(hash);
          }
        } catch (error) {
          logger.error(`Error unpinning ${hash}`, error);
          result.failed.push(hash);
        }

        // Small delay between operations to avoid overwhelming the service
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Longer delay between batches
      if (i + batchSize < hashes.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info(`Batch unpin completed: ${result.success.length} success, ${result.failed.length} failed, ${result.skipped.length} skipped`);
    return result;
  }

  /**
   * Get IPFS service status/info
   */
  async getServiceInfo(): Promise<any> {
    try {
      const response = await axios.post(`${this.baseUrl}/version`, null, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      logger.error('Failed to get IPFS service info', error);
      throw error;
    }
  }
}