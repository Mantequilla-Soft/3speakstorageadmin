#!/bin/bash

# 3Speak Storage Admin - S3 Purge Script
# This script marks S3 videos as deleted if they no longer exist in storage

echo "=================================================="
echo "  3Speak Storage Admin - S3 Purge"
echo "=================================================="
echo ""
echo "This script will mark S3 videos as 'deleted' if they"
echo "no longer exist in the S3/Wasabi bucket."
echo ""
echo "📋 Use Case: After mass S3 storage deletion"
echo "🎯 Purpose: Clean up broken video links in database"
echo "✅ Safe: Only changes video status, doesn't delete files"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "src" ]; then
    echo "❌ ERROR: Please run this script from the 3speakstorageadmin directory"
    exit 1
fi

# Build the project first
echo "📦 Building project..."
npm run build > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Build failed. Please check for errors."
    exit 1
fi

echo "✅ Project built successfully"
echo ""

# Step 1: Check for S3 videos
echo "🔍 Checking for S3 videos in database..."
PREVIEW=$(npm start -- list --storage-type s3 --limit 1 2>/dev/null)
if echo "$PREVIEW" | grep -q "No videos found"; then
    echo "✅ No S3 videos found - database is clean!"
    exit 0
fi

echo "📋 Found S3 videos in database"
echo ""

# Step 2: Run dry run analysis
echo "🧪 Running analysis to estimate scope..."
echo ""
npm start -- purge-s3 --dry-run --limit 1000

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Analysis failed. Please review the errors above."
    exit 1
fi

echo ""
echo "✅ Analysis completed"
echo ""

# Step 3: Ask for batch size
echo "🎛️ S3 Purge Configuration:"
echo ""
echo "Batch Size Options:"
echo "  1) Small (50 videos)     - Safest, good for testing"
echo "  2) Medium (200 videos)   - Balanced (Recommended)" 
echo "  3) Large (500 videos)    - Faster processing"
echo "  4) All videos            - Process everything"
echo "  5) Custom amount"
echo ""

while true; do
    read -p "Choose batch size [1-5]: " batch_choice
    case $batch_choice in
        1) BATCH_SIZE=50; LIMIT=1000; break;;
        2) BATCH_SIZE=200; LIMIT=5000; break;;
        3) BATCH_SIZE=500; LIMIT=10000; break;;
        4) BATCH_SIZE=500; LIMIT=0; break;;
        5) 
            while true; do
                read -p "Enter custom batch size (1-1000): " custom_batch
                if [[ "$custom_batch" =~ ^[0-9]+$ ]] && [ "$custom_batch" -ge 1 ] && [ "$custom_batch" -le 1000 ]; then
                    BATCH_SIZE=$custom_batch
                    read -p "Enter video limit (0 for all): " custom_limit
                    if [[ "$custom_limit" =~ ^[0-9]+$ ]] && [ "$custom_limit" -ge 0 ]; then
                        LIMIT=$custom_limit
                        break 2
                    else
                        echo "❌ Please enter a valid number for limit"
                    fi
                else
                    echo "❌ Please enter a number between 1 and 1000"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, 4, or 5";;
    esac
done

echo ""
echo "📝 S3 Purge Summary:"
echo "   Target: S3 videos missing from storage"
echo "   Action: Mark as 'deleted' status in database"
echo "   Batch Size: $BATCH_SIZE videos per batch"
if [ "$LIMIT" -eq 0 ]; then
    echo "   Scope: All S3 videos"
else
    echo "   Scope: Up to $LIMIT videos"
fi
echo "   Safety: Database update only (no file deletion)"
echo ""

# Step 4: Final confirmation
echo "🚨 FINAL CONFIRMATION"
echo ""
echo "This will update video statuses in the database."
echo "Videos will be marked as 'deleted' if they don't exist in S3."
echo "This helps clean up broken video links after storage deletion."
echo ""
read -p "Are you sure you want to proceed? [yes/no]: " final_confirm

if [ "$final_confirm" != "yes" ]; then
    echo "❌ S3 purge cancelled by user"
    exit 0
fi

echo ""
echo "🚀 Starting S3 purge process..."
echo "   Processing $BATCH_SIZE videos at a time"
echo "   You can press Ctrl+C to stop at any time"
echo ""

# Step 5: Execute purge
START_TIME=$(date)

if [ "$LIMIT" -eq 0 ]; then
    npm start -- purge-s3 --batch-size $BATCH_SIZE --no-confirm
else
    npm start -- purge-s3 --batch-size $BATCH_SIZE --limit $LIMIT --no-confirm
fi

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ S3 purge completed successfully!"
    echo ""
    echo "📊 Database updated with correct video statuses"
    echo ""
    echo "🕐 Started: $START_TIME"
    echo "🕐 Finished: $(date)"
    echo ""
    echo "💡 Next steps:"
    echo "   • Videos marked as 'deleted' can be cleaned up with cleanup command"
    echo "   • Run 'npm start -- stats' to see updated statistics"
else
    echo ""
    echo "❌ S3 purge encountered issues. Check the output above."
    echo "   You can safely run this script again."
fi

echo ""
echo "📄 Full logs are available in: ./logs/app.log"
echo "=================================================="