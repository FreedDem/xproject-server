import { Router } from 'express'
import multer from 'multer'
import { signAdminToken, requireAdmin } from '../utils/auth.js'
import { makeKey, putObject } from '../utils/s3.js'
import sharp from 'sharp'
import heicConvert from 'heic-convert'
import mime from 'mime'

const router = Router()

router.get('/ping', (_req, res) => res.json({ ok: true }))

router.post('/login', (req, res) => {
  const { password } = req.body || {}
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on server' })
  }
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' })
  }
  const token = signAdminToken()
  res.json({ token })
})

// Multer — принимаем файлы в память
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // до 30 МБ
})

/* ========================= Helpers ========================= */
const isHeic = (file) => {
  const name = (file.originalname || '').toLowerCase()
  const mt = (file.mimetype || '').toLowerCase()
  return name.endsWith('.heic') || name.endsWith('.heif') || mt.includes('heic') || mt.includes('heif')
}

async function heicToJpegBuffer(inputBuffer) {
  const out = await heicConvert({
    buffer: inputBuffer,
    format: 'JPEG',
    quality: 90,
  })
  return Buffer.from(out)
}

async function compressToWebpMax(buffer, {
  maxBytes = 2 * 1024 * 1024,
  initialQuality = 85,
  minQuality = 60,
  maxWidth = 2560,
  minWidth = 1280,
} = {}) {
  let quality = initialQuality
  const meta = await sharp(buffer).metadata()
  let width = Math.min(meta.width || maxWidth, maxWidth)

  let out = await sharp(buffer)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 4 })
    .toBuffer()

  if (out.length <= maxBytes) return out

  for (let i = 0; i < 20; i += 1) {
    if (quality > minQuality) {
      quality = Math.max(minQuality, quality - 5)
    } else if (width > minWidth) {
      width = Math.max(minWidth, Math.round(width * 0.9))
    } else {
      break
    }
    out = await sharp(buffer)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer()
    if (out.length <= maxBytes) break
  }
  return out
}

/* === Upload with optional folder === */
router.post('/upload', requireAdmin, upload.array('files'), async (req, res) => {
  try {
    const files = req.files || []
    const folder = String(req.body.folder || 'tours').replace(/[^a-z0-9/_-]+/gi, '').replace(/^\/+|\/+$/g, '')

    if (!files.length) return res.json({ urls: [], keys: [] })

    const urls = []
    const keys = []

    for (const f of files) {
      try {
        // Проверяем тип
        if (!f.mimetype.startsWith('image/')) {
          console.warn('Skipped non-image file:', f.originalname)
          continue
        }

        // HEIC → JPEG
        let inputBuffer = f.buffer
        if (isHeic(f)) {
          inputBuffer = await heicToJpegBuffer(f.buffer)
        }

        // Сжатие и перевод в WebP
        const webpBuffer = await compressToWebpMax(inputBuffer)

        // Формируем ключ
        const keyBase = makeKey(f.originalname, folder || 'tours')
        const key = keyBase.replace(/\.[^.]+$/, '') + '.webp'

        const url = await putObject({
          buffer: webpBuffer,
          key,
          contentType: 'image/webp',
        })

        urls.push(url)
        keys.push(key)
      } catch (err) {
        console.error('Upload failed for file', f.originalname, err)
      }
    }

    if (!keys.length) {
      return res.status(500).json({ error: 'No files uploaded' })
    }

    res.json({ urls, keys })
  } catch (e) {
    console.error('S3 upload error:', e)
    res.status(500).json({ error: 'Upload failed' })
  }
})

export default router
