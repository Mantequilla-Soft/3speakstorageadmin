#!/usr/bin/env node
import { Command } from 'commander';
import { validateConfig } from './config';
import { logger } from './utils/logger';
import { cleanupCommand } from './commands/cleanup';
import { statsCommand } from './commands/stats';
import { listCommand } from './commands/list';
import { testS3Command } from './commands/test-s3';
import { testSpecificVideoCommand } from './commands/test-specific-video';
import { debugBannedUsersCommand } from './commands/debug-banned';
import { s3DietCommand } from './commands/s3-diet';
import { ipfsDietCommand } from './commands/ipfs-diet';
import { nukeAccountCommand } from './commands/nuke-account';
import { slimUserCommand } from './commands/slim-user';
import { slimVideoCommand } from './commands/slim-video';
import { trimFatCommand } from './commands/trim-fat';
import { reconcileS3Command } from './commands/reconcile-s3';
import { purgeS3Command } from './commands/purge-s3';
import { purgeFailedCommand } from './commands/purge-failed';
import { purgeAbandonedCommand } from './commands/purge-abandoned';
import { clusterStatus, clusterPins, clusterCheckPin } from './commands/cluster-status';
import { testSupernodeUpload } from './commands/test-supernode-upload';

const program = new Command();

program
  .name('3speak-admin')
  .description('3Speak Storage Administration Tool')
  .version('1.0.0');

program
  .command('cleanup')
  .description('Clean up videos based on specified criteria')
  .option('-b, --banned-users', 'Clean up videos from banned users')
  .option('-a, --age <days>', 'Clean up videos older than specified days')
  .option('--max-views <count>', 'Clean up videos with less than specified views')
  .option('--min-views <count>', 'Clean up videos with more than specified views')
  .option('-o, --orphaned', 'Clean up orphaned videos (no filename)')
  .option('-s, --status <statuses>', 'Clean up videos with specific statuses (comma-separated). Use "deleted" for admin-deleted videos.')
  .option('--stuck-days <days>', 'Clean up videos stuck in processing for X days (default: 30)')
  .option('--storage-type <type>', 'Target specific storage type: ipfs, s3, unknown')
  .option('--dry-run', 'Preview changes without executing them')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .option('--batch-size <size>', 'Process videos in batches of specified size')
  .action(cleanupCommand);

program
  .command('stats')
  .description('Show storage statistics')
  .option('-d, --detailed', 'Show detailed breakdown')
  .action(statsCommand);

program
  .command('list')
  .description('List videos matching criteria')
  .option('-b, --banned-users', 'List videos from banned users')
  .option('-a, --age <days>', 'List videos older than specified days')
  .option('--max-views <count>', 'List videos with less than specified views')
  .option('--min-views <count>', 'List videos with more than specified views')
  .option('-o, --orphaned', 'List orphaned videos')
  .option('-s, --status <statuses>', 'List videos with specific statuses')
  .option('--stuck-days <days>', 'List videos stuck in processing for X days (default: 30)')
  .option('--storage-type <type>', 'Filter by storage type: ipfs, s3, unknown')
  .option('--limit <count>', 'Limit number of results')
  .action(listCommand);

program
  .command('test-s3')
  .description('Test S3 connection and list objects')
  .action(testS3Command);

program
  .command('test-video')
  .description('Test specific video S3 object access')
  .action(testSpecificVideoCommand);

program
  .command('debug-banned')
  .description('Debug banned users and video lookup')
  .action(debugBannedUsersCommand);

program
  .command('s3-diet')
  .description('Optimize S3 storage by keeping only 480p resolution for low-engagement S3 videos')
  .option('--older-than-months <months>', 'Target S3 videos older than specified months (default: 6)')
  .option('--view-threshold <count>', 'Target S3 videos with less than specified views (default: 500)')
  .option('--batch-size <size>', 'Process S3 videos in batches of specified size (default: 25)')
  .option('--dry-run', 'Preview changes without executing them (default: true)')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(s3DietCommand);

program
  .command('ipfs-diet')
  .description('Free IPFS storage by unpinning low-engagement IPFS videos (makes videos inaccessible)')
  .option('--older-than-months <months>', 'Target IPFS videos older than specified months (default: 6)')
  .option('--view-threshold <count>', 'Target IPFS videos with less than specified views (default: 500)')
  .option('--batch-size <size>', 'Process IPFS videos in batches of specified size (default: 25)')
  .option('--dry-run', 'Preview changes without executing them (default: true)')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(ipfsDietCommand);

program
  .command('nuke-account')
  .description('Permanently delete all videos and storage for a specific account')
  .requiredOption('-u, --username <username>', 'Account username to nuke')
  .option('--include-cleaned', 'Include videos already marked as cleaned')
  .option('--status <statuses>', 'Only include videos with these statuses (comma-separated)')
  .option('--limit <count>', 'Limit the number of videos processed (default: all)')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 25, max: 500)')
  .option('--dry-run', 'Preview the destructive impact without executing it')
  .option('--no-confirm', 'Skip confirmation prompts (use with extreme caution)')
  .action(nukeAccountCommand);

program
  .command('slim-user')
  .description('Storage diet for a specific user - keep only 480p for old videos')
  .requiredOption('-u, --username <username>', 'Account username to optimize')
  .option('--older-than-months <months>', 'Target videos older than specified months (default: 6)')
  .option('--include-cleaned', 'Include videos already marked as optimized')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 25, max: 200)')
  .option('--dry-run', 'Preview storage savings without executing optimization')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(slimUserCommand);

program
  .command('slim-video')
  .description('Optimize storage for a specific video by keeping only the smallest resolution')
  .argument('<url>', '3Speak video URL (e.g., https://3speak.tv/watch?v=mes/zlsjctuz)')
  .option('--dry-run', 'Show what would be done without making changes', false)
  .option('--no-confirm', 'Skip confirmation prompt', false)
  .action(slimVideoCommand);

program
  .command('trim-fat')
  .description('Trim fat from a specific account - remove old/low-engagement content')
  .requiredOption('-u, --username <username>', 'Account username to trim fat from')
  .option('--older-than-months <months>', 'Target videos older than specified months (0=any age)')
  .option('--view-threshold <views>', 'Target videos with less than specified views (999999=no limit)')
  .option('--include-cleaned', 'Include videos already marked as cleaned')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 25)')
  .option('--dry-run', 'Preview fat trimming without executing removal')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(trimFatCommand);

program
  .command('reconcile-s3')
  .description('Reconcile S3 storage - find and clean up videos with missing files')
  .requiredOption('-u, --username <username>', 'User account to reconcile')
  .option('--include-optimized', 'Include already optimized videos in reconciliation')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 25)')
  .option('--dry-run', 'Preview reconciliation without making changes')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(reconcileS3Command);

program
  .command('purge-s3')
  .description('Mark S3 videos as deleted if they no longer exist in storage (mass cleanup after storage deletion)')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 100)')
  .option('--limit <count>', 'Limit number of videos to process (default: all)')
  .option('--dry-run', 'Preview purge without making changes (default: true)')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(purgeS3Command);

program
  .command('purge-failed')
  .description('Clean up failed videos and unpin their IPFS content (videos that failed encoding/processing)')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 100)')
  .option('--limit <count>', 'Limit number of videos to process (default: all)')
  .option('--dry-run', 'Preview purge without making changes')
  .option('--no-dry-run', 'Actually execute the purge (dangerous!)')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(purgeFailedCommand);

program
  .command('purge-abandoned')
  .description('Clean up abandoned manual publish videos and unpin their IPFS content (videos stuck in publish_manual)')
  .option('--older-than-days <days>', 'Target videos stuck in publish_manual for more than specified days (default: 7)')
  .option('--batch-size <size>', 'Process videos in batches of specified size (default: 100)')
  .option('--limit <count>', 'Limit number of videos to process (default: all)')
  .option('--dry-run', 'Preview purge without making changes')
  .option('--no-dry-run', 'Actually execute the purge (dangerous!)')
  .option('--no-confirm', 'Skip confirmation prompts (use with caution)')
  .action(purgeAbandonedCommand);

// Cluster management commands
program
  .command('cluster-status')
  .description('Show IPFS Cluster status and metrics')
  .action(() => clusterStatus());

program
  .command('cluster-pins')
  .description('List all pins in the IPFS Cluster')
  .action(() => clusterPins());

program
  .command('cluster-check <hash>')
  .description('Check if a specific hash is pinned in the IPFS Cluster')
  .action((hash) => clusterCheckPin(hash));

program
  .command('test-supernode-upload')
  .description('Test upload to supernode and verify which daemon receives it')
  .action(testSupernodeUpload);

async function main() {
  try {
    validateConfig();
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error('Application error', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export default program;