// server/utils/db.js
import mongoose from 'mongoose'

export async function connectDB() {
  // теперь читаем и MONGO_URI, и MONGODB_URI (чтобы оба работали)
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) {
    throw new Error('MONGO_URI is not set')
  }

  // В dev режиме включаем mongoose debug (показывает запросы)
  if (process.env.NODE_ENV !== 'production') {
    mongoose.set('debug', true)
  }

  const opts = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    family: 4, // на Windows помогает
    heartbeatFrequencyMS: 10000,
  }

  try {
    await mongoose.connect(uri, opts)
    console.log('✅ MongoDB connected:', maskMongoUri(uri))
  } catch (err) {
    console.error('❌ MongoDB connection failed.')
    console.error('   • Проверь Network Access (IP whitelist) в MongoDB Atlas — добавь свой текущий IP или 0.0.0.0/0 для dev')
    console.error('   • Убедись, что используешь SRV-строку вида:')
    console.error('     mongodb+srv://<user>:<pass>@<cluster>/toursite?retryWrites=true&w=majority&appName=YourTravel')
    console.error('   • Проверь логин/пароль пользователя БД и права на базу')
    console.error('   • Если Windows: попробуй family:4 (уже включено) и выключи VPN/Proxy')
    throw err
  }
}

function maskMongoUri(uri) {
  try {
    const u = new URL(uri.replace('mongodb+srv://', 'http://'))
    if (u.password) {
      return uri.replace(u.password, '***')
    }
    return uri
  } catch {
    return uri
  }
}
