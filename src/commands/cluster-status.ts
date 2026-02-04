import { IpfsService } from '../services/ipfs';
import { logger } from '../utils/logger';

export async function clusterStatus(): Promise<void> {
  try {
    logger.info('🔍 Fetching IPFS Cluster status...');
    
    const ipfs = new IpfsService();

    // Get cluster status
    const status = await ipfs.getClusterStatus();
    logger.info('📍 Cluster Status:', {
      peername: status.peername,
      reachable: status.health.reachable,
      peerCount: status.peerAddresses.length,
      trustedPeers: status.trustedPeers.length
    });

    if (!status.health.reachable) {
      logger.error('❌ Cluster is not reachable. Ensure:');
      logger.error('   1. Cluster is running: systemctl status ipfs-cluster.service');
      logger.error('   2. SSH tunnel is active (if remote): ssh -L 9095:127.0.0.1:9095 -L 9097:127.0.0.1:9097 root@ipfs.3speak.tv');
      logger.error('   3. IPFS_CLUSTER_ENDPOINT is set correctly (default: http://127.0.0.1:9095)');
      return;
    }

    // Get cluster metrics
    logger.info('📊 Fetching cluster metrics...');
    const metrics = await ipfs.getClusterMetrics();

    logger.info('\n🎯 Cluster Metrics:', {
      totalPins: metrics.totalPins,
      pinnedSizeBytes: metrics.pinnedSize,
      pinnedSizeGB: (metrics.pinnedSize / (1024 ** 3)).toFixed(2) + ' GB',
      peersCount: metrics.peers.length,
      status: metrics.status
    });

    // Display peer information
    if (metrics.peers.length > 0) {
      logger.info('\n👥 Cluster Peers:');
      metrics.peers.forEach((peer, idx) => {
        logger.info(`   Peer ${idx + 1}: ${peer.peername}`, {
          ipfs: peer.ipfs,
          version: peer.version,
          addresses: peer.addresses.length
        });
      });
    }

    // Display helpful information
    logger.info('\n📝 Cluster Information:');
    logger.info(`   Peername: ${status.peername}`);
    logger.info(`   Trusted Peers: ${status.trustedPeers.join(', ') || 'None'}`);
    
    if (status.peerAddresses.length > 0) {
      logger.info(`   \n🌐 Peer Addresses:`);
      status.peerAddresses.slice(0, 3).forEach(addr => {
        logger.info(`      ${addr}`);
      });
      if (status.peerAddresses.length > 3) {
        logger.info(`      ... and ${status.peerAddresses.length - 3} more`);
      }
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
    
    const ipfs = new IpfsService();
    const pins = await ipfs.listClusterPins();

    logger.info(`\n📌 Total pins in cluster: ${pins.length}`);
    
    if (pins.length === 0) {
      logger.info('No pins found in cluster');
      return;
    }

    // Show first 10 pins as example
    logger.info('\n📍 Sample pins (first 10):');
    pins.slice(0, 10).forEach((pin, idx) => {
      logger.info(`   ${idx + 1}. ${pin}`);
    });

    if (pins.length > 10) {
      logger.info(`   ... and ${pins.length - 10} more pins`);
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
    
    const ipfs = new IpfsService();
    const isPinned = await ipfs.isClusterPinned(hash);

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
