// server/server.js

// Загружаем .env ДО любых других импортов
import 'dotenv/config'

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'path'
import { fileURLToPath } from 'url'

import { connectDB } from './utils/db.js'
import toursRouter from './routes/tours.js'
import adminRouter from './routes/admin.js'
import { initTelegram } from './telegram/boot.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// ✅ Для Amvera слушаем именно порт 80
const PORT = 80

/* ============ Middleware ============ */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
)

// CORS — whitelist через ORIGIN_WHITELIST (через запятую)
const ORIGIN_WHITELIST = (process.env.ORIGIN_WHITELIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

app.use(
  cors(
    ORIGIN_WHITELIST.length
      ? {
          origin: ORIGIN_WHITELIST,
          credentials: true,
        }
      : undefined
  )
)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))

/* ============ Healthcheck ============ */
app.get('/api/health', (_req, res) => res.json({ ok: true }))

/* ============ Static uploads ============ */
app.use('/uploads', express.static(path.join(__dirname, 'uploads')))

/* ============ API routes ============ */
app.use('/api/admin', adminRouter)
app.use('/api/tours', toursRouter)

/* ============ Вспомогательные тест-маршруты ============ */

app.get('/api/ping-telegram', async (_req, res) => {
  try {
    if (!app.locals.notifyAll) {
      console.warn('ping-telegram: notifyAll не инициализирован')
      return res
        .status(500)
        .json({ ok: false, error: 'notifyAll не инициализирован' })
    }
    const result = await app.locals.notifyAll('✅ Тестовое сообщение от сервера')
    if (result && typeof result === 'object') {
      console.log(
        'ping-telegram: отправлено=%s, ошибок=%s',
        result.total,
        result.failed
      )
    }
    res.json({ ok: true })
  } catch (e) {
    console.error('ping-telegram error:', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || 'TG error' })
  }
})

// ПИНГ email (опциональный util)
let sendMailFn = null
try {
  const mailMod = await import('./utils/mail.js')
  sendMailFn = mailMod.sendMail || mailMod.default || null
} catch {}
app.get('/api/ping-mail', async (_req, res) => {
  try {
    if (typeof sendMailFn !== 'function') {
      return res.status(501).json({ ok: false, error: 'sendMail не настроен' })
    }
    const ok = await sendMailFn({
      subject: '✅ Тестовое письмо',
      html: '<p>Это тест с вашего сервера.</p>',
    })
    res.json({ ok: !!ok })
  } catch (e) {
    console.error('ping-mail error:', e?.message || e)
    res.status(500).json({ ok: false, error: e?.message || 'Mail error' })
  }
})

/* ============ API 404 ============ */
app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'API route not found' })
})

/* ============ НЕ раздаём фронт ============ */

/* ============ Start server ============ */
const start = async () => {
  try {
    await connectDB()
    initTelegram(app)

    if (!process.env.ADMIN_PASSWORD) {
      console.warn('⚠️  ADMIN_PASSWORD не задан — /api/admin/login может не работать')
    }

    app.listen(PORT, '0.0.0.0', () =>
      console.log(`✅ Server started on http://0.0.0.0:${PORT}`)
    )
  } catch (e) {
    console.error('Failed to start server:', e)
    process.exit(1)
  }
}

/* Глобальные ловушки для логов */
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err)
})

start()
