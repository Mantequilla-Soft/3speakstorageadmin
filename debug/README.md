# Debug Scripts

This folder contains debug scripts used during development and troubleshooting.

⚠️ **Security Note**: These scripts use environment variables from `.env` file. Never hardcode credentials!

## Scripts:

- `check-*.js` - Scripts to inspect S3 content for specific videos
- `fix-*.js` - Scripts to repair broken video playlists

## Usage:

Make sure your `.env` file is properly configured, then run:

```bash
node debug/script-name.js
```

## Safety:

- All scripts read credentials from environment variables
- No sensitive information is hardcoded
- Scripts are read-only unless explicitly named "fix-*"