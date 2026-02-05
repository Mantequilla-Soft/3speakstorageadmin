# IPFS Supernode Monitoring Service

## Overview

A lightweight Node.js service that runs **locally on the IPFS supernode** to provide real-time system metrics, IPFS repository statistics, and operational data that cannot be accessed remotely.

## Purpose

The main 3Speak Storage Admin tool connects remotely (MongoDB + HTTPS gateway), so it cannot access:
- Local file system (GC logs, repo sizes)
- System metrics (RAM, disk usage, uptime)
- Local IPFS daemon statistics
- Service status information

This monitoring service fills that gap by running on the supernode itself.

---

## ⚠️ CRITICAL: What We Monitor

### New Repository (SAFE TO MONITOR)
- **Path**: `/pool0/ipfs/.ipfs-new`
- **Daemon Port**: 5001 (API), 8081 (gateway)
- **Size**: ~1-2 GB (small, grows daily)
- **Operations**: ✅ ALL metrics safe
  - `du -sb` for size
  - `find` for block count
  - `ipfs pin ls` for pin count
  - `ipfs stats repo` for repo stats

### Old Repository (⚠️ DANGEROUS - LIMITED MONITORING ONLY)
- **Path**: `/pool0/ipfs/.ipfs`
- **Daemon Port**: 5002 (API), 8080 (gateway)
- **Size**: 81.6 TB (MASSIVE)
- **Operations**: 
  - ❌ **NEVER** run `du -sb` or `du -sh` on `/pool0/ipfs/.ipfs/blocks` (will spike RAM to 120GB+)
  - ❌ **NEVER** run `find` with full traversal (will hang for hours)
  - ✅ **SAFE**: `ipfs pin ls | wc -l` (count pins via daemon API)
  - ✅ **SAFE**: `ipfs stats repo` (daemon provides cached stats)
  - ✅ **SAFE**: Check if daemon is running via `ipfs id`

### System Metrics (SAFE)
- **RAM Usage**: `/proc/meminfo` or `os.totalmem()`
- **Disk Usage**: `df -B1 /pool0` (filesystem-level, very fast)
- **Load Average**: `os.loadavg()`
- **Uptime**: `os.uptime()`

### GC Logs (SAFE)
- **Path**: `/var/log/ipfs-gc-new.log`
- **Size**: Small (daily rotation)
- **Read**: Tail last 20 lines to get latest GC run

---

## Specific Configuration Values

**NOTE**: These values will be loaded from `.env` file, not hardcoded. This section documents the actual values for reference.

```bash
# .env (actual values for ipfs.3speak.tv supernode)
SECRET_KEY=<generate-with-crypto>
PORT=3001

# IPFS Paths
IPFS_NEW_PATH=/pool0/ipfs/.ipfs-new
IPFS_OLD_PATH=/pool0/ipfs/.ipfs

# Monitoring paths
GC_LOG_PATH=/var/log/ipfs-gc-new.log
DISK_MOUNT=/pool0

# Feature flags (what to monitor)
MONITOR_NEW_REPO_SIZE=true
MONITOR_NEW_REPO_BLOCKS=true
MONITOR_NEW_REPO_PINS=true
MONITOR_OLD_REPO_SIZE=false        # ⚠️ DANGEROUS - NEVER ENABLE
MONITOR_OLD_REPO_BLOCKS=false       # ⚠️ DANGEROUS - NEVER ENABLE
MONITOR_OLD_REPO_PINS=true          # ✅ SAFE - via daemon API only
```

---

## Project Structure

```
3speak-node-monitor/
├── package.json
├── tsconfig.json
├── .env.example
├── .env                    # SECRET_KEY configuration
├── README.md
├── src/
│   ├── index.ts           # Express server entry point
│   ├── config.ts          # Configuration and constants
│   ├── middleware/
│   │   └── auth.ts        # Header-based auth middleware
│   ├── services/
│   │   ├── system.ts      # System metrics (RAM, disk, uptime)
│   │   ├── ipfs.ts        # IPFS daemon queries
│   │   └── gc-logs.ts     # Parse GC log files
│   └── routes/
│       └── stats.ts       # API endpoint
└── ecosystem.config.js     # PM2 configuration
```

---

## Authentication

