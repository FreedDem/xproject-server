import { Router } from 'express'
import Tour from '../models/Tour.js'
import { requireAdmin } from '../utils/auth.js'
import { s3 } from '../utils/s3.js'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'

const router = Router()

/* ================= S3 helpers (Yandex Object Storage) ================= */
const ENDPOINT = 'https://storage.yandexcloud.net'
const BUCKET =
  process.env.YC_BUCKET_NAME ||
  process.env.AWS_BUCKET_NAME ||
  ''

// База для публичных URL (любой из вариантов, что у вас используется на фронте/сервере)
const PUBLIC_BASE =
  process.env.S3_PUBLIC_BASE ||
  process.env.VITE_S3_PUBLIC_BASE ||
  process.env.VITE_S3_URL ||
  process.env.REACT_APP_S3_URL ||
  (BUCKET ? `${ENDPOINT}/${BUCKET}` : '')

function toS3Url(key) {
  if (!key) return ''
  if (/^https?:\/\//i.test(key)) return key
  if (!PUBLIC_BASE) return key
  return `${String(PUBLIC_BASE).replace(/\/$/, '')}/${String(key).replace(/^\//, '')}`
}

function toS3Key(urlOrKey) {
  if (!urlOrKey) return ''
  const s = String(urlOrKey)
  if (!/^https?:\/\//i.test(s)) return s.replace(/^\/+/, '')
  try {
    const u = new URL(s)
    const host = u.host || ''
    const parts = u.pathname.split('/').filter(Boolean)
    if (!parts.length) return ''
    // Варианты Yandex Object Storage:
    // 1) https://<bucket>.storage.yandexcloud.net/key
    // 2) https://storage.yandexcloud.net/<bucket>/key
    if (host === 'storage.yandexcloud.net') {
      if (parts[0] === BUCKET) return parts.slice(1).join('/')
      return parts.join('/')
    }
    if (host.endsWith('.storage.yandexcloud.net')) {
      // left-most label — bucket
      return parts.join('/')
    }
    // Прочие CDN/домен — просто путь
    return parts.join('/')
  } catch {
    return s
  }
}

/* ================== Common helpers (slug/normalize) ================== */
function slugify(str = '') {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
  }
  const s = String(str).toLowerCase()
    .replace(/[а-яё]/g, ch => map[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
  return s || 'tour'
}

async function uniqueSlug(base, excludeId = null) {
  let candidate = slugify(base)
  let n = 1
  while (true) {
    const q = { slug: candidate }
    if (excludeId) q._id = { $ne: excludeId }
    const exists = await Tour.exists(q)
    if (!exists) return candidate
    n += 1
    candidate = `${slugify(base)}-${n}`
  }
}

function toArray(val) {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String).map(s => s.trim()).filter(Boolean)
  return String(val).split(',').map(s => s.trim()).filter(Boolean)
}
function toNumber(val, def = 0) {
  const n = Number(val)
  return Number.isFinite(n) ? n : def
}

/** Программа по дням — теперь с фото */
function normalizeItinerary(val) {
  if (!val) return []
  if (Array.isArray(val)) {
    return val.map((x, i) => ({
      day: toNumber(x.day, i + 1),
      title: (x.title || `День ${i + 1}`).toString(),
      details: (x.details || '').toString(),
      photos: Array.isArray(x.photos)
        ? x.photos.map(toS3Key).filter(Boolean).slice(0, 3)
        : [],
    }))
  }
  const lines = String(val).split('\n').map(s => s.trim()).filter(Boolean)
  return lines.map((line, idx) => ({
    day: idx + 1,
    title: line || `День ${idx + 1}`,
    details: '',
    photos: [],
  }))
}

/** Слоты дат */
function normalizeDateSlots(val) {
  if (!val) return []
  const arr = Array.isArray(val) ? val : []
  const norm = arr
    .map(x => {
      const start = (x?.start || '').toString().trim()
      const end = (x?.end || '').toString().trim()
      const seatsAvailable =
        (x?.seatsAvailable == null || x?.seatsAvailable === '')
          ? 0
          : (Number(x?.seatsAvailable) || 0)
      return start && end ? { start, end, seatsAvailable } : null
    })
  .filter(Boolean)
  norm.sort((a, b) => String(a.start).localeCompare(String(b.start)))
  return norm
}

/** Нормализация payload для всех полей тура */
function normalizePayload(body = {}) {
  const b = { ...body }

  b.title = (b.title || '').toString().trim()
  b.slug = (b.slug || '').toString().trim()
  b.summary = (b.summary || '').toString()
  b.description = (b.description || '').toString()
  b.language = (b.language || '').toString().trim() || 'Русский'
  b.status = 'published'

  b.durationDays = toNumber(b.durationDays)
  b.priceFromRUB = toNumber(b.priceFromRUB)

  b.categories = toArray(b.categories)
  b.location = toArray(b.location)
  b.includes = toArray(b.includes)
  b.excludes = toArray(b.excludes)

  const heroIn = toArray(b.heroImages)
  const galleryIn = toArray(b.gallery)
  b.heroImages = Array.from(new Set(heroIn.map(toS3Key).filter(Boolean)))
  b.gallery = Array.from(new Set(galleryIn.map(toS3Key).filter(Boolean)))

  // новые поля
  b.accommodationText = (b.accommodationText || '').toString()
  b.accommodationImages = toArray(b.accommodationImages).map(toS3Key).slice(0, 10)
  b.mapImage = b.mapImage ? toS3Key(b.mapImage) : ''
  b.paymentTerms = (b.paymentTerms || '').toString()
  b.cancellationPolicy = (b.cancellationPolicy || '').toString()
  b.importantInfo = (b.importantInfo || '').toString()
  b.faq = (b.faq || '').toString()

  b.itinerary = normalizeItinerary(b.itinerary)
  b.dateSlots = normalizeDateSlots(b.dateSlots)

  return b
}

const parseIntSafe = (v, d) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n > 0 ? n : d
}
const parseExpandList = (v) =>
  String(v || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)

/* ========================= LIST (public) ========================= */
router.get('/', async (req, res) => {
  try {
    const { q = '', page = '1', limit = '24', expand = '' } = req.query

    const where = {}
    if (q) {
      where.$or = [
        { title: { $regex: q, $options: 'i' } },
        { summary: { $regex: q, $options: 'i' } },
        { categories: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } },
      ]
    }
    // показываем только опубликованные
    where.$or = where.$or
      ? [...where.$or, { status: { $in: [null, undefined, 'published'] } }]
      : [{ status: { $in: [null, undefined, 'published'] } }]

    const pageNum = Math.max(1, parseIntSafe(page, 1))
    const lim = Math.min(100, Math.max(1, parseIntSafe(limit, 24)))
    const skip = (pageNum - 1) * lim
    const expandList = parseExpandList(expand)
    const needUrls = expandList.includes('urls')

    const [list, total] = await Promise.all([
      Tour.find(where).sort({ createdAt: -1 }).skip(skip).limit(lim).lean(),
      Tour.countDocuments(where),
    ])

    const items = (list || []).map(t => {
      if (!needUrls) return t
      return {
        ...t,
        heroImages: (t.heroImages || []).map(toS3Url),
        gallery: (t.gallery || []).map(toS3Url),
        accommodationImages: (t.accommodationImages || []).map(toS3Url),
        mapImage: toS3Url(t.mapImage),
        itinerary: (t.itinerary || []).map(d => ({
          ...d,
          photos: (d.photos || []).map(toS3Url),
        })),
      }
    })

    res.json({
      items,
      page: pageNum,
      limit: lim,
      total,
      pages: Math.ceil(total / lim),
    })
  } catch (e) {
    console.error('GET /api/tours failed:', e?.message || e)
    res.status(500).json({ ok: false, error: 'Failed to load tours' })
  }
})

