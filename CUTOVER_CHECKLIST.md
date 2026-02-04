# Phase 2b Cutover Safety Checklist

## 🏥 PRE-CUTOVER (24 HOURS BEFORE)

- [ ] Notify team: Maintenance window scheduled
- [ ] Identify low-traffic period (check analytics)
- [ ] Ensure SSH key access to supernode verified
- [ ] Test: `ssh root@ipfs.3speak.tv "systemctl status ipfs-cluster.service"`
- [ ] Have rollback plan documented (see below)

## ✅ IMMEDIATE PRE-CUTOVER (15 MINUTES BEFORE)

- [ ] Verify hot nodes are ready for downtime
- [ ] Open two terminal windows:
  - Terminal A: For monitoring script
  - Terminal B: For cutover script
- [ ] Test monitoring script on dry run: `./scripts/monitor-cutover.sh` (Ctrl+C after 10s)
- [ ] Confirm both daemons created:
  - `/pool0/ipfs/.ipfs-new` exists
  - `/pool0/ipfs/.ipfs` exists (old)
- [ ] Confirm systemd services created:
  - `systemctl status kubo-new.service`
  - `systemctl status kubo-old-archive.service`

## 🚀 DURING CUTOVER (1 HOUR WINDOW)

**Terminal A (Monitoring):**
```bash
./scripts/monitor-cutover.sh
# Watches CPU, memory, connections in real-time
# Will auto-abort if thresholds exceeded
```

**Terminal B (Execution):**
```bash
./scripts/execute-cutover.sh
# Executes all cutover steps in sequence
# Requires "YES" confirmation
```

## 📊 ABORT CONDITIONS (Monitoring Script Stops Everything If...)

- [ ] Old daemon CPU > 80%
- [ ] Old daemon memory > 60GB
- [ ] New daemon fails to start in 30s
- [ ] Cluster unhealthy
- [ ] Old daemon connections > 500

If any abort condition triggered:
1. Monitoring script exits with error
2. Stop cutover script manually (Ctrl+C)
3. Execute rollback (see below)

## 🟢 SUCCESS INDICATORS

After cutover completes, verify:

1. **Both daemons running:**
   ```bash
   ssh root@ipfs.3speak.tv "systemctl status kubo-new.service"
   ssh root@ipfs.3speak.tv "systemctl status kubo-old-archive.service"
   ```
   Expected: Both `active (running)`

2. **Old daemon using minimal resources:**
   ```bash
   ssh root@ipfs.3speak.tv "ps aux | grep 'IPFS_PATH=/pool0/ipfs/.ipfs'"
   ```
   Expected: CPU < 5%, Memory < 5GB

3. **New daemon responding:**
   ```bash
   ssh root@ipfs.3speak.tv "curl -s http://127.0.0.1:5001/api/v0/version | jq"
   ```
   Expected: Version info returned

4. **Cluster aware of both:**
   ```bash
   ssh root@ipfs.3speak.tv "ipfs-cluster-ctl peers ls"
   ```
   Expected: 160TB-SuperNode + us-02.infra.3speak.tv listed

5. **Old content accessible:**
   ```bash
   curl -I https://ipfs.3speak.tv/ipfs/<OLD_CID_HERE>
   ```
   Expected: HTTP 200 (or 404 if not replicated, but no timeouts)

## 🔄 ROLLBACK PROCEDURE (If Something Goes Wrong)

**Scenario: Old daemon choking immediately**

```bash
# 1. Stop both new daemons
ssh root@ipfs.3speak.tv "systemctl stop kubo-new.service"
ssh root@ipfs.3speak.tv "systemctl stop kubo-old-archive.service"
sleep 5

# 2. Restart original daemon (if it hasn't been modified)
ssh root@ipfs.3speak.tv "systemctl start 3speak-ipfs-storage-admin.service"
sleep 20

# 3. Verify
ssh root@ipfs.3speak.tv "curl -s http://127.0.0.1:5001/api/v0/version | jq"

# 4. Notify team - back to original state
```

**Scenario: New daemon won't start**

```bash
# 1. Check logs
ssh root@ipfs.3speak.tv "journalctl -u kubo-new.service -n 50"

# 2. Verify repo initialized correctly
ssh root@ipfs.3speak.tv "ls -la /pool0/ipfs/.ipfs-new/"

# 3. Reinitialize if needed
ssh root@ipfs.3speak.tv << 'EOF'
rm -rf /pool0/ipfs/.ipfs-new/*
su - ipfs-daemon -c 'IPFS_PATH=/pool0/ipfs/.ipfs-new ipfs init --profile=pebbleds,lowpower'
EOF

# 4. Restart
ssh root@ipfs.3speak.tv "systemctl start kubo-new.service"
```

## 📝 POST-CUTOVER (VERIFY DAILY FOR 1 WEEK)

- [ ] Day 1: Monitor old daemon - should stay tame
- [ ] Day 3: Verify hot nodes can still pin content
- [ ] Day 7: Verify archival is working (week-old content on new daemon)
- [ ] Monitor: Check that old daemon isn't suddenly spiking

---

## Timeline Estimate

| Phase | Duration | What's Happening |
|-------|----------|------------------|
| Stop old | 10s | Current daemon shuts down |
| Start archive | 10s | Old daemon starts (tamed) |
| Start new | 15s | New daemon initializes |
| Reload cluster | 5s | Cluster learns about both |
| Stabilize | 20s | Systems settle |
| **TOTAL** | **~1 min** | **Downtime ends** |
| Monitor | 10 min+ | Watch vitals in monitoring script |

---

## Questions Before Proceeding?

- Do you want to adjust any thresholds in the monitoring script?
- Preferred cutover time/day?
- Should we notify anyone automatically?
- Want to test dry-run first?