### Simple Header-Based Auth

**Request Header:**
```
Authorization: Bearer <SECRET_KEY>
```

**Example:**
```bash
curl -H "Authorization: Bearer your-secret-key-here" \
  http://localhost:3001/api/node-stats
```

### Configuration

**`.env` file:**
```bash
SECRET_KEY=generate-random-secure-key-here
PORT=3001
IPFS_NEW_PATH=/pool0/ipfs/.ipfs-new
IPFS_OLD_PATH=/pool0/ipfs/.ipfs
GC_LOG_PATH=/var/log/ipfs-gc-new.log
```

**Generate secret key:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API Endpoint

### `GET /api/node-stats`

**Headers:**
```
Authorization: Bearer <SECRET_KEY>
```

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-02-04T17:45:00.000Z",
  "data": {
    "system": {
      "hostname": "ipfs-supernode-1",
      "uptime": 432000,
      "uptimeHuman": "5 days",
      "memory": {
        "totalGB": 128,
        "usedGB": 21,
        "freeGB": 107,
        "percentUsed": 16
      },
      "disk": {
        "path": "/pool0",
        "totalTB": 90,
        "usedTB": 81.6,
        "freeTB": 8.4,
        "percentUsed": 90
      },
      "loadAverage": [2.34, 2.56, 2.12]
    },
    "ipfs": {
      "newRepo": {
        "path": "/pool0/ipfs/.ipfs-new",
        "sizeGB": 1.2,
        "blockCount": 945,
        "pinCount": 68,
        "daemonRunning": true,
        "version": "0.38.1",
        "peerCount": 100
      },
      "oldRepo": {
        "path": "/pool0/ipfs/.ipfs",
        "sizeTB": 81.6,
        "blockCount": null,
        "pinCount": 381434,
        "daemonRunning": true,
        "version": "0.38.1",
        "peerCount": 100
      }
    },
    "gc": {
      "lastRun": "2026-02-04T03:00:00.000Z",
      "lastRunHuman": "14 hours ago",
      "blocksRemoved": 945,
      "durationSeconds": 134,
      "durationHuman": "2m 14s",
      "nextScheduled": "2026-02-05T03:00:00.000Z",
      "status": "success",
      "logPath": "/var/log/ipfs-gc-new.log"
    },
    "services": {
      "kuboNew": {
        "status": "active",
        "since": "2026-02-02T12:00:00.000Z",
        "memory": "1.2GB",
        "cpu": "82%"
      },
      "kuboOld": {
        "status": "active",
        "since": "2025-01-15T08:00:00.000Z",
        "memory": "236MB",
        "cpu": "73%"
      },
      "nginx": {
        "status": "active",
        "since": "2025-01-15T08:00:00.000Z"
      }
    }
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": "Unauthorized - Invalid or missing authorization header"
}
```

---

## Implementation Details

### 1. System Metrics (`src/services/system.ts`)

```typescript
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function getSystemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  
  // Get disk usage for /pool0
  const { stdout } = await execAsync('df -B1 /pool0 | tail -1');
  const [, total, used, available] = stdout.trim().split(/\s+/).map(Number);
  
  return {
    hostname: os.hostname(),
    uptime: os.uptime(),
    uptimeHuman: formatUptime(os.uptime()),
    memory: {
      totalGB: Math.round(totalMem / (1024 ** 3)),
      usedGB: Math.round(usedMem / (1024 ** 3)),
      freeGB: Math.round(freeMem / (1024 ** 3)),
      percentUsed: Math.round((usedMem / totalMem) * 100)
    },
    disk: {
      path: '/pool0',
      totalTB: (total / (1024 ** 4)).toFixed(1),
      usedTB: (used / (1024 ** 4)).toFixed(1),
      freeTB: (available / (1024 ** 4)).toFixed(1),
      percentUsed: Math.round((used / total) * 100)
    },
    loadAverage: os.loadavg()
  };
}
```

### 2. IPFS Stats (`src/services/ipfs.ts`)

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
import { stat } from 'fs/promises';

const execAsync = promisify(exec);

export async function getIpfsStats(repoPath: string, isNewRepo: boolean) {
  try {
    const env = `IPFS_PATH=${repoPath}`;
    
    // Check if daemon is running first
    const { stdout: idOutput } = await execAsync(
      `${env} ipfs id 2>/dev/null || echo "ERROR"`
    );
    const daemonRunning = !idOutput.includes('ERROR');
    
    let sizeBytes = null;
    let blockCount = null;
    
    // ⚠️ ONLY gather size/block stats for NEW repo
    // Old repo (81.6TB) will kill the server with these commands
    if (isNewRepo) {
      // Safe: new repo is small (~1-2GB)
      const { stdout: duOutput } = await execAsync(
        `du -sb ${repoPath}/blocks 2>/dev/null | awk '{print $1}'`
      );
      sizeBytes = parseInt(duOutput.trim());
      
      // Fast approximation for new repo
      const { stdout: blockCountOutput } = await execAsync(
        `find ${repoPath}/blocks -type f 2>/dev/null | wc -l`
      );
      blockCount = parseInt(blockCountOutput.trim());
    } else {
      // For old repo: use IPFS daemon's cached stats (if available)
      if (daemonRunning) {
        try {
          const { stdout: repoStats } = await execAsync(
            `${env} ipfs stats repo --human 2>/dev/null || echo "ERROR"`
          );
          if (!repoStats.includes('ERROR')) {
            // Parse size from "RepoSize: 81.6 TB"
            const sizeMatch = repoStats.match(/RepoSize:\s*(\d+\.?\d*)\s*(GB|TB)/);
            if (sizeMatch) {
              const value = parseFloat(sizeMatch[1]);
              const unit = sizeMatch[2];
              sizeBytes = unit === 'TB' ? value * (1024 ** 4) : value * (1024 ** 3);
            }
          }
        } catch (e) {
          // Daemon stats failed, leave as null
        }
      }
    }
    
    // Pin count is SAFE for both repos (daemon API, not filesystem)
    let pinCount = null;
    if (daemonRunning) {
      const { stdout: pinOutput } = await execAsync(
        `${env} ipfs pin ls --type=recursive 2>/dev/null | wc -l`
      );
      pinCount = parseInt(pinOutput.trim());
    }
    
    // Get version and peer count if daemon is running
    let version = null;
    let peerCount = null;
    if (daemonRunning) {
      const { stdout: versionOutput } = await execAsync(
        `${env} ipfs version --number 2>/dev/null`
      );
      version = versionOutput.trim();
      
      const { stdout: peersOutput } = await execAsync(
        `${env} ipfs swarm peers 2>/dev/null | wc -l`
      );
      peerCount = parseInt(peersOutput.trim());
    }
    
    return {
      path: repoPath,
      sizeGB: sizeBytes && sizeBytes < 1024 ** 4 
        ? (sizeBytes / (1024 ** 3)).toFixed(1)
        : null,
      sizeTB: sizeBytes && sizeBytes >= 1024 ** 4
        ? (sizeBytes / (1024 ** 4)).toFixed(1)
        : null,
      blockCount,
      pinCount,
      daemonRunning,
      version,
      peerCount
    };
  } catch (error) {
    return {
      path: repoPath,
      error: error.message
    };
  }
}
```

