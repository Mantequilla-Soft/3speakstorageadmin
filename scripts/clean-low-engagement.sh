#!/bin/bash

# 3Speak Storage Admin - Clean Low Engagement Videos
# This script removes old videos with very low view counts

echo "====================================================="
echo "  3Speak Storage Admin - Clean Low Engagement Videos"
echo "====================================================="
echo ""
echo "⚠️  CAUTION: This removes published videos!"
echo ""
echo "This script targets old videos that have:"
echo "- Very low or zero view counts"
echo "- Been published for a long time"
echo "- Are taking up storage space"
echo ""
echo "Use this only when storage is critically low!"
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

# Step 1: Age threshold selection
echo "🎛️  Age Threshold Options:"
echo ""
echo "How old should videos be before considering them for cleanup?"
echo "  1) 1 year (365 days)   - Conservative"
echo "  2) 2 years (730 days)  - Moderate" 
echo "  3) 3 years (1095 days) - Aggressive (Recommended)"
echo "  4) 5 years (1825 days) - Very aggressive"
echo "  5) Custom days"
echo ""

while true; do
    read -p "Choose age threshold [1-5]: " age_choice
    case $age_choice in
        1) AGE_DAYS=365; AGE_DESC="1 year";;
        2) AGE_DAYS=730; AGE_DESC="2 years";;
        3) AGE_DAYS=1095; AGE_DESC="3 years";;
        4) AGE_DAYS=1825; AGE_DESC="5 years";;
        5) 
            while true; do
                read -p "Enter custom days (180-3650): " custom_days
                if [[ "$custom_days" =~ ^[0-9]+$ ]] && [ "$custom_days" -ge 180 ] && [ "$custom_days" -le 3650 ]; then
                    AGE_DAYS=$custom_days
                    AGE_DESC="$custom_days days"
                    break 2
                else
                    echo "❌ Please enter a number between 180 and 3650"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, 4, or 5"; continue;;
    esac
    break
done

echo ""

# Step 2: View threshold selection
echo "🎛️  View Threshold Options:"
echo ""
echo "Maximum view count for videos to be removed:"
echo "  1) 0 views          - Only completely unwatched videos"
echo "  2) 5 views or less  - Minimal engagement"
echo "  3) 10 views or less - Very low engagement (Recommended)"
echo "  4) 25 views or less - Low engagement"
echo "  5) Custom threshold"
echo ""

while true; do
    read -p "Choose view threshold [1-5]: " view_choice
    case $view_choice in
        1) VIEW_THRESHOLD=0; VIEW_DESC="0 views";;
        2) VIEW_THRESHOLD=5; VIEW_DESC="5 views or less";;
        3) VIEW_THRESHOLD=10; VIEW_DESC="10 views or less";;
        4) VIEW_THRESHOLD=25; VIEW_DESC="25 views or less";;
        5) 
            while true; do
                read -p "Enter custom view threshold (0-100): " custom_views
                if [[ "$custom_views" =~ ^[0-9]+$ ]] && [ "$custom_views" -ge 0 ] && [ "$custom_views" -le 100 ]; then
                    VIEW_THRESHOLD=$custom_views
                    VIEW_DESC="$custom_views views or less"
                    break 2
                else
                    echo "❌ Please enter a number between 0 and 100"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, 4, or 5"; continue;;
    esac
    break
done

echo ""

# Step 3: Preview what will be affected
echo "🔍 Checking for videos older than $AGE_DESC with $VIEW_DESC..."
PREVIEW=$(npm start -- list --age $AGE_DAYS --max-views $VIEW_THRESHOLD --limit 1 2>/dev/null)
if echo "$PREVIEW" | grep -q "No videos found"; then
    echo "✅ No low-engagement videos found matching your criteria!"
    exit 0
fi

echo "📋 Found low-engagement videos matching your criteria"
echo ""

# Show sample
echo "📝 Sample of videos that would be removed:"
npm start -- list --age $AGE_DAYS --max-views $VIEW_THRESHOLD --limit 5 2>/dev/null | grep -E "(Owner:|Views:|Created:|Size:)"
echo ""

