# Plan: IPFS Dual-Repo Architecture with Cluster Cold Storage

Migrate from a single bloated repo to a clean dual-repo system: new repo on daemon for hot content (new videos, 98%), old repo on cluster for cold storage (archive, 2% access), with gateway fallback to cluster for seamless content retrieval. Eliminates performance choking and enables independent GC on the new repo.

## Phase 1: Cluster Integration into Admin Tool

**Objective:** Enable the admin tool to communicate with and monitor the IPFS cluster, separate from daemon operations.

**Steps:**

1. Add cluster endpoint configuration to `src/config/index.ts` — support both daemon and cluster endpoints via environment variables (`IPFS_DAEMON_ENDPOINT`, `IPFS_CLUSTER_ENDPOINT`)

2. Extend `src/services/ipfs.ts` to detect and support cluster API endpoints — implement cluster-specific pin status, list, and unpin methods that use `/api/v0/pins` endpoints

3. Create `src/commands/cluster-status.ts` — new command to query cluster health, pin counts, peer status, and replication metrics

4. Add cluster monitoring to `src/web/server.ts` dashboard — display separate metrics for daemon vs. cluster

5. Update batch processors in `src/utils/batch-processor.ts` to handle cluster-specific rate limits (cluster may have different thresholds than daemon)

## Phase 2: Gateway Fallback Setup

**Objective:** Configure the HTTPS gateway to serve from the new daemon repo, with automatic fallback to the cluster repo for old content.

**Steps:**

1. Document gateway configuration in `DEPLOYMENT.md` — add section on dual-repo IPFS setup with fallback logic

2. Configure primary gateway to serve from new daemon repo (point to new repo's port/endpoint)

3. Configure secondary/fallback gateway routing — likely requires custom IPFS HTTP gateway or reverse proxy layer:
   - **Option A:** Use IPFS HTTP proxy with custom routing rules
   - **Option B:** Nginx/Caddy reverse proxy in front of gateways (try daemon first, cluster on 404)
   - **Option C:** Custom fallback logic in 3speak application layer (if videos are app-served)

4. Test gateway failover: request old video → daemon returns 404 → cluster serves from cold storage

5. Document CDN cache strategy — ensure CDN doesn't cache "not found" responses, allow it to retry on fallback

## Phase 3: Old Repo to Cluster Migration

**Objective:** Transfer old repo content to cluster in archive mode, with user-facing tools to export their content before expiration.

**Steps:**

1. Create migration plan document in `DEPLOYMENT.md` — outline step-by-step repo transfer without service downtime

2. Implement `src/commands/migrate-to-cluster.ts` — verify old repo integrity, export pin list, prepare for cluster import

3. Add `src/commands/verify-cluster-migration.ts` — post-migration validation (pin counts match, content accessible)

4. Create archive announcement tool in `src/commands/generate-archive-notice.ts` — generate user-facing CID export tool/script so users can download their old videos before content expires

5. Document retention policy in `README.md` — clarify old repo will be accessed infrequently, archive content after X days/months of no access

6. Stop all pinning on old cluster repo (disable in systemd timer or config flag)

## Phase 4: Operational Switchover

**Objective:** Cut over to the new daemon repo while putting the old cluster repo into archive mode.

**Steps:**

1. Create new repo on the 60TB available space — initialize fresh IPFS repo for daemon

2. Reconfigure daemon to point to new repo path (update systemd service in `3speak-ipfs-storage-management.service`)

3. Redirect video ingestion to new daemon repo — update application layer to pin new videos to new repo only

4. Suspend old cluster from active pinning — keep it in "archive mode" (monitor only, no new pins)

5. Run verification suite via cluster-status command to confirm both repos operational

6. Monitor for 1–2 weeks: track old-content requests hitting cluster, confirm fallback working

## Further Considerations

### 1. Gateway Fallback Implementation

**Which approach fits your infrastructure best?**

- **Option A:** Custom IPFS HTTP middleware (most control, requires development)
- **Option B:** Reverse proxy layer (simpler, less control) — **Nginx/Caddy**
- **Option C:** Application-layer handling (best if 3speak app manages video serving)

**Recommendation:** Start with Option B (Nginx) for simplicity; migrate to Option A if fallback performance is insufficient.

### 2. Cluster Peer/Replication Setup

**Should the cluster actively replicate content from daemon, or is it archive-only?**

- **Archive-only:** Simpler, less bandwidth. Content only flows cluster→gateway on miss.
- **Active replication:** More resilient, but uses bandwidth. Keeps data fresh across both repos.

**Recommendation:** Start archive-only (2% traffic won't justify replication overhead). Re-evaluate if fallback performance becomes an issue.

### 3. Old Repo Retention & Cleanup

**How long to keep archive before archiving to cheaper cold storage?**

- No timeline specified yet. Suggest: 90 days no-access trigger for deeper archival (offline storage)?
- Or explicit TTL announcement to users (e.g., "old content archived after 6 months")?

**Recommendation:** Define this based on business/legal requirements before Phase 3.

## Timeline & Risk Mitigation

| Phase | Duration | Risk Level | Mitigation |
|-------|----------|-----------|-----------|
| Phase 1 | 1–2 weeks | Low | Unit tests for cluster API integration |
| Phase 2 | 1 week | Medium | Test failover in staging before prod; monitor CDN behavior |
| Phase 3 | 1–2 weeks | Low | Dry-run migration; verify pin counts before/after |
| Phase 4 | 2–3 days | High | Perform during low-traffic window; have rollback plan |

## Success Metrics

- New daemon repo operational with <2% disk usage vs. old repo bloat
- Independent GC runs without halting services
- 2% of old-content requests fall back to cluster within acceptable latency (<500ms additional)
- Zero data loss during migration
- Dashboard displays separate daemon/cluster metrics
- Systemd services stable under new configuration

## Rollback Plan

If Phase 4 encounters critical issues:
1. Revert daemon to old repo path (keep new repo intact as backup)
2. Re-enable pinning on cluster
3. Investigate issues before re-attempting switchover
4. No data is deleted until migration confirmed stable for 2 weeks
