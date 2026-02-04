#!/bin/bash

# Direct cluster status query via SSH
# No REST API endpoints needed - just use ipfs-cluster-ctl

echo "🔍 Fetching cluster status via ipfs-cluster-ctl..."

# Get peer info
PEERS=$(ssh root@ipfs.3speak.tv "ipfs-cluster-ctl peers ls 2>/dev/null" | grep '|' | head -1)

if [ -z "$PEERS" ]; then
  echo "❌ Cluster not reachable or no peers found"
  exit 1
fi

echo "✅ Cluster Status:"
echo "$PEERS"

# Get pin count
echo ""
echo "📊 Pin Statistics:"
PIN_COUNT=$(ssh root@ipfs.3speak.tv "ipfs-cluster-ctl status 2>/dev/null | grep -c ':'" || echo "0")
echo "Total tracked items: $PIN_COUNT"

echo ""
echo "✅ Cluster is healthy and accessible!"
