import { uploadFile, downloadFile } from '@huggingface/hub';
import { retry } from '../utils/retry.js';

const BUCKET_REPO = {
  type: 'bucket',
  name: process.env.HF_BUCKET_NAME
};

const HF_TOKEN = process.env.HF_TOKEN;

function verifyEnv() {
  if (!HF_TOKEN || !process.env.HF_BUCKET_NAME) {
    throw new Error('Missing required environment variables: HF_TOKEN or HF_BUCKET_NAME');
  }
}

/**
 * Writes JSON data safely to the Hugging Face Storage Bucket
 */
export async function writeJSON(path, data) {
  verifyEnv();

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
  verifyEnv();

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

/**
 * Writes a binary buffer (image asset) safely to the Hugging Face Storage Bucket
 */
export async function writeBinary(path, buffer, mimeType = 'image/png') {
  verifyEnv();

  return retry(async () => {
    const blob = new Blob([buffer], { type: mimeType });

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
 * Reads a raw binary buffer from the HF Storage Bucket using your redirect isolation strategy
 */
export async function readBinary(path) {
  verifyEnv();

  // Strategy 1: Attempt via SDK download client wrapper
  try {
    const response = await downloadFile({
      repo: BUCKET_REPO,
      path: path,
      accessToken: HF_TOKEN
    });
    if (response && response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }
  } catch (err) {
    // Gracefully fall through to isolation handshake
  }

  // Strategy 2: Direct Canonical Bucket URL with Manual Redirect Isolation
  const bucketName = process.env.HF_BUCKET_NAME;
  const directUrl = `https://huggingface.co/buckets/${bucketName}/resolve/${path}`;

  let directResponse = await fetch(directUrl, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${HF_TOKEN}` },
    redirect: 'manual'
  });

  if (directResponse.status === 302 || directResponse.status === 307) {
    const s3Url = directResponse.headers.get('location');
    if (s3Url) {
      directResponse = await fetch(s3Url, { method: 'GET' });
    }
  }

  if (directResponse.ok) {
    return Buffer.from(await directResponse.arrayBuffer());
  }
  if (directResponse.status === 404) {
    return null;
  }

  throw new Error(`Bucket binary read failed. Status: ${directResponse.status}`);
}

/**
 * Deletes a target asset directly from the Hugging Face Storage Bucket mutable objects line
 */
export async function deleteBucketFile(path) {
  verifyEnv();

  return retry(async () => {
    const bucketName = process.env.HF_BUCKET_NAME;
    const response = await fetch(`https://huggingface.co/api/buckets/${bucketName}/objects/${path}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${HF_TOKEN}` }
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Bucket file deletion failed: ${response.statusText}`);
    }
    return true;
  });
}