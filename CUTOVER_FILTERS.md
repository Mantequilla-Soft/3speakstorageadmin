# Application Cutover Filters

## Overview

This document describes the application-level filters implemented to prevent operations on read-only old repository content after the dual-daemon migration on **February 4, 2026**.

## Problem

After migrating to a dual-daemon architecture:
- **Old daemon** (`/pool0/ipfs/.ipfs`) contains all historical content (381,434 videos, 8.5 PB)
- **New daemon** (`/pool0/ipfs/.ipfs-new`) receives all new uploads (starting Feb 4, 2026)
- Old daemon is **READ-ONLY** - cannot unpin, delete, or modify content
- Admin tools must not attempt operations on old content

## Solution

Implemented a global `CUTOVER_DATE` constant that filters all database queries to only return content uploaded after the migration date.

### Cutover Date

```typescript
export const CUTOVER_DATE = new Date('2026-02-04T00:00:00Z');
```

**Location**: `src/config/index.ts`

## Affected Components

### 1. Database Service (`src/services/database.ts`)

Added cutover date filter to all query methods:

#### `getVideosForCleanup()`
Filters all cleanup types:
- `banned-users`: Only post-cutover banned user content
- `stuck-uploads`: Only new repo stuck uploads
- `admin-deleted`: Only new repo deleted videos
- `low-engagement`: Only new repo low-engagement content

**Example Query**:
```typescript
query.created = { $gte: CUTOVER_DATE };
// For age-based queries:
query.created = { $lt: cutoffDate, $gte: CUTOVER_DATE };
```

#### `getVideosByOwner()`
Only returns videos uploaded after cutover for account operations.

#### `getVideosByCriteria()`
Base filter applied to all criteria-based searches.

#### `getStuckVideos()`
Only returns stuck videos from new repository.

#### `getComprehensiveStats()`
Extended to show old/new repo separation:
- `newRepoVideos`: Count of manageable content
- `oldRepoVideos`: Count of archive content
- `newRepoSizeGB`: Size of manageable content
- `oldRepoSizeGB`: Size of archive content

### 2. Commands Updated

All commands now import `CUTOVER_DATE` and show informational message:

```typescript
import { config, CUTOVER_DATE } from '../config';

// At command start:
uLog.info(`📅 Cutover Date: ${CUTOVER_DATE.toISOString().split('T')[0]}`);
uLog.info(`ℹ️  Only managing content uploaded after cutover (old repo is read-only)`);
```

#### Updated Commands:
1. **cleanup.ts** - All cleanup operations filtered
2. **nuke-account.ts** - Account deletion filtered
3. **purge-abandoned.ts** - Abandoned video cleanup
4. **purge-failed.ts** - Failed upload cleanup
5. **purge-s3.ts** - S3 cleanup operations
6. **purge-banned.ts** - Banned user cleanup
7. **slim-user.ts** - User IPFS optimization
8. **slim-video.ts** - Single video optimization
9. **trim-fat.ts** - Account optimization
10. **s3-diet.ts** - S3 optimization
11. **ipfs-diet.ts** - IPFS optimization
12. **reconcile-s3.ts** - S3 reconciliation
13. **stats.ts** - Statistics with old/new breakdown

### 3. Stats Command Output

New stats output shows clear separation:

```
=== 3Speak Storage Statistics ===
📅 Cutover Date: 2026-02-04 (dual-daemon migration)

--- Repository Split ---
  🆕 New Repo (Manageable): 68 videos, 11.5 GB
  📦 Old Repo (Read-Only Archive): 381434 videos, 8495774.7 GB
  📊 Total: 381502 videos, 8495786.3 GB
```

## Testing

### Test Results (Feb 4, 2026)

#### 1. Stats Command
```bash
$ node dist/index.js stats
```
**Result**: ✅ Shows 68 manageable videos vs 381,434 archive videos

#### 2. Cleanup Command
```bash
$ node dist/index.js cleanup --status deleted --dry-run
```
**Result**: ✅ Found only 1 deleted video (uploaded today), ignored 202,950 old deleted videos

#### 3. Nuke Account Command
```bash
$ node dist/index.js nuke-account --username salvationn --dry-run
```
**Result**: ✅ Found only 2 videos (uploaded today), correctly filtered out all old content

## Database Query Examples

### Before Cutover Filter
```javascript
// Would return ALL deleted videos (202,950)
db.find({ status: 'deleted' })
```

### After Cutover Filter
```javascript
// Returns only NEW deleted videos (1)
db.find({ 
  status: 'deleted',
  created: { $gte: CUTOVER_DATE }
})
```

### Age-Based Queries
```javascript
// Old videos > 30 days, but only from new repo
const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - 30);

db.find({ 
  created: { 
    $lt: cutoffDate,      // Older than 30 days
    $gte: CUTOVER_DATE    // But after cutover
  }
})
```

## Future Considerations

### Web Dashboard
**TODO**: Update web interface to:
- Show "Manageable" vs "Archive" content
- Disable admin buttons for pre-cutover content
- Add tooltip: "Content before Feb 4, 2026 is in read-only archive"

### API Endpoints
If exposing admin operations via API, ensure all endpoints respect cutover filter.

### Reporting
Consider adding separate reports for:
- **Operational**: Only new repo metrics
- **Historical**: Combined old+new metrics
- **Archive**: Old repo analytics only

## Maintenance

### If Cutover Date Needs Changing
**WARNING**: Only change if migration date was incorrect or testing needs adjustment.

**Location**: `src/config/index.ts`
```typescript
export const CUTOVER_DATE = new Date('YYYY-MM-DDTHH:mm:ssZ');
```

### Verification Query
To verify filter is working:
```bash
# Check what would be returned
node dist/index.js cleanup --status deleted --dry-run

# Should only show videos with created >= 2026-02-04
```

## Benefits

1. **Safety**: Prevents failed operations on read-only old content
2. **Performance**: Reduces query result sets by 99.9%
3. **Clarity**: Clear separation between manageable and archive content
4. **Consistency**: All commands use same filter logic
5. **Visibility**: Stats show exact split between old/new repos

## Migration Impact

### Before Cutover Filter
- Commands would attempt to operate on 381,434 videos
- Most operations would fail (old repo read-only)
- Error messages would confuse operators
- Database could become inconsistent

### After Cutover Filter
- Commands only operate on 68 manageable videos (and growing)
- All operations succeed (new repo fully operational)
- Clear messaging about cutover policy
- Database remains consistent

## Related Documentation

- [DUAL_DAEMON_MIGRATION.md](DUAL_DAEMON_MIGRATION.md) - Infrastructure migration details
- [README.md](README.md) - Command usage examples
- [PURGE_COMMANDS.md](PURGE_COMMANDS.md) - Cleanup operation details

## Summary

The cutover filter implementation ensures that all admin operations respect the dual-daemon architecture by only targeting content in the new, writable repository. This prevents operational failures and maintains system consistency while allowing old content to remain accessible via the read-only archive daemon.
