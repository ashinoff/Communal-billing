# Communal Billing — GitHub Pages (HTML + JS, CSV in repo)

Простая страница, которую можно разместить на **GitHub Pages** (`https://USERNAME.github.io/REPO/`).  
Все данные хранятся в CSV-файлах внутри репозитория (`/data/*.csv`).  
Чтение/запись идут через **GitHub Contents API**. Никаких внешних сервисов.

> ⚠️ Для записи нужен **Personal Access Token (classic)**. Пользователь вводит токен в интерфейсе.  
> Токен хранится только в браузере (localStorage) и отправляется **только** на api.github.com.

## Шаги запуска
1. Создайте репозиторий `REPO` и включите **GitHub Pages** (Settings → Pages → Deploy from branch → `main` → `/root`).
2. Скопируйте файлы из этого архива в корень репозитория.
3. В разделе **data/** лежат стартовые CSV (можно оставить пустыми).
4. Откройте страницу `https://USERNAME.github.io/REPO/`.
5. В форме настроек вверху укажите:
   - Owner: ваш логин (например, `ashinoff`)
   - Repo: название репозитория
   - Branch: `main`
   - Data dir: `data`
   - Personal Access Token (classic) с правами `repo` (или `public_repo` для публичного)
6. Нажмите **Save**. Теперь можно добавлять квартиры, услуги, тарифы, счётчики, вводить показания и формировать расчёты.

## Структура CSV
- `data/apartments.csv` — `id,name,notes`
- `data/services.csv` — `id,code,name,unit`
- `data/tariffs.csv` — `id,service_id,price,start_date,end_date`
- `data/meters.csv` — `id,apartment_id,service_id,serial,is_shared`
- `data/readings.csv` — `id,meter_id,period,value`
- `data/adjustments.csv` — `id,apartment_id,period,amount,comment`

## Безопасность
- Токен вводится вручную и хранится только в вашем браузере (localStorage), **не коммитится** в репозиторий.
- Для приватного репозитория нужен scope `repo`. Для публичного — достаточно `public_repo`.
- Для дополнительной безопасности используйте **fine-grained** токен, ограниченный на один репозиторий и только на `contents:read/write`.

---

MIT License