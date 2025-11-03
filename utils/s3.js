// server/utils/s3.js
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'node:crypto'
import path from 'node:path'
import mime from 'mime'

const { YC_ACCESS_KEY, YC_SECRET_KEY, YC_BUCKET_NAME } = process.env

if (!YC_BUCKET_NAME) {
  console.warn('⚠️  YC_BUCKET_NAME не задан — загрузки не будут работать')
}

const ENDPOINT = 'https://storage.yandexcloud.net'
const REGION = 'ru-central1'
const PUBLIC_BASE = `${ENDPOINT}/${YC_BUCKET_NAME}`

// Клиент S3 для Яндекс Облака
export const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: YC_ACCESS_KEY || '',
    secretAccessKey: YC_SECRET_KEY || '',
  },
})

export function makeKey(originalName, folder = 'tours') {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg'
  const id = crypto.randomUUID()
  const y = new Date().getFullYear()
  const m = String(new Date().getMonth() + 1).padStart(2, '0')
  return `${folder}/${y}/${m}/${id}${ext}`
}

export async function putObject({ buffer, key, contentType }) {
  const params = {
    Bucket: YC_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  }
  await s3.send(new PutObjectCommand(params))
  return `${PUBLIC_BASE}/${key}`
}

export async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: YC_BUCKET_NAME, Key: key }))
}
