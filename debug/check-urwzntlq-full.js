require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// S3 configuration - using actual .env values
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const bucketName = process.env.S3_BUCKET_NAME;
const permlink = 'urwzntlq';

async function checkAllVideoContent() {
  try {
    console.log(`Checking ALL content for video ${permlink}...`);
    
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: `${permlink}/`,
      MaxKeys: 1000, // Get more objects
    });

    const response = await s3Client.send(listCommand);
    
    if (response.Contents && response.Contents.length > 0) {
      console.log(`Found ${response.Contents.length} objects:\n`);
      
      // Group by type
      const playlists = [];
      const segments = { '1080p': [], '720p': [], '480p': [], '360p': [] };
      const thumbnails = [];
      const other = [];
      
      response.Contents.forEach(obj => {
        const key = obj.Key;
        if (key.endsWith('.m3u8')) {
          playlists.push(key);
        } else if (key.includes('/1080p/')) {
          segments['1080p'].push(key);
        } else if (key.includes('/720p/')) {
          segments['720p'].push(key);
        } else if (key.includes('/480p/')) {
          segments['480p'].push(key);
        } else if (key.includes('/360p/')) {
          segments['360p'].push(key);
        } else if (key.includes('/thumbnails/')) {
          thumbnails.push(key);
        } else {
          other.push(key);
        }
      });
      
      console.log('📝 PLAYLISTS:');
      playlists.forEach(p => console.log(`  ${p}`));
      
      console.log('\n🎬 SEGMENTS:');
      Object.keys(segments).forEach(res => {
        console.log(`  ${res}: ${segments[res].length} files`);
        if (segments[res].length > 0 && segments[res].length <= 3) {
          segments[res].forEach(s => console.log(`    ${s}`));
        }
      });
      
      console.log('\n🖼️ THUMBNAILS:');
      thumbnails.forEach(t => console.log(`  ${t}`));
      
      console.log('\n📦 OTHER:');
      other.forEach(o => console.log(`  ${o}`));
      
    } else {
      console.log('❌ NO CONTENT FOUND AT ALL!');
    }
    
  } catch (error) {
    console.error('Error checking video content:', error.message);
  }
}

checkAllVideoContent();