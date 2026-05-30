import { uploadFile, downloadFile } from '@huggingface/hub';
import { retry } from '../utils/retry.js';

const HF_TOKEN = process.env.HF_TOKEN;
const HF_BUCKET_NAME = process.env.HF_BUCKET_NAME;

if (!HF_TOKEN || !HF_BUCKET_NAME) {
  throw new Error('Missing required environment variables: HF_TOKEN, HF_BUCKET_NAME');
}

const BUCKET_REPO = { type: 'bucket', name: HF_BUCKET_NAME };

export async function readJSON(path) {
  return retry(async () => {
    try {
      const res = await downloadFile({
        repo: BUCKET_REPO,
        path,
        accessToken: HF_TOKEN
      });

      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to download ${path}`);

      const text = await res.text();
      return JSON.parse(text);
    } catch (err) {
      if (err.status === 404 || err.statusCode === 404 || err.message?.includes('404')) {
        return null;
      }
      throw err;
    }
  });
}

export async function writeJSON(path, data) {
  return retry(async () => {
    // EFFICIENCY FIX: Removed 'null, 2' line indentation. Minifying the stringified
    // object cuts computing overhead, scales faster, and prevents wasting bucket space.
    const blob = new Blob([JSON.stringify(data)], {
      type: 'application/json'
    });

    await uploadFile({
      repo: BUCKET_REPO,
      path,
      file: blob,
      accessToken: HF_TOKEN
    });
  });
}
