#!/bin/bash

# S3 Storage Reconciliation Script
# Usage: ./reconcile-s3.sh <username> [--execute]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Help function
show_help() {
    echo -e "${BLUE}S3 Storage Reconciliation Tool${NC}"
    echo ""
    echo "Usage: $0 <username> [--execute]"
    echo ""
    echo "This tool checks S3 videos for a user and marks missing ones as deleted."
    echo ""
    echo "Examples:"
    echo "  $0 alice"
    echo "  $0 bob --execute"
    echo ""
    echo "Options:"
    echo "  --execute         Execute the reconciliation (default is dry-run)"
    echo "  --include-optimized  Include already optimized videos"
    echo "  --help            Show this help message"
    echo ""
    echo -e "${YELLOW}What it does:${NC}"
    echo "  ✅ Finds all S3 videos for the user"
    echo "  🔍 Checks if files actually exist on S3/Wasabi storage"
    echo "  🗑️  Marks missing videos as deleted (cleans up broken links)"
    echo "  📊 Provides detailed report of what was found"
    echo ""
    echo -e "${PURPLE}Safety Note:${NC} Always run without --execute first!"
}

# Check if help is requested
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]] || [[ $# -eq 0 ]]; then
    show_help
    exit 0
fi

# Get arguments
USERNAME="$1"
EXECUTE_MODE="$2"
INCLUDE_OPTIMIZED="$3"

echo -e "${BLUE}=== S3 Storage Reconciliation ===${NC}"
echo -e "Target User: ${YELLOW}$USERNAME${NC}"
echo ""

# Validate username
if [[ -z "$USERNAME" ]]; then
    echo -e "${RED}Error: Username is required${NC}"
    show_help
    exit 1
fi

# Build command arguments
ARGS=("--username" "$USERNAME")

# Add include-optimized if specified
if [[ "$INCLUDE_OPTIMIZED" == "--include-optimized" ]] || [[ "$EXECUTE_MODE" == "--include-optimized" ]]; then
    ARGS+=("--include-optimized")
    echo -e "${BLUE}📋 Including already optimized videos${NC}"
fi

# Determine execution mode
if [[ "$EXECUTE_MODE" == "--execute" ]] || [[ "$3" == "--execute" ]]; then
    echo -e "${YELLOW}⚠️  EXECUTION MODE - Changes will be made!${NC}"
    echo ""
    
    # Double confirmation for execution
    read -p "This will mark missing S3 videos as deleted for user '$USERNAME'. Continue? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "${RED}Aborted.${NC}"
        exit 0
    fi
    
    # Run the actual reconciliation
    echo -e "${GREEN}🚀 Executing S3 reconciliation...${NC}"
    npm start -- reconcile-s3 "${ARGS[@]}" --no-confirm
else
    echo -e "${GREEN}🔍 Running dry-run analysis...${NC}"
    echo -e "${BLUE}💡 Add --execute flag to actually perform reconciliation${NC}"
    echo ""
    
    # Run dry-run by default
    npm start -- reconcile-s3 "${ARGS[@]}" --dry-run
fi

echo ""
echo -e "${GREEN}✅ Reconciliation completed!${NC}"

if [[ "$EXECUTE_MODE" != "--execute" ]] && [[ "$3" != "--execute" ]]; then
    echo -e "${YELLOW}💡 To execute the reconciliation, run:${NC}"
    echo -e "   ${BLUE}$0 $USERNAME --execute${NC}"
fi