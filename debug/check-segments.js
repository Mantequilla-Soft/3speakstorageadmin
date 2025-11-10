require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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

async function checkSegmentNames() {
  try {
    console.log(`Checking segment naming pattern for ${permlink}...`);
    
    // Get a few 1080p segments to understand the naming pattern
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: `${permlink}/1080p/`,
      MaxKeys: 10,
    });

    const response = await s3Client.send(listCommand);
    
    if (response.Contents && response.Contents.length > 0) {
      console.log('First 10 1080p segments:');
      response.Contents.forEach(obj => {
        const filename = obj.Key.split('/').pop();
        console.log(`  ${filename}`);
      });
    }
    
    // Get a few 360p segments
    const listCommand360 = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: `${permlink}/360p/`,
      MaxKeys: 10,
    });

    const response360 = await s3Client.send(listCommand360);
    
    if (response360.Contents && response360.Contents.length > 0) {
      console.log('\nFirst 10 360p segments:');
      response360.Contents.forEach(obj => {
        const filename = obj.Key.split('/').pop();
        console.log(`  ${filename}`);
      });
    }
    
  } catch (error) {
    console.error('Error checking segment names:', error.message);
  }
}

checkSegmentNames();