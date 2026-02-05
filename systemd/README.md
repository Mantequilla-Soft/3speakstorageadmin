# Systemd Service Files

This directory contains systemd service and timer files for automated tasks.

## Files

### `3speak-ipfs-storage-management.service`
Main storage management service for continuous monitoring and cleanup operations.

### `ipfs-gentle-gc.service`
IPFS garbage collection service for the new repository.

### `ipfs-gentle-gc.timer`
Systemd timer to schedule regular IPFS garbage collection (runs daily at 3 AM).

## Installation

To install these services on the supernode:

```bash
# Copy service files
sudo cp systemd/*.service /etc/systemd/system/
sudo cp systemd/*.timer /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable and start services
sudo systemctl enable ipfs-gentle-gc.timer
sudo systemctl start ipfs-gentle-gc.timer

# Check status
sudo systemctl status ipfs-gentle-gc.timer
sudo systemctl list-timers
```

## Usage

```bash
# Check timer status
sudo systemctl status ipfs-gentle-gc.timer

# View service logs
sudo journalctl -u ipfs-gentle-gc.service -f

# Manually trigger GC
sudo systemctl start ipfs-gentle-gc.service
```

## Notes

- These services are designed to run on the IPFS supernode
- The GC timer runs daily to keep IPFS repository size under control
- Services are configured for the new IPFS repository (`/pool0/ipfs/.ipfs-new`)
