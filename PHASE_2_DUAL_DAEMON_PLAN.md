# Phase 2: Dual-Daemon Architecture Setup

## Status: ✅ Step 1 Complete

### What We Just Did
- ✅ Created new fresh IPFS repo at `/pool0/ipfs/.ipfs-new`
- ✅ Initialized with `pebbleds` profile (modern, efficient)
- ✅ Configured as low-power mode

**New Repo Details:**
- Path: `/pool0/ipfs/.ipfs-new`
- Peer ID: `12D3KooWLwVfv7nUqQkxndLiA6Ze3vQs6eri49UCyMSyvwcRAvhB`
- Datastore: Pebbleds (efficient for large repos)
- Storage Max: 10GB (conservative, can adjust)

### The Two-Daemon Architecture

**Daemon 1 (New) - Port 5001:**
- Repo: `/pool0/ipfs/.ipfs-new`
- Purpose: Hot archive (receives week-old backups from hot nodes)
- Status: Ready to start
- Will handle: All NEW content after migration

**Daemon 2 (Old) - Port 5002:**
- Repo: `/pool0/ipfs/.ipfs` (current, 81.6TB)
- Purpose: Read-only archive (frozen, no GC thrashing)
- Status: Will be stopped/restarted in read-only mode
- Will handle: All OLD content (via cluster routing)

**Cluster Coordination:**
- Routes requests intelligently between both daemons
- Old CIDs → Daemon 2
- New CIDs → Daemon 1
- HTTP Gateway: `https://ipfs.3speak.tv/ipfs/<CID>` (unchanged)

## Status: ✅ Phase 2a Complete

### What We've Done
- ✅ Backed up current daemon config to `/pool0/ipfs/.ipfs/config.backup.1770177271`
- ✅ Tamed old daemon configuration:
  - Connections limited to 16-32 (was unlimited/aggressive)
  - DHT disabled (archive doesn't need routing)
  - GC period set to 24h (minimal background load)
  - Memory usage reduced (HashOnRead disabled)
- ✅ Created systemd services:
  - `kubo-new.service`: Fresh repo on default ports (5001)
  - `kubo-old-archive.service`: Archive repo with tamed limits (4002)

## Phase 2b: The Cutover (1 Hour Downtime Window)

**Prerequisites:**
- Notify hot nodes that gateway will be down 1 hour
- Prepare cutover for low-traffic period

**Steps (execute in order):**

```bash
# 1. Stop current daemon
systemctl stop 3speak-ipfs-storage-admin.service
sleep 2

# 2. Start old daemon (archive, tamed)
systemctl start kubo-old-archive.service
sleep 10
# Verify: curl localhost:5001/api/v0/id

# 3. Start new daemon (fresh repo)
systemctl start kubo-new.service
sleep 15
# Verify: curl localhost:5001/api/v0/version

# 4. Update cluster config to know about both daemons
# (see cluster config section below)

# 5. Reload cluster
systemctl restart ipfs-cluster.service
sleep 5

# 6. Verify cluster sees both daemons
ipfs-cluster-ctl peers ls

# 7. Test: Request old CID
# Should route to old daemon
curl http://127.0.0.1:8080/ipfs/<OLD_CID_HERE>

# 8. Test: Request new CID
# Should be empty initially (new repo)
curl http://127.0.0.1:8080/ipfs/<NEW_CID_HERE>
```

**Expected Results:**
- Old daemon running on 4002 (tamed, minimal load)
- New daemon running on 5001 (default)
- Cluster aware of both
- Old CIDs served from archive
- New CIDs will be pinned here starting week 1

## Phase 2c: Verification (15 minutes)
1. Test: Old CID request → served from old repo via cluster ✅
2. Test: New CID request → empty (expected, new repo) ✅
3. Test: Gateway routing works correctly ✅
4. Monitor: Old daemon using minimal resources ✅

### Phase 3: Hot Node Pinner Update
- Update hot-node pinner to pin to new repo after week 1
- Start archiving week-old videos automatically

---

## Cluster Configuration Update Needed

After cutover, cluster needs to know about **both daemons**. Current setup:

```json
{
  "ipfsClusterEndpoint": "http://65.21.201.94:9094",
  "ipfsClusterPinsEndpoint": "http://65.21.201.94:9097"
}
```

**Needs to be updated to configure cluster to use:**
- Primary: localhost:5001 (new daemon)
- Secondary: localhost:5002 (old daemon)

This tells cluster:
- New CIDs → pin to 5001 (new repo)
- Old CIDs → already pinned, coordinate with both 5001 & 5002
- Requests for CID → route to whichever daemon has it

Update location: `/home/ipfs-daemon/.ipfs-cluster/service.json`

Key settings:
```json
{
  "peername": "160TB-SuperNode",
  "privatekeyfile": "identity.key",
  "datastore": {
    "connectionurl": "postgres://..."
  },
  "api": {
    "restapi": {
      "httplistenmultiaddr": "/ip4/0.0.0.0/tcp/9094"
    }
  },
  "ipfshttp": {
    "nodetarget": [
      "/ip4/127.0.0.1/tcp/5001",
      "/ip4/127.0.0.1/tcp/5002"
    ]
  }
}
```

---

## Taming Summary (What We Configured)

**Rollback Plan:**
If new daemon fails:
1. Stop new daemon
2. Restart old daemon as primary (revert to original setup)
3. Investigate and retry

**Data Safety:**
- Old repo is never deleted, only frozen
- All 81.6TB remains accessible through cluster
- New repo starts fresh (no conflicts)

---

## Cluster Configuration Next

We'll need to update cluster config to know about both daemons:
- Primary daemon: localhost:5001 (new repo)
- Secondary daemon: localhost:5002 (old repo, read-only)

This ensures cluster can route both old and new content correctly.

---

## Current Config Snapshots

**New Repo Location:**
```
/pool0/ipfs/.ipfs-new
```

**Storage Settings (Conservative):**
```
StorageMax: 10GB
StorageGCWatermark: 90%
GCPeriod: 1h
```

Can be adjusted upward once we validate the setup works.