### 3. GC Log Parser (`src/services/gc-logs.ts`)

```typescript
import { readFile, stat } from 'fs/promises';
import { parseISO, formatDistanceToNow } from 'date-fns';

export async function getLastGcRun(logPath: string) {
  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    // Parse last GC run from log
    // Expected format:
    // 2026-02-04 03:00:00 Starting GC...
    // removed 945 blocks
    // 2026-02-04 03:02:14 GC complete
    
    const lastLines = lines.slice(-10); // Last 10 lines
    const startMatch = lastLines.find(l => l.includes('Starting GC'));
    const blocksMatch = lastLines.find(l => l.includes('removed') && l.includes('blocks'));
    const endMatch = lastLines.find(l => l.includes('GC complete'));
    
    if (!startMatch || !endMatch) {
      return {
        lastRun: null,
        status: 'No GC run found in logs'
      };
    }
    
    const startTime = parseISO(startMatch.substring(0, 19).replace(' ', 'T'));
    const endTime = parseISO(endMatch.substring(0, 19).replace(' ', 'T'));
    const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    const blocksRemoved = blocksMatch 
      ? parseInt(blocksMatch.match(/removed (\d+) blocks/)?.[1] || '0')
      : 0;
    
    // Calculate next scheduled run (3 AM next day)
    const nextRun = new Date(startTime);
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setHours(3, 0, 0, 0);
    
    return {
      lastRun: startTime.toISOString(),
      lastRunHuman: formatDistanceToNow(startTime, { addSuffix: true }),
      blocksRemoved,
      durationSeconds,
      durationHuman: formatDuration(durationSeconds),
      nextScheduled: nextRun.toISOString(),
      status: 'success',
      logPath
    };
  } catch (error) {
    return {
      lastRun: null,
      status: `Error reading log: ${error.message}`,
      logPath
    };
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}
```

