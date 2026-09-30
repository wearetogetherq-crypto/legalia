/**
 * Legalia — відгуки з сайту (Google Apps Script).
 *
 * Як це працює:
 *  1. Сайт надсилає відгук (doPost) → він записується в таблицю «Legalia — відгуки» зі статусом pending
 *     і приходить Аліні від бота в Telegram з кнопками «✅ Опублікувати» / «❌ Відхилити».
 *  2. Кожну хвилину poll() забирає натискання кнопок у боті й змінює статус відгуку.
 *  3. Сайт показує лише схвалені відгуки (doGet).
 *
 * Налаштування (один раз):
 *  - Project Settings → Script properties → додати TG_TOKEN = токен бота від @BotFather;
 *  - запустити setup() і дозволити доступ;
 *  - Deploy → New deployment → Web app: Execute as «Me», Who has access «Anyone»;
 *  - Аліна відкриває посилання з журналу setup() і натискає Start — бот запам’ятовує її чат.
 */

const SHEET_NAME = "Відгуки";
const HEAD = ["id", "status", "date", "rating", "name", "city", "service", "text", "lang", "created"];
const COL = { id: 0, status: 1, date: 2, rating: 3, name: 4, city: 5, service: 6, text: 7 };
const SVC_UK = {
  work: "Карта побиту — за роботою", jdg: "Карта побиту — JDG", spolka: "Карта побиту — spółka",
  study: "Карта побиту — навчання", family: "Карта побиту — возз’єднання сім’ї", cukr: "Карта CUKR",
  rez: "Карта резидента ЄС", roots: "Сталий побит — за походженням", kp: "Сталий побит — за Картою поляка",
  spouse: "Сталий побит — з громадянином Польщі", cit: "Громадянство Польщі",
  najem: "Порука для найму оказіонального", meld: "Мельдунок", consult: "Консультація"
};
const ADMIN_USERNAME = "alinuccia3"; // схвалювати відгуки може лише цей акаунт Telegram
const P = PropertiesService.getScriptProperties();

/* ---------- налаштування ---------- */
function setup() {
  if (!P.getProperty("TG_TOKEN")) throw new Error("Спочатку додайте TG_TOKEN у Project Settings → Script properties");
  const me = tg_("getMe", {}, true);
  const sh = sheet_();
  if (!P.getProperty("ADMIN_CODE")) P.setProperty("ADMIN_CODE", Utilities.getUuid().replace(/-/g, "").slice(0, 16));
  tg_("deleteWebhook", {});
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("poll").timeBased().everyMinutes(1).create();
  console.log("Бот: @" + me.username);
  console.log("Таблиця з відгуками: " + sh.getParent().getUrl());
  console.log("Посилання для Аліни (відкрити й натиснути Start): https://t.me/" + me.username + "?start=" + P.getProperty("ADMIN_CODE"));
}

/** Скинути всіх, хто схвалює відгуки, і створити нове посилання для Аліни. */
function resetAdmins() {
  P.deleteProperty("ADMINS");
  P.setProperty("ADMIN_CODE", Utilities.getUuid().replace(/-/g, "").slice(0, 16));
  const me = tg_("getMe", {}, true);
  console.log("Нове посилання для Аліни (відкрити й натиснути Start): https://t.me/" + me.username + "?start=" + P.getProperty("ADMIN_CODE"));
}

/** Текст на заставці бота (до натискання Start). */
function botProfile() {
  tg_("setMyDescription", { description: "Службовий бот сайту Legalia — Аліна Калініч, Радом.\n\nСюди приходять відгуки клієнтів із сайту, щоб Аліна могла опублікувати їх одним натисканням.\n\nНаписати Аліні: @alinuccia3" }, true);
  tg_("setMyShortDescription", { short_description: "Відгуки клієнтів сайту Legalia · Аліна Калініч, Радом. Написати Аліні: @alinuccia3" }, true);
  console.log("Опис бота оновлено");
}

