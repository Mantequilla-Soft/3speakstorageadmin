#!/bin/bash

# 3Speak Video Storage Optimizer
# Usage: ./slim-video.sh <3speak-url> [--execute]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Help function
show_help() {
    echo -e "${BLUE}3Speak Video Storage Optimizer${NC}"
    echo ""
    echo "Usage: $0 <3speak-url> [--execute]"
    echo ""
    echo "Examples:"
    echo "  $0 https://3speak.tv/watch?v=mes/tnvwibjd"
    echo "  $0 mes/tnvwibjd"
    echo "  $0 https://3speak.tv/watch?v=mes/tnvwibjd --execute"
    echo ""
    echo "Options:"
    echo "  --execute    Execute the optimization (default is dry-run)"
    echo "  --help       Show this help message"
    echo ""
    echo -e "${YELLOW}Safety Note:${NC} Always run without --execute first to preview changes!"
}

# Check if help is requested
if [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]] || [[ $# -eq 0 ]]; then
    show_help
    exit 0
fi

# Get URL argument
URL="$1"
EXECUTE_MODE="$2"

echo -e "${BLUE}=== 3Speak Video Storage Optimizer ===${NC}"
echo -e "Target: ${YELLOW}$URL${NC}"
echo ""

# Validate URL format
if [[ ! "$URL" =~ ^https://3speak\.(tv|online)/watch\?v=.+/.+ ]] && [[ ! "$URL" =~ ^[^/]+/[^/]+$ ]]; then
    echo -e "${RED}Error: Invalid URL format${NC}"
    echo "Expected formats:"
    echo "  https://3speak.tv/watch?v=username/permlink"
    echo "  username/permlink"
    exit 1
fi

# Determine execution mode
if [[ "$EXECUTE_MODE" == "--execute" ]]; then
    echo -e "${YELLOW}⚠️  EXECUTION MODE - Changes will be made!${NC}"
    echo ""
    
    # Double confirmation for execution
    read -p "Are you sure you want to execute storage optimization? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "${RED}Aborted.${NC}"
        exit 0
    fi
    
    # Run the actual optimization
    echo -e "${GREEN}🚀 Executing optimization...${NC}"
    npm start -- slim-video "$URL" --no-confirm
else
    echo -e "${GREEN}📊 Running dry-run analysis...${NC}"
    echo -e "${BLUE}💡 Add --execute flag to actually perform optimization${NC}"
    echo ""
    
    # Run dry-run by default
    npm start -- slim-video "$URL" --dry-run
fi

echo ""
echo -e "${GREEN}✅ Operation completed!${NC}"

if [[ "$EXECUTE_MODE" != "--execute" ]]; then
    echo -e "${YELLOW}💡 To execute the optimization, run:${NC}"
    echo -e "   ${BLUE}$0 \"$URL\" --execute${NC}"
fi