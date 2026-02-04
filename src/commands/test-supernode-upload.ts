import FormData from 'form-data';
// @ts-ignore
import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';

interface IpfsAddResponse {
  Name: string;
  Hash: string;
  Size: string;
}

export async function testSupernodeUpload() {
  const SUPERNODE_API = 'https://ipfs.3speak.tv/api/v0/add';
  const timestamp = new Date().toISOString();
  const testContent = `Test upload from 3speak storage admin at ${timestamp}`;
  
  logger.info('Starting supernode upload test');
  logger.info(`Target endpoint: ${SUPERNODE_API}`);
  logger.info(`Test content: ${testContent}`);
  
  try {
    // Create form data with test file
    const form = new FormData();
    form.append('file', Buffer.from(testContent), {
      filename: `test-${Date.now()}.txt`,
      contentType: 'text/plain'
    });
    
    logger.info('Sending upload request...');
    const startTime = Date.now();
    
    const response = await fetch(SUPERNODE_API, {
      method: 'POST',
      body: form,
      headers: form.getHeaders(),
      timeout: 60000  // 60 second timeout
    });
    
    const duration = Date.now() - startTime;
    logger.info(`Upload completed in ${duration}ms`);
    logger.info(`Response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Upload failed: ${errorText}`);
      return;
    }
    
    const result = await response.json() as IpfsAddResponse;
    logger.info('Upload successful!');
    logger.info(`CID: ${result.Hash}`);
    logger.info(`Name: ${result.Name}`);
    logger.info(`Size: ${result.Size}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('TEST RESULTS');
    console.log('='.repeat(80));
    console.log(`✅ Upload successful`);
    console.log(`📦 CID: ${result.Hash}`);
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log('='.repeat(80));
    console.log('\nNow verify which daemon has this pin:');
    console.log(`  IPFS_PATH=/pool0/ipfs/.ipfs-new ipfs pin ls ${result.Hash}`);
    console.log(`  IPFS_PATH=/pool0/ipfs/.ipfs ipfs pin ls ${result.Hash}`);
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    logger.error('Upload failed with error:', error);
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    }
    throw error;
  }
}