# Step 4: Batch size selection
echo "🎛️  Batch Size Options:"
echo ""
echo "⚠️  IMPORTANT: Start small for published content cleanup!"
echo ""
echo "  1) Very Small (5 videos)  - Maximum safety (Recommended for first run)"
echo "  2) Small (10 videos)      - Conservative"
echo "  3) Medium (25 videos)     - Only after testing smaller batches"
echo "  4) Custom amount (max 50)"
echo ""

while true; do
    read -p "Choose batch size [1-4]: " batch_choice
    case $batch_choice in
        1) BATCH_SIZE=5; break;;
        2) BATCH_SIZE=10; break;;
        3) BATCH_SIZE=25; break;;
        4) 
            while true; do
                read -p "Enter custom batch size (1-50): " custom_batch
                if [[ "$custom_batch" =~ ^[0-9]+$ ]] && [ "$custom_batch" -ge 1 ] && [ "$custom_batch" -le 50 ]; then
                    BATCH_SIZE=$custom_batch
                    break 2
                else
                    echo "❌ Please enter a number between 1 and 50"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, or 4";;
    esac
done

echo ""
echo "📝 Configuration Summary:"
echo "   Target: Videos older than $AGE_DESC with $VIEW_DESC"
echo "   Batch Size: $BATCH_SIZE videos per batch"
echo "   Safety Level: LOW - This affects published content!"
echo ""

# Step 5: Dry run
echo "🧪 Running safety check (dry run)..."
echo ""
npm start -- cleanup --age $AGE_DAYS --max-views $VIEW_THRESHOLD --batch-size $BATCH_SIZE --dry-run --no-confirm

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Safety check failed. Please review the errors above."
    exit 1
fi

echo ""
echo "✅ Safety check completed"
echo ""

# Step 6: Final confirmation with extra safety
echo "🚨🚨 FINAL CONFIRMATION - PUBLISHED CONTENT REMOVAL 🚨🚨"
echo ""
echo "⚠️  WARNING: This will remove PUBLISHED videos!"
echo ""
echo "Criteria:"
echo "- Videos older than $AGE_DESC"
echo "- Videos with $VIEW_DESC"
echo "- Processing $BATCH_SIZE videos at a time"
echo ""
echo "⚠️  This action cannot be undone!"
echo "⚠️  This affects content that users can currently watch!"
echo ""
echo "Only proceed if storage is critically low and you understand the impact."
echo ""
read -p "Type 'DELETE LOW ENGAGEMENT VIDEOS' to proceed: " final_confirm

if [ "$final_confirm" != "DELETE LOW ENGAGEMENT VIDEOS" ]; then
    echo "❌ Cleanup cancelled - confirmation text did not match"
    exit 0
fi

echo ""
echo "🚀 Starting low engagement video cleanup..."
echo "   Processing $BATCH_SIZE videos at a time"
echo "   Criteria: Older than $AGE_DESC with $VIEW_DESC"
echo "   You can press Ctrl+C to stop at any time"
echo ""

# Step 7: Execute cleanup
START_TIME=$(date)
echo "🧹 Executing cleanup..."
echo ""

# Run cleanup in background and monitor progress
npm start -- cleanup --age $AGE_DAYS --max-views $VIEW_THRESHOLD --batch-size $BATCH_SIZE --no-confirm > /tmp/3speak_loweng_$$.log 2>&1 &
CLEANUP_PID=$!

# Show progress indicator while cleanup runs
SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
SPIN_INDEX=0
SECONDS_ELAPSED=0

echo -n "Removing low-engagement videos "
while kill -0 $CLEANUP_PID 2>/dev/null; do
    printf "\r${SPINNER[$SPIN_INDEX]} Removing low-engagement videos... %02d:%02d elapsed" $((SECONDS_ELAPSED/60)) $((SECONDS_ELAPSED%60))
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
CLEANUP_OUTPUT=$(cat /tmp/3speak_loweng_$$.log)
echo "$CLEANUP_OUTPUT"

# Clean up temp file
rm -f /tmp/3speak_loweng_$$.log

if [ $CLEANUP_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Low engagement video cleanup completed!"
    echo ""
    echo "📊 Storage freed from low-engagement content"
    echo ""
    echo "🕐 Started: $START_TIME"
    echo "🕐 Finished: $(date)"
else
    echo ""
    echo "❌ Cleanup encountered issues. Check the output above."
    echo "   You can safely run this script again."
fi

echo ""
echo "📄 Full logs are available in: ./logs/app.log"
echo "====================================================="