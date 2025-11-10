require('dotenv').config();
const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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

async function fixMasterPlaylist() {
  try {
    console.log(`Fixing broken video ${permlink}...`);
    
    // Get all 1080p segments
    console.log('📋 Getting 1080p segments...');
    const segments1080p = await getAllSegments(`${permlink}/1080p/`);
    console.log(`Found ${segments1080p.length} 1080p segments`);
    
    // Get all 360p segments  
    console.log('📋 Getting 360p segments...');
    const segments360p = await getAllSegments(`${permlink}/360p/`);
    console.log(`Found ${segments360p.length} 360p segments`);
    
    if (segments1080p.length === 0 && segments360p.length === 0) {
      console.log('❌ No segments found - cannot restore video');
      return;
    }
    
    // Create playlists with actual segment names
    if (segments1080p.length > 0) {
      const playlist1080p = createHLSPlaylist(segments1080p, '1080p/');
      console.log('📤 Uploading 1080p playlist...');
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: `${permlink}/1080p.m3u8`,
        Body: playlist1080p,
        ContentType: 'application/vnd.apple.mpegurl',
      }));
    }
    
    if (segments360p.length > 0) {
      const playlist360p = createHLSPlaylist(segments360p, '360p/');
      console.log('📤 Uploading 360p playlist...');
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: `${permlink}/360p.m3u8`, 
        Body: playlist360p,
        ContentType: 'application/vnd.apple.mpegurl',
      }));
    }

    // Create master playlist
    let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';
    
    if (segments1080p.length > 0) {
      masterPlaylist += '#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080,CODECS="avc1.42001f,mp4a.40.2"\n1080p.m3u8\n';
    }
    
    if (segments360p.length > 0) {
      masterPlaylist += '#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=640x360,CODECS="avc1.42001e,mp4a.40.2"\n360p.m3u8\n';
    }

    console.log('📤 Uploading master playlist...');
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `${permlink}/default.m3u8`,
      Body: masterPlaylist,
      ContentType: 'application/vnd.apple.mpegurl',
    }));

    console.log('✅ Successfully restored all playlists for urwzntlq');
    console.log('🎥 Video should now be playable again!');
    
  } catch (error) {
    console.error('❌ Error fixing master playlist:', error.message);
  }
}

async function getAllSegments(prefix) {
  const segments = [];
  let continuationToken;
  
  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    
    const response = await s3Client.send(listCommand);
    
    if (response.Contents) {
      response.Contents.forEach(obj => {
        const filename = obj.Key.split('/').pop();
        if (filename.endsWith('.ts')) {
          segments.push(filename);
        }
      });
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  // Sort segments numerically
  segments.sort((a, b) => {
    const numA = parseInt(a.replace('.ts', ''));
    const numB = parseInt(b.replace('.ts', ''));
    return numA - numB;
  });
  
  return segments;
}

function createHLSPlaylist(segments, pathPrefix) {
  let playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
`;

  segments.forEach(segment => {
    playlist += `#EXTINF:10.0,\n${pathPrefix}${segment}\n`;
  });
  
  playlist += '#EXT-X-ENDLIST\n';
  return playlist;
}

fixMasterPlaylist();