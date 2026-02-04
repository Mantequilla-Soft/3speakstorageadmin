# Dual-Daemon IPFS Architecture Migration

**Date:** February 3-4, 2026  
**Status:** ✅ Complete  
**Impact:** Critical infrastructure change - resolved daemon choking issue

---

## Problem Statement

### Symptoms
The main IPFS daemon on the supernode (160TB-SuperNode) was experiencing severe performance degradation:

- **Memory spikes:** RAM usage spiking from normal 2-3GB to 120GB+, causing OOM kills
- **System lockups:** Server becoming unresponsive during daemon operations
- **Repo size:** 81.6TB pinned content with flatfs datastore (inefficient for large repos)
- **Query timeouts:** Simple operations like `ipfs pin ls` causing permission errors and system hangs
- **Service instability:** Daemon requiring frequent restarts, disrupting video delivery

### Root Cause Analysis
1. **Flatfs datastore** doesn't scale well beyond 10-20TB
2. **Single daemon** handling both:
   - Heavy write traffic (new uploads from hot nodes)
   - Heavy read traffic (video playback, CDN requests)
   - Background operations (GC, repo maintenance)
3. **No connection limits** - daemon accepting unlimited peer connections
4. **DHT enabled** - participating in network-wide content discovery (unnecessary overhead)

### Business Impact
- Video playback interruptions for users
- Hot node backup failures
- Risk of complete service outage if daemon crashes during peak traffic

---

## Solution: Dual-Daemon Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        NGINX (Port 443)                     │
│                     ipfs.3speak.tv                          │
└────────────┬──────────────────────────┬─────────────────────┘
             │                          │
      ┌──────▼──────┐            ┌──────▼─────────┐
      │  API Write  │            │  Gateway Read  │
      │   Port 5001 │            │   Port 8081    │
      └──────┬──────┘            └──────┬─────────┘
             │                          │
      ┌──────▼──────────────────┐  ┌───▼──────────────────────┐
      │  NEW DAEMON (Fresh)     │  │  OLD DAEMON (Archive)    │
      │  /pool0/ipfs/.ipfs-new  │  │  /pool0/ipfs/.ipfs       │
      │  - pebbleds datastore   │  │  - flatfs datastore      │
      │  - Receives new uploads │  │  - Read-only archive     │
      │  - Memory: ~50MB        │  │  - Tamed connections     │
      │  - Week-old backups     │  │  - Memory: ~220MB        │
      │  - Hot node content     │  │  - 81.6TB historical     │
      └─────────────────────────┘  └──────────────────────────┘
                   │                          │
                   └────────┬─────────────────┘
                            │
                   ┌────────▼──────────┐
                   │  IPFS Cluster     │
                   │  Coordinates both │
                   │  100 peers each   │
                   └───────────────────┘
```

### Implementation Strategy

#### Phase 1: Preparation
- Created new IPFS repo with `pebbleds` profile at `/pool0/ipfs/.ipfs-new`
- Configured new daemon on ports 5001 (API), 8081 (Gateway)
- Tamed old daemon configuration:
  - Reduced connections: `LowWater: 16, HighWater: 32`
  - Disabled DHT: `Routing.Type: none`
  - Extended GC period: `GCPeriod: 24h`
  - Disabled hash verification: `HashOnRead: false`
- Created systemd services:
  - `kubo-new.service` (new daemon)
  - `kubo-old-archive.service` (tamed old daemon)

#### Phase 2: Cutover
- Stopped main `ipfs.service`
- Started both new services simultaneously
- Updated IPFS Cluster configuration to recognize both daemons
- Restarted cluster to coordinate dual-daemon setup

#### Phase 3: Nginx Routing Configuration
**Critical issue discovered:** Hot nodes were bypassing Nginx, connecting directly to port 5002 (old daemon API).

**Solution implemented:**
1. Updated Nginx to expose API endpoints:
   - `/api/v0/add` → port 5001 (uploads to new daemon)
   - `/api/v0/pin/add|rm|ls` → port 5001 (pin operations to new daemon)
2. Updated gateway routing (fixed multiple times due to config drift):
   - All read operations → port 8081 (new daemon gateway)
   - HLS manifests (`.m3u8`) → port 8081
   - HLS segments (`.ts`, `.m4s`, `.key`, `.vtt`) → port 8081
   - Catch-all `/` → port 8081
3. Blocked direct external access to daemon ports:
   - Only localhost can access ports 5001, 5002
   - All external traffic forced through Nginx HTTPS

#### Phase 4: Post-Cutover Issues (Day 2)
**RAM Spike Crisis:** System RAM usage spiked to 90GB within hours of cutover.

**Root causes identified:**
1. **Stuck `du` command:** A disk usage check on old repo had been running for 7+ hours, reading 81.6TB of blocks into cache
2. **Old daemon with GC enabled:** Service file still had `--enable-gc` flag causing background operations
3. **Bitswap flooding:** Old daemon receiving constant bitswap requests from network peers, causing permission errors
4. **New daemon overloaded:** Running at 82% CPU, 1.2GB RAM after 10 hours

**Emergency fixes applied:**
```bash
# Kill stuck du command
kill -9 74086