/* ---------- сайт: новий відгук ---------- */
function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    // спам-боти: заповнене приховане поле або форма заповнена швидше ніж за 4 секунди — тихо ігноруємо
    if (d.website || (d.t != null && Number(d.t) < 4000)) return json_({ ok: true });
    const r = {
      rating: Math.round(Number(d.rating)),
      name: clean_(d.name, 40), city: clean_(d.city, 40),
      service: SVC_UK[d.service] ? d.service : "",
      text: clean_(d.text, 1200),
      lang: /^(uk|ru|en)$/.test(d.lang) ? d.lang : ""
    };
    if (!(r.rating >= 1 && r.rating <= 5) || !r.name || r.text.length < 15) return json_({ ok: false, error: "invalid" });

    // одна людина — один відгук: такі самі ім’я + місто + послуга вже є (крім відхилених)
    const who = norm_(r.name) + "|" + norm_(r.city) + "|" + r.service;
    const same = sheet_().getDataRange().getValues().slice(1).some(x => x[COL.status] !== "rejected" &&
      norm_(unsafe_(x[COL.name])) + "|" + norm_(unsafe_(x[COL.city])) + "|" + String(x[COL.service]) === who);
    if (same) return json_({ ok: false, error: "already" });

    // не більше 30 відгуків на годину — захист від спаму
    const cache = CacheService.getScriptCache(), n = Number(cache.get("rate") || 0);
    if (n >= 30) return json_({ ok: false, error: "busy" });
    cache.put("rate", String(n + 1), 3600);
    // той самий текст повторно протягом доби не приймаємо (повторні натискання, спам)
    const dup = "dup_" + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, r.text.toLowerCase().replace(/\s+/g, " ")));
    if (cache.get(dup)) return json_({ ok: true });

    const id = Utilities.getUuid().slice(0, 8), now = new Date();
    r.date = Utilities.formatDate(now, "Europe/Warsaw", "yyyy-MM");
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      sheet_().appendRow([id, "pending", r.date, r.rating, r.name, r.city, r.service, r.text, r.lang, now].map(safe_));
    } finally { lock.releaseLock(); }
    cache.put(dup, "1", 86400);

    notify_(id, r);
    return json_({ ok: true, id: id });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server" });
  }
}

/* ---------- сайт: схвалені відгуки ---------- */
function doGet() {
  const cache = CacheService.getScriptCache();
  let out = cache.get("pub");
  if (!out) {
    const rows = sheet_().getDataRange().getValues().slice(1);
    const list = rows.filter(r => r[COL.status] === "approved").reverse().map(r => ({
      id: String(r[COL.id]), date: month_(r[COL.date]), rating: Number(r[COL.rating]),
      name: unsafe_(r[COL.name]), city: unsafe_(r[COL.city]), service: String(r[COL.service]), text: unsafe_(r[COL.text])
    }));
    out = JSON.stringify({ reviews: list });
    try { cache.put("pub", out, 300); } catch (_) {}
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- бот: кнопки та /start ---------- */
function poll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    const ups = tg_("getUpdates", { offset: Number(P.getProperty("OFFSET") || 0), timeout: 0,
      allowed_updates: JSON.stringify(["message", "callback_query"]) }) || [];
    ups.forEach(u => {
      P.setProperty("OFFSET", String(u.update_id + 1));
      try { handle_(u); } catch (err) { console.error(err); }
    });
  } finally { lock.releaseLock(); }
}

function handle_(u) {
  if (u.message && u.message.text) {
    const chat = String(u.message.chat.id), t = u.message.text.trim();
    const admins = admins_();
    const isAlina = String(u.message.from && u.message.from.username || "").toLowerCase() === ADMIN_USERNAME;
    if (t === "/start " + P.getProperty("ADMIN_CODE") && !isAlina) {
      tg_("sendMessage", { chat_id: chat, text: "Схвалювати відгуки може лише Аліна (@" + ADMIN_USERNAME + ")." });
    } else if (t === "/start " + P.getProperty("ADMIN_CODE")) {
      if (admins.indexOf(chat) < 0) { admins.push(chat); P.setProperty("ADMINS", JSON.stringify(admins)); }
      tg_("sendMessage", { chat_id: chat, text: "✅ Готово! Сюди приходитимуть нові відгуки з сайту Legalia.\n\nНатисніть «Опублікувати» — і відгук з’явиться на сайті протягом хвилини." });
      // відгуки, які вже чекають на рішення
      sheet_().getDataRange().getValues().slice(1).filter(r => r[COL.status] === "pending")
        .forEach(r => send_(chat, String(r[COL.id]), rowObj_(r)));
    } else if (admins.indexOf(chat) < 0) {
      tg_("sendMessage", { chat_id: chat, text: "Це службовий бот сайту Legalia. Написати Аліні: @alinuccia3" });
    }
    return;
  }
  const q = u.callback_query;
  if (!q || !q.message) return;
  const chat = String(q.message.chat.id);
  if (admins_().indexOf(chat) < 0) return;
  const parts = String(q.data || "").split(":");
  const status = { ok: "approved", no: "rejected", del: "removed" }[parts[0]];
  if (!status) return;
  const row = setStatus_(parts[1], status);
  tg_("answerCallbackQuery", { callback_query_id: q.id, text: row ? "Готово" : "Відгук не знайдено" });
  if (!row) return;
  CacheService.getScriptCache().remove("pub");
  const note = { approved: "✅ Опубліковано на сайті", rejected: "❌ Відхилено", removed: "🗑 Прибрано з сайту" }[status];
  const kb = status === "approved"
    ? [[{ text: "🗑 Прибрати з сайту", callback_data: "del:" + parts[1] }]]
    : [[{ text: "✅ Все ж опублікувати", callback_data: "ok:" + parts[1] }]];
  tg_("editMessageText", { chat_id: chat, message_id: q.message.message_id, parse_mode: "HTML",
    text: card_(row) + "\n\n<b>" + note + "</b>", reply_markup: JSON.stringify({ inline_keyboard: kb }) });
}

/* ---------- допоміжне ---------- */
function notify_(id, r) { admins_().forEach(chat => send_(chat, id, r)); }

function send_(chat, id, r) {
  tg_("sendMessage", { chat_id: chat, parse_mode: "HTML", text: card_(r) + "\n\nОпублікувати на сайті?",
    reply_markup: JSON.stringify({ inline_keyboard: [[
      { text: "✅ Опублікувати", callback_data: "ok:" + id },
      { text: "❌ Відхилити", callback_data: "no:" + id }]] }) });
}

function card_(r) {
  const n = Math.max(1, Math.min(5, Number(r.rating) || 0));
  return "⭐ <b>Відгук із сайту Legalia</b>\n\n" + "★".repeat(n) + "☆".repeat(5 - n) + " (" + n + "/5)\n" +
    "<b>" + esc_(r.name) + "</b>" + (r.city ? " · " + esc_(r.city) : "") + "\n" +
    (r.service ? "Послуга: " + esc_(SVC_UK[r.service] || r.service) + "\n" : "") +
    "\n«" + esc_(r.text) + "»";
}

function setStatus_(id, status) {
  if (!id) return null;
  const sh = sheet_(), rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][COL.id]) === id) {
      sh.getRange(i + 1, COL.status + 1).setValue(status);
      return rowObj_(rows[i]);
    }
  }
  return null;
}

function rowObj_(r) {
  return { rating: r[COL.rating], name: unsafe_(r[COL.name]), city: unsafe_(r[COL.city]), service: String(r[COL.service]), text: unsafe_(r[COL.text]) };
}

function sheet_() {
  const id = P.getProperty("SHEET_ID");
  if (id) return SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
  const ss = SpreadsheetApp.create("Legalia — відгуки");
  const sh = ss.getSheets()[0];
  sh.setName(SHEET_NAME);
  sh.getRange("A:I").setNumberFormat("@"); // усе як текст, щоб таблиця нічого не перетворювала на дати й формули
  sh.appendRow(HEAD);
  sh.setFrozenRows(1);
  sh.getRange("B2:B").setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(["pending", "approved", "rejected", "removed"], true).build());
  P.setProperty("SHEET_ID", ss.getId());
  return sh;
}

function admins_() { try { return JSON.parse(P.getProperty("ADMINS") || "[]"); } catch (_) { return []; } }

function tg_(method, params, strict) {
  // усі значення передаємо рядками: інакше великі числа (offset, message_id) доходять до Telegram у незрозумілому форматі
  const payload = {};
  Object.keys(params).forEach(k => { const v = params[k]; payload[k] = typeof v === "object" ? JSON.stringify(v) : String(v); });
  const res = UrlFetchApp.fetch("https://api.telegram.org/bot" + P.getProperty("TG_TOKEN") + "/" + method,
    { method: "post", payload: payload, muteHttpExceptions: true });
  const j = JSON.parse(res.getContentText() || "{}");
  if (!j.ok) {
    console.warn(method + ": " + (j.description || res.getResponseCode()));
    if (strict) throw new Error("Telegram: " + (j.description || "помилка") + " — перевірте TG_TOKEN");
    return null;
  }
  return j.result;
}

function clean_(v, max) { return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, max); }
function safe_(v) { return typeof v === "string" && /^[=+\-@]/.test(v) ? "\u200B" + v : v; } // не даємо тексту стати формулою
function norm_(v) { return String(v || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); } // «Олена К.» = «олена к»
function unsafe_(v) { return String(v).replace(/^\u200B/, ""); }
function esc_(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function month_(v) { return v instanceof Date ? Utilities.formatDate(v, "Europe/Warsaw", "yyyy-MM") : String(v); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function checkBot() {
  const admins = admins_();
  console.log("Схвалюють відгуки: " + admins.length);
  admins.forEach(id => { const c = tg_("getChat", { chat_id: id }); console.log(" - @" + (c && c.username) + " " + (c && c.first_name)); });
  const wh = tg_("getWebhookInfo", {});
  console.log("Черга оновлень: " + (wh && wh.pending_update_count) + (wh && wh.last_error_message ? ", помилка: " + wh.last_error_message : ""));
}
