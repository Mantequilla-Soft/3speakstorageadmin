# Complete Dual-Repo Migration Roadmap

## Executive Summary

3Speak's IPFS supernode is choking on an 81.6TB bloated repo that can't be garbage collected or even listed. The solution: create a fresh new repo for new content, archive the old repo to the cluster for rare access, and use the gateway to seamlessly fall back to old content when needed.

**Impact:**
- ✅ Eliminate choking daemon (performance restored)
- ✅ Enable independent GC (cleanup becomes possible)
- ✅ 64TB runway for new content (years of growth)
- ✅ Transparent fallback for old videos (no service disruption)
- ✅ Archive strategy ready (prepare for offline storage)

---

## Phases Overview

### Phase 1: Cluster Integration ✅ COMPLETE
**Status:** Ready for testing  
**Duration:** 1-2 weeks  
**Risk:** Low

Integrate admin tool with cluster via SSH tunnel. Enables monitoring and management of cluster pins.

**Deliverables:**
- ✅ Cluster endpoint config
- ✅ IPFS service extensions
- ✅ Admin commands (status, pins, check)
- ✅ SSH tunnel helper script
- ✅ Setup documentation

**Current Step:** Test tunnel connectivity

**Commands Available:**
```bash
node dist/index.js cluster-status      # Check health
node dist/index.js cluster-pins        # List pins
node dist/index.js cluster-check <hash> # Verify hash
```

**Next:** Proceed to Phase 2 once testing confirms cluster connectivity.

---

### Phase 2: Gateway Fallback (Planned)
**Status:** Design ready  
**Duration:** 3-5 days  
**Risk:** Medium (requires nginx testing)

Configure gateway to serve from new repo with automatic fallback to old repo.

**What needs to happen:**
1. Nginx already has failover scaffold: `proxy_next_upstream error timeout http_502 http_504 http_404`
2. Start secondary IPFS daemon on port 8083 (or backup gateway)
3. Point it to old repo
4. Uncomment nginx backup upstream
5. Test: old videos fail on daemon, succeed on backup

**Why safe:**
- Failover is built into nginx config already
- Old daemon stays operational (just reserved for archive)
- No downtime during testing
- Rollback is immediate (revert nginx config)

**Testing Plan:**
- Request old video → should succeed via fallback
- Monitor latency → should be <1s after CDN cache
- Verify new videos still fast → should be instant from daemon

---

### Phase 3: Old Repo to Cluster (Planned)
**Status:** Process documented  
**Duration:** 1 week  
**Risk:** Low (dry-run before execution)

Transition old repo to cluster-only pinning. New daemon becomes primary.

**Steps:**
1. Export pin list from old daemon (lightweight, no traversal)
2. Verify pin count
3. Pin exported list to cluster via batch operations
4. Verify cluster has all pins
5. Stop new pinning on old daemon
6. Disable 3speak-pinner timer

**Data Safety:**
- Old blockstore stays intact (pinned to cluster)
- No deletion until confirmed stable
- 2-week stabilization window before archival

---

### Phase 4: Switchover (Planned)
**Status:** Sequence planned  
**Duration:** 1 day  
**Risk:** High (brief service impact)

Cut over to new daemon. Old daemon becomes archive-only.

**Sequence:**
1. Init new repo: `/pool0/ipfs/.ipfs-new`
2. Update systemd: `ExecStart=/usr/local/bin/ipfs daemon ... --repo-path=/pool0/ipfs/.ipfs-new`
3. Restart daemon (30-60s downtime)
4. Verify gateway serving from new repo
5. Update upload service to pin to new repo
6. Monitor for 1-2 weeks

**Fallback:**
- Revert daemon config to old path
- Restart daemon
- Restore pinner timer
- ~5 minutes to rollback

---

## Infrastructure Architecture

### Current State
```
Gateway (nginx) 
    ↓
Daemon (5002) → Old 81.6TB Repo
    ↓
Cluster (9095, 9097) — coordinating pins to daemon
```

### Final State
```
Gateway (nginx)
    ├→ Primary: Daemon (8080) → New Repo (~100GB, growing)
    └→ Fallback: Old Daemon (8083) → Old Repo (81.6TB, archived)
         ↓
    Cluster (9095, 9097) — coordinating pins across both
```

---

## Success Metrics

| Metric | Current | Target | Timeline |
|--------|---------|--------|----------|
| Daemon repo size | 81.6TB | <100GB | Phase 4 |
| GC possible | ❌ No | ✅ Yes | Phase 4 |
| Daemon CPU | 275% | <50% | Phase 4 |
| New video latency | Timeout | <100ms | Phase 4 |
| Old video latency | N/A | <1s | Phase 2 |
| Cluster access | Remote ❌ | Local tunnel ✅ | Phase 1 |
| Data runway | N/A | 5+ years | Phase 4 |

---

## Timeline Estimate