# Clear filesystem cache (freed 69GB RAM)
sync && echo 3 > /proc/sys/vm/drop_caches

# Disable bandwidth metrics on old daemon
IPFS_PATH=/pool0/ipfs/.ipfs ipfs config --json Swarm.DisableBandwidthMetrics true

# Remove GC flag from old daemon
sed -i 's/ --enable-gc//' /etc/systemd/system/kubo-old-archive.service
systemctl daemon-reload
systemctl restart kubo-old-archive

# Result: RAM dropped from 90GB → 21GB
```

**Node-fetch timeout issue:** Test command initially timed out due to default timeout being too short. Added 60-second timeout to fetch requests.

---

## Configuration Details

### New Daemon Configuration
**Location:** `/pool0/ipfs/.ipfs-new/config`

```json
{
  "Datastore": {
    "Spec": {
      "type": "measure",
      "child": {
        "type": "pebbleds",
        "path": "datastore"
      }
    }
  },
  "Addresses": {
    "API": "/ip4/127.0.0.1/tcp/5001",
    "Gateway": "/ip4/127.0.0.1/tcp/8081",
    "Swarm": ["/ip4/0.0.0.0/tcp/4001", "/ip6/::/tcp/4001"]
  }
}
```

### Old Daemon Configuration (Tamed)
**Location:** `/pool0/ipfs/.ipfs/config`

```json
{
  "Swarm": {
    "ConnMgr": {
      "LowWater": 16,
      "HighWater": 32
    }
  },
  "Routing": {
    "Type": "none"
  },
  "Datastore": {
    "GCPeriod": "24h",
    "HashOnRead": false
  },
  "Addresses": {
    "API": "/ip4/0.0.0.0/tcp/5002",
    "Gateway": "/ip4/0.0.0.0/tcp/8080",
    "Swarm": ["/ip4/0.0.0.0/tcp/4001", "/ip6/::/tcp/4001"]
  }
}
```

### Nginx Configuration
**File:** `/etc/nginx/sites-enabled/ipfs-3speak`

**Key routing rules:**
```nginx
# Gateway upstream points to new daemon
upstream ipfs_gateways {
    server 127.0.0.1:8081;
}

# HTTPS API endpoints (port 443)
location /api/v0/add {
    proxy_pass http://127.0.0.1:5001;  # New daemon
}

location ~ ^/api/v0/pin/(add|rm|ls) {
    proxy_pass http://127.0.0.1:5001;  # New daemon
}

# All gateway reads
location ~* \.m3u8$ {
    proxy_pass http://127.0.0.1:8081;  # New daemon
}

location ~* \.(ts|m4s|key|vtt)$ {
    proxy_pass http://127.0.0.1:8081;  # New daemon
}

location / {
    proxy_pass http://127.0.0.1:8081;  # New daemon
}
```

### Systemd Services
**New Daemon:** `/etc/systemd/system/kubo-new.service`
```ini
[Unit]
Description=IPFS daemon (new fresh repo)
After=network.target

[Service]
Type=notify
Environment=IPFS_PATH=/pool0/ipfs/.ipfs-new
ExecStart=/usr/local/bin/ipfs daemon --migrate=true
Restart=on-failure
RestartSec=10s
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
```

**Old Daemon:** `/etc/systemd/system/kubo-old-archive.service`
```ini
[Unit]
Description=IPFS daemon (old archive, tamed)
After=network.target

[Service]
Type=notify
Environment=IPFS_PATH=/pool0/ipfs/.ipfs
ExecStart=/usr/local/bin/ipfs daemon --migrate=true
Restart=on-failure
RestartSec=10s
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
```

**Note:** The `--enable-gc` flag was initially present but removed during troubleshooting (Day 2) to reduce load on archive daemon.

---

## Verification & Testing

### Test Upload Command
Created dedicated test command in this repository:

```bash
node dist/index.js test-supernode-upload
```

This uploads a timestamped test file and returns the CID for verification.

### Manual Verification
```bash
# Check which daemon has a specific CID
IPFS_PATH=/pool0/ipfs/.ipfs-new ipfs pin ls <CID>  # Should find it
IPFS_PATH=/pool0/ipfs/.ipfs ipfs pin ls <CID>      # Should NOT find it

