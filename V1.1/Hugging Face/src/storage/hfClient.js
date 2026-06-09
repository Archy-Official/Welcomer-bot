import { uploadFile, downloadFile } from '@huggingface/hub';
import { execFile } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { retry } from '../utils/retry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUCKET_REPO = {
  type: 'bucket',
  name: process.env.HF_BUCKET_NAME,
};

const HF_TOKEN = process.env.HF_TOKEN;

function verifyEnv() {
  if (!HF_TOKEN || !process.env.HF_BUCKET_NAME) {
    throw new Error('Missing required env vars: HF_TOKEN or HF_BUCKET_NAME');
  }
}

/**
 * Resolves a bucket file URL, handling HF's redirect to a signed S3 location.
 * The Authorization header must not be forwarded to S3 — hence manual redirect handling.
 */
async function resolveAndFetch(filePath) {
  const bucketName = process.env.HF_BUCKET_NAME;
  const url = `https://huggingface.co/buckets/${bucketName}/resolve/${filePath}`;

  let resp = await fetch(url, {
    headers: { Authorization: `Bearer ${HF_TOKEN}` },
    redirect: 'manual',
  });

  if (resp.status === 302 || resp.status === 307) {
    const s3Url = resp.headers.get('location');
    if (s3Url) resp = await fetch(s3Url);
  }

  return resp;
}

export async function writeJSON(filePath, data) {
  verifyEnv();
  return retry(() =>
    uploadFile({
      repo: BUCKET_REPO,
      accessToken: HF_TOKEN,
      file: {
        path: filePath,
        content: new Blob([JSON.stringify(data)], { type: 'application/json' }),
      },
    })
  );
}

export async function readJSON(filePath) {
  verifyEnv();

  // Try the SDK path first — it handles auth and retries internally
  try {
    const resp = await downloadFile({ repo: BUCKET_REPO, path: filePath, accessToken: HF_TOKEN });
    if (resp?.ok)          return resp.json();
    if (resp?.status === 404) return null;
  } catch {
    // Fall through to direct URL strategy below
  }

  // Direct fetch with manual redirect isolation (avoids leaking auth headers to S3)
  const resp = await resolveAndFetch(filePath);
  if (resp.ok)           return resp.json();
  if (resp.status === 404) return null;

  const text = await resp.text().catch(() => '');
  throw new Error(`Bucket read failed (${resp.status}): ${text}`);
}

export async function writeBinary(filePath, buffer, mimeType = 'image/png') {
  verifyEnv();
  return retry(() =>
    uploadFile({
      repo: BUCKET_REPO,
      accessToken: HF_TOKEN,
      file: {
        path: filePath,
        content: new Blob([buffer], { type: mimeType }),
      },
    })
  );
}

export async function readBinary(filePath) {
  verifyEnv();

  try {
    const resp = await downloadFile({ repo: BUCKET_REPO, path: filePath, accessToken: HF_TOKEN });
    if (resp?.ok) return Buffer.from(await resp.arrayBuffer());
  } catch {
    // Fall through to direct URL strategy below
  }

  const resp = await resolveAndFetch(filePath);
  if (resp.ok)           return Buffer.from(await resp.arrayBuffer());
  if (resp.status === 404) return null;

  throw new Error(`Bucket binary read failed (${resp.status})`);
}

/**
 * Deletes a file from the bucket via a small Python helper script.
 * The huggingface_hub batch delete API isn't available in the Node SDK,
 * so we shell out to python3 which has the full SDK installed on Alpine.
 */
export async function deleteBucketFile(targetPath) {
  verifyEnv();

  if (!targetPath) throw new Error('[hfClient] targetPath is required');

  return retry(() =>
    new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'delete_helper.py');

      execFile('python3', [scriptPath, targetPath], { env: process.env }, (err, stdout, stderr) => {
        if (err) {
          console.error('[hfClient] Python bridge error:', stderr || err.message);
          return reject(new Error(`Python process failed: ${stderr || err.message}`));
        }

        const output = stdout.trim();
        if (output.startsWith('ERROR:')) {
          console.error('[hfClient] SDK rejection:', output);
          return reject(new Error(`HF SDK delete failed: ${output}`));
        }

        console.log('[hfClient]', output);
        resolve(true);
      });
    })
  );
}