import dotenv from 'dotenv';
import { StorageConfig } from '../types';

dotenv.config();

export const config: StorageConfig = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/3speak',
    dbName: process.env.MONGODB_DB_NAME || '3speak'
  },
  ipfs: {
    apiUrl: process.env.IPFS_ENDPOINT || 'http://localhost:5001',
    gatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io'
  },
  cluster: {
    apiUrl: process.env.IPFS_CLUSTER_ENDPOINT || 'http://localhost:9095',
    pinsUrl: process.env.IPFS_CLUSTER_PINS_ENDPOINT || 'http://localhost:9097'
  },
  s3: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'us-east-1',
    bucketName: process.env.S3_BUCKET_NAME || '3speak-videos',
    endpoint: process.env.S3_ENDPOINT
  },
  safety: {
    dryRunMode: process.env.DRY_RUN_MODE === 'true',
    requireConfirmation: process.env.REQUIRE_CONFIRMATION === 'true',
    maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '100', 10)
  }
};

export const validateConfig = (): void => {
  const required = [
    'MONGODB_URI'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};