#!/bin/bash

# 3Speak Storage Admin - Free Deleted Videos
# This script safely cleans up videos that admins have already marked as deleted

echo "=============================================="
echo "  3Speak Storage Admin - Free Deleted Videos"
echo "=============================================="
echo ""
echo "This script will clean up videos that have been"
echo "marked as 'deleted' by administrators."
echo ""
echo "These are the SAFEST videos to remove since"
echo "they've already been marked for deletion."
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

# Step 1: Show current stats
echo "📊 Getting current statistics..."
echo ""
npm start -- stats 2>/dev/null | grep -E "(deleted:|Total Videos:|Total Size:)"
echo ""

# Step 2: Preview what will be cleaned
echo "🔍 Checking how many deleted videos are ready for cleanup..."
PREVIEW=$(npm start -- list --status deleted --limit 1 2>/dev/null)
if echo "$PREVIEW" | grep -q "No videos found"; then
    echo "✅ No deleted videos found - storage is already clean!"
    exit 0
fi

echo "📋 Found deleted videos ready for cleanup"
echo ""

# Step 3: Ask for batch size
echo "🎛️  Configuration Options:"
echo ""
echo "Batch Size Options:"
echo "  1) Small (25 videos)    - Safest, slower"
echo "  2) Medium (100 videos)  - Balanced (Recommended)"
echo "  3) Large (250 videos)   - Faster, more aggressive"
echo "  4) Custom amount"
echo ""

while true; do
    read -p "Choose batch size [1-4]: " batch_choice
    case $batch_choice in
        1) BATCH_SIZE=25; break;;
        2) BATCH_SIZE=100; break;;
        3) BATCH_SIZE=250; break;;
        4) 
            while true; do
                read -p "Enter custom batch size (1-500): " custom_batch
                if [[ "$custom_batch" =~ ^[0-9]+$ ]] && [ "$custom_batch" -ge 1 ] && [ "$custom_batch" -le 500 ]; then
                    BATCH_SIZE=$custom_batch
                    break 2
                else
                    echo "❌ Please enter a number between 1 and 500"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, or 4";;
    esac
done

echo ""
echo "📝 Configuration Summary:"
echo "   Target: Admin-deleted videos"
echo "   Batch Size: $BATCH_SIZE videos per batch"
echo "   Safety Level: Maximum (these videos are already marked deleted)"
echo ""

# Step 4: Dry run
echo "🧪 Running safety check (dry run)..."
echo ""
npm start -- cleanup --status deleted --batch-size $BATCH_SIZE --dry-run --no-confirm

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Safety check failed. Please review the errors above."
    exit 1
fi

echo ""
echo "✅ Safety check completed"
echo ""

# Step 5: Final confirmation
echo "🚨 FINAL CONFIRMATION"
echo ""
echo "This will permanently remove files from S3 storage."
echo "These videos have already been marked as deleted by admins."
echo ""
read -p "Are you sure you want to proceed? [yes/no]: " final_confirm

if [ "$final_confirm" != "yes" ]; then
    echo "❌ Cleanup cancelled by user"
    exit 0
fi

echo ""
echo "🚀 Starting cleanup process..."
echo "   Processing $BATCH_SIZE videos at a time"
echo "   You can press Ctrl+C to stop at any time"
echo ""

# Step 6: Execute cleanup
START_TIME=$(date)
echo "🧹 Executing cleanup..."

# Capture the cleanup output to extract storage freed info
CLEANUP_OUTPUT=$(npm start -- cleanup --status deleted --batch-size $BATCH_SIZE --no-confirm 2>&1)
CLEANUP_EXIT_CODE=$?

# Display the output
echo "$CLEANUP_OUTPUT"

if [ $CLEANUP_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Cleanup completed successfully!"
    
    # Extract and highlight storage freed information
    STORAGE_FREED=$(echo "$CLEANUP_OUTPUT" | grep "💾 STORAGE FREED:" || echo "Storage information not available")
    if [ "$STORAGE_FREED" != "Storage information not available" ]; then
        echo ""
        echo "🎉 RESULT: $STORAGE_FREED"
    fi
    
    echo ""
    echo "📊 Updated statistics:"
    npm start -- stats 2>/dev/null | grep -E "(deleted:|Total Videos:|Total Size:|Videos Cleaned Up:)"
    echo ""
    echo "🕐 Started: $START_TIME"
    echo "🕐 Finished: $(date)"
else
    echo ""
    echo "❌ Cleanup encountered some issues. Check the output above."
    echo "   The process may have been interrupted or encountered errors."
    echo "   You can safely run this script again."
fi

echo ""
echo "📄 Full logs are available in: ./logs/app.log"
echo "=============================================="