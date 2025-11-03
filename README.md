# Server

## ENV
- `PORT` — по умолчанию 5174
- `MONGODB_URI` или `MONGO_URI` — строка подключения (пример: mongodb://localhost:27017/toursite)
- `ADMIN_PASSWORD` — пароль для заголовка `x-admin-key`

## Маршруты
- GET `/api/tours` — список
- GET `/api/tours/:id` — детали
- POST `/api/tours` — создание (нужен `x-admin-key`)
- PUT `/api/tours/:id` — обновление (нужен `x-admin-key`)
- DELETE `/api/tours/:id` — удаление (нужен `x-admin-key`)