/* ========================= READ (public) ========================= */
router.get('/:id', async (req, res) => {
  try {
    const expandList = parseExpandList(req.query.expand)
    const needUrls = expandList.includes('urls')

    const t = await Tour.findById(req.params.id).lean()
    if (!t) return res.status(404).json({ error: 'Not found' })

    if (t.status && t.status === 'draft' && !req.user?.isAdmin) {
      return res.status(404).json({ error: 'Not found' })
    }

    if (!needUrls) return res.json(t)

    res.json({
      ...t,
      heroImages: (t.heroImages || []).map(toS3Url),
      gallery: (t.gallery || []).map(toS3Url),
      accommodationImages: (t.accommodationImages || []).map(toS3Url),
      mapImage: toS3Url(t.mapImage),
      itinerary: (t.itinerary || []).map(d => ({
        ...d,
        photos: (d.photos || []).map(toS3Url),
      })),
    })
  } catch (e) {
    console.error(`GET /api/tours/${req.params.id} failed:`, e?.message || e)
    res.status(500).json({ ok: false, error: 'Failed to load tour' })
  }
})

/* ========================= CREATE (admin) ========================= */
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = normalizePayload(req.body || {})
    if (!body.title) return res.status(400).json({ error: 'title is required' })
    body.slug = await uniqueSlug(body.slug || body.title)
    const created = await Tour.create(body)
    res.json(created)
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'slug already exists' })
    }
    res.status(400).json({ error: e.message })
  }
})