# Monitor daemon health
systemctl status kubo-new kubo-old-archive

# Check memory usage
ps aux | grep ipfs | grep -v grep

# Count pins in each repo
IPFS_PATH=/pool0/ipfs/.ipfs-new ipfs pin ls --type recursive | wc -l
IPFS_PATH=/pool0/ipfs/.ipfs ipfs stats repo  # Old repo (careful - may choke)

# Check Nginx logs for API traffic
tail -f /var/log/nginx/access.log | grep "api/v0"

# Verify daemon ports
ss -tlnp | grep ipfs
```

### Success Criteria
- ✅ New uploads appear only in new daemon
- ✅ Old daemon memory stable at ~236MB (down from 120GB+ spikes)
- ✅ New daemon memory ~1.2GB under load (started at ~50MB)
- ✅ Gateway serving content correctly (port 8081)
- ✅ Hot node backups successful (after routing fixes)
- ✅ Video playback uninterrupted
- ✅ No direct connections to port 5002 from external IPs (localhost only)
- ✅ System RAM stable at ~21GB (down from 90GB spike)

---

## Troubleshooting Guide

### Issue: Uploads Going to Old Daemon
**Symptoms:** CID found in `/pool0/ipfs/.ipfs` instead of `.ipfs-new`

**Diagnosis:**
```bash
# Check active connections
ss -tnp | grep :5002  # Should only show localhost
ss -tnp | grep :5001  # Should show Nginx connections

# Check Nginx routing
grep "proxy_pass" /etc/nginx/sites-enabled/ipfs-3speak
```

**Fix:**
1. Verify Nginx routes to port 5001 for API operations
2. Ensure firewall blocks external access to 5002
3. Reload Nginx: `systemctl reload nginx`

### Issue: Old Daemon Choking, bitswap flooding errors

**Diagnosis:**
```bash
# Check if daemon is being queried directly
journalctl -u kubo-old-archive -n 100

# Check memory
ps aux | grep ipfs

# Look for stuck processes
ps aux | grep "du -sh"
```

**Fix:**
1. Don't run `ls`, `du`, or disk usage commands on old repo (causes massive cache buildup)
2. Kill any stuck disk operations: `kill -9 <PID>`
3. Clear filesystem cache if RAM spiked: `sync && echo 3 > /proc/sys/vm/drop_caches`
4. Ensure `--enable-gc` flag removed from systemd service
5. Verify only cluster connections to port 5002
6. Verify only cluster connections to port 5002
3. Restart if necessary: `systemctl restart kubo-old-archive`

### Issue: Videos Not Playing
**Symptoms:** 404 or timeout errors on video requests

**Diagnosis:**
```bash
# Check daemon status
systemctl status kubo-new

# Check if content accessible
curl -I http://127.0.0.1:8081/ipfs/<CID>

# Check Nginx logs
tail -f /var/log/nginx/error.log
```

**Fix:**
1. Verify new daemon is running
2. Check gateway port 8081 accessible
3. Verify upstream configuration in Nginx
4. Test direct gateway access before checking Nginx

---

## Maintenance & Operations

### Daily Monitoring
```bash
# Quick health check
systemctl is-active kubo-new kubo-old-archive ipfs-cluster

# Memory check
ps aux | grep ipfs | awk '{print $2, $4, $11}'

# Pin count growth (new daemon)
IPFS_PATH=/pool0/ipfs/.ipfs-new ipfs pin ls --type recursive | wc -l

# Check GC log for cleanup activity
tail -20 /var/log/ipfs-gc-new.log
```

### Automated Garbage Collection
The new daemon accumulates cached blocks from serving old content. Daily GC is configured via cron:

```bash
# View current cron jobs
crontab -l

# Cron job (runs daily at 3 AM):
0 3 * * * IPFS_PATH=/pool0/ipfs/.ipfs-new /usr/local/bin/ipfs repo gc >> /var/log/ipfs-gc-new.log 2>&1
```

**To install GC cron job:**
```bash
(crontab -l 2>/dev/null; echo "0 3 * * * IPFS_PATH=/pool0/ipfs/.ipfs-new /usr/local/bin/ipfs repo gc >> /var/log/ipfs-gc-new.log 2>&1") | crontab -
```

**Manual GC (if needed):**
```bash
IPFS_PATH=/pool0/ipfs/.ipfs-new ipfs repo gc
```

**Note:** The new daemon typically accumulates 900-1000 cached blocks per day from gateway traffic serving old content.

### Weekly Tasks
1. Review Nginx access logs for anomalies
2. Verify no direct connections to daemon ports
3. Check disk space on `/pool0`
4. Review daemon memory trends

### Hot Node Configuration
Hot nodes must use HTTPS endpoint (not direct IP):

```bash
# Correct configuration
SUPERNODE_API=https://ipfs.3speak.tv/api/v0/add

# ❌ Wrong (bypasse - Q2 2026):** User-Initiated Backup Window
- Announce 6-month backup window for old content (videos older than current date)
- Users can download/re-upload their historical content if desired
- No automatic migration planned - old repo remains read-only archive

**Phase 4 (Future - Q3 2026):** Gradual Old Daemon Shutdown
- After backup window closes, old daemon can be stopped
- Old repo `/pool0/ipfs/.ipfs` remains on disk for emergency recovery (6-12 months)
- Gateway routing switches entirely to new daemon
- Archive old repo offline for legal/compliance hold period
- **Note:** No cluster migration planned - old content will eventually be abandonedrowth on new repo

**Phase 4 (Future):** Decommission old daemon
- After all critical content verified in cluster
- Stop `kubo-old-archive.service`
- Archive `/pool0/ipfs/.ipfs` for disaster recovery
- Update documentation

---

5. **Stuck monitoring commands:** `du` command left running on old repo caused 90GB RAM spike
6. **GC flag oversight:** Old daemon started with `--enable-gc` causing unnecessary load
7. **Gateway port confusion:** Had to fix 8080→8081 routing multiple times
8. **Default timeout too short:** Node-fetch needed 60s timeout for production environment
## Lessons Learned

### What Went Wrong
1. **Direct port exposure:** Hot nodes were configured with hardcoded IPs bypassing Nginx
2. **Missing API endpoints:** Nginx initially only exposed `/api/v0/add`, not pin operations
3. **Incomplete firewall rules:** Ports 5001/5002 were publicly accessible
4. **Configuration drift:** `sites-available` vs `sites-enabled` confusion

### What Went Right
1. **Zero downtime cutover:** Both daemons started successfully without user impact
2. **Taming strategy worked:** Old daemon stable at 220MB after connection limits
3. **Cluster coordination:** Seamlessly recognized dual-daemon setup
4. **Testing methodology:** Created dedicated test command to verify routing

### Best Practices Established
6. **Never run disk usage commands on large IPFS repos** - use systemd for metrics instead
7. Clear filesystem cache after major I/O operations to prevent RAM bloat
8. Remove GC flags from archive/read-only daemons
9. Test from actual client machines, not just localhost
10. Set adequate timeouts (60s+) for production API calls
1. Always use Nginx proxy for daemon access
2. Never expose daemon API ports publicly
3. Test with actual upload before declaring success
4. Monitor memory trends for early warning signs
5. Document port mappings clearly

---

## References

- **Cutover Checklist:** `/docs/CUTOVER_CHECKLIST.md`
- **Phase 2 Plan:** `/docs/PHASE_2_DUAL_DAEMON_PLAN.md`
- **Monitoring Script:** `/scripts/monitor-cutover.sh`
- **Test Command:** `src/commands/test-supernode-upload.ts`

---

## Contact & Escalation

**Primary Engineer:** Meno  
**System:** 160TB-SuperNode (65.21.201.94)  
**Production Impact:** Critical - affects video delivery

**Emergency Rollback:**
```bash
# Stop new services
systemctl stop kubo-new kubo-old-archive

# Start original service
systemctl start ipfs.service

# Revert Nginx (from backup)
cp /etc/nginx/sites-enabled/ipfs-3speak.backup /etc/nginx/sites-enabled/ipfs-3speak
---

## Known Issues & Ongoing Monitoring

### New Daemon Load
- Currently running at 82% CPU, 1.2GB RAM after 10 hours
- May need connection limits similar to old daemon if load continues
- Monitor for memory growth over first week

### Old Daemon Bitswap Errors
- Continues to receive bitswap requests from network peers
- Permission denied errors are normal (corrupted/moved blocks)
- Not user-facing - cluster handles routing
- Can be ignored unless memory spikes

### Node-fetch Timeout
- Default timeout too short for production
- Test command updated with 60s timeout
- Hot node utilities should verify timeout settings

---

**Document Version:** 1.1  
**Last Updated:** February 4, 2026 (Post-Troubleshooting Update)  
**Next Review:** February 11, 2026 (1-week stability check)
**Backup Locations:**
- Nginx config: `/etc/nginx/sites-enabled/ipfs-3speak.backup.2026-02-04`
- Old daemon config: `/pool0/ipfs/.ipfs/config.backup.2026-02-03`

---

**Document Version:** 1.0  
**Last Updated:** February 4, 2026  
**Next Review:** March 4, 2026
