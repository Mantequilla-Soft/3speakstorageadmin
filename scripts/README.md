# 3Speak Storage Admin Scripts

**🎯 Friendly Storage Management Scripts**

These scripts make storage cleanup super simple and safe. No need to remember complex commands!

## 🚀 Quick Start

1. **Check what needs cleaning:**
   ```bash
   ./scripts/status-check.sh
   ```

2. **Start with the safest cleanup:**
   ```bash
   ./scripts/free-deleted-videos.sh
   ```

## 📋 Available Scripts

### 🔍 `status-check.sh` - Storage Overview
**What it does:** Shows current storage stats and cleanup opportunities
**Safety:** 100% safe (read-only)
**When to use:** Anytime you want to see what's going on

```bash
./scripts/status-check.sh
```

### 🧹 `free-deleted-videos.sh` - Clean Admin-Deleted S3 Videos ⭐ **START HERE**
**What it does:** Removes S3 videos that admins already marked as deleted
**Safety:** Maximum safety (these videos are already marked for deletion)
**Space saved:** Usually 4-6 TB
**When to use:** First cleanup, regular maintenance

```bash
./scripts/free-deleted-videos.sh
```

### 📌 `free-deleted-ipfs.sh` - Clean Admin-Deleted IPFS Videos
**What it does:** Unpins IPFS videos that admins already marked as deleted
**Safety:** Maximum safety (admin pre-approved deletions)
**Action:** Unpins from IPFS node (different from S3 deletion)
**When to use:** After S3 cleanup, to free IPFS storage

```bash
./scripts/free-deleted-ipfs.sh
```