/* ========================= UPDATE (admin) ========================= */
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const patch = normalizePayload(req.body || {})
    patch.status = 'published'

    if (!patch.slug && patch.title) {
      patch.slug = await uniqueSlug(patch.title, req.params.id)
    } else if (patch.slug) {
      patch.slug = await uniqueSlug(patch.slug, req.params.id)
    }

    const updated = await Tour.findByIdAndUpdate(
      req.params.id,
      patch,
      { new: true, runValidators: true }
    )
    if (!updated) return res.status(404).json({ error: 'Not found' })
    res.json(updated)
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: 'slug already exists' })
    }
    res.status(400).json({ error: e.message })
  }
})

/* ========================= DELETE (admin) ========================= */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const tour = await Tour.findById(req.params.id)
    if (!tour) return res.status(404).json({ error: 'Not found' })

    const allKeys = [
      ...(tour.heroImages || []),
      ...(tour.gallery || []),
      ...(tour.accommodationImages || []),
      tour.mapImage || '',
      ...(tour.itinerary || []).flatMap(d => d.photos || []),
    ].map(toS3Key).filter(Boolean)

    if (allKeys.length && BUCKET) {
      try {
        await s3.send(new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: allKeys.map(Key => ({ Key })) },
        }))
        console.log(`🗑️ Deleted ${allKeys.length} images from S3 for tour ${tour._id}`)
      } catch (err) {
        console.error('⚠️ Error deleting S3 images:', err?.message || err)
      }
    }

    await Tour.findByIdAndDelete(tour._id)
    res.json({ ok: true })
  } catch (e) {
    console.error(`DELETE /api/tours/${req.params.id} failed:`, e?.message || e)
    res.status(500).json({ ok: false, error: 'Failed to delete tour' })
  }
})

/* ========================= BOOKINGS (public) ========================= */
/**
 * Принимает заявку на тур и отправляет её в Telegram всем подписчикам.
 * Тело запроса:
 * {
 *   tourId?: string,
 *   tourTitle?: string,
 *   dateRange?: string, // "01.12.2025 — 05.12.2025"
 *   name: string,
 *   phone: string,
 *   adults?: number,
 *   children?: number,
 *   comment?: string
 * }
 */
router.post('/bookings', async (req, res) => {
  try {
    const { tourId, tourTitle, dateRange, name, phone, adults, children, comment } = req.body || {}

    const errs = []
    if (!tourId && !tourTitle) errs.push('tourId или tourTitle обязателен')
    if (!name) errs.push('name обязателен')
    if (!phone) errs.push('phone обязателен')
    if (errs.length) return res.status(400).json({ ok: false, error: errs.join(', ') })

    const lines = [
      '🧳 <b>Новая заявка на тур</b>',
      tourTitle ? `• <b>Тур:</b> ${escapeHtml(tourTitle)}` : '',
      dateRange ? `• <b>Даты:</b> ${escapeHtml(dateRange)}` : '',
      `• <b>Имя:</b> ${escapeHtml(name)}`,
      `• <b>Телефон:</b> ${escapeHtml(String(phone))}`,
      (adults != null) ? `• <b>Взрослых:</b> ${Number(adults) || 0}` : '',
      (children != null) ? `• <b>Детей:</b> ${Number(children) || 0}` : '',
      comment ? `• <b>Комментарий:</b> ${escapeHtml(comment)}` : '',
      tourId ? `\nID тура: <code>${String(tourId)}</code>` : '',
    ].filter(Boolean)

    const text = lines.join('\n')

    // Рассылка через бота (функция кладётся в app.locals при инициализации Telegram)
    const ok = await req.app.locals.notifyAll?.(text)
    if (!ok) {
      // Бот недоступен — не валим UX клиента, просто сообщим предупреждение
      return res.json({ ok: true, warning: 'Telegram disabled/unavailable' })
    }

    res.json({ ok: true })
  } catch (e) {
    console.error('POST /api/tours/bookings error:', e?.message || e)
    res.status(500).json({ ok: false, error: 'Failed to submit booking' })
  }
})

// Мелкий util для защиты HTML в Telegram
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export default router
