import axios from 'axios';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config();

// Get environment variables
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUIDAX_API_URL = process.env.QUIDAX_API_URL || 'https://app.quidax.io/api/v1';
const QUIDAX_API_SECRET_KEY = process.env.QUIDAX_API_SECRET_KEY || '';
const QUIDAX_COMPANY_USERID = process.env.QUIDAX_COMPANY_USERID || 'me';

// The access token to always work with (as requested)
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNtbW5lNGFkdDAwMTBreGZlejV6amdneGciLCJ1c2VyVHlwZSI6IklORElWSURVQUwiLCJpYXQiOjE3Nzk0NTkyMjgsImV4cCI6MTc3OTU0NTYyOH0.A1BvFn8y3VK_O9RZFCf_TN3rlENzdB4bmRCOIMgyDuc';

async function main() {
  console.log('=== Withdrawal Confirmation Script ===\n');
  
  // Get previewID from command line argument
  const previewId = process.argv[2];
  if (!previewId) {
    console.error('Error: Please provide a previewID as an argument');
    console.log('Usage: ts-node src/scripts/confirm-withdrawal.ts <previewId>');
    process.exit(1);
  }

  try {
    // Connect to Redis
    console.log('Connecting to Redis...');
    const redis = new Redis(REDIS_URL);
    
    // Wait for connection
    await new Promise((resolve, reject) => {
      redis.on('connect', resolve);
      redis.on('error', reject);
    });
    
    console.log('Connected to Redis\n');
    
    // Get preview data from Redis
    const redisKey = `send:${previewId}`;
    console.log(`Fetching preview data from Redis key: ${redisKey}`);
    const previewData = await redis.get(redisKey);
    
    if (!previewData) {
      console.error(`Error: No preview data found for previewId: ${previewId}`);
      await redis.quit();
      process.exit(1);
    }
    
    // Parse preview data
    let preview: any;
    try {
      preview = JSON.parse(previewData);
    } catch (error) {
      console.error('Error: Failed to parse preview data from Redis');
      await redis.quit();
      process.exit(1);
    }
    
    console.log('Preview data retrieved successfully:');
    console.log(`- Currency: ${preview.currency}`);
    console.log(`- Amount: ${preview.requestedAmount}`);
    console.log(`- Network: ${preview.network}`);
    console.log(`- To Address: ${preview.toAddress}`);
    if (preview.destinationTag) {
      console.log(`- Destination Tag: ${preview.destinationTag}`);
    }
    console.log(`- User ID: ${preview.userId}\n`);
    
    // Verify the access token and extract user ID
    console.log('Verifying access token...');
    let decodedToken: any;
    try {
      decodedToken = jwt.verify(ACCESS_TOKEN, 'your-jwt-secret'); // We need the secret to verify
    } catch (error) {
      console.error('Error: Invalid or expired access token');
      await redis.quit();
      process.exit(1);
    }
    
    const tokenUserId = decodedToken.id;
    console.log(`Token user ID: ${tokenUserId}`);
    
    // Verify that the preview belongs to the user from the token
    if (preview.userId !== tokenUserId) {
      console.error(`Error: Preview does not belong to the user from the access token`);
      console.log(`Preview user ID: ${preview.userId}`);
      console.log(`Token user ID: ${tokenUserId}`);
      await redis.quit();
      process.exit(1);
    }
    
    console.log('✓ Preview ownership verified\n');
    
    // Close Redis connection
    await redis.quit();
    
    // Prepare Quidax API request
    const url = `${QUIDAX_API_URL}/users/${QUIDAX_COMPANY_USERID}/withdraws`;
    
    const requestData = {
      user_id: QUIDAX_COMPANY_USERID,
      currency: preview.currency.toLowerCase(),
      amount: preview.requestedAmount,
      fund_uid: preview.toAddress,
      fund_uid2: preview.currency.toLowerCase() === 'xrp' ? preview.destinationTag : undefined,
      network: preview.network,
      reference: previewId,
      transaction_note: 'External crypto withdrawal',
      narration: `Send to ${preview.toAddress.slice(0, 8)}...`,
    };
    
    // Remove undefined values
    Object.keys(requestData).forEach(key => 
      requestData[key] === undefined && delete requestData[key]
    );
    
    console.log('Calling Quidax API to confirm withdrawal...');
    console.log(`URL: ${url}`);
    console.log(`Data: ${JSON.stringify(requestData, null, 2)}\n`);
    
    // Make API call using axios directly (not through HttpService/BaseQuidax)
    const response = await axios.post(url, requestData, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${QUIDAX_API_SECRET_KEY}` // Use the service secret key
      }
    });
    
    console.log('=== API Response ===');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('\nWithdrawal confirmation completed successfully!');
    
  } catch (error: any) {
    console.error('=== Error Occurred ===');
    if (error.response) {
      // Axios error with response
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // Axios error with request but no response
      console.error('No response received:', error.message);
    } else {
      // Other error
      console.error('Error:', error.message);
    }
    
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
