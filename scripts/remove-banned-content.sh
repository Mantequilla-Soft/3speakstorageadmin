#!/bin/bash

# 3Speak Storage Admin - Remove Banned User Content
# This script removes content from users who have been banned

echo "================================================"
echo "  3Speak Storage Admin - Remove Banned Content"
echo "================================================"
echo ""
echo "⚠️  WARNING: This removes content from banned users"
echo ""
echo "This script will:"
echo "1. Find all users marked as 'banned' in the database"
echo "2. Locate all their uploaded content"
echo "3. Remove their videos from IPFS and S3 storage"
echo "4. Mark videos as deleted in the database"
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

# Step 1: Show banned user statistics
echo "📊 Checking banned user statistics..."
STATS=$(npm start -- stats 2>/dev/null)
BANNED_USERS=$(echo "$STATS" | grep "Banned Users:" | head -1)
echo "$BANNED_USERS"

if echo "$BANNED_USERS" | grep -q "Banned Users: 0"; then
    echo "✅ No banned users found - no content to remove!"
    exit 0
fi

echo ""

# Step 2: Preview banned user content
echo "🔍 Checking for content from banned users..."
PREVIEW=$(npm start -- list --banned-users --limit 1 2>/dev/null)
if echo "$PREVIEW" | grep -q "No videos found"; then
    echo "✅ No content from banned users found!"
    exit 0
fi

echo "📋 Found content from banned users that can be removed"
echo ""

# Show sample of what will be affected
echo "📝 Sample of content to be removed:"
npm start -- list --banned-users --limit 5 2>/dev/null | grep -A 1 -B 1 "Owner:"
echo ""

# Step 3: Ask for batch size
echo "🎛️  Configuration Options:"
echo ""
echo "Batch Size Options:"
echo "  1) Small (10 videos)    - Very safe, very slow"
echo "  2) Medium (25 videos)   - Safe, moderate speed (Recommended)"
echo "  3) Large (50 videos)    - Faster, more aggressive"
echo "  4) Custom amount"
echo ""

while true; do
    read -p "Choose batch size [1-4]: " batch_choice
    case $batch_choice in
        1) BATCH_SIZE=10; break;;
        2) BATCH_SIZE=25; break;;
        3) BATCH_SIZE=50; break;;
        4) 
            while true; do
                read -p "Enter custom batch size (1-100): " custom_batch
                if [[ "$custom_batch" =~ ^[0-9]+$ ]] && [ "$custom_batch" -ge 1 ] && [ "$custom_batch" -le 100 ]; then
                    BATCH_SIZE=$custom_batch
                    break 2
                else
                    echo "❌ Please enter a number between 1 and 100"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, or 4";;
    esac
done

echo ""
echo "📝 Configuration Summary:"
echo "   Target: Content from banned users"
echo "   Batch Size: $BATCH_SIZE videos per batch"
echo "   Safety Level: High (only affects banned user content)"
echo ""

# Step 4: Dry run
echo "🧪 Running safety check (dry run)..."
echo ""
npm start -- cleanup --banned-users --batch-size $BATCH_SIZE --dry-run --no-confirm

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
echo "This will permanently remove content from banned users."
echo "Files will be deleted from both IPFS and S3 storage."
echo "Videos will be marked as deleted in the database."
echo ""
echo "⚠️  This action cannot be undone!"
echo ""
read -p "Type 'REMOVE BANNED CONTENT' to proceed: " final_confirm

if [ "$final_confirm" != "REMOVE BANNED CONTENT" ]; then
    echo "❌ Cleanup cancelled - confirmation text did not match"
    exit 0
fi

echo ""
echo "🚀 Starting banned content removal..."
echo "   Processing $BATCH_SIZE videos at a time"
echo "   You can press Ctrl+C to stop at any time"
echo ""

# Step 5: Execute cleanup
START_TIME=$(date)
echo "🧹 Executing cleanup..."
echo ""

# Run cleanup in background and monitor progress
npm start -- cleanup --banned-users --batch-size $BATCH_SIZE --no-confirm > /tmp/3speak_banned_$$.log 2>&1 &
CLEANUP_PID=$!

# Show progress indicator while cleanup runs
SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
SPIN_INDEX=0
SECONDS_ELAPSED=0

echo -n "Removing banned content "
while kill -0 $CLEANUP_PID 2>/dev/null; do
    printf "\r${SPINNER[$SPIN_INDEX]} Removing banned content... %02d:%02d elapsed" $((SECONDS_ELAPSED/60)) $((SECONDS_ELAPSED%60))
    SPIN_INDEX=$(( (SPIN_INDEX + 1) % 10 ))
    sleep 1
    SECONDS_ELAPSED=$((SECONDS_ELAPSED + 1))
done

# Wait for process to complete and get exit code
wait $CLEANUP_PID
CLEANUP_EXIT_CODE=$?

# Clear the spinner line
printf "\r\033[K"

# Display the output
CLEANUP_OUTPUT=$(cat /tmp/3speak_banned_$$.log)
echo "$CLEANUP_OUTPUT"

# Clean up temp file
rm -f /tmp/3speak_banned_$$.log

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
    npm start -- stats 2>/dev/null | grep -E "(Banned Users:|Total Videos:|Total Size:|Videos Cleaned Up:)"
    echo ""
    echo "🕐 Started: $START_TIME"
    echo "🕐 Finished: $(date)"
else
    echo ""
    echo "❌ Cleanup encountered some issues. Check the output above."
fi

echo ""
echo "📄 Full logs are available in: ./logs/app.log"
echo "================================================"