# Веб-интерфейс Antigravity: `web/`

> Одностраничное приложение (SPA на базе React), выполняемое в изолированном Android WebView и взаимодействующее с локальным Go/C++ ядром (`language_server`) через loopback HTTPS и нативный Java-мост (`AndroidBridge`).

---

## 1. Архитектурный обзор (Architecture Overview)

Веб-слой Antigravity представляет собой специализированный UI-фронтенд, упакованный в ассеты приложения и оптимизированный для работы на сенсорных экранах Android (ARM64). Вместо загрузки через классическую схему `file:///android_asset/` (блокирующую современные возможности браузера и работу ConnectRPC), интерфейс монтируется в `WebView` через `loadDataWithBaseURL` на доверенный origin loopback-сервера `https://127.0.0.1:<port>/`.

### Архитектурная диаграмма взаимодействий

```mermaid
sequenceDiagram
    autonumber
    participant Host as Android (Activity/AppLoader)
    participant Injector as AppHtmlInjector
    participant WV as WebView (Chromium)
    participant AssetServer as LocalAssetServer
    participant Core as Core Engine (language_server)
    participant Bridge as AndroidBridge (Java)

    Host->>Injector: inject(index.html, bridge, theme)
    Note over Injector: Внедряет CSP, __APP_CONFIG__, __AG_ENDPOINTS__,<br/>__AG_CSRF__, __AG_NATIVE_BRIDGE_TOKEN__ и startup_ready.js
    Injector-->>Host: Patched HTML
    Host->>WV: loadDataWithBaseURL("https://127.0.0.1:port/", HTML, ...)

    critical Загрузка ассетов и скриптов
        WV->>AssetServer: GET /generated/patches/web_optimizations.js
        AssetServer-->>WV: 200 OK (локальный файл из files/web/)
        WV->>AssetServer: GET /generated/main.js
        AssetServer-->>WV: 200 OK (локальный 9.5MB бандл)
    end

    Note over WV: Выполнение скриптов boot, patches и main.js
    
    opt Вызовы RPC / Ядро
        WV->>Core: POST /exa.language_server_pb.LanguageServerService/...
        Note over WV,Core: Fetch-rewrite перенаправляет вызовы на CoreBase<br/>с заголовком x-codeium-csrf-token
        Core-->>WV: ConnectRPC / SSE Stream Response
    end

    opt Готовность UI и синхронизация темы
        WV->>Bridge: onUiReady(token)
        Bridge->>Host: dismissSplash() (Скрытие сплэш-скрина)
        WV->>Bridge: setThemeByUser(theme)
        Bridge->>Host: Обновление цвета статус-бара и шторки
    end
```

---

## 2. Структура файлов и каталогов

```
web/
├── build.sh                      # Баш-оркестратор сборщика фрагментов и патчера
├── src.manifest                  # Декларативный манифест сборки web/generated/**
├── patch_main.py                 # Патчер upstream main.js (Desktop Mode + монохромное Eza)
├── index.html                    # Корневой HTML-шаблон хоста приложения
├── main.js                       # Исходный (upstream) обфусцированный бандл React UI (~9.9 МБ)
├── jetbox.css                    # Стили специфичных контролов и терминала
├── compiled_tailwind.css         # Базовый скомпилированный бандл Tailwind CSS
├── prism_bundle.js               # Бандл подсветки синтаксиса PrismJS (defer)
├── diff_worker.js                # Web Worker для фонового вычисления строковых диффов
├── audio_processor.js            # AudioWorkletProcessor для потокового аудио 16 kHz
├── antigravity-icon.png          # Иконка приложения
├── google_signin.svg             # Векторный ассет кнопки входа
├── symbols-icons/                # Локальный кэш иконок Material Symbols
├── workers/                      # Модули интеграции с PDF.js
│   ├── pdf.min.mjs               # Библиотека PDF.js core
│   ├── pdf.worker.mjs            # Воркер парсинга PDF
│   └── pdfjs_loader.mjs          # Мост между Closure compiler и ESM PDF.js
├── generated/                    # Каталог артефактов сборки (генерируется build.sh)
│   ├── main.js                   # Пропатченный рабочий бандл приложения
│   ├── bridge.core.js            # Ядро моста, полифиллы и рерайтер fetch
│   ├── boot/                     # Скрипты ранней инициализации (<head>)
│   │   ├── custom-elements-guard.js
│   │   └── theme-bootstrap.js
│   └── patches/                  # Мобильные патчи и адаптеры
│       ├── web_optimizations.js
│       ├── touch_model_menu.js
│       ├── theme_sync.js
│       └── startup_ready.js
├── src/                          # Модульные исходники фрагментов бандлов
│   ├── boot/                     # Фрагменты раннего старта
│   ├── core/                     # Фрагменты ядра моста (namespace, csrf, fetch, ...)
│   └── patches/                  # Фрагменты функциональных патчей
└── tests/
    └── selftest.sh               # Тест сборки и проверки целостности исходников
```