### 4. Auth Middleware (`src/middleware/auth.ts`)

```typescript
import { Request, Response, NextFunction } from 'express';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.SECRET_KEY;
  
  if (!expectedKey) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error: SECRET_KEY not set'
    });
  }
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - Missing authorization header'
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer '
  
  if (token !== expectedKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - Invalid authorization token'
    });
  }
  
  next();
}
```

### 5. Main Server (`src/index.ts`)

```typescript
import express from 'express';
import dotenv from 'dotenv';
import { requireAuth } from './middleware/auth';
import { getSystemMetrics } from './services/system';
import { getIpfsStats } from './services/ipfs';
import { getLastGcRun } from './services/gc-logs';
import { config } from './config';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Health check (no auth required)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Main stats endpoint (auth required)
app.get('/api/node-stats', requireAuth, async (req, res) => {
  try {
    const [systemMetrics, newRepoStats, oldRepoStats, gcInfo] = await Promise.all([
      getSystemMetrics(),
      getIpfsStats(config.ipfs.newRepoPath, true),   // true = new repo, safe to do full stats
      getIpfsStats(config.ipfs.oldRepoPath, false),  // false = old repo, limited stats only
      getLastGcRun(config.gc.logPath)
    ]);
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        system: systemMetrics,
        ipfs: {
          newRepo: newRepoStats,
          oldRepo: oldRepoStats
        },
        gc: gcInfo
      }
    });
  } catch (error: any) {
    console.error('Error fetching node stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Node Monitor running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
```

---

## Nginx Configuration

Add to `/etc/nginx/sites-enabled/ipfs-3speak`:

```nginx
# Node monitoring service (internal only)
location /api/node-stats {
    proxy_pass http://127.0.0.1:3001/api/node-stats;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Authorization $http_authorization;
    
    # Optional: Restrict to specific IPs
    # allow 192.168.1.0/24;  # Your admin network
    # allow 1.2.3.4;         # Your home IP
    # deny all;
}
```

**Reload nginx:**
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Deployment

### 1. Install on Supernode

```bash
# SSH into supernode
ssh root@ipfs.3speak.tv

# Create project directory
mkdir -p /opt/3speak-node-monitor
cd /opt/3speak-node-monitor

# Clone or copy project files
# (git clone or scp from development machine)

# Install dependencies
npm install

# Build TypeScript
npm run build
```

### 2. Configure Environment

```bash
# Generate secret key
SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Create .env file with ACTUAL supernode values
cat > .env << EOF
SECRET_KEY=${SECRET_KEY}
PORT=3001

# IPFS Repositories on ipfs.3speak.tv
IPFS_NEW_PATH=/pool0/ipfs/.ipfs-new
IPFS_OLD_PATH=/pool0/ipfs/.ipfs

# Monitoring configuration
GC_LOG_PATH=/var/log/ipfs-gc-new.log
DISK_MOUNT=/pool0

# Feature flags - CRITICAL: Old repo size/block monitoring DISABLED
MONITOR_NEW_REPO_SIZE=true
MONITOR_NEW_REPO_BLOCKS=true
MONITOR_NEW_REPO_PINS=true
MONITOR_OLD_REPO_SIZE=false
MONITOR_OLD_REPO_BLOCKS=false
MONITOR_OLD_REPO_PINS=true
EOF

chmod 600 .env

# IMPORTANT: Verify paths exist
ls -lh /pool0/ipfs/.ipfs-new
ls -lh /pool0/ipfs/.ipfs
ls -lh /var/log/ipfs-gc-new.log
```

