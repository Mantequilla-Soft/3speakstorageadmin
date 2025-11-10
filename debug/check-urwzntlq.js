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

async function checkVideoContent() {
  try {
    console.log(`Checking all content for video ${permlink}...`);
    
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: `${permlink}/`,
      MaxKeys: 100,
    });

    const response = await s3Client.send(listCommand);
    
    if (response.Contents && response.Contents.length > 0) {
      console.log(`Found ${response.Contents.length} objects:`);
      response.Contents.forEach(obj => {
        console.log(`  ${obj.Key} (${obj.Size} bytes)`);
      });
    } else {
      console.log('❌ NO CONTENT FOUND AT ALL!');
      console.log('This video has been completely destroyed.');
    }
    
  } catch (error) {
    console.error('Error checking video content:', error.message);
  }
}

checkVideoContent();