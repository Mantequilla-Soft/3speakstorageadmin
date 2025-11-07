#!/bin/bash

# 3Speak Storage Admin - Clean Stuck Uploads
# This script removes videos that have been stuck in processing for a long time

echo "=============================================="
echo "  3Speak Storage Admin - Clean Stuck Uploads"
echo "=============================================="
echo ""
echo "This script removes videos that have been stuck"
echo "in processing (uploaded/encoding) for a long time."
echo ""
echo "These videos are likely failed uploads that are"
echo "taking up storage space unnecessarily."
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
npm start -- stats --detailed 2>/dev/null | grep -E "(uploaded:|encoding_|failed:|Total Videos:|Total Size:)"
echo ""

# Step 2: Ask for age threshold
echo "🎛️  Age Threshold Options:"
echo ""
echo "How old should stuck uploads be before removal?"
echo "  1) 30 days   - Conservative (only very old stuck uploads)"
echo "  2) 90 days   - Moderate (recommended for first cleanup)"
echo "  3) 180 days  - Aggressive (6+ months stuck)"
echo "  4) 365 days  - Very aggressive (1+ year stuck)"
echo "  5) Custom days"
echo ""

while true; do
    read -p "Choose age threshold [1-5]: " age_choice
    case $age_choice in
        1) STUCK_DAYS=30; break;;
        2) STUCK_DAYS=90; break;;
        3) STUCK_DAYS=180; break;;
        4) STUCK_DAYS=365; break;;
        5) 
            while true; do
                read -p "Enter custom days (7-1000): " custom_days
                if [[ "$custom_days" =~ ^[0-9]+$ ]] && [ "$custom_days" -ge 7 ] && [ "$custom_days" -le 1000 ]; then
                    STUCK_DAYS=$custom_days
                    break 2
                else
                    echo "❌ Please enter a number between 7 and 1000"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, 4, or 5";;
    esac
done

echo ""

# Step 3: Preview what will be cleaned
echo "🔍 Checking for uploads stuck for $STUCK_DAYS+ days..."
PREVIEW=$(npm start -- list --stuck-days $STUCK_DAYS --limit 1 2>/dev/null)
if echo "$PREVIEW" | grep -q "No videos found"; then
    echo "✅ No stuck uploads found for $STUCK_DAYS+ days - great!"
    exit 0
fi

echo "📋 Found stuck uploads older than $STUCK_DAYS days"
echo ""

# Show sample
echo "📝 Sample of stuck uploads to be removed:"
npm start -- list --stuck-days $STUCK_DAYS --limit 3 2>/dev/null | grep -E "(Owner:|Status:|Created:)"
echo ""

# Step 4: Ask for batch size  
echo "🎛️  Batch Size Options:"
echo ""
echo "  1) Small (25 videos)    - Safest, slower"
echo "  2) Medium (50 videos)   - Balanced (Recommended)"
echo "  3) Large (100 videos)   - Faster"
echo "  4) Custom amount"
echo ""

while true; do
    read -p "Choose batch size [1-4]: " batch_choice
    case $batch_choice in
        1) BATCH_SIZE=25; break;;
        2) BATCH_SIZE=50; break;;
        3) BATCH_SIZE=100; break;;
        4) 
            while true; do
                read -p "Enter custom batch size (1-200): " custom_batch
                if [[ "$custom_batch" =~ ^[0-9]+$ ]] && [ "$custom_batch" -ge 1 ] && [ "$custom_batch" -le 200 ]; then
                    BATCH_SIZE=$custom_batch
                    break 2
                else
                    echo "❌ Please enter a number between 1 and 200"
                fi
            done
            ;;
        *) echo "❌ Please choose 1, 2, 3, or 4";;
    esac
done

echo ""
echo "📝 Configuration Summary:"
echo "   Target: Videos stuck in processing for $STUCK_DAYS+ days"
echo "   Batch Size: $BATCH_SIZE videos per batch"
echo "   Safety Level: Medium (affects old stuck uploads only)"
echo ""

# Step 5: Dry run
echo "🧪 Running safety check (dry run)..."
echo ""
npm start -- cleanup --stuck-days $STUCK_DAYS --batch-size $BATCH_SIZE --dry-run --no-confirm

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Safety check failed. Please review the errors above."
    exit 1
fi

echo ""
echo "✅ Safety check completed"
echo ""

# Step 6: Final confirmation
echo "🚨 FINAL CONFIRMATION"
echo ""
echo "This will permanently remove stuck uploads older than $STUCK_DAYS days."
echo "These are likely failed uploads taking up storage space."
echo ""
read -p "Are you sure you want to proceed? [yes/no]: " final_confirm

if [ "$final_confirm" != "yes" ]; then
    echo "❌ Cleanup cancelled by user"
    exit 0
fi

echo ""
echo "🚀 Starting stuck upload cleanup..."
echo "   Processing uploads stuck for $STUCK_DAYS+ days"
echo "   Batch size: $BATCH_SIZE videos"
echo "   You can press Ctrl+C to stop at any time"
echo ""

# Step 7: Execute cleanup
START_TIME=$(date)
echo "🧹 Executing cleanup..."
echo ""

# Run cleanup in background and monitor progress
npm start -- cleanup --stuck-days $STUCK_DAYS --batch-size $BATCH_SIZE --no-confirm > /tmp/3speak_stuck_$$.log 2>&1 &
CLEANUP_PID=$!

# Show progress indicator while cleanup runs
SPINNER=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
SPIN_INDEX=0
SECONDS_ELAPSED=0

echo -n "Cleaning stuck uploads "
while kill -0 $CLEANUP_PID 2>/dev/null; do
    printf "\r${SPINNER[$SPIN_INDEX]} Cleaning stuck uploads (${STUCK_DAYS}+ days old)... %02d:%02d elapsed" $((SECONDS_ELAPSED/60)) $((SECONDS_ELAPSED%60))
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
CLEANUP_OUTPUT=$(cat /tmp/3speak_stuck_$$.log)
echo "$CLEANUP_OUTPUT"

# Clean up temp file
rm -f /tmp/3speak_stuck_$$.log

if [ $CLEANUP_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ Stuck upload cleanup completed!"
    echo ""
    echo "📊 Updated statistics:"
    npm start -- stats 2>/dev/null | grep -E "(uploaded:|encoding_|Total Videos:|Total Size:)"
    echo ""
    echo "🕐 Started: $START_TIME"
    echo "🕐 Finished: $(date)"
else
    echo ""
    echo "❌ Cleanup encountered some issues. Check the output above."
    echo "   You can safely run this script again."
fi

echo ""
echo "📄 Full logs are available in: ./logs/app.log"
echo "=============================================="