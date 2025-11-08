#!/usr/bin/env node

/**
 * Quick script to check storage usage for specific accounts
 * Usage: node check-account-storage.js username1 username2 username3
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/3speak';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || '3speak';

async function checkAccountStorage(usernames) {
  const client = new MongoClient(MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(MONGODB_DB_NAME);
    const videos = db.collection('videos');
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('  3Speak Account Storage Analysis');
    console.log('═══════════════════════════════════════════════════════\n');
    
    let totalStorage = 0;
    let totalVideos = 0;
    
    for (const username of usernames) {
      console.log(`\n📊 Account: ${username}`);
      console.log('─────────────────────────────────────────────────────');
      
      // Get all videos for this user
      const userVideos = await videos.find({ owner: username }).toArray();
      
      if (userVideos.length === 0) {
        console.log('  ⚠️  No videos found for this account');
        continue;
      }
      
      // Calculate storage
      let accountStorage = 0;
      let s3Videos = 0;
      let ipfsVideos = 0;
      let publishedVideos = 0;
      let deletedVideos = 0;
      
      userVideos.forEach(video => {
        // Estimate storage (if size field exists)
        if (video.size) {
          accountStorage += video.size;
        } else {
          // Rough estimate: 500MB per video if no size data
          accountStorage += 500 * 1024 * 1024;
        }
        
        // Count by storage type
        if (video.filename?.startsWith('ipfs://')) {
          ipfsVideos++;
        } else if (video.filename) {
          s3Videos++;
        }
        
        // Count by status
        if (video.status === 'published') publishedVideos++;
        if (video.status === 'deleted') deletedVideos++;
      });
      
      const accountStorageGB = accountStorage / (1024 * 1024 * 1024);
      const dailyCost = accountStorageGB * 0.00022754;
      const monthlyCost = dailyCost * 30;
      const annualCost = dailyCost * 365;
      
      console.log(`  📹 Total Videos: ${userVideos.length}`);
      console.log(`  📦 S3 Videos: ${s3Videos}`);
      console.log(`  📌 IPFS Videos: ${ipfsVideos}`);
      console.log(`  ✅ Published: ${publishedVideos}`);
      console.log(`  ❌ Deleted: ${deletedVideos}`);
      console.log(`\n  💾 Estimated Storage: ${accountStorageGB.toFixed(2)} GB`);
      console.log(`  💰 Daily Cost: $${dailyCost.toFixed(4)}`);
      console.log(`  💰 Monthly Cost: $${monthlyCost.toFixed(2)}`);
      console.log(`  💰 Annual Cost: $${annualCost.toFixed(2)}`);
      
      totalStorage += accountStorage;
      totalVideos += userVideos.length;
      
      // Show some sample videos
      console.log(`\n  📋 Sample Videos (first 5):`);
      userVideos.slice(0, 5).forEach(video => {
        const storageType = video.filename?.startsWith('ipfs://') ? 'IPFS' : 'S3';
        console.log(`    • ${video.title || 'Untitled'} [${video.status}] [${storageType}]`);
      });
    }
    
    // Summary
    if (totalVideos > 0) {
      console.log('\n\n═══════════════════════════════════════════════════════');
      console.log('  TOTAL FOR ALL ACCOUNTS');
      console.log('═══════════════════════════════════════════════════════');
      
      const totalStorageGB = totalStorage / (1024 * 1024 * 1024);
      const totalDailyCost = totalStorageGB * 0.00022754;
      const totalMonthlyCost = totalDailyCost * 30;
      const totalAnnualCost = totalDailyCost * 365;
      
      console.log(`  📹 Total Videos: ${totalVideos}`);
      console.log(`  💾 Total Storage: ${totalStorageGB.toFixed(2)} GB`);
      console.log(`  💰 Daily Cost: $${totalDailyCost.toFixed(4)}`);
      console.log(`  💰 Monthly Cost: $${totalMonthlyCost.toFixed(2)}`);
      console.log(`  💰 Annual Cost: $${totalAnnualCost.toFixed(2)}`);
      console.log('\n═══════════════════════════════════════════════════════\n');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Main
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage: node check-account-storage.js <username1> [username2] [username3] ...');
  console.log('\nExample:');
  console.log('  node check-account-storage.js alice bob charlie');
  process.exit(1);
}

checkAccountStorage(args);
