// models/Tour.js
import mongoose from 'mongoose'

// --- Программа по дням ---
const ItinerarySchema = new mongoose.Schema({
  day: { type: Number, required: true },
  title: { type: String, required: true },
  details: { type: String, default: '' }, // HTML или текст
  photos: { type: [String], default: [] }, // до 3 изображений
}, { _id: false })

// --- Слоты дат/мест (только свободные места) ---
const DateSlotSchema = new mongoose.Schema({
  start: { type: String, required: true }, // YYYY-MM-DD
  end:   { type: String, required: true }, // YYYY-MM-DD
  seatsAvailable: { type: Number, default: 0, min: 0 },
}, { _id: false })

// --- Жильё и дополнительные блоки ---
const TourSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, index: true, unique: true, sparse: true },

  // базовые параметры
  durationDays: { type: Number, default: 0 },
  priceFromRUB: { type: Number, default: 0 },
  activity: { type: String, default: '' },
  ageRange: { type: String, default: '' },
  comfort: { type: String, default: '' },
  language: { type: String, default: 'Русский' },

  // публикация
  status: { type: String, enum: ['published', 'draft'], default: 'published' },

  categories: { type: [String], default: [] },
  location: { type: [String], default: [] },

  // медиа
  heroImages: { type: [String], default: [] },
  gallery: { type: [String], default: [] },

  // описание
  summary: { type: String, default: '' },
  description: { type: String, default: '' },

  // программа
  itinerary: { type: [ItinerarySchema], default: [] },

  // включено/не включено
  includes: { type: [String], default: [] },
  excludes: { type: [String], default: [] },

  // даты и места
  dateSlots: { type: [DateSlotSchema], default: [] },

  // --- новые блоки ---
  accommodationText: { type: String, default: '' },         // где живём (текст)
  accommodationImages: { type: [String], default: [] },     // до 10 изображений
  mapImage: { type: String, default: '' },                  // карта путешествия (одно изображение)
  paymentTerms: { type: String, default: '' },              // условия оплаты
  cancellationPolicy: { type: String, default: '' },        // условия отмены
  importantInfo: { type: String, default: '' },             // важно знать
  faq: { type: String, default: '' },                       // часто задаваемые вопросы
}, { timestamps: true })

export default mongoose.model('Tour', TourSchema)