---

## 3. Конвейер сборки бандлов (Bundling Pipeline)

Сборка веб-слоя выполняется утилитой [`build.sh`](build.sh) на основе манифеста [`src.manifest`](src.manifest). Пайплайн спроектирован так, чтобы гарантировать **неизменность апстримного файла `main.js`**: все изменения вносятся исключительно в копию в `web/generated/main.js`.

### Синтаксис `src.manifest`
- `bundle iife <path>` — объявляет бандл с оборачиванием в изолированную IIFE `(function(){ ... })();`. Если исходные фрагменты бандла уже имеют собственное замыкание верхнего уровня, `build.sh` автоматически пропускает повторную обертку, предотвращая появление вложенных `(function(){(function(){...})()})();`.
- `bundle <path>` — объявляет бандл с прямой конкатенацией без замыкания.
- `src/<path>` — добавляет фрагмент кода в текущий открытый бандл.
- Строки `#` и `;` считаются комментариями.

### Генерируемые бандлы

| Бандл (`web/generated/...`) | Режим | Размер | Назначение |
|---|---|---|---|
| **`boot/custom-elements-guard.js`** | IIFE | ~514 B | Предотвращает краш при повторной регистрации Custom Elements в overlay-бандлах. |
| **`boot/theme-bootstrap.js`** | IIFE | ~1.3 KB | Мгновенно применяет `light`/`dark` до первого рендера, предотвращая мигание экрана. |
| **`bridge.core.js`** | IIFE | ~12 KB | Полифилл `window.process`, конфигурация, CSRF, discovery эндпоинтов и перехватчик `fetch`. |
| **`patches/web_optimizations.js`** | IIFE | ~2.2 KB | Ликвидация 300мс задержки тапа, фиксация высоты `--agy-vvh` при открытии IME, GPU-композитинг. |
| **`patches/touch_model_menu.js`** | IIFE | ~6.7 KB | Адаптация hover-меню выбора моделей Base UI под сенсорный ввод. |
| **`patches/theme_sync.js`** | IIFE | ~4.7 KB | MutationObserver за классами `<html>`/`<body>` и передача смены темы в нативный Android. |
| **`patches/startup_ready.js`** | IIFE | ~4.7 KB | Детектор первого полезного рендера DOM и перехватчик JS-ошибок для `AndroidBridge`. |
| **`main.js`** | Raw + Patch | ~9.5 MB | Рабочий бандл React UI, пропатченный скриптами `patch_main.py` и [`tools/patch_main_any_files.py`](../../tools/patch_main_any_files.py). |

### Проверка валидности (Verification)
После сборки `build.sh` запускает статический синтаксический анализатор V8 (`node --check`) для каждого сгенерированного файла. Если Node.js не установлен в окружении, проверка пропускается с информационным предупреждением.

---

## 4. Патчинг основного бандла (`patch_main.py`)

Скрипт [`patch_main.py`](patch_main.py) выполняет динамическую модификацию скомпилированного и обфусцированного бандла `main.js`:

1. **Идемпотентность**: Перед патчингом проверяется наличие маркеров `"Desktop Mode"` или `"ag_desktop_mode"`. Если они присутствуют, повторное применение пропускается.
2. **Внедрение Desktop Mode Toggle**:
   - Находится сигнатура хуков компонента Appearance:
     ```python
     hook_pattern = re.compile(r'(var\s+[A-Za-z0-9_$]+=[A-Za-z0-9_$]+!==3,\s*[A-Za-z0-9_$]+=[A-Za-z0-9_$]+!==2,\s*[A-Za-z0-9_$]+=[A-Za-z0-9_$]+=>\s*[A-Za-z0-9_$]+=>\{.*?\};)')
     ```
   - Внедряются React-хуки `useState` и `useCallback`, связывающие состояние с `window.Android.isDesktopMode()` и `localStorage.getItem('ag_desktop_mode')`.
   - Находится вызов `createElement` для секции `{label:"Theme"}` и сразу за ним инжектируется элемент настройки Desktop Mode с переключателем (`Switch`).
3. **Монохроматизация логотипа Eza**:
   - Upstream-логотип Antigravity содержит жестко зашитый многоцветный SVG (`mask0_6153_71`).
   - Патчер заменяет тело компонента `var Eza=...` на монохромный плоский SVG, использующий CSS-токены `text-[#9AA0A6]` (тёмная тема) и `text-[#5F6368]` (светлая тема).

### Патчер вложений любых типов (`tools/patch_main_any_files.py`)

Отдельный идемпотентный патчер, снимающий ограничение композера «только изображения, PDF, офисные документы, zip, текст, аудио, видео».

| Что делает | Где в `main.js` | Сигнатура |
|---|---|---|
| **A. Добавляет `agyMimeForName()`** — таблица на ~120 расширений → MIME | перед `var u5a=` | `function agyMimeForName(a){…}` |
| **B. Снимает фильтр `dragover`** | `m5a`, обработчик `r` | `some(w=>w.kind==="file")` вместо проверки `CB(...) \|\| image/ \|\| …` |
| **B. Снимает фильтр `drop`** | `m5a`, обработчик `t` | `!y.has(C.name)&&B.items.add(C)` вместо `…&&CB(C.name,C.type)&&…` |
| **C. Заменяет терминальный `else e?.("Unsupported file format")`** | `u5a`, конец цепочки валидации | общая ветка: `ArrayBuffer` → `I.MediaSchema` с `inlineData`, определение типа по расширению и первым 64 КБ |
| **D. Поднимает лимит текста 1 МБ → 10 МБ** | `u5a`, ветка `vNa` | `Text file size exceeds 10MB limit` |

Почему правится сам бандл, а не sidecar-патч из `patches/`: валидатор `u5a` — переменная модульного замыкания, снаружи (`window`) её не достать. Все sidecar-патчи работают только с глобальными объектами.

Проверка после применения: `node --check app/assets/web/generated/main.js` и отсутствие строки `Unsupported file format`.

---

## 5. Взаимодействие с нативным Android (`AndroidBridge`)

Веб-приложение выполняется в WebView, где объект `Android` (а также псевдоним `window.AndroidBridge`) зарегистрирован через `addJavascriptInterface`.

### Инъекции во время загрузки (`AppHtmlInjector`)
Перед передачей разметки в движок WebView, Java-класс `AppHtmlInjector` внедряет в `<head>`:
- **Strict Content Security Policy (CSP)**: запрет небезопасных внешних фреймов и объектов, ограничение `worker-src 'self' blob:`.
- **Глобальные параметры конфигурации**:
  - `window.__APP_CONFIG__` — JSON-параметры среды (версия, платформа, пути к воркспейсу).
  - `window.__AG_ENDPOINTS__` — адрес core-сервера (`core`, `core_http`, `enginePort`).
  - `window.__AG_CSRF__` — криптографический CSRF-токен для авторизации в `language_server`.
  - `window.__AG_HOST_THEME__` / `window.__AG_RESOLVED_THEME__` — начальная тема хоста (`dark` / `light` / `system`).
  - `window.__AG_NATIVE_BRIDGE_TOKEN__` — криптографический 32-байтный одноразовый токен для авторизации привилегированных вызовов (сброс сплэша, сохранение блобов).
- **Скрипт сигнала готовности**: `<script src="./generated/patches/startup_ready.js"></script>`.

### Интерфейсы моста `window.Android`

| Метод | Сигнатура | Назначение |
|---|---|---|
| `onUiReady` | `(token: string) => void` | Вызывается скриптом `startup_ready.js` при первом реальном рендере DOM для скрытия нативного сплэш-экрана. |
| `onUiError` | `(token: string, message: string) => void` | Передает критические фатальные ошибки JS в нативный логкат и экран ошибки. |
| `setThemeByUser`| `(theme: string) => boolean` | Передает выбранную пользователем тему (`light`/`dark`) для обновления цвета системных баров Android. |
| `onVisualThemeChanged` | `(theme: string) => void` | Сигнализирует о смене активного CSS-оформления. |
| `getTheme` | `() => string` | Возвращает текущую системную тему устройства. |
| `isDesktopMode` | `() => boolean` | Проверяет, включен ли режим широкого десктопного Viewport. |
| `setDesktopMode`| `(enabled: boolean) => void` | Динамически переключает User-Agent и Viewport WebView между мобильным и десктопным режимами. |
| `openDirectoryPicker` | `() => void` | Запускает системный диалог выбора папки (SAF Document Tree) для открытия проекта. |
| `saveBlob` | `(token, base64, filename, mime) => void` | Безопасное сохранение сгенерированных веб-интерфейсом блобов в хранилище `Downloads`. |

---

## 6. Подсистемы веб-слоя

### 6.1. Подсистема тем (Theme Engine)
1. **Ранняя стадия (`theme-bootstrap.js`)**: Выполняется синхронно в `<head>`. Читает `?hostTheme=` или `__AG_HOST_THEME__`. Моментально ставит класс `dark`/`light` на `document.documentElement` и задает `style.colorScheme`. Исключает белый блик при запуске в тёмной теме.
2. **Синхронизация во время работы (`theme_sync.js`)**: 
   - `MutationObserver` слушает изменения атрибута `class` на `<html>` и `<body>`.
   - Слушатель `window.addEventListener('storage')` отслеживает смену темы во вкладках.
   - Слушатель `matchMedia('(prefers-color-scheme: dark)')` реагирует на системное расписание день/ночь.
   - Метод `notify()` обновляет нативные шторки и панели Android.

### 6.2. Мобильные оптимизации (Mobile & Touch Optimizations)
- **`web_optimizations.js`**:
  - `touch-action: manipulation` на кнопках, ссылках и инпутах отключает браузерную 300-миллисекундную задержку двойного тапа.
  - `visualViewport.addEventListener('resize')` динамически пересчитывает переменную `--agy-vvh` в пикселях, предотвращая дергание поля чата при выезде клавиатуры IME.
  - Выборочный `transform: translateZ(0)` форсирует GPU-слои только для ключевых контейнеров скролла (`chat-container`, `.scrollable`), предотвращая исчерпание видеопамяти и зависания RenderThread на чипах ARM Mali.
- **`touch_model_menu.js`**:
  - Выпадающий список выбора моделей Antigravity в библиотеке Base UI открывает меню уровней размышления (Low / Medium / High) исключительно по hover-событию мыши.
  - На сенсорном экране тап приводил к мгновенному выбору модели по умолчанию без раскрытия настроек.
  - Патч перехватывает `pointerdown`/`click` в capture-фазе, блокирует событие и симулирует синтетическую цепочку событий указателя (`pointerover`, `pointerenter`, `pointermove`), после чего посылает `KeyboardEvent('ArrowRight')` с задержками 70мс и 260мс, гарантируя открытие мобильного подменю.

### 6.3. Мост ядра и транспорт (Core Transport & Fetch Rewrite)
- **`bridge.core.js`**:
  - Создает стаб `window.process` (Linux / ARM64 / renderer) со стандартными методами `cwd()` и `nextTick()`.
  - Переопределяет `window.fetch`. Все запросы к ConnectRPC-маркерам (`exa.language_server_pb.`, `exa.host_bridge_pb.`, `/exa.`) переписываются на целевой origin ядра `https://127.0.0.1:<enginePort>`.
  - Автоматически инжектирует CSRF-заголовок `x-codeium-csrf-token` и параметр `csrf_token`.
  - Содержит логику ретрая `fetchWithStartupRetry` (до 30 попыток с шагом 120мс), что предотвращает сбои первого запроса, если фронтенд стартовал раньше, чем TLS-сокет ядра завершил биндинг.

### 6.4. Воркеры и аудиопроцессинг
- **PDF Pipeline (`workers/`)**: изолированная работа с документами в воркере `pdf.worker.mjs` без блокировки главного потока UI.
- **Diff Calculation (`diff_worker.js`)**: вычисление статистики изменений строк (алгоритм Майерса $O(ND)$ с отсечением совпадающих префиксов и суффиксов) вынесено в Web Worker.
- **Voice / Audio Processor (`audio_processor.js`)**: зарегистрирован как `AudioWorkletProcessor` с именем `audio-streaming-processor`. Осуществляет потоковый даунсемплинг аудиопотока микрофона до 16 кГц PCM (`Int16Array`) для отправки в мультимодальные модели.

### 6.5. Оверлей настроек AGY (Settings Overlay)
Оверлейные скрипты `agy_*.js` / `agy_tools.sh` не входят в бандлы `generated/`, они инжектируются нативным слоем поверх UI настроек:
- **`agy_tools.sh`** — бэкенд «Настройки → Инструменты» (запускается только нативным мостом `AgyTools`). Содержит операции `status/install/remove/upgrade/npm/sdk/ndk/policy/verify/repairbt/selfheal/setlang/gradle/agp`. `status` дополнительно сообщает `@@sdkhome shared|internal <path>` (где установлен SDK; shared-хранилище смонтировано noexec), `@@stub <build-tools/N/tool> foreign-shebang` (битые заглушки с shebang чужой песочницы) и `@@broken <name> dangling|foreign-shebang|missing-interpreter|env-shebang` от `scan_broken`; операция `repairbt` перепривязывает `aidl/aapt/aapt2/zipalign/d8/apksigner` в build-tools на рабочие бинарники из `$PREFIX/bin`. Операции `gradle`/`gradleremove` переключают версию Gradle (дистрибутивы в `$HOME/gradle-dist`, симлинк `$PREFIX/bin/gradle`, статус `@@gradle-active`), операция `agp` записывает выбранную версию AGP в `AGENTS.md` (статус `@@agp-active`).
  - `verify` проверяет инструмент **реальной операцией**, а не `--version`: `ffmpeg` кодирует один кадр, `magick` рисует 16×16, `tesseract` перечисляет языковые модели, `numpy` импортируется. `verify all` собирает список проверок из того, что реально установлено, — перечислять вручную не нужно.
  - `verify jvm` идёт **по каждой установленной JDK** (у каждой свой union-стор) и требует `anchors>0` **и** `default>0` — второе число означает «столько корней видит JVM без флагов».
  - `selfheal` идемпотентно восстанавливает профиль окружения, мосты `runtime/bin`, симлинк `gradle`, пару `agy-agp.state` ↔ `# AGY-AGP:` и статические блоки правил в `AGENTS.md`; повторный запуск печатает `fixed=0`.
  - `setlang <ru|en>` пишет выбор в `$HOME/.agy_lang`; его читают `L(ru, en)` здесь и `agy-notify`, поэтому уведомления в шторке совпадают по языку с интерфейсом.
  - Все сетевые операции (`pkg update`, `pkg install`, `npm install`, загрузка SDK/NDK) обёрнуты в `pkg_retry` (до 3 попыток с бэкоффом) и используют curl с `--retry-all-errors`: без этого обрывы соединения (curl error 35 «Recv failure: Connection reset by peer», частые в мобильных/VPN-сетях) приводили к сбоям установки с 3–4 попыток.
  - Загрузка NDK (~1 ГБ) докачивается с `-C -` с фолбэком на полную перезагрузку.
- **`AgyTruststore.java`** — helper рядом с `agy_tools.sh` (резолвится относительно каталога скрипта, компилируется в `$PREFIX/etc/antigravity/truststore/`). Режимы: `union <out.jks> <type>:<pass>:<path>...` собирает объединение CA-бандлов с дедупликацией по SHA-256 и пишет **JKS с пустым паролем**; `check <spec>` / `defcheck` считают корни в произвольном хранилище и в дефолтном (код возврата 3 при нуле); `https` делает HEAD-пробу Maven Central (код 4 при сбое). Нужен, потому что `cacerts` из Termux-OpenJDK — PKCS12 под паролем `changeit`, а дефолтная JVM открывает его пустым паролем и получает **0** корней: форкнутые ядром JVM (Gradle daemon, `sdkmanager`, Maven, `jadx`) падают с `the trustAnchors parameter must be non-empty`. Подробности — `docs/gradle-agp-toolchain.md` §1.1.
- **`agy_providers.js`** — страница «Провайдеры» (Claude/OpenAI/Gemini-совместимые API).
  - «Загрузить модели»: base URL нормализуется (концевые `/`, лишний `/v1` для Anthropic). Если провайдер не реализует список моделей (например, Anthropic-эндпоинт MiMo отвечает 404 на `/v1/models`, хотя `/v1/messages` работает), выполняется фолбэк-запрос OpenAI-совместимого каталога того же хоста (`<origin>/v1/models`).
  - Ручное добавление моделей: поле «ID модели» + кнопка «Добавить» и кнопка удаления (✕) у каждой модели — для провайдеров без каталога моделей.
- **`agy_shield.js`** — «Настройки → Безопасность»: политики `autoExecutionPolicy` и др. пишутся в `config.json → userSettings`; список разрешений `globalPermissionGrants` (формат `action(target)`, см. https://antigravity.google/docs/permissions) хранится там же. Записи с переводами строк отбрасываются ядром как невалидные — для «не спрашивать» используются правила-уайлдкарды вида `command(*)`.
- **`agy_fun_notify.js`** — гифка и звук по завершении хода. Взводится только реальной отправкой сообщения (кнопка, Enter с опустевшим полем, RPC `SendUserCascadeMessage`), затем требует, чтобы агент действительно работал (`input-send-button-cancel-tooltip`, `send-button-pending`, `agent-loading`, `GetTurnDiff`) и замолчал на `SETTLE_MS` (4.2 с). Доставка:
  - тот же чат на переднем плане → гифка внутрь `[data-turn-content="latest"]`;
  - другой чат → оверлей (`funShow(..., {overlay:true})`), в чужую переписку не вставляем;
  - приложение в фоне → завершение запоминается на 15 минут и отдаётся при возврате (`visibilitychange`).

  Почему это отдельные ветки, а не одна: Android замораживает таймеры свёрнутого WebView, поэтому `armTick` может не выполниться ни разу, а индикатор занятости к моменту возврата уже исчез. При возврате взвод «доседывается» через `GRACE_MS` (1.5 с) — задержка нужна, чтобы индикатор успел отрисоваться, и не зависит от того, сколько пользователь отсутствовал.

  Звук: WebView работает с `setMediaPlaybackRequiresUserGesture`, поэтому `new Audio().play()` без жеста отклоняется с `NotAllowedError`. Общий элемент `Audio` разблокируется первым касанием беззвучным прогоном (`unlockAudio`), заблокированное воспроизведение встаёт в `soundQueued` и повторяется на следующем жесте (`onGesture`). Пустой `.catch()` в старой версии глушил эту ошибку — звука не было никогда.

  Гифка переживает перерисовки React: узел переставляется интервалом `_agyKeep` (до 10 раз за 35 с), а при смене каскада узел снимается, чтобы не «прилипнуть» к чужому ходу.

  Диагностика из консоли WebView: `__agyFunDiag()` (enabled/inChat/audioUnlocked/soundQueued/visible/armed/seenBusy/pending/log) и `__agyFunFire()`. Оффлайн-стенд с фейковым DOM и виртуальными таймерами — `brain/<id>/scratch/fun_notify_test.js` (19 проверок: передний план, перерисовка, фон, возврат без увиденной занятости, другой чат, блокировка autoplay, диагностика).

---

## 7. Результаты аудита: архитектурные костыли и рекомендации

В ходе аудита веб-слоя выявлен ряд архитектурных нюансов, узких мест и костылей:

| Проблема / Костыль | Локация | Описание риска | Рекомендация по исправлению |
|---|---|---|---|
| **Отсутствие авто-сборки веб-слоя в пайплайне APK** | `modules/builder/05_stage_assets.py` | Скрипт `05_stage_assets.py` проверял и собирал `env`, но для `web/` просто копировал существующий `web/generated/`. Если разработчик правил `web/src/**` и не запустил `web/build.sh` вручную, в APK попадал устаревший бандл. | **[Исправлено]** В `05_stage_assets.py` добавлен автоматический вызов `bash web/build.sh` перед стадированием ассетов. |
| **Утечка `src.manifest` в финальный релизный APK** | `modules/builder/05_stage_assets.py` | В списке игнорируемых файлов `web_ignore` отсутствовал `src.manifest`, из-за чего исходный манифест сборщика попадал в ресурсы продакшн-APK. | **[Исправлено]** `"src.manifest"` добавлен в кортеж исключений `web_ignore`. |
| **Хрупкий Regex-патчинг `main.js`** | `web/patch_main.py` | Патчер завязан на точные сигнатуры обфусцированных переменных React (`var C=g!==3,D=g!==2...`) и содержит захардкоженные запасные имена компонентов (`item_comp="v3"`, `switch_comp="dX"`). При смене версии бандла возможен сбой инъекции или `ReferenceError`. | Реализовать верификацию синтаксиса через AST-парсер либо добавить строгие тесты проверки наличия интерфейса в CI. |
| **Избыточная двойная обертка IIFE** | `web/src.manifest`, `src/boot/theme-bootstrap.js` | Исходник `theme-bootstrap.js` уже имеет собственное замыкание `(function(){...})()`, а в манифесте объявлен как `bundle iife`. В итоге генерировался двойной вложенный IIFE. | **[Исправлено]** В `web/build.sh` добавлена проверка `is_already_iife`, предотвращающая повторное оборачивание уже закрытых фрагментов. |
| **Зависимость от `/tmp` на Android** | `web/build.sh` (строка 28) | Вызов `mktemp "${TMPDIR:-/tmp}/..."` падал на Android при отсутствии `$TMPDIR` в окружении, так как каталога `/tmp` в системе нет. | **[Исправлено]** Заменено на переносимый и безопасный путь `${TMPDIR:-${HOME:-.}/.tmp}` с автоматическим созданием каталога. |
| **Захардкоженный fallback CSRF** | `web/src/core/csrf.js` (строка 13) | Если токен не передан через `__AG_CSRF__` и отсутствует в DOM, используется константа `'agy-standalone-token'`. | Генерировать случайный UUID/Hex fallback-токен при инициализации вместо статической константы. |
| **Несогласованность схемы порта в discovery** | `web/src/core/endpoints.js` (строка 50) | При парсинге URL-параметра `?port=` выставляется `ENDPOINTS.core_http = 'http://127.0.0.1:' + port;`, хотя ядро работает исключительно по HTTPS. | Заменить схему на `https://127.0.0.1:` для единообразия с TLS-транспортом. |
| **Эмуляция событий тача через задержки** | `web/src/patches/touch_model_menu/` | Раскрытие меню моделей опирается на последовательность `setTimeout(..., 70)` и `setTimeout(..., 260)`. При сильной загрузке CPU задержки могут не успеть сработать. | Использовать MutationObserver или события смены фокуса для подтверждения открытия подменю. |

---

## 8. Проверка и тестирование (Verification)

Для проверки целостности и собираемости веб-слоя запустите тест самодиагностики:

```bash
bash web/tests/selftest.sh
```

Тест выполняет:
1. Создание изолированной временной копии директории `web/`.
2. Фиксацию контрольной суммы SHA-256 исходного `main.js`.
3. Запуск сборки `web/build.sh` и патчера `patch_main.py`.
4. Проверку, что исходный `main.js` остался неизменным.
5. Проверку генерации всех файлов и валидность путей в `index.html`.
6. Верификацию отсутствия повторных IIFE-оберток в сгенерированных бандлах.
