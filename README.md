<p align="center"><img src="./assets/leostryx-banner.svg" alt="Leostryx — Russian build of Antigravity for Android" width="100%" /></p>

<p align="center">
  <a href="https://github.com/Leostrange/Leostryx/releases/latest"><img src="https://img.shields.io/badge/Release-v3.1.14-0b84ff?style=flat-square" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Android-8.0+-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Android" />
  <img src="https://img.shields.io/badge/ARM64-v8.0--A+-111827?style=flat-square" alt="ARM64" />
  <img src="https://img.shields.io/badge/Русская-локализация-0033A0?style=flat-square" alt="Русская локализация" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache_2.0-0b84ff?style=flat-square" alt="License" /></a>
</p>

<p align="center"><b>Leostryx для Android — русская сборка среды разработки с ИИ-агентом Antigravity (v3.1.14).</b><br/>
Полная русификация, поддержка любых ИИ-провайдеров (OpenAI, Claude, DeepSeek, Gemini), авто-сжатие контекста длинных диалогов, щит безопасности агента, каталог субагентов, интерактивные уведомления в шторке с прямым ответом, встроенный видеоплеер, оптимизация памяти, кастомизация маскотов (Волк, Медведь, Рысь, Сова) и Flutter SDK.</p>

<p align="center"><sub>Форк <a href="https://github.com/werdio325-png/antigravity-android">werdio325-png/antigravity-android</a> · Сборка <a href="https://github.com/Leostrange">@Leostrange</a></sub></p>

<p align="center">
  <a href="#-скачать-сборки-v3114"><b>📥 Скачать APK</b></a> &nbsp;·&nbsp;
  <a href="#-интерфейс-и-скриншоты">📱 Скриншоты</a> &nbsp;·&nbsp;
  <a href="#-ключевые-возможности">✨ Возможности</a> &nbsp;·&nbsp;
  <a href="#-установка">⚙️ Установка</a> &nbsp;·&nbsp;
  <a href="#-сборка-из-исходников">🛠 Сборка</a> &nbsp;·&nbsp;
  <a href="CHANGELOG.md">📜 Changelog</a> &nbsp;·&nbsp;
  <a href="https://t.me/+qji9jQ68cWRmZDky">💬 Telegram</a>
</p>

> [!NOTE]
> **3.1.14 — актуальный стабильный релиз.** Готовые подписанные APK `Leostryx-3.1.14-standard.apk` и `Leostryx-3.1.14-bypass.apk` собраны и проверены, контрольные суммы зафиксированы в [`SHA256SUMS-3.1.14.txt`](https://github.com/Leostrange/Leostryx/releases/download/v3.1.14/SHA256SUMS-3.1.14.txt).

---

## 📱 Интерфейс и скриншоты

<p align="center">
  <img src="./assets/screenshots/home.jpg" width="31%" alt="Главный экран Leostryx" />
  <img src="./assets/screenshots/models.jpg" width="31%" alt="Выбор моделей и провайдеров" />
  <img src="./assets/screenshots/dark-theme.jpg" width="31%" alt="Тёмная тема и чат" />
</p>
<p align="center">
  <img src="./assets/screenshots/shield.jpg" width="31%" alt="Щит безопасности" />
  <img src="./assets/screenshots/dictation.jpg" width="31%" alt="Голосовой ввод и диктовка" />
  <img src="./assets/screenshots/light-theme.jpg" width="31%" alt="Светлая тема оформления" />
</p>

---

## 💡 О проекте

- **Antigravity** — автономный агентный движок разработки, который работает **нативно в userspace Android** (Linux kernel 6.1+, ARM64, Bionic) прямо внутри процесса приложения — без PRoot, QEMU и тяжелых виртуальных машин. Агент самостоятельно исследует кодовую базу, редактирует файлы, запускает компиляцию и тестирует результат прямо на телефоне.
- **Leostryx** — независимая расширенная сборка этого окружения. Включает авторскую русификацию, расширенную работу с внешними ИИ-провайдерами, глубокую интеграцию с системными компонентами Android и развитые инструменты разработчика.

---

## ✨ Ключевые возможности

### 🇷🇺 Локализация и ИИ-провайдеры
- **Полная русская локализация:** безупречный перевод интерфейса, контекстных меню, статусов действий агента, мыслительного процесса, системных диалогов и раздела бэкапов.
- **Поддержка любых ИИ-моделей:** быстрое переключение между Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq, Ollama и произвольными совместимыми эндпоинтами.
- **Голосовой ввод и диктовка:** офлайн-распознавание речи через модели Vosk без отправки аудио на сторонние серверы.

### 🤖 Субагенты и автономность
- **Каталог субагентов:** вкладка в кастомизации с готовыми специализированными агентами (Code Reviewer, Android Debugger, Security Auditor, Docs Architect, Test Engineer).
- **Вызов в чате:** быстрое делегирование задач через `@` и меню действий.
- **Автономный режим (EAGER):** работа агента без лишних подтверждений для непрерывного решения сложных задач.
- **Фоновый демон `agy-daemon`:** легковесный планировщик (<10 МБ RAM) с wake-lock службой — задачи выполняются даже при заблокированном экране.

### 🛡 Щит безопасности и контроль
- **Гранулярные профили доступа:** гибкое управление доступом к файловой системе, интернету, песочнице и браузерному JavaScript.
- **Защита терминала:** прозрачный контроль над выполнением консольных команд с опцией ручного подтверждения.

### 🎨 Кастомизация и дизайн
- **4 авторских маскота:** геометрические логотипы **Волк** (`03_lsx`), **Медведь** (`04_angular_x`), **Рысь** (`02_lynx`), **Сова** (`01_owl`).
- **Смена иконки на лету:** переключение значка приложения на рабочем столе Android без переустановки APK (через `activity-alias`).
- **Стиль и динамический акцент:** плавная адаптация акцентного цвета, темы матового стекла (Frosted Glass), адаптивный полноэкранный сплэш и экраны перезапуска ядра.

### 📱 Нативная интеграция с Android
- **Интерактивные уведомления:** чат-уведомления в системной шторке Android с полем прямого ответа (`RemoteInput`) и кнопками подтверждения («Разрешить / Продолжить»).
- **Кликабельные пути:** открытие каталогов в системном проводнике (DocumentsUI) и мгновенная установка APK по тапу в чате.
- **Мобильный видеоплеер:** воспроизведение локальных видео без задержек, перемотка жестами двойного тапа (±5 секунд) и поддержка любых медиа-вложений.
- **Повышенные привилегии:** интеграция с Shizuku (`rish`) для выполнения системных операций уровня ADB shell.

### 🛠 Инструменты разработчика (Developer Tools)
- **Консоль и диагностика:** встроенная консоль выполнения команд, фильтр реальных ошибок и быстрый съем логов `logcat`.
- **Flutter SDK в 1 клик:** автоматическая установка и bionic-патчинг тулчейна Flutter/Dart (`agy-fix-flutter`).
- **Мультиверсионный Gradle & AGP:** одновременная поддержка Gradle 8.x/9.x и AGP 8.7.3/9.0.0/9.1.1 с переключением без повторного скачивания.
- **Протоколы MCP и UTCP:** поддержка серверов Model Context Protocol (StitchMCP, sequential-thinking, exa, github-mcp-server) и спецификаций OpenAPI 3.0 / UTCP.

---

## 📥 Скачать сборки (v3.1.14)

| Вариант | Назначение | Пакет | SHA-256 контрольная сумма |
|---|---|---|---|
| **Standard** | Базовая сборка без изменений ядра | [`Leostryx-3.1.14-standard.apk`](https://github.com/Leostrange/Leostryx/releases/tag/v3.1.14) | `1ec76f3eaab7d0bc350c349370166004b0d5f54beca2d306bd34400d29e9de85` |
| **Bypass** | С обходом региональных ограничений Gemini | [`Leostryx-3.1.14-bypass.apk`](https://github.com/Leostrange/Leostryx/releases/tag/v3.1.14) | `257586c588f9cf572bfd666be910103108655a6d2848683ad88bbdaba716f100` |

> [!TIP]
> **Чем отличается Bypass?**
> В варианте **Bypass** модифицировано ядро `liblanguage_server.so`: в проверках геолокации выставлен принудительный пропуск региональных ограничений Google Gemini. Если вы используете сторонние модели (OpenAI, DeepSeek, Claude) или находитесь в поддерживаемом регионе, выбирайте **Standard**.

---

## ⚙️ Установка

> [!WARNING]
> **Обновление поверх старых версий:** Сборки ветки 3.x (`com.agyru.t2`) обновляются поверх предыдущих версий 3.x штатно без потери данных. Если у вас была установлена устаревшая сборка 2.x, потребуется чистая переустановка из-за несовместимости ключей подписи.

1. Скачайте нужный APK из [релиза v3.1.14](https://github.com/Leostrange/Leostryx/releases/tag/v3.1.14).
2. Сверьте контрольную сумму через SHA-256:
   ```bash
   sha256sum Leostryx-3.1.14-*.apk
   ```
3. Установите APK на устройство и запустите приложение.

---

## 🛠 Сборка из исходников

Для сборки требуются Python 3 и Java (OpenJDK 17):

```bash
# Собрать оба варианта (Standard и Bypass):
python3 rebuild.py both

# Собрать конкретный вариант:
python3 rebuild.py standard
python3 rebuild.py bypass
```

Готовые и подписанные APK создаются в каталоге `dist/signed/`.

<details>
<summary><b>📂 Структура репозитория и проверка артефактов</b></summary>

```text
├── README.md, CHANGELOG.md, LICENSE
├── assets/
│   ├── leostryx-banner.svg              # Векторный баннер проекта
│   └── screenshots/                     # Скриншоты интерфейса
├── app/                                 # Полное дерево пакета приложения
│   ├── AndroidManifest.xml, classes*.dex, res/
│   └── assets/
│       ├── web/                         # Веб-интерфейс, скрипты и стили
│       │   ├── agy_ru.js, agy_i18n.js   # Русификация и i18n
│       │   ├── agy_paths.js             # Кликабельные пути и действия
│       │   ├── agy_loading.js           # Полноэкранный сплэш ядра
│       │   ├── brand/                   # Векторные наборы маскотов
│       ├── runtime/                     # Go-ядро (liblanguage_server.so)
│       └── env/                         # Userspace оверлей Linux
├── variants/bypass/                     # Дельта bypass-ядра и манифеста
├── docs/                                # Технические руководства
│   ├── gradle-agp-toolchain.md          # Руководство по Gradle & AGP
│   ├── flutter-toolchain.md             # Руководство по Flutter SDK
│   ├── jadx-fixes.md                    # Инструкции по jadx-agy
│   └── archive/                         # Архив отчетов сессий
├── tools/                               # Скрипты и утилиты сборки
└── rebuild.py                           # Основной скрипт сборки релизов
```

Хеши ядра внутри каждого APK можно проверить командами:
```bash
sha256sum dist/signed/standard.apk dist/signed/bypass.apk
unzip -p dist/signed/standard.apk assets/runtime/bin/liblanguage_server.so | sha256sum
unzip -p dist/signed/bypass.apk   assets/runtime/bin/liblanguage_server.so | sha256sum
```
</details>

---

## 📜 Что нового в 3.1.13

- **Восстановление просмотра файлов в чате (`agy_paths.js`):** устранена блокировка открытия кода, markdown, логов и скриптов в чате — просмотрщик IDE работает беспрепятственно, а модальное окно действий открывается только для `.apk`.
- **Локализация контекстного меню проектов (`agy_i18n.js`):** переведены пункты «Копировать название проекта», «Удалить проект» и диалог подтверждения удаления с правильными падежами диалогов.
- **Подписи завершения задач (`agy_fun_notify.js`):** локализованы alt-тексты и подписи поздравительных GIF-анимаций.
- **Релизная синхронизация:** актуализация версий `3.1.13` (код 39) в манифесте, веб-интерфейсе и сборщике.

👉 **Полная история всех изменений и предыдущих релизов доступна в [CHANGELOG.md](CHANGELOG.md)**.

---

<details>
<summary><b>🇺🇸 English version / Read in English</b></summary>

<!-- EN -->
# Leostryx for Android (v3.1.13)

**Leostryx** is an advanced Russian build of the **Antigravity** autonomous AI developer environment running natively on Android (Linux 6.1+, ARM64, Bionic userspace) without PRoot or containers.

### Key Highlights
- **Full Russian UI Localization:** seamless Russian interface, context menus, pluralization, and backup manager.
- **Multi-Provider AI Engine:** native support for Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq, Ollama, and custom endpoints.
- **Subagents Hub:** pre-configured subagents (Code Reviewer, Android Debugger, Security Auditor) with in-chat invocation.
- **Security Shield:** fine-grained permissions for filesystem, internet, sandboxing, and terminal command execution.
- **Branding & Customization:** 4 geometric mascot packs (Wolf, Bear, Lynx, Owl), live launcher icon switching via `activity-alias`, and dynamic accent colors.
- **Deep Android Integration:** interactive notifications with `RemoteInput` direct reply, DocumentsUI integration, clickable file paths, and Shizuku `rish` support.
- **Built-in Toolchains:** Flutter SDK with automatic Bionic patching (`agy-fix-flutter`), multi-version Gradle & AGP toolchains, and MCP/UTCP support.

### Download Releases (v3.1.13)
- **Standard Edition:** [`Leostryx-3.1.13-standard.apk`](https://github.com/Leostrange/Leostryx/releases/tag/v3.1.13) — `176e5c5ac37a8461661811a95a5337d3129a21bb9b3f18351677840b148aef5a`
- **Bypass Edition:** [`Leostryx-3.1.13-bypass.apk`](https://github.com/Leostrange/Leostryx/releases/tag/v3.1.13) — `9363cf980aaf88adb07b54512cbf4776e5977e72af6060eb0ffb1e597a5d6193`

Full changelog is available in [CHANGELOG.md](CHANGELOG.md).
<!-- /EN -->
</details>

---

## 📄 Лицензия

Исходный код проекта распространяется по лицензии [Apache 2.0](LICENSE). Antigravity, Gemini и сторонние компоненты принадлежат соответствующим авторам и распространяются по их собственным лицензиям.

Оригинальный проект: [werdio325-png/antigravity-android](https://github.com/werdio325-png/antigravity-android).

<p align="center"><sub>Разработано с заботой о сообществе · <a href="https://github.com/Leostrange">Leostrange</a></sub></p>
