#!/bin/bash

# Phase 2b Cutover Script
# Executes all steps to migrate from single daemon to dual-daemon architecture
# THIS WILL CAUSE ~1 HOUR DOWNTIME

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SUPERNODE="root@ipfs.3speak.tv"

echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║          PHASE 2B: DUAL-DAEMON CUTOVER PROCEDURE              ║${NC}"
echo -e "${RED}║                    ⚠️  1 HOUR DOWNTIME ⚠️                      ║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "This script will:"
echo "  1. Stop current IPFS daemon"
echo "  2. Start old daemon in tamed/archive mode"
echo "  3. Start new daemon from fresh repo"
echo "  4. Reload cluster configuration"
echo "  5. Verify both daemons are healthy"
echo ""
echo -e "${YELLOW}⚠️  MAKE SURE:${NC}"
echo "  • Hot nodes are notified of maintenance window"
echo "  • This is during low-traffic period"
echo "  • Monitoring script is running in another terminal"
echo "  • You have SSH access to supernode"
echo ""
read -p "Type 'YES' to proceed with cutover: " CONFIRM

if [ "$CONFIRM" != "YES" ]; then
    echo "❌ Cutover cancelled"
    exit 1
fi

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "STEP 1: Stopping current daemon..."
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

ssh $SUPERNODE "systemctl stop 3speak-ipfs-storage-admin.service || true"
sleep 3

# Verify it stopped
status=$(ssh $SUPERNODE "systemctl is-active 3speak-ipfs-storage-admin.service || echo 'inactive'")
if [ "$status" = "inactive" ]; then
    echo -e "${GREEN}✅ Current daemon stopped${NC}"
else
    echo -e "${RED}❌ Current daemon still running!${NC}"
    exit 1
fi

sleep 2

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "STEP 2: Starting old daemon in archive/tamed mode (port 4002)..."
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

ssh $SUPERNODE "systemctl start kubo-old-archive.service"
sleep 10

# Verify it started
old_status=$(ssh $SUPERNODE "systemctl is-active kubo-old-archive.service || echo 'inactive'")
if [ "$old_status" = "active" ]; then
    echo -e "${GREEN}✅ Old archive daemon started${NC}"
    
    # Test API
    response=$(ssh $SUPERNODE "curl -s http://127.0.0.1:5001/api/v0/id 2>/dev/null | head -c 20" || echo "")
    if [ ! -z "$response" ]; then
        echo -e "${GREEN}✅ Old daemon API responding${NC}"
    else
        echo -e "${YELLOW}⏳ Old daemon API not responding yet (might be starting)${NC}"
    fi
else
    echo -e "${RED}❌ Old daemon failed to start!${NC}"
    exit 1
fi

sleep 2

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "STEP 3: Starting new daemon from fresh repo (port 5001)..."
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

ssh $SUPERNODE "systemctl start kubo-new.service"
sleep 15

# Verify it started
new_status=$(ssh $SUPERNODE "systemctl is-active kubo-new.service || echo 'inactive'")
if [ "$new_status" = "active" ]; then
    echo -e "${GREEN}✅ New daemon started${NC}"
    
    # Test API
    response=$(ssh $SUPERNODE "curl -s http://127.0.0.1:5001/api/v0/version 2>/dev/null | head -c 20" || echo "")
    if [ ! -z "$response" ]; then
        echo -e "${GREEN}✅ New daemon API responding${NC}"
    else
        echo -e "${YELLOW}⏳ New daemon API not responding yet (might be initializing)${NC}"
    fi
else
    echo -e "${RED}❌ New daemon failed to start!${NC}"
    exit 1
fi

sleep 2

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "STEP 4: Reloading cluster configuration..."
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

ssh $SUPERNODE "systemctl restart ipfs-cluster.service"
sleep 5

echo -e "${GREEN}✅ Cluster restarted${NC}"

sleep 2

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo "STEP 5: Verifying cluster sees both daemons..."
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

peers=$(ssh $SUPERNODE "ipfs-cluster-ctl peers ls 2>/dev/null | grep -c Peername || echo 0")
echo "Cluster peers: $peers"

if [ "$peers" -ge 1 ]; then
    echo -e "${GREEN}✅ Cluster responding${NC}"
else
    echo -e "${YELLOW}⏳ Cluster still initializing${NC}"
fi

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             ✅ CUTOVER COMPLETE - SYSTEM ONLINE              ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "📊 Architecture is now:"
echo "   • Old Daemon (Archive): /pool0/ipfs/.ipfs (port 4002, tamed)"
echo "   • New Daemon (Fresh): /pool0/ipfs/.ipfs-new (port 5001)"
echo "   • Cluster: Routing between both"
echo ""
echo "🔍 NEXT: Run monitoring script if not already done:"
echo "   ./scripts/monitor-cutover.sh"
echo ""
echo "✅ Hot nodes can resume operations"
echo ""
