import { uploadFile, downloadFile } from '@huggingface/hub';
import { retry } from '../utils/retry.js';

const BUCKET_REPO = {
  type: 'bucket',
  name: process.env.HF_BUCKET_NAME
};

const HF_TOKEN = process.env.HF_TOKEN;

/**
 * Writes JSON data safely to the Hugging Face Storage Bucket
 */
export async function writeJSON(path, data) {
  if (!HF_TOKEN || !process.env.HF_BUCKET_NAME) {
    throw new Error('Missing required environment variables: HF_TOKEN or HF_BUCKET_NAME');
  }

  return retry(async () => {
    const blob = new Blob([JSON.stringify(data)], {
      type: 'application/json'
    });

    await uploadFile({
      repo: BUCKET_REPO,
      accessToken: HF_TOKEN,
      file: {
        path: path,
        content: blob
      }
    });
  });
}

/**
 * Reads JSON data from the Hugging Face Storage Bucket with safe cross-origin redirect isolation
 */
export async function readJSON(path) {
  if (!HF_TOKEN || !process.env.HF_BUCKET_NAME) {
    throw new Error('Missing required environment variables: HF_TOKEN or HF_BUCKET_NAME');
  }

  // Strategy 1: Attempt downloading via the SDK client wrapper
  try {
    const response = await downloadFile({
      repo: BUCKET_REPO,
      path: path,
      accessToken: HF_TOKEN
    });

    if (response && response.ok) {
      return await response.json();
    }
    if (response && response.status === 404) {
      return null;
    }
  } catch (sdkError) {
    // Gracefully fall through to the manual resolution strategy
  }

  // Strategy 2: Direct Canonical Resolve URL with Manual Redirect Isolation
  const bucketName = process.env.HF_BUCKET_NAME;
  const directUrl = `https://huggingface.co/buckets/${bucketName}/resolve/${path}`;
  
  // Step A: Request the temporary download location from HF
  let directResponse = await fetch(directUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`
    },
    redirect: 'manual' // Prevent header leakage to AWS S3
  });

  // Step B: Manually handle the redirect signature without authorization headers
  if (directResponse.status === 302 || directResponse.status === 307) {
    const s3Url = directResponse.headers.get('location');
    if (s3Url) {
      directResponse = await fetch(s3Url, {
        method: 'GET'
      });
    }
  }

  if (directResponse.ok) {
    return await directResponse.json();
  }

  if (directResponse.status === 404) {
    return null;
  }

  const rawErrorText = await directResponse.text().catch(() => 'Unreadable payload');
  throw new Error(`Bucket direct read failed. Status: ${directResponse.status} - ${rawErrorText}`);
}
