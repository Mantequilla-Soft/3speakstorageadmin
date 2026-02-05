# Test Scripts

This directory contains test and development scripts for the 3Speak Storage Admin tool.

## Files

### `test-cluster-direct.sh`
Direct connection test script for the IPFS cluster. Tests connectivity and basic operations.

### `setup-cluster-tunnel.sh`
Sets up SSH tunnel for secure cluster access during development and testing.

## Usage

### Testing Cluster Connectivity

```bash
# Test direct cluster access
./tests/test-cluster-direct.sh

# Setup tunnel for remote testing
./tests/setup-cluster-tunnel.sh
```

## Notes

- These scripts are primarily for development and debugging
- Cluster functionality is currently in development (Phase 1 implementation)
- SSH tunneling may be required depending on your network configuration
