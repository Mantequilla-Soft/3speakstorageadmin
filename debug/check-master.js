require('dotenv').config();
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

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

async function checkMasterPlaylist() {
  try {
    console.log('🔍 Checking master playlist...');
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: `${permlink}/default.m3u8`,
    });

    const response = await s3Client.send(command);
    const content = await response.Body.transformToString();
    
    console.log('✅ Master playlist exists!');
    console.log('Content:');
    console.log(content);
    
  } catch (error) {
    console.log('❌ Master playlist does not exist:', error.message);
  }
}

checkMasterPlaylist();