#!/bin/bash

# 3Speak Storage Admin - IPFS Diet (Unpin Low-Engagement Videos)
# This script unpins IPFS videos to free up storage space

echo "=============================================="
echo "  3Speak Storage Admin - IPFS Diet 🗂️"
echo "=============================================="
echo ""
echo "This script unpins IPFS videos to free up storage space."
echo "Target: Old, low-engagement IPFS videos"
echo ""
echo "⚡ STORAGE IMPACT: Can free 100% of video storage!"
echo "📺 USER IMPACT: ⚠️  Videos become INACCESSIBLE after unpinning"
echo ""
echo "🎯 Target: IPFS videos (most old content)"
echo "💡 Note: This is where the big storage savings happen!"
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
echo "📊 Getting current IPFS statistics..."
echo ""
npm start -- stats 2>/dev/null | grep -E "(Total Videos:|IPFS Videos:|Total Size:|Videos Cleaned Up:)"
echo ""

# Step 2: Configure optimization parameters
echo "🎛️  IPFS Diet Configuration:"
echo ""
echo "Age Threshold Options:"
echo "  1) 3 months old    - More aggressive"
echo "  2) 6 months old    - Balanced (Recommended)"
echo "  3) 12 months old   - Conservative"
echo "  4) 18 months old   - Very conservative"
echo "  5) Custom months"
echo ""

while true; do
    read -p "Choose age threshold [1-5]: " age_choice
    case $age_choice in
        1) AGE_MONTHS=3; break;;
        2) AGE_MONTHS=6; break;;
        3) AGE_MONTHS=12; break;;
        4) AGE_MONTHS=18; break;;
        5) 
            while true; do
                read -p "Enter custom age in months (1-60): " custom_age
                if [[ "$custom_age" =~ ^[0-9]+$ ]] && [ "$custom_age" -ge 1 ] && [ "$custom_age" -le 60 ]; then
                    AGE_MONTHS=$custom_age
                    break 2
                else
                    echo "❌ Please enter a number between 1 and 60"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, 4, or 5";;
    esac
done

echo ""
echo "View Count Threshold Options:"
echo "  1) Under 100 views  - Most aggressive"
echo "  2) Under 500 views  - Balanced (Recommended)"  
echo "  3) Under 1000 views - Conservative"
echo "  4) Under 2000 views - Very conservative"
echo "  5) Custom threshold"
echo ""

while true; do
    read -p "Choose view threshold [1-5]: " view_choice
    case $view_choice in
        1) VIEW_THRESHOLD=100; break;;
        2) VIEW_THRESHOLD=500; break;;
        3) VIEW_THRESHOLD=1000; break;;
        4) VIEW_THRESHOLD=2000; break;;
        5) 
            while true; do
                read -p "Enter custom view threshold (1-10000): " custom_views
                if [[ "$custom_views" =~ ^[0-9]+$ ]] && [ "$custom_views" -ge 1 ] && [ "$custom_views" -le 10000 ]; then
                    VIEW_THRESHOLD=$custom_views
                    break 2
                else
                    echo "❌ Please enter a number between 1 and 10000"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, 4, or 5";;
    esac
done

echo ""
echo "Batch Size Options:"
echo "  1) Small (10 videos)   - Safest, IPFS-friendly"
echo "  2) Medium (25 videos)  - Balanced (Recommended)"
echo "  3) Large (50 videos)   - Faster, may stress IPFS node"
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
echo "📝 IPFS Diet Summary:"
echo "   Target: IPFS videos older than $AGE_MONTHS months with <$VIEW_THRESHOLD views"
echo "   Action: Unpin IPFS hashes (100% storage freed per video)"
echo "   Batch Size: $BATCH_SIZE videos per batch"
echo "   Impact: ⚠️  Videos become INACCESSIBLE after unpinning"
echo ""

# Step 3: Preview what will be unpinned
echo "🔍 Checking how many IPFS videos qualify for unpinning..."
PREVIEW=$(npm start -- list --older-than-days $((AGE_MONTHS * 30)) --view-threshold $VIEW_THRESHOLD --limit 1 --storage-type ipfs 2>/dev/null)
if echo "$PREVIEW" | grep -q "No videos found"; then
    echo "✅ No IPFS videos found matching criteria - already optimized!"
    echo "💡 This means either no old videos exist or they're already unpinned"
    exit 0
fi

echo "📋 Found IPFS videos that qualify for unpinning"
echo ""

# Step 4: Dry run to show impact
echo "🧪 Running IPFS diet preview (dry run)..."
echo ""
npm start -- ipfs-diet --older-than-months $AGE_MONTHS --view-threshold $VIEW_THRESHOLD --batch-size $BATCH_SIZE --dry-run --no-confirm

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Preview failed. Please review the errors above."
    exit 1
fi

echo ""
echo "✅ Preview completed - showing potential IPFS storage savings"
echo ""

# Step 5: Final confirmation
echo "🚨 FINAL CONFIRMATION - IPFS DIET"
echo ""
echo "⚠️  ⚠️  ⚠️  CRITICAL WARNING ⚠️  ⚠️  ⚠️"
echo ""
echo "This will PERMANENTLY UNPIN IPFS content:"
echo "   • IPFS hashes will be unpinned from your node"
echo "   • Videos will become INACCESSIBLE to users"
echo "   • Storage space will be freed (after 'ipfs repo gc')"
echo "   • This action is IRREVERSIBLE without re-adding content"
echo ""
echo "✅ This will achieve:"
echo "   • 100% storage freed per unpinned video"
echo "   • Significant disk space savings"
echo "   • Reduced IPFS node storage costs"
echo ""
echo "💡 Only proceed if these videos are truly unwanted!"
echo ""
read -p "Are you absolutely sure you want to unpin these videos? [yes/no]: " final_confirm

if [ "$final_confirm" != "yes" ]; then
    echo "❌ IPFS diet cancelled by user"
    exit 0
fi

echo ""
echo "🗂️ Starting IPFS diet process..."
echo "   Unpinning $BATCH_SIZE IPFS videos at a time"
echo "   Freeing 100% storage per video"
echo "   You can press Ctrl+C to stop at any time"
echo ""

# Step 6: Execute IPFS diet
START_TIME=$(date)
echo "🧹 Executing IPFS diet unpinning..."
echo ""

# Run IPFS diet in background and monitor progress
npm start -- ipfs-diet --older-than-months $AGE_MONTHS --view-threshold $VIEW_THRESHOLD --batch-size $BATCH_SIZE --no-confirm > /tmp/3speak_ipfsdiet_$$.log 2>&1 &
DIET_PID=$!

# Show progress indicator while unpinning runs
SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
SPIN_INDEX=0
SECONDS_ELAPSED=0

echo -n "Unpinning IPFS videos "
while kill -0 $DIET_PID 2>/dev/null; do
    printf "\r${SPINNER[$SPIN_INDEX]} Unpinning IPFS videos (freeing storage)... %02d:%02d elapsed" $((SECONDS_ELAPSED/60)) $((SECONDS_ELAPSED%60))
    SPIN_INDEX=$(( (SPIN_INDEX + 1) % 10 ))
    sleep 1
    SECONDS_ELAPSED=$((SECONDS_ELAPSED + 1))
done

# Wait for process to complete and get exit code
wait $DIET_PID
DIET_EXIT_CODE=$?

# Clear the spinner line
printf "\r\033[K"

# Display the output
DIET_OUTPUT=$(cat /tmp/3speak_ipfsdiet_$$.log)
echo "$DIET_OUTPUT"

# Clean up temp file
rm -f /tmp/3speak_ipfsdiet_$$.log

if [ $DIET_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ IPFS diet completed successfully!"
    
    # Extract and highlight storage freed information
    STORAGE_FREED=$(echo "$DIET_OUTPUT" | grep "💾 IPFS STORAGE FREED:" || echo "Storage information not available")
    if [ "$STORAGE_FREED" != "Storage information not available" ]; then
        echo ""
        echo "🎉 RESULT: $STORAGE_FREED"
        echo "🗂️ IPFS hashes have been unpinned!"
        echo ""
        echo "💡 IMPORTANT: To actually free disk space, run:"
        echo "   ipfs repo gc"
        echo ""
    fi
    
    echo "📊 Updated statistics:"
    npm start -- stats 2>/dev/null | grep -E "(Total Videos:|IPFS Videos:|Total Size:|Videos Cleaned Up:)"
    echo ""
    echo "🕐 Started: $START_TIME"
    echo "🕐 Finished: $(date)"
else
    echo ""
    echo "❌ IPFS diet encountered some issues. Check the output above."
    echo "   The process may have been interrupted or encountered errors."
    echo "   You can safely run this script again."
fi

echo ""
echo "📄 Full logs are available in: ./logs/app.log"
echo "=============================================="