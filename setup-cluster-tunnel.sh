#!/bin/bash

# SSH Tunnel Setup for IPFS Cluster Admin Tool
# This script establishes SSH tunnels to the 3Speak supernode cluster API

set -e

REMOTE_HOST="${1:-root@ipfs.3speak.tv}"
LOCAL_CLUSTER_API_PORT="${2:-9095}"
LOCAL_CLUSTER_PINS_PORT="${3:-9097}"

echo "🔐 Establishing SSH tunnel to $REMOTE_HOST..."
echo ""
echo "Local ports:"
echo "  - Cluster API: localhost:$LOCAL_CLUSTER_API_PORT → ipfs.3speak.tv:9095"
echo "  - Cluster Pins: localhost:$LOCAL_CLUSTER_PINS_PORT → ipfs.3speak.tv:9097"
echo ""
echo "To use in another terminal, set environment variables:"
echo "  export IPFS_CLUSTER_ENDPOINT=http://localhost:$LOCAL_CLUSTER_API_PORT"
echo "  export IPFS_CLUSTER_PINS_ENDPOINT=http://localhost:$LOCAL_CLUSTER_PINS_PORT"
echo ""
echo "Then run commands like:"
echo "  npm run build && node dist/index.js cluster-status"
echo ""
echo "Press Ctrl+C to close the tunnel..."
echo ""

ssh -N -L $LOCAL_CLUSTER_API_PORT:127.0.0.1:9095 -L $LOCAL_CLUSTER_PINS_PORT:127.0.0.1:9097 "$REMOTE_HOST"
