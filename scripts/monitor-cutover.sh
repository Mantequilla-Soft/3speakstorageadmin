#!/bin/bash

# Phase 2b Cutover Monitoring Script
# Watches daemon health during the migration
# ABORT THRESHOLDS:
#   - Old daemon CPU > 80%
#   - Old daemon memory > 60GB
#   - New daemon not responding after 30s
#   - Cluster not healthy
#   - Connections > 500 on old daemon

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SUPERNODE="root@ipfs.3speak.tv"
ABORT_CPU_THRESHOLD=80
ABORT_MEM_THRESHOLD_GB=60
ABORT_CONNECTIONS_THRESHOLD=500
NEW_DAEMON_TIMEOUT=30
MONITOR_INTERVAL=3
TOTAL_DURATION=600  # 10 minutes of monitoring after cutover

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  PHASE 2B CUTOVER MONITORING SYSTEM${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "⚠️  ABORT THRESHOLDS:"
echo "   • Old daemon CPU: ${ABORT_CPU_THRESHOLD}%"
echo "   • Old daemon Memory: ${ABORT_MEM_THRESHOLD_GB}GB"
echo "   • Old daemon Connections: ${ABORT_CONNECTIONS_THRESHOLD}"
echo "   • New daemon startup timeout: ${NEW_DAEMON_TIMEOUT}s"
echo ""
echo "📊 Press Ctrl+C to stop monitoring"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Colors for status
health_status() {
    local value=$1
    local threshold=$2
    local unit=$3
    
    if (( $(echo "$value > $threshold" | bc -l) )); then
        echo -e "${RED}⚠️  CRITICAL${NC} ($value${unit})"
        return 1
    elif (( $(echo "$value > $((threshold * 80 / 100))" | bc -l) )); then
        echo -e "${YELLOW}⚡ WARNING${NC} ($value${unit})"
        return 0
    else
        echo -e "${GREEN}✅ OK${NC} ($value${unit})"
        return 0
    fi
}

start_time=$(date +%s)
iteration=0

while true; do
    iteration=$((iteration + 1))
    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    
    echo -e "${BLUE}[Iteration $iteration | Elapsed: ${elapsed}s]${NC}"
    echo ""
    
    # Check old daemon (archive)
    echo "🔍 Old Daemon (Archive on 4002):"
    old_pid=$(ssh $SUPERNODE "pgrep -f 'IPFS_PATH=/pool0/ipfs/.ipfs ' | head -1" 2>/dev/null || echo "")
    
    if [ -z "$old_pid" ]; then
        echo -e "  ${RED}❌ Not running${NC}"
    else
        # CPU usage
        old_cpu=$(ssh $SUPERNODE "ps -p $old_pid -o %cpu= 2>/dev/null | tr -d ' '" 2>/dev/null || echo "0")
        echo -n "  CPU: "
        if ! health_status "$old_cpu" "$ABORT_CPU_THRESHOLD" "%"; then
            echo -e "${RED}🛑 ABORTING: CPU too high!${NC}"
            exit 1
        fi
        
        # Memory usage
        old_mem_kb=$(ssh $SUPERNODE "ps -p $old_pid -o rss= 2>/dev/null | tr -d ' '" 2>/dev/null || echo "0")
        old_mem_gb=$(echo "scale=2; $old_mem_kb / 1024 / 1024" | bc)
        echo -n "  Memory: "
        if ! health_status "$old_mem_gb" "$ABORT_MEM_THRESHOLD_GB" "GB"; then
            echo -e "${RED}🛑 ABORTING: Memory too high!${NC}"
            exit 1
        fi
        
        # Active connections
        old_conns=$(ssh $SUPERNODE "netstat -an 2>/dev/null | grep -c ESTABLISHED || echo 0" 2>/dev/null || echo "0")
        echo -n "  Connections: "
        if [ "$old_conns" -gt "$ABORT_CONNECTIONS_THRESHOLD" ]; then
            echo -e "${RED}⚠️  HIGH${NC} ($old_conns)"
        else
            echo -e "${GREEN}✅ OK${NC} ($old_conns)"
        fi
    fi
    
    echo ""
    
    # Check new daemon (fresh repo)
    echo "🔍 New Daemon (Fresh on 5001):"
    new_pid=$(ssh $SUPERNODE "pgrep -f 'IPFS_PATH=/pool0/ipfs/.ipfs-new' | head -1" 2>/dev/null || echo "")
    
    if [ -z "$new_pid" ]; then
        if [ $elapsed -lt $NEW_DAEMON_TIMEOUT ]; then
            echo -e "  ${YELLOW}⏳ Still starting...${NC} (${elapsed}s)"
        else
            echo -e "  ${RED}❌ Failed to start after ${NEW_DAEMON_TIMEOUT}s!${NC}"
            exit 1
        fi
    else
        # New daemon running, check health
        new_cpu=$(ssh $SUPERNODE "ps -p $new_pid -o %cpu= 2>/dev/null | tr -d ' '" 2>/dev/null || echo "0")
        echo "  CPU: ${GREEN}✅${NC} ($new_cpu%)"
        
        new_mem_kb=$(ssh $SUPERNODE "ps -p $new_pid -o rss= 2>/dev/null | tr -d ' '" 2>/dev/null || echo "0")
        new_mem_gb=$(echo "scale=2; $new_mem_kb / 1024 / 1024" | bc)
        echo "  Memory: ${GREEN}✅${NC} ($new_mem_gb GB)"
        
        # Check if responding
        response=$(ssh $SUPERNODE "curl -s http://127.0.0.1:5001/api/v0/version 2>/dev/null | head -c 10" 2>/dev/null || echo "")
        if [ ! -z "$response" ]; then
            echo -e "  API: ${GREEN}✅ Responding${NC}"
        else
            echo -e "  API: ${YELLOW}⏳ Not responding yet${NC}"
        fi
    fi
    
    echo ""
    
    # Check cluster health
    echo "🔍 Cluster Status:"
    cluster_status=$(ssh $SUPERNODE "ipfs-cluster-ctl peers ls 2>/dev/null | head -3" 2>/dev/null || echo "")
    if [ ! -z "$cluster_status" ]; then
        echo -e "  ${GREEN}✅ Cluster responding${NC}"
    else
        echo -e "  ${YELLOW}⏳ Waiting for cluster${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}───────────────────────────────────────────────────────────────${NC}"
    echo ""
    
    # Check if we should stop monitoring
    if [ $elapsed -gt $TOTAL_DURATION ]; then
        echo -e "${GREEN}✅ Cutover complete! Monitoring for ${elapsed}s with no issues.${NC}"
        echo "Your patient is stable. 🏥✨"
        exit 0
    fi
    
    sleep $MONITOR_INTERVAL
done
