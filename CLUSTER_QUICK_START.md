# Quick Reference: Cluster Admin Tool Phase 1

## TL;DR Setup (30 seconds)

```bash
# Terminal 1: Establish tunnel
cd /home/meno/Documents/menosoft/3speakstorageadmin
./setup-cluster-tunnel.sh root@ipfs.3speak.tv
# Leave this running

# Terminal 2: Test cluster
export IPFS_CLUSTER_ENDPOINT=http://localhost:9095
export IPFS_CLUSTER_PINS_ENDPOINT=http://localhost:9097
npm run build && node dist/index.js cluster-status
```

## Available Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `cluster-status` | Check cluster health | `node dist/index.js cluster-status` |
| `cluster-pins` | List all pinned hashes | `node dist/index.js cluster-pins` |
| `cluster-check <hash>` | Verify if hash is pinned | `node dist/index.js cluster-check QmXxx...` |

## Environment Variables

Required when tunnel is active:
```bash
export IPFS_CLUSTER_ENDPOINT=http://localhost:9095
export IPFS_CLUSTER_PINS_ENDPOINT=http://localhost:9097
```

Or use defaults (localhost):
```bash
# These are already defaults, no export needed if running locally
```

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| "Cluster is not reachable" | Check tunnel is running in Terminal 1 |
| "Connection refused" | Run `./setup-cluster-tunnel.sh root@ipfs.3speak.tv` in new terminal |
| Port 9095 in use | Use different port: `./setup-cluster-tunnel.sh root@ipfs.3speak.tv 19095 19097` |
| Build fails | Run `npm run clean && npm install && npm run build` |

## Key Files

- Setup script: `./setup-cluster-tunnel.sh`
- Config: `src/config/index.ts`
- Service layer: `src/services/ipfs.ts`
- Commands: `src/commands/cluster-status.ts`
- CLI entry: `src/index.ts`

## Next Phase

Once testing passes, migrate from SSH tunnel to Nginx reverse proxy (no tunnel needed).

See `docs/internal/SUPERNODE_ASSESSMENT.md` for full roadmap.