### 3. Install as systemd Service

**Create `/etc/systemd/system/node-monitor.service`:**

```ini
[Unit]
Description=3Speak Node Monitor Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/3speak-node-monitor
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable node-monitor
sudo systemctl start node-monitor
sudo systemctl status node-monitor
```

### 4. Update Nginx

Add the location block to nginx config and reload.

### 5. Update Admin Dashboard

Add the `SECRET_KEY` to the admin dashboard's `.env`:

```bash
# In 3speakstorageadmin/.env
NODE_MONITOR_URL=https://ipfs.3speak.tv/api/node-stats
NODE_MONITOR_SECRET=<paste-secret-key-here>
```

---

## Integration with Admin Dashboard

### Add to `src/web/server.ts`:

```typescript
app.get('/api/node-stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const response = await fetch(process.env.NODE_MONITOR_URL!, {
      headers: {
        'Authorization': `Bearer ${process.env.NODE_MONITOR_SECRET}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Monitor service returned ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    logger.error('Node monitor fetch error', error);
    res.status(500).json({ 
      success: false, 
      error: 'Unable to fetch node stats from supernode'
    });
  }
});
```

### Add to Dashboard UI:

In the "Repo Stats" modal, add a new section for live system metrics fetched from this endpoint.

---

## Security Considerations

1. **Secret Key**: 
   - Use strong random key (32+ bytes)
   - Never commit to git
   - Rotate periodically

2. **Network Exposure**:
   - Service listens on localhost only (127.0.0.1:3001)
   - Only accessible via nginx proxy
   - Nginx can add IP restrictions

3. **Rate Limiting**:
   - Consider adding rate limiting in nginx:
   ```nginx
   limit_req_zone $binary_remote_addr zone=monitor:10m rate=10r/m;
   limit_req zone=monitor burst=5;
   ```

4. **Logging**:
   - Log all requests with IP addresses
   - Alert on failed auth attempts

5. **File Permissions**:
   - `.env` should be 600 (owner read/write only)
   - Service runs as root (required for system metrics)

6. **⚠️ Old Repo Protection**:
   - Feature flags prevent dangerous operations on old repo
   - Code explicitly checks `isNewRepo` flag before filesystem operations
   - Never modify these flags without understanding RAM implications
   - Running `du` on old repo can spike RAM from 21GB to 120GB+

---

## Testing

### Local Test (on supernode):
```bash
curl -H "Authorization: Bearer your-secret-key" \
  http://localhost:3001/api/node-stats
```

### Remote Test (through nginx):
```bash
curl -H "Authorization: Bearer your-secret-key" \
  https://ipfs.3speak.tv/api/node-stats
```

### Test from Admin Dashboard:
The dashboard should fetch and display the data in the "Repo Stats" modal.

---

## Monitoring & Maintenance

### Check Service Status:
```bash
sudo systemctl status node-monitor
sudo journalctl -u node-monitor -f
```

### Log Files:
- Service logs: `journalctl -u node-monitor`
- Nginx access: `/var/log/nginx/access.log`
- Nginx errors: `/var/log/nginx/error.log`

### Update Service:
```bash
cd /opt/3speak-node-monitor
git pull  # or copy new files
npm install
npm run build
sudo systemctl restart node-monitor
```

---

## Package.json

```json
{
  "name": "3speak-node-monitor",
  "version": "1.0.0",
  "description": "System and IPFS metrics for 3Speak supernode",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "watch": "tsc --watch"
  },
  "dependencies": {
    "express": "^4.18.2",
    "dotenv": "^16.0.3",
    "date-fns": "^2.30.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.1"
  }
}
```

---

## Summary

This monitoring service provides the missing piece of the puzzle - real-time system and IPFS metrics that can only be gathered locally on the supernode. It's:

- **Lightweight**: Simple Express server, minimal dependencies
- **Secure**: Header-based auth, localhost-only, nginx-proxied
- **Fast**: Caches where possible, parallel queries
- **Maintainable**: Small codebase, clear structure
- **Integrated**: Seamlessly works with existing admin dashboard

Deploy it, test it, and the admin dashboard will have complete visibility into the supernode's health and status!
