import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { ClusterStatus, ClusterMetrics, ClusterPeerInfo } from '../types';

const execAsync = promisify(exec);

const CLUSTER_HOST = 'root@ipfs.3speak.tv';

export class ClusterDirectService {
  /**
   * Get cluster status via ipfs-cluster-ctl
   */
  async getClusterStatus(): Promise<ClusterStatus> {
    try {
      const { stdout } = await execAsync(`ssh ${CLUSTER_HOST} "ipfs-cluster-ctl peers ls 2>/dev/null" 2>/dev/null`, {
        timeout: 10000,
        maxBuffer: 10 * 1024 * 1024
      });

      const lines = stdout.split('\n').filter((line: string) => line.includes('|'));
      
      if (lines.length === 0) {
        return {
          peername: 'offline',
          peerAddresses: [],
          trustedPeers: [],
          health: {
            reachable: false,
            errorRate: 1
          }
        };
      }

      // Parse peer information
      const peername = lines[0].includes('160TB-SuperNode') ? '160TB-SuperNode' : 'cluster-peer';
      const peerCount = lines.length;

      return {
        peername,
        peerAddresses: lines.map((line: string) => line.split('|')[0].trim()),
        trustedPeers: lines.map((line: string) => line.split('|')[0].trim()),
        health: {
          reachable: true,
          errorRate: 0
        }
      };
    } catch (error: any) {
      logger.error('Failed to get cluster status', error.message);
      return {
        peername: 'offline',
        peerAddresses: [],
        trustedPeers: [],
        health: {
          reachable: false,
          errorRate: 1
        }
      };
    }
  }

  /**
   * Get cluster metrics via ipfs-cluster-ctl
   */
  async getClusterMetrics(): Promise<ClusterMetrics> {
    try {
      const [peersOutput, statusOutput] = await Promise.all([
        execAsync(`ssh ${CLUSTER_HOST} "ipfs-cluster-ctl peers ls 2>/dev/null" 2>/dev/null`, {
          timeout: 10000,
          maxBuffer: 10 * 1024 * 1024
        }),
        execAsync(`ssh ${CLUSTER_HOST} "ipfs-cluster-ctl status 2>/dev/null | wc -l" 2>/dev/null`, {
          timeout: 30000,
          maxBuffer: 50 * 1024 * 1024
        })
      ]);

      const peerLines = peersOutput.stdout.split('\n').filter((line: string) => line.includes('|'));
      const pinCount = parseInt(statusOutput.stdout.trim() || '0', 10);

      const peers: ClusterPeerInfo[] = peerLines.map((line: string) => {
        const parts = line.split('|');
        return {
          peername: parts[1]?.trim() || 'unknown',
          ipfs: parts[0]?.trim() || 'unknown',
          addresses: [],
          version: 'v1.1.4',
          commit: 'unknown'
        };
      });

      return {
        totalPins: pinCount,
        pinnedSize: 0,
        peers,
        status: 'active'
      };
    } catch (error: any) {
      logger.error('Failed to get cluster metrics', error.message);
      return {
        totalPins: 0,
        pinnedSize: 0,
        peers: [],
        status: 'offline'
      };
    }
  }

  /**
   * List all pins in cluster via ipfs-cluster-ctl
   */
  async listClusterPins(limit: number = 100): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `ssh ${CLUSTER_HOST} "ipfs-cluster-ctl status 2>/dev/null | head -${limit} | awk '{print $1}'" 2>/dev/null`,
        {
          timeout: 60000,
          maxBuffer: 50 * 1024 * 1024
        }
      );

      return stdout
        .split('\n')
        .filter((line: string) => line.trim() && line.match(/^[Qm|bafy]/))
        .slice(0, limit);
    } catch (error) {
      logger.error('Failed to list cluster pins', error);
      throw error;
    }
  }

  /**
   * Check if hash is pinned in cluster
   */
  async isClusterPinned(hash: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        `ssh ${CLUSTER_HOST} "ipfs-cluster-ctl status ${hash} 2>/dev/null | grep PINNED" 2>/dev/null`,
        {
          timeout: 10000
        }
      );

      return stdout.includes('PINNED') || stdout.includes(hash);
    } catch (error: any) {
      if (error.code === 1) {
        // Exit code 1 means not found
        return false;
      }
      logger.error(`Failed to check cluster pin status for ${hash}`, error.message);
      return false;
    }
  }

  /**
   * Get total pin count
   */
  async getClusterPinCount(): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `ssh ${CLUSTER_HOST} "ipfs-cluster-ctl status 2>/dev/null | wc -l" 2>/dev/null`,
        {
          timeout: 60000,
          maxBuffer: 50 * 1024 * 1024
        }
      );

      return parseInt(stdout.trim() || '0', 10);
    } catch (error) {
      logger.error('Failed to get cluster pin count', error);
      return 0;
    }
  }
}
