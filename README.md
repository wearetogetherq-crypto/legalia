# Legalia — сайт Алины Калинич

Легализация в Польше: карта побыту, CUKR, карта резидента, сталый побыт, гражданство, мельдунок. Радом, Мазовецкое воеводство.

Статичный сайт: `index.html` + `alina.jpg`, без сборки. Заявки из формы уходят в Telegram [@alinuccia3](https://t.me/alinuccia3).

## Домен

Сайт работает на **https://legalia-radom.pl**. Домен куплен в OVHcloud 30.09.2026 и оплачен до 30.09.2027; автопродление включено в кабинете OVH.

- **DNS в OVH (зона legalia-radom.pl):**
  - четыре A-записи GitHub (185.199.108–111.153);
  - четыре AAAA-записи (2606:50c0:8000–8003::153);
  - `www` → CNAME `wearetogetherq-crypto.github.io.`
- **Почты на домене нет.** Защита от подделки писем: SPF `v=spf1 -all` и `_dmarc` с `p=reject`.
- **GitHub:** Settings → Pages → Custom domain = `legalia-radom.pl` (файл `CNAME`), включён Enforce HTTPS.
- **Домен подтверждён в GitHub:** Settings → Pages → Verified domains. TXT-запись `_github-pages-challenge-wearetogetherq-crypto` не удаляйте.
- **Редиректы:** старый адрес `wearetogetherq-crypto.github.io/legalia/` и `www` перенаправляют на основной домен.

## Отзывы

Как это работает:

1. Клиент заполняет на сайте форму «Залишити відгук» и нажимает «Надіслати». Отзыв сразу уходит в хранилище: это Google Apps Script `reviews-backend.gs` на аккаунте wearetogetherq@gmail.com, проект «Legalia — відгуки».
2. Бот Legalia присылает Алине отзыв в Telegram с кнопками «✅ Опублікувати» и «❌ Відхилити».
3. После нажатия «Опублікувати» отзыв в течение минуты появляется на сайте у всех. Средняя оценка пересчитывается сама.
4. Под опубликованным отзывом в боте появляется кнопка «🗑 Прибрати з сайту», ею отзыв можно снять.
5. Пока отзыв на проверке, автор видит его на сайте с пометкой «на перевірці». Её видит только он сам.

Все отзывы хранятся в Google-таблице «Legalia — відгуки». Колонка `status` принимает значения `pending`, `approved`, `rejected` или `removed`, и её можно менять вручную.

Если хранилище недоступно, сайт предложит клиенту отправить отзыв Алине через Telegram.

Отзывы можно добавлять и вручную, через файл `reviews.json`. На GitHub откройте файл, нажмите ✏️, затем Commit changes. Пример записи:

```json
[
  { "name": "Олена К.", "city": "Радом", "service": "cukr", "rating": 5, "date": "2026-10", "text": "Текст отзыва." }
]
```

Коды услуг: `work`, `jdg`, `spolka`, `study`, `family`, `cukr`, `rez`, `roots`, `kp`, `spouse`, `cit`, `najem`, `meld`, `consult`.

Ссылка, которая сразу открывает форму отзыва (удобно отправлять клиенту после услуги): `…/legalia/#vidguk`.

### Если нужно переустановить хранилище

1. Создайте проект на script.google.com и вставьте код из `reviews-backend.gs`.
2. В Project Settings → Script properties добавьте `TG_TOKEN`, токен бота.
3. Запустите `setup()`.
4. Опубликуйте проект: Deploy → Web app, «Execute as: Me», «Who has access: Anyone».
5. Адрес `/exec` пропишите в `REVIEWS_API` в `index.html`.