### ❌ `clean-failed-encodings.sh` - Remove Failed Encoding Videos
**What it does:** Removes videos with 'encoding_failed' or 'failed' status
**Safety:** High (these videos failed processing and can't be published)
**Space saved:** Can be very significant (8TB+ of failed encodings)
**When to use:** Regular maintenance to free up wasted storage

```bash
./scripts/clean-failed-encodings.sh
```

### 🚫 `remove-banned-content.sh` - Remove Banned User Content
**What it does:** Removes all content from users marked as banned
**Safety:** High (only affects banned users)  
**When to use:** After banning users, periodic cleanup

```bash
./scripts/remove-banned-content.sh
```

### 📦 `clean-stuck-uploads.sh` - Clean Old Stuck Uploads
**What it does:** Removes videos stuck in processing for X days
**Safety:** Medium (choose age threshold carefully)
**When to use:** Monthly cleanup of failed uploads

```bash
./scripts/clean-stuck-uploads.sh
```

7. **`clean-low-engagement.sh`**
   - Removes very old videos with minimal engagement
   - Targets content unlikely to be missed
   - **Risk Level:** Medium - Reviews criteria before proceeding

### 🪣 `s3-diet.sh` - S3 Storage Optimizer (S3 Videos Only) 🆕
**What it does:** Optimizes S3 storage by keeping only 480p, removes higher resolutions
**Storage Type:** ✅ **S3 videos only** - selective file deletion possible
**Safety:** Low risk (videos remain watchable in 480p)
**Reality Check:** Platform stopped using S3 4 years ago - limited savings expected (~1,000 S3 videos)
**Storage Impact:** 60-80% reduction per S3 video (selective resolution deletion)
**When to use:** If you have newer S3 uploads to optimize

```bash
./scripts/s3-diet.sh
```

### 🗂️ `ipfs-diet.sh` - IPFS Storage Optimizer (IPFS Videos Only - THE BIG ONE) 🆕
**What it does:** Unpins low-engagement IPFS videos to completely free storage space
**Storage Type:** ✅ **IPFS videos only** - all-or-nothing unpinning (no partial deletion possible)
**Safety:** ⚠️ HIGH IMPACT - Videos become completely inaccessible after unpinning
**Reality Check:** This is where the major storage savings happen (~130K IPFS videos)
**Storage Impact:** 100% freed per unpinned video (complete removal from IPFS node)
**Technical Note:** IPFS doesn't support partial deletion - you can only pin (accessible) or unpin (inaccessible)
**When to use:** When you need significant storage savings and can sacrifice old, low-engagement content

```bash
./scripts/ipfs-diet.sh
```

### 🥗 `slim-user.sh` - Targeted User Storage Diet (S3 Videos Only) 🆕
**What it does:** User-focused storage optimization for specific accounts
**Storage Type:** ✅ **S3 videos only** - IPFS videos cannot be "slimmed" (all-or-nothing)
**Safety:** Medium (targets only old S3 videos from specific user)
**Features:** Cost savings calculation, age-based targeting, keeps videos watchable in 480p
**Space saved:** ~70% reduction per optimized S3 video
**Limitation:** Cannot optimize IPFS videos (use ipfs-diet.sh to unpin IPFS videos instead)
**When to use:** Optimize specific users with S3 content, reduce storage costs for inactive creators

```bash
./scripts/slim-user.sh
```

### ✂️ `trim-fat.sh` - Account Fat Trimming (Both Storage Types - FLEXIBLE) 🆕
**What it does:** Removes old or low-engagement content from specific accounts with flexible criteria
**Storage Type:** ✅ **Both S3 and IPFS** - intelligently handles different storage types appropriately
**Operations:** S3 files deleted, IPFS hashes unpinned (content becomes inaccessible)
**Safety:** Medium-High (account-specific with age/engagement filters)
**Features:** Flexible age thresholds, engagement filtering, combined criteria, dry-run preview
**Space saved:** Varies - targets underperforming content (typically significant savings)
**Flexibility:** Age-based (1-10 years), engagement-based (50-5000 views), or combined criteria
**When to use:** Clean up specific accounts with old/unwanted content, reduce storage costs with precision

```bash
./scripts/trim-fat.sh
```

### 🎯 `slim-video.sh` - Single Video Storage Optimizer (S3 Videos Only) 🆕
**What it does:** Optimize storage for one specific video with 3Speak URL support
**Storage Type:** ✅ **S3 videos only** - keeps smallest available resolution
**Safety:** Low risk (video remains watchable, just in lower resolution)
**Features:** 3Speak URL parsing, automatic resolution analysis, 80%+ storage savings
**Space saved:** ~80% reduction per optimized S3 video
**IPFS Handling:** Gracefully detects IPFS videos and provides informative message (no changes made)
**When to use:** Optimize individual videos quickly, test storage optimization before bulk operations

```bash
# Using 3Speak URL (easiest)
./scripts/slim-video.sh https://3speak.tv/watch?v=alice/my-video

# Direct permlink usage
./scripts/slim-video.sh alice/my-video
```

### 🔍 `reconcile-s3.sh` - S3 Storage Reconciliation (S3 Videos Only) 🆕
**What it does:** Find and clean up "phantom" videos where database records exist but S3 files are missing
**Storage Type:** ✅ **S3 videos only** - checks actual file existence on S3/Wasabi
**Safety:** Medium risk (only marks videos as deleted if files are actually missing)
**Problem Solved:** Broken video links where posts exist but playback fails due to missing files
**Features:** File existence verification, detailed reporting, database cleanup
**When to use:** Fix broken user profiles with phantom videos that can't be played

```bash
# Check for missing S3 files (dry-run)
./scripts/reconcile-s3.sh alice

# Execute reconciliation (mark missing videos as deleted)
./scripts/reconcile-s3.sh alice --execute

# Include already optimized videos in check
./scripts/reconcile-s3.sh alice --include-optimized --execute
```

### ☢️ `nuke-account.sh` - Nuclear Account Deletion (Both Storage Types - EXTREME)
**What it does:** Erases every trace of a specific account from all storage systems
**Storage Type:** ✅ **Both S3 and IPFS** - intelligently detects and applies appropriate destruction method
**Operations:** S3 files deleted, IPFS hashes unpinned, database records removed
**Safety:** ⚠️ EXTREME - completely irreversible, use only with absolute certainty
**When to use:** Legal takedowns, DMCA requests, or malicious accounts that must be fully purged

```bash
./scripts/nuke-account.sh
```

## �️ Storage Type Understanding

**📊 Current Video Distribution:**
- **S3 Videos:** ~1,000 videos (newer uploads, before platform switched to IPFS)
- **IPFS Videos:** ~130,000 videos (majority of platform content)  
- **Unknown/Failed:** ~200,000+ processing tokens/failed uploads

**🔧 Storage Type Operations:**

### S3 Videos (Selective Operations Possible):
- **✅ Can be "slimmed":** Delete high-resolution files, keep 480p → videos remain watchable
- **✅ Can be deleted:** Remove all files → videos become inaccessible
- **Tools:** `s3-diet.sh` (slim), `slim-user.sh` (slim S3 only), cleanup commands (delete)

### IPFS Videos (All-or-Nothing Operations):
- **❌ Cannot be "slimmed":** IPFS is atomic - you cannot delete "part" of a video
- **✅ Can be unpinned:** Remove from IPFS node → videos become completely inaccessible  
- **Technical:** IPFS videos exist as complete content-addressed hashes, no partial states
- **Tools:** `ipfs-diet.sh` (unpin), cleanup commands (unpin)

### Universal Operations (Both Types):
- **✅ Complete removal:** `nuke-account.sh`, `cleanup.ts` commands
- **Logic:** Detects storage type automatically and applies appropriate method:
  - S3: Deletes all files and HLS segments
  - IPFS: Unpins content hash from node

**💡 Key Insight:** Major storage savings come from IPFS unpinning (~130K videos), not S3 optimization (~1K videos)

## �🛡️ Safety Features

✅ **Every script includes:**
- Automatic project building
- Safety checks before execution
- Dry run preview of changes
- Interactive confirmations  
- Progress monitoring
- Error handling
- Full logging

✅ **Smart defaults:**
- Conservative batch sizes
- Safe targeting (no accidentally deleting published content)
- Clear warnings for destructive operations
- Storage type detection and appropriate operation selection

## 📊 Recommended Usage Order

**First Time Setup - Recommended Order:**

1. **Get familiar:** `./scripts/status-check.sh`
2. **Biggest safe wins:** `./scripts/free-deleted-videos.sh` (S3 cleanup)
3. **IPFS companion:** `./scripts/free-deleted-ipfs.sh` (IPFS cleanup)
4. **Failed encodings:** `./scripts/clean-failed-encodings.sh` (8TB+ potential)
5. **Monthly maintenance:** `./scripts/clean-stuck-uploads.sh`
6. **As needed:** `./scripts/remove-banned-content.sh`
7. **Emergency only:** `./scripts/clean-low-engagement.sh` (removes published content!)
8. **S3 optimization:** `./scripts/s3-diet.sh` (optimize rare S3 videos)
9. **IPFS optimization:** `./scripts/ipfs-diet.sh` (THE BIG SAVINGS - unpins old IPFS content)
10. **Single video test:** `./scripts/slim-video.sh` (test optimization on individual videos)
11. **S3 reconciliation:** `./scripts/reconcile-s3.sh` (fix phantom videos with missing files)
12. **User optimization:** `./scripts/slim-user.sh` (target specific heavy users)
13. **Account fat trimming:** `./scripts/trim-fat.sh` (flexible account cleanup with age/engagement criteria)
14. **Nuclear option:** `./scripts/nuke-account.sh` (per-account wipe, irreversible)

**For Regular Maintenance:**

```bash
# Weekly: Clean admin-deleted content (both S3 and IPFS)
./scripts/free-deleted-videos.sh
./scripts/free-deleted-ipfs.sh

# Monthly: Clean failed encodings and stuck uploads
./scripts/clean-failed-encodings.sh
./scripts/clean-stuck-uploads.sh

# As needed: Remove banned content
./scripts/remove-banned-content.sh

# Emergency only: Remove low-engagement content
./scripts/clean-low-engagement.sh

# 🚀 MAJOR storage optimization: Unpin old IPFS content (~130K videos - THE BIG WINS)
./scripts/ipfs-diet.sh

# 🔧 Minor optimization: Optimize S3 videos to 480p (~1K videos - limited impact)
./scripts/s3-diet.sh

# 🎯 Single video optimization: Test on individual videos (great for testing)
./scripts/slim-video.sh https://3speak.tv/watch?v=user/video

# 🔍 S3 storage reconciliation: Fix phantom videos (missing files)
./scripts/reconcile-s3.sh username

# 🎯 User-specific optimization: Target heavy S3 users (cost savings calculations)
./scripts/slim-user.sh

# ✂️ Account fat trimming: Flexible account cleanup (age + engagement criteria)
./scripts/trim-fat.sh

# ☢️ Nuclear option: Completely remove account (both S3 and IPFS)
./scripts/nuke-account.sh
```

## 🎛️ Script Options Explained

### Batch Sizes:
- **Small (10-25):** Safest, takes longer, easier to stop if needed
- **Medium (25-100):** Balanced, good for regular use
- **Large (100-250):** Faster, use when confident

### Age Thresholds (for stuck uploads):
- **30 days:** Very conservative, only clearly failed uploads
- **90 days:** Moderate, good for first cleanup
- **180+ days:** Aggressive, use when storage is critical

## 🚨 Emergency Stop

**If something goes wrong:**
- Press `Ctrl+C` to stop any running script
- All scripts can be safely re-run (they skip already processed videos)
- Check `./logs/app.log` for detailed information

## 🔧 Troubleshooting

**"ERROR: Please run this script from the 3speakstorageadmin directory"**
- Solution: `cd /path/to/3speakstorageadmin` first

**"Build failed"**
- Solution: Run `npm install` then try again

**"No videos found"**
- This is good! It means that category is already clean

## 📈 Expected Results

**After running `free-deleted-videos.sh`:**
- 4-6 TB of storage freed up
- 16,000+ admin-deleted video records cleaned
- S3 storage costs reduced

**After running `remove-banned-content.sh`:**
- All content from 438 banned users removed
- Policy compliance improved

**After running `clean-stuck-uploads.sh`:**
- Failed uploads removed
- Database cleaned up
- Storage efficiency improved

## 💡 Pro Tips

1. **Always start with status-check.sh** to understand current state
2. **Use free-deleted-videos.sh first** - it's the safest big win
3. **For major storage savings, use ipfs-diet.sh** - this is where the big wins are (old IPFS content)
4. **s3-diet.sh has limited impact** - platform stopped using S3 4 years ago
5. **Start with small batch sizes** until you're comfortable
6. **Run during off-peak hours** for less system impact
7. **Check logs** if anything seems unusual: `tail -f logs/app.log`

## 🎯 For VPS Deployment

Once comfortable with the scripts, you can automate them:

```bash
# Add to crontab for automated cleanup
# Clean admin-deleted videos every 6 hours
0 */6 * * * cd /path/to/3speakstorageadmin && ./scripts/free-deleted-videos.sh

# Weekly stuck upload cleanup  
0 2 * * 1 cd /path/to/3speakstorageadmin && ./scripts/clean-stuck-uploads.sh
```