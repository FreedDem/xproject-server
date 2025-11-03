import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * ВАЖНО: chatId храним как STRING.
 * Telegram chatId у каналов/супергрупп выглядит как -1001234567890 и может превышать безопасный диапазон Number.
 * Строка исключает потери точности и проблему со знаками.
 */
const TelegramSubscriberSchema = new Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true },

    // Тип чата: private | group | supergroup | channel
    chatType: { type: String, enum: ['private', 'group', 'supergroup', 'channel'], default: 'private' },

    // Для private-чатов — данные пользователя
    username: String,
    firstName: String,
    lastName: String,

    // Для групп/каналов — заголовок
    title: String,

    // Подписка активна?
    isActive: { type: Boolean, default: true },

    // Когда пользователь/чат впервые подписался
    dateSubscribed: { type: Date, default: Date.now },

    // Последняя активность (получено любое сообщение/команда)
    lastMessageAt: Date,

    // Последняя ошибка доставки
    lastError: {
      code: Number,
      message: String,
      at: Date,
    },

    // Произвольные данные (например, источник подписки, UTM и пр.)
    meta: Schema.Types.Mixed,
  },
  { timestamps: true }
);

/** Индексы для частых выборок */
TelegramSubscriberSchema.index({ isActive: 1, updatedAt: -1 });
TelegramSubscriberSchema.index({ chatType: 1, isActive: 1 });

/** Нормализация chatId к строке */
TelegramSubscriberSchema.pre('save', function (next) {
  if (typeof this.chatId !== 'string') {
    this.chatId = String(this.chatId);
  }
  next();
});

/** Хелпер: отметить активность */
TelegramSubscriberSchema.methods.touchActivity = async function () {
  this.lastMessageAt = new Date();
  return this.save();
};

/** Статик: зафиксировать ошибку отправки; деактивировать при 400/403 */
TelegramSubscriberSchema.statics.recordSendError = async function (chatId, err) {
  const code = err?.response?.error_code ?? err?.code;
  const doc = await this.findOne({ chatId: String(chatId) });
  if (!doc) return;

  doc.lastError = {
    code: typeof code === 'number' ? code : undefined,
    message: err?.response?.description || err?.message || String(err),
    at: new Date(),
  };

  if (code === 400 || code === 403) {
    doc.isActive = false;
  }
  await doc.save();
};

/** Статик: безопасная (ре)активация подписчика */
TelegramSubscriberSchema.statics.activate = async function (chatId, payload = {}) {
  const update = {
    $set: {
      isActive: true,
      lastError: undefined,
      ...payload,
    },
    $setOnInsert: { dateSubscribed: new Date() },
  };
  await this.updateOne({ chatId: String(chatId) }, update, { upsert: true });
};

export default mongoose.models.TelegramSubscriber
  || mongoose.model('TelegramSubscriber', TelegramSubscriberSchema);
