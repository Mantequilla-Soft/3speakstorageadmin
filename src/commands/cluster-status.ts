import { ClusterDirectService } from '../services/cluster-direct';
import { logger } from '../utils/logger';

export async function clusterStatus(): Promise<void> {
  try {
    logger.info('🔍 Fetching IPFS Cluster status...');
    
    const cluster = new ClusterDirectService();

    // Get cluster status
    const status = await cluster.getClusterStatus();
    logger.info('📍 Cluster Status:', {
      peername: status.peername,
      reachable: status.health.reachable,
      peerCount: status.peerAddresses.length,
      trustedPeers: status.trustedPeers.length
    });

    if (!status.health.reachable) {
      logger.error('❌ Cluster is not reachable. Ensure:');
      logger.error('   1. Supernode is running and accessible at ipfs.3speak.tv');
      logger.error('   2. SSH key is configured for root@ipfs.3speak.tv');
      logger.error('   3. Cluster service is running: systemctl status ipfs-cluster.service');
      return;
    }

    // Get cluster metrics
    logger.info('📊 Fetching cluster metrics...');
    const metrics = await cluster.getClusterMetrics();

    logger.info('\n🎯 Cluster Metrics:', {
      totalPins: metrics.totalPins,
      pinnedSizeBytes: metrics.pinnedSize,
      peersCount: metrics.peers.length,
      status: metrics.status
    });

    // Display peer information
    if (metrics.peers.length > 0) {
      logger.info('\n👥 Cluster Peers:');
      metrics.peers.forEach((peer, idx) => {
        logger.info(`   Peer ${idx + 1}: ${peer.peername}`, {
          ipfs: peer.ipfs,
          version: peer.version
        });
      });
    }

    logger.info('\n✅ Cluster status retrieved successfully');
  } catch (error) {
    logger.error('❌ Failed to get cluster status:', error);
    process.exit(1);
  }
}

export async function clusterPins(): Promise<void> {
  try {
    logger.info('📋 Fetching cluster pin list...');
    
    const cluster = new ClusterDirectService();
    const pinCount = await cluster.getClusterPinCount();
    const pins = await cluster.listClusterPins(10);

    logger.info(`\n📌 Total pins in cluster: ${pinCount}`);
    
    if (pins.length === 0) {
      logger.info('No pins found in cluster');
      return;
    }

    logger.info('\n📍 Sample pins (first 10):');
    pins.forEach((pin, idx) => {
      logger.info(`   ${idx + 1}. ${pin}`);
    });

    if (pinCount > 10) {
      logger.info(`   ... and ${pinCount - 10} more pins`);
    }

    logger.info('\n✅ Pin list retrieved successfully');
  } catch (error) {
    logger.error('❌ Failed to list cluster pins:', error);
    process.exit(1);
  }
}

export async function clusterCheckPin(hash: string): Promise<void> {
  try {
    logger.info(`🔍 Checking if ${hash} is pinned in cluster...`);
    
    const cluster = new ClusterDirectService();
    const isPinned = await cluster.isClusterPinned(hash);

    if (isPinned) {
      logger.info(`✅ Hash ${hash} is pinned in cluster`);
    } else {
      logger.info(`❌ Hash ${hash} is NOT pinned in cluster`);
    }
  } catch (error) {
    logger.error('❌ Failed to check cluster pin status:', error);
    process.exit(1);
  }
}
