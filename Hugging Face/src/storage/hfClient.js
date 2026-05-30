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

    // FIXED: Formatted the file configuration using an object wrapper containing path and content
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
 * Reads JSON data from the Hugging Face Storage Bucket
 */
export async function readJSON(path) {
  if (!HF_TOKEN || !process.env.HF_BUCKET_NAME) {
    throw new Error('Missing required environment variables: HF_TOKEN or HF_BUCKET_NAME');
  }

  return retry(async () => {
    const response = await downloadFile({
      repo: BUCKET_REPO,
      path: path,
      accessToken: HF_TOKEN
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to read from bucket: ${response.statusText}`);
    }

    return await response.json();
  });
}
