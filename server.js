// server/server.js

// 1) .env должен грузиться до всего
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

/* ============ Основные настройки ============ */

// На PaaS (включая Amvera) порт передаётся через env.
// Локально используем 5174 для удобства dev-сценария.
const PORT = Number(process.env.PORT) || 5174

// Если стоим за прокси/ингр.stdin — доверяем заголовкам X-Forwarded-*
app.set('trust proxy', 1)

/* ============ Middleware ============ */

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
)

const ORIGIN_WHITELIST = (process.env.ORIGIN_WHITELIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Разрешаем preflight и креды для whitelisted источников
const corsOptions =
  ORIGIN_WHITELIST.length > 0
    ? {
        origin(origin, cb) {
          // Разрешаем без Origin (health-чеки, curl и т.п.)
          if (!origin) return cb(null, true)
          if (ORIGIN_WHITELIST.includes(origin)) return cb(null, true)
          return cb(new Error(`CORS blocked for origin: ${origin}`))
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        optionsSuccessStatus: 204,
      }
    : undefined

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

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

// ПИНГ email (опционально)
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

/* ============ Глобальный обработчик ошибок (JSON) ============ */
app.use((err, _req, res, _next) => {
  console.error('API ERROR:', err?.stack || err)
  const code = err.status || 500
  res.status(code).json({ ok: false, error: err.message || 'Server error' })
})

/* ============ Статически фронт НЕ раздаём ============ */

/* ============ Start server ============ */
const start = async () => {
  try {
    await connectDB()
    initTelegram(app)

    if (!process.env.ADMIN_PASSWORD) {
      console.warn('⚠️  ADMIN_PASSWORD не задан — /api/admin/login может не работать')
    }

    app.listen(PORT, '0.0.0.0', () =>
      console.log(`✅ Server started on 0.0.0.0:${PORT}`)
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
