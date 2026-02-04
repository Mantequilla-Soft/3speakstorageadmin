# Phase 1: Cluster Integration via SSH Tunnel

## Setup Instructions

### Step 1: Start SSH Tunnel

Open a new terminal and establish the SSH tunnel:

```bash
cd /home/meno/Documents/menosoft/3speakstorageadmin
chmod +x setup-cluster-tunnel.sh
./setup-cluster-tunnel.sh root@ipfs.3speak.tv
```

The tunnel will remain active as long as the terminal is open. Leave it running.

**Expected output:**
```
🔐 Establishing SSH tunnel to root@ipfs.3speak.tv...

Local ports:
  - Cluster API: localhost:9095 → ipfs.3speak.tv:9095
  - Cluster Pins: localhost:9097 → ipfs.3speak.tv:9097

Press Ctrl+C to close the tunnel...
```

### Step 2: Use Admin Tool

In another terminal, set environment variables and run commands:

```bash
export IPFS_CLUSTER_ENDPOINT=http://localhost:9095
export IPFS_CLUSTER_PINS_ENDPOINT=http://localhost:9097
```

### Step 3: Test Cluster Connectivity

Run the cluster status command:

```bash
node dist/index.js cluster-status
```

**Expected output:**
```
🔍 Fetching IPFS Cluster status...
📍 Cluster Status: {
  peername: '160TB-SuperNode',
  reachable: true,
  peerCount: 4,
  trustedPeers: 4
}

📊 Cluster Metrics: {
  totalPins: 45000,
  pinnedSizeBytes: 87654321,
  pinnedSizeGB: '81.64 GB',
  peersCount: 4,
  status: 'active'
}

👥 Cluster Peers:
   Peer 1: 160TB-SuperNode {...}
   Peer 2: peer-name-2 {...}
   ...

✅ Cluster status retrieved successfully
```

## Available Cluster Commands

### 1. Check Cluster Status
```bash
node dist/index.js cluster-status
```
Shows overall cluster health, peer count, total pins, and storage usage.

### 2. List All Cluster Pins
```bash
node dist/index.js cluster-pins
```
Displays all pinned hashes in the cluster (with sample of first 10).

### 3. Check if Hash is Pinned
```bash
node dist/index.js cluster-check QmXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
Verifies if a specific CID is pinned in the cluster.

## Troubleshooting

### Cluster Not Reachable

If you get an error like "Cluster is not reachable":

1. **Verify SSH tunnel is running:**
   ```bash
   # In tunnel terminal, you should see:
   # "Press Ctrl+C to close the tunnel..."
   ```

2. **Verify port forwarding:**
   ```bash
   # In another terminal:
   netstat -tuln | grep 9095
   # Should show: LISTEN 0 ... 127.0.0.1:9095
   ```

3. **Verify environment variables are set:**
   ```bash
   echo $IPFS_CLUSTER_ENDPOINT
   echo $IPFS_CLUSTER_PINS_ENDPOINT
   ```

4. **Check supernode cluster is running:**
   ```bash
   ssh root@ipfs.3speak.tv "systemctl status ipfs-cluster.service"
   ```

### Still Having Issues?

Check the supernode directly:

```bash
ssh root@ipfs.3speak.tv "curl -s http://127.0.0.1:9095/api/v0/peers | head -50"
```

This should return cluster peer information.

## Next Steps (Phase 2)

Once Phase 1 is stable and tested, migrate to a permanent setup using Nginx reverse proxy with authentication:

1. Remove SSH tunnel dependency
2. Implement proper access control
3. Add credentials rotation

See `docs/internal/SUPERNODE_ASSESSMENT.md` for details.