| Phase | Start | End | Duration | Dependency |
|-------|-------|-----|----------|------------|
| **1** | Feb 4 | Feb 18 | 2 weeks | None |
| **2** | Feb 19 | Feb 24 | 1 week | Phase 1 ✅ |
| **3** | Feb 25 | Mar 4 | 1 week | Phase 2 ✅ |
| **4** | Mar 5 | Mar 6 | 1 day | Phase 3 ✅ |
| **Stabilize** | Mar 7 | Mar 21 | 2 weeks | Phase 4 ✅ |

**Total:** 5 weeks to full migration and stabilization.

---

## Documentation Structure

```
docs/internal/
├── DUAL_REPO_MIGRATION_PLAN.md ........... High-level strategy
├── SUPERNODE_ASSESSMENT.md .............. Current state + feasibility
├── PHASE_1_CLUSTER_SETUP.md ............. SSH tunnel guide
├── IMPLEMENTATION_SUMMARY.md ............ What was built (Phase 1)
├── PHASE_2_GATEWAY_SETUP.md ............ (To be created)
├── PHASE_3_MIGRATION_PROCESS.md ........ (To be created)
└── PHASE_4_SWITCHOVER_CHECKLIST.md .... (To be created)
```

---

## Risk Assessment

### Phase 1: LOW
- Tunnel-based access only (no production changes)
- SSH key-based auth
- Rollback: just close tunnel

### Phase 2: MEDIUM
- Requires nginx testing in staging
- Fallback tested before production
- Rollback: revert nginx config (5 minutes)

### Phase 3: LOW
- Dry-run and verification steps
- No deletion, just state change
- Rollback: resume pinner timer

### Phase 4: HIGH
- Brief downtime (30-60 seconds)
- Must execute in low-traffic window
- Rollback: 5 minutes to restore old daemon

### Overall: MANAGEABLE
- Each phase isolated and testable
- Clear rollback paths
- No data loss risk if sequenced correctly

---

## Dependencies & Prerequisites

**Must-haves before Phase 1:**
- ✅ SSH access to supernode (verified)
- ✅ Cluster running and coordinating (verified)
- ✅ Admin tool source code (available)
- ✅ 64TB free space on supernode (verified)

**Must-haves before Phase 2:**
- ✅ Phase 1 complete and tested
- ✅ Nginx failover understanding
- ✅ Secondary gateway port available (8083)

**Must-haves before Phase 3:**
- ✅ Phase 2 complete and stable
- ✅ Pin export process validated
- ✅ Cluster pin API tested

**Must-haves before Phase 4:**
- ✅ All previous phases complete
- ✅ Nginx fallback confirmed working
- ✅ Cluster coordinating both repos
- ✅ Low-traffic window scheduled

---

## Usage After Completion

### Daily Operations
```bash
# Monitor cluster health
node dist/index.js cluster-status

# Check if specific video is in archive
node dist/index.js cluster-check QmHash...

# View storage usage
node dist/index.js stats

# Cleanup old abandoned videos
node dist/index.js cleanup --orphaned --dry-run
```

### Routine Maintenance
```bash
# Weekly GC on new repo (runs automatically via timer)
# No impact on gateway or uploads

# Monthly check on archive repo health
node dist/index.js cluster-status

# Archive videos with no access in 6 months
# (Tool to be created in Phase 3)
```

### Emergency Procedures
```bash
# If new daemon fails, old repo still serves via fallback
# No service disruption, just slow

# To temporarily disable GC:
systemctl stop ipfs-gentle-gc.timer

# To restore old daemon as primary (rollback Phase 4):
sudo systemctl edit ipfs.service
# Change IPFS_PATH back to /.ipfs
systemctl restart ipfs
```

---

## Communication Plan

### For Operations Team
- Phase 1: "Cluster monitoring tool ready for testing"
- Phase 2: "Implementing automatic fallback for archive videos"
- Phase 3: "Archiving old repo content to cluster"
- Phase 4: "Migrating to new IPFS repo — brief maintenance window required"

### For Users
- Pre-Phase 3: "We're archiving old videos (>6 months). Download yours now."
- Post-Phase 4: "3Speak video infrastructure upgraded. Old videos may take up to 1 minute to load."

---

## Next Immediate Action

**For Feb 4 (today):**
1. Review this roadmap
2. Test Phase 1 with SSH tunnel
3. Confirm cluster connectivity
4. Document any issues

**For Feb 11 (end of Phase 1):**
1. Complete Phase 1 testing
2. Begin Phase 2 design
3. Set up staging nginx for testing

**For Feb 25 (Phase 3):**
1. Export old repo pin list
2. Begin cluster pin migration
3. Validate pin counts

**For Mar 5 (Phase 4):**
1. Schedule maintenance window
2. Execute switchover
3. Monitor for stability

---

**Questions?** See `SUPERNODE_ASSESSMENT.md` for detailed technical architecture.  
**Ready to start Phase 1?** See `CLUSTER_QUICK_START.md` for immediate testing.
