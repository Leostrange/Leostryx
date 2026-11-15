# Список изменений — Leostryx (3.1.10)
# Changelog — Leostryx (3.1.10)

Полный список всех внесённых изменений и добавленного функционала.

The complete list of every change and feature that was added.

Каждая секция продублирована на английском между маркерами `<!-- EN -->` и `<!-- /EN -->`.
Every section is duplicated in English between the `<!-- EN -->` and `<!-- /EN -->` markers.

## v3.1.10 — 2026-11-15 (Оповещение о завершении: гифка и звук действительно срабатывают)

<!-- RU -->
- **Звук завершения не проигрывался вообще.** WebView запускается с `setMediaPlaybackRequiresUserGesture`, поэтому `play()` отклонялся с `NotAllowedError`, а ошибка молча гасилась пустым `.catch()`. Теперь общий `Audio`-элемент «разблокируется» первым же касанием (тихим проигрыванием), а заблокированный вызов не теряется: он ставится в очередь `soundQueued` и повторяется при следующем касании — звук догоняет гифку, а не пропадает.
- **Оповещения из фоновых чатов и из других бесед отбрасывались.** Правило `done:background → skip` глушило их полностью: если задача завершалась, пока приложение было свёрнуто или открыт другой чат, не было ни гифки, ни звука. Теперь такое событие сохраняется в `pendingDone` (TTL 15 минут) и доставляется на `visibilitychange`, то есть при возврате в приложение.
- **Гифка могла вставиться в чужую беседу.** Найдено тестом, а не на глаз: `announce()` передавал пустой `cascadeId` в значении «не вставлять», но пустой идентификатор отключал защиту внутри `chatInsert`, и гифка попадала в открытый чат вместо того, где задача закончилась. Теперь вызов идёт как `funShow("", { force: true, overlay: true })`, а в `announce()` появился явный выход `if (!inChat || opts.overlay) { show(); playSound(); return; }`.
- **Перерисовка React стирала гифку.** Узел удалялся при следующем ре-рендере, и вместо трёх секунд гифка жила один кадр. Добавлен интервал `_agyKeep`, который возвращает узел на место (не более 10 раз за 35 секунд) и снимает его при смене беседы; `deferred`-таймер `arm` при этом больше не держит ссылку на чужой чат.
- **Возврат из фона срабатывал «на глазок».** Проверка `Date.now() - arm.at > 5000` заменена на отложенную проверку `GRACE_MS = 1500`, которая внутри таймера заново убеждается, что `arm` ещё актуален, `seenBusy` не выставлен и `isAgentBusy()` ложно — иначе возврат в приложение засчитывался как завершение задачи, которая всё ещё работала.
- **Кулдаун снижен с 12 до 2 секунд** (`skip:dup`), чтобы две задачи, завершившиеся подряд, не «съедали» второе оповещение.
- **Появилась диагностика.** `__agyFunDiag()` показывает состояние разблокировки звука, очередь `pendingDone` и счётчики срабатываний; `__agyFunFire()` принудительно запускает оповещение — проверять больше не нужно реальным ожиданием задачи.
- **Тест-стенд на 19 проверок — временный, в комплект не входит.** `fun_notify_test.js` — офлайн-стенд с фейковым DOM и виртуальными таймерами, 7 сценариев (в том числе фон, чужой чат и перерисовка); запускался как `node fun_notify_test.js agy_fun_notify.js` рядом с копией `agy_fun_notify.js`. В репозиторий, APK и исходный архив файл не включён — он существовал только на время работы над фиксом. Именно он нашёл ошибку с вставкой в чужой чат.
- **Внутренняя документация `assets/web/README.md` дополнена.** Файл едет внутри APK, и в нём появилось описание ветвей доставки оповещения (тот же чат → гифка в переписку, другой чат → оверлей, фон → отложенная доставка), `GRACE_MS`, разблокировки `Audio` через `soundQueued` и `_agyKeep`, а также диагностики `__agyFunDiag`/`__agyFunFire`.
- **Новый инструмент `tools/axml_version.py`.** Манифест в репозитории — это скомпилированный AXML, а не текст, и раньше версия правилась в нём вручную. Теперь скрипт переписывает пул строк (чанк `0x0001`) и встроенное значение `versionCode`, умеет работать в режиме проверки и выдаёт результат, который принимает `aapt2 dump badging`.
- **Исправлена главная причина, по которой не скачивались Gradle и AGP.** Встроенный в Termux-OpenJDK файл `cacerts` — это хранилище **PKCS12 под паролем `changeit`**, а JVM по умолчанию использует пустой пароль: хранилище открывалось «молча» с **нулём** доверенных корней, и любой HTTPS-запрос падал с `java.security.InvalidAlgorithmParameterException: the trustAnchors parameter must be non-empty` — Gradle, AGP, `sdkmanager` и Maven не могли скачать вообще ничего. Теперь `agy-selfheal` **нормализует само хранилище**: helper `AgyTruststore` (`$HOME/web/AgyTruststore.java`) собирает union всех CA-бандлов устройства (дедупликация по SHA-256 отпечатку) и пишет его как **JKS с пустым паролем** — единственная кодировка, которую дефолтная JVM открывает целиком (PKCS12, пересохранённый с пустым паролем, перезагружается с **0** записями — проверено) — на место `$JAVA_HOME/lib/security/cacerts`, оригинал сохраняется в `cacerts.pkcs12.orig`. Результат проверяется JVM **без флагов** и при нуле корней откатывается из бэкапа. Измерено: `gradle resolveProbe --no-daemon` скачал `guava:32.1.3-jre` с Maven Central и `com.android.tools.build:gradle:8.7.3` с Google Maven — `BUILD SUCCESSFUL`.
- **Флагов окружения было недостаточно — отсюда «проверка зелёная, а сборка падает».** `JAVA_TOOL_OPTIONS` видит только процесс, который сам подхватил окружение: login-шелл (через `profile.d/65-agy-jvm.sh`) или скрипт, вызвавший `jvm_env_ensure()`. Ядро приложения форкает Gradle-daemon, `sdkmanager`, Maven и `jadx` с окружением, которое было у приложения при старте, а там есть `-Duser.home` и **нет** truststore-флагов. Поэтому `verify jvm` теперь требует `anchors>0` **и** `default>0` (число корней без флагов) и печатает `anchors=149 default=149`, а профиль (маркер `JVM-TRUSTSTORE-FIX-v3`) для нормализованного JKS флаги не добавляет вообще — иначе `-Djavax.net.ssl.trustStorePassword` ломает MAC хранилища.
- **Тулчейн Gradle и AGP с несколькими версиями.** В «Настройки › Инструменты › Gradle & AGP» добавлен каталог `agp-9.1.1`, видны все кэшированные версии, у каждой — трёхпозиционный бейдж (не установлено / в кэше / активно). `agy_tools.sh agp "8.7.3 9.0.0 9.1.1"` и `gradle "8.14.7 auto"` работают без интерфейса; версия `auto` выбирается под проект по `.agy-toolchain` → `gradle-wrapper.properties` → заметке `# AGY-AGP:` → последней стабильной. Активный AGP хранится в `~/.gemini/config/agy-agp.state` и дублируется заметкой в `AGENTS.md`.
- **`agy-selfheal` — починка тулчейна без открытия интерфейса.** Новая обёртка (и одноимённая операция `selfheal` в `agy_tools.sh`) восстанавливает профиль окружения и JVM-профиль, мосты в `runtime/bin`, симлинк `$PREFIX/bin/gradle`, пару `agy-agp.state` ↔ `# AGY-AGP:`, правила `<!-- AGY-GRADLE-AGP -->` в обоих `AGENTS.md` и убирает мусорный `$HOME/AGENTS.md`. Зарегистрирована в `agy-daemon` (`Toolchain self-heal`, каждый час), поэтому после обновления приложения тулчейн чинится сам. Тот же ремонт доступен кнопкой «Починить окружение» в «Настройки › Инструменты».
- **`selfheal` действительно идемпотентен.** `agents_block_put` переписывал блок в **конец** файла, а `write_env` перезаписывал профиль безусловно — из-за этого два блока в одном файле менялись местами при каждом запуске, и счётчик `fixed=N` никогда не доходил до нуля. Теперь блок заменяется **на месте**, а все записи сравниваются через `cmp` до `mv`: повторный запуск печатает `@@selfheal fixed=0`, то есть ничего не изменил.
- **Устранены ещё две мелкие поломки.** `agents_block_put` падал с `tmp: unbound variable` под `set -u` (два `local` в одном объявлении раскрываются до создания переменных) — блок правил не записывался даже после успешной загрузки AGP. А демон писал каждую строку лога дважды (`dup2` stdout в лог-файл плюс явный `print()`), из-за чего один цикл выглядел как два конкурирующих демона.
- **Новый документ `docs/gradle-agp-toolchain.md`** — разбор truststore, каталогов, матрицы совместимости AGP ↔ Gradle ↔ JDK и правил self-heal.
- **Исправлена Java 17 — она была сломана, хотя проверка показывала «зелено».** В `java-17-openjdk/lib/security/cacerts` лежал **висячий симлинк** на `/data/data/com.termux/files/usr/etc/tls/certs/java/cacerts` — путь из чужого сандбокса, которого здесь нет; в самой Java 21 тот же файл был настоящим. Из-за этого 17-я не могла проверить ни один HTTPS-сертификат, а `verify jvm` смотрел только на активную JDK, поэтому проблему не видел. Теперь нормализация идёт **по каждой установленной JDK**: каждая получает собственный union-стор, висячие симлинки удаляются перед записью, результат проверяется JVM без флагов **отдельно для каждой версии**, и при неудаче откатывается из бэкапа именно эта JDK. Замерено: `@@ok jvm truststore ok: java-17-openjdk anchors=149 default=149, java-21-openjdk anchors=149 default=149`.
- **`AgyTruststore` больше не компилируется под чужую версию JDK.** Класс собирался Java 21 (class file 65) и падал на Java 17 с `UnsupportedClassVersionError: runtime accepts up to 61.0`. Теперь компиляция перебирает цели `11 → 17 → 8 → default`, рядом с классом пишется маркер `AgyTruststore.release`, и класс принимается только при совместимой цели — иначе пересобирается. Существующий класс с более новым mtime больше не считается доказательством совместимости.
- **`verify` стал настоящей проверкой, а не `--version`.** Для `ffmpeg` выполняется реальное кодирование одного кадра (lavfi → mp4), для `imagemagick` — рендер картинки 16×16, для `tesseract` — чтение списка языковых моделей, для `numpy` — импорт. Добавлен `verify all`: список проверок строится из того, что реально установлено, без ручного перечисления.
- **Добавлен поиск битых исполняемых файлов (`scan_broken`).** `op_status` теперь сообщает о висячих симлинках (`@@broken <name> dangling -> <target>`), о скриптах с чужим shebang, о несуществующем интерпретаторе и о `#!/usr/bin/env`, которого на Android нет; ELF-бинарники пропускаются. Это те самые «битые инструменты», которые формально установлены, но не запускаются.
- **Медиа-инструменты появились в «Инструментах».** Новая группа «Медиа, распознавание и изображения» и пресет «Медиа и распознавание»: FFmpeg (с проверкой кодирования), Tesseract OCR, ImageMagick, NumPy. Раньше их можно было поставить только из терминала, и приложение о них не знало.
- **Tesseract не находил языковые модели.** Пакет собран под префикс `/data/data/com.termux/...`, поэтому `tesseract --list-langs` отвечал «0 языков» при 23 МБ данных в `$PREFIX/share/tessdata` — установлен, но бесполезен. Профиль окружения теперь экспортирует `TESSDATA_PREFIX`, а сама проверка выставляет его самостоятельно и прямо пишет, в каком каталоге моделей нет.
- **Задачи в фоне больше не «висят» после завершения.** Найдены четыре причины. Первая: `RUNNING_JOBS` снимался только на успешном пути, поэтому исключение в уведомлении навсегда оставляло задачу «выполняющейся» — теперь вся запись результата, уведомление и снятие флага находятся в `finally`. Вторая: `subprocess.run(timeout=…)` убивал только оболочку, а дочерние процессы держали пайпы — теперь процесс запускается в отдельной группе (`start_new_session`) и при таймауте группа гасится `SIGTERM`, затем `SIGKILL`. Третья: планировщик сохранял **весь свой устаревший снимок** файла задач и затирал только что записанный результат — теперь пишутся только изменённые поля (`patch_tasks`) под файловой блокировкой (`flock`). Четвёртая: у задачи не было поля `state` вообще, поэтому интерфейс не мог отличить идущий запуск от законченного.
- **Появилось восстановление «зависших» меток (`reap_stale`).** Если демон был убит или дочерний процесс умер, метка `running` оставалась навсегда, и `execute_action_async` отказывался запускать задачу повторно — одна смерть в неудачном месте отключала задачу целиком. Теперь каждый тик планировщика проверяет живость `run_pid` (и записывает **настоящий** pid дочернего процесса, а не свой) и снимает метку, помечая запуск как `aborted`. `agy-daemon task list` при этом честно показывает `running` или `aborted`, а не выдаёт завершённую задачу за работающую. Проверено вживую: задача с `--delay 3s` переходит `running` → `idle`/`success` (`hello-from-e2e`), а задача `sleep 300` с убитым родителем помечается `aborted`. Мёртвый pid дочернего процесса сам по себе признаком зависания не считается: между выходом оболочки и записью результата остаётся окно, и снятие метки в нём помечало успешный запуск как `aborted`. Теперь мёртвому pid даётся 60-секундная фора, а запись перепроверяется по свежему файлу под блокировкой — проверено: задача, завершившаяся за 7 с, остаётся `success` и в лог больше не попадает ложное `Reaped stale running marker(s)`.
- **Уведомления в шторке Android приходят на языке интерфейса.** `agy-notify` не знал выбранного языка и всегда писал по-русски, даже если приложение было на английском. Теперь язык выбирается по приоритету `--lang`/`-L` → `$AGY_LANG` → `$HOME/.agy_lang` (его пишет операция `setlang`) → `$LANG` → `ru`, и через него проходят не только тексты уведомлений, но и справка, сообщения об ошибках и строка состояния, так что фоновые задачи и их завершение говорят на том же языке, что и интерфейс.
- **Детальный просмотр релиза больше не обрезается.** Тело самого крупного релиза (`v3.1.0` ≈ 29 КБ) не влезало в окно «Что нового» и заканчивалось на «…» посреди списка: лимит поднят с 14 000 до 32 000 символов. Список последних релизов по-прежнему показывает по 700 символов на релиз.
- **В `AGENTS.md` добавлены два новых блока правил.** `AGY-LANG` — агент обязан отвечать и писать на языке пользователя (включая коммиты, `CHANGELOG.md`, тексты для форума и комментарии в коде), технические идентификаторы не переводятся, двуязычная документация правится в обеих половинах. `AGY-BUILD-VERSION` — версия поднимается один раз за сборку, фиксы и фичи по ходу сборки входят в **текущую** версию без перепрыгивания номера, добавление функциональности в идущий билд требует подтверждения пользователя, а `CHANGELOG.md` пишется только после успешной сборки и обязан совпадать с именем APK и `SHA256SUMS`. Блоки лежат в поставляемом `AGENTS.md` и автоматически переносятся в живой файл правил при `agy-selfheal` (повторный запуск печатает `fixed=0`).
- **В сборку больше не попадает байткод Python.** `__pycache__` каталога `app/assets/env/overlay` ехал внутрь APK: `rebuild.py` исключал его только при упаковке архива исходников, а при сборке APK — нет. Пять `.pyc`-файлов (демон и модули планировщика) убраны из установочного пакета.
- **Описания этого релиза теперь соответствуют тому, что действительно лежит в APK.** Опубликованная сборка 3.1.9 была выложена раньше, чем появились truststore, `agy-selfheal`, фикс фоновых задач, язык уведомлений и правила в `AGENTS.md` — в её APK нет ни `agy-selfheal`, ни `AgyTruststore`. Поэтому все эти изменения перечислены здесь, в 3.1.10, а не в тексте 3.1.9.
- **Версия 3.1.10** (`versionCode` 36) в манифесте, «О приложении» и кэш-бастерах `index.html`.
<!-- /RU -->

<!-- EN -->
- **The completion sound never played at all.** The WebView starts with `setMediaPlaybackRequiresUserGesture`, so `play()` was rejected with `NotAllowedError` and the error was swallowed by an empty `.catch()`. A shared `Audio` element is now unlocked by the first touch (a silent run), and a blocked playback is not lost: it is queued in `soundQueued` and retried on the next touch, so the sound catches up with the gif instead of vanishing.
- **Notifications from background chats and from other conversations were dropped.** The `done:background → skip` rule silenced them completely: if a task finished while the app was in the background or another chat was open, there was neither a gif nor a sound. Such an event is now stored in `pendingDone` (15-minute TTL) and delivered on `visibilitychange`, i.e. when the user returns to the app.
- **The gif could be inserted into the wrong conversation.** This was found by the harness, not by eye: `announce()` passed an empty `cascadeId` to mean "do not insert", but an empty id disabled `chatInsert`'s internal guard, so the gif landed in whichever chat was open instead of the one where the task had finished. The call is now `funShow("", { force: true, overlay: true })`, and `announce()` gained an explicit `if (!inChat || opts.overlay) { show(); playSound(); return; }` exit.
- **A React repaint erased the gif.** The node was removed on the next re-render, so the gif lived for a single frame instead of three seconds. A `_agyKeep` interval now puts the node back (at most 10 times per 35 seconds) and drops it on a conversation change; the deferred `arm` timer no longer keeps a reference to someone else's chat.
- **Background return was settled by eye.** The `Date.now() - arm.at > 5000` check was replaced with a deferred `GRACE_MS = 1500` check that re-verifies inside the timer that `arm` is still current, `seenBusy` is unset and `isAgentBusy()` is false — otherwise returning to the app counted as the completion of a task that was still running.
- **The cooldown was reduced from 12 to 2 seconds** (`skip:dup`), so two tasks finishing back to back no longer swallow the second notification.
- **Diagnostics were added.** `__agyFunDiag()` reports the audio unlock state, the `pendingDone` queue and the fired counters; `__agyFunFire()` forces a notification — no more waiting for a real task to check the behaviour.
- **A 19-check test harness — temporary, not part of the release.** `fun_notify_test.js` is an offline stand with a fake DOM and virtual timers, covering 7 scenarios (including background, another chat and a repaint); it was run as `node fun_notify_test.js agy_fun_notify.js` next to a copy of `agy_fun_notify.js`. The file is not included in the repository, the APKs or the source archive — it existed only while the fix was being developed. It is exactly what found the wrong-chat insertion bug.
- **The internal `assets/web/README.md` documentation was extended.** The file travels inside the APK, and it now describes the notification delivery branches (same chat → gif into the conversation, another chat → overlay, background → deferred delivery), `GRACE_MS`, the `Audio` unlock through `soundQueued` and `_agyKeep`, and the `__agyFunDiag`/`__agyFunFire` diagnostics.
- **New tool `tools/axml_version.py`.** The manifest in the repository is compiled AXML rather than text, and the version used to be edited in it by hand. The script now rewrites the string pool (chunk `0x0001`) and the inline `versionCode`, supports a check-only mode, and produces a manifest that `aapt2 dump badging` accepts.
- **The root cause of the broken Gradle/AGP downloads is fixed.** The `cacerts` bundled with Termux-OpenJDK is a **PKCS12 store protected by `changeit`**, while the JVM default password is empty: the store opened silently with **zero** trust anchors and every HTTPS call died with `java.security.InvalidAlgorithmParameterException: the trustAnchors parameter must be non-empty` — Gradle, AGP, `sdkmanager` and Maven could not download anything at all. `agy-selfheal` now **normalises the store itself**: the `AgyTruststore` helper (`$HOME/web/AgyTruststore.java`) builds the union of every CA bundle on the device (deduplicated by SHA-256 fingerprint) and writes it as **JKS with an empty password** — the only encoding a default JVM opens with all certificates intact (PKCS12 re-saved with an empty password reloads with **0** entries, measured) — at `$JAVA_HOME/lib/security/cacerts`, keeping the original as `cacerts.pkcs12.orig`. The result is verified by a **flag-free** JVM and rolled back from the backup when it holds zero anchors. Measured: `gradle resolveProbe --no-daemon` downloaded `guava:32.1.3-jre` from Maven Central and `com.android.tools.build:gradle:8.7.3` from Google Maven — `BUILD SUCCESSFUL`.
- **Environment flags were not enough — hence "the check is green but the build fails".** `JAVA_TOOL_OPTIONS` only reaches a process that picked the environment up itself: a login shell (through `profile.d/65-agy-jvm.sh`) or a script that called `jvm_env_ensure()`. The app core forks the Gradle daemon, `sdkmanager`, Maven and `jadx` with the environment the app had at launch, which carries `-Duser.home` and **no** truststore flags. `verify jvm` therefore now requires `anchors>0` **and** `default>0` (anchors without flags) and prints `anchors=149 default=149`, and the profile (marker `JVM-TRUSTSTORE-FIX-v3`) adds no flags at all for a normalised JKS — `-Djavax.net.ssl.trustStorePassword` would only break the store MAC.
- **A multi-version Gradle and AGP toolchain.** `Settings › Tools › Gradle & AGP` gained the `agp-9.1.1` catalog entry, shows every cached version and gives each one a three-way badge (not installed / cached / active). `agy_tools.sh agp "8.7.3 9.0.0 9.1.1"` and `gradle "8.14.7 auto"` work without the UI; `auto` resolves against the project through `.agy-toolchain` → `gradle-wrapper.properties` → the `# AGY-AGP:` note → the latest stable. The active AGP is stored in `~/.gemini/config/agy-agp.state` and mirrored by a note in `AGENTS.md`.
- **`agy-selfheal` repairs the toolchain without opening the UI.** A new wrapper (plus the matching `selfheal` operation in `agy_tools.sh`) restores the environment profile and the JVM profile, the bridges in `runtime/bin`, the `$PREFIX/bin/gradle` symlink, the `agy-agp.state` ↔ `# AGY-AGP:` pair and the `<!-- AGY-GRADLE-AGP -->` rules in both `AGENTS.md` files, and removes the stray `$HOME/AGENTS.md`. It is registered with `agy-daemon` (`Toolchain self-heal`, hourly), so the toolchain heals itself after an app update. The same repair is available through the "Repair environment" button in `Settings › Tools`.
- **`selfheal` is genuinely idempotent.** `agents_block_put` used to rewrite its block at the **end** of the file and `write_env` rewrote the profile unconditionally, so two blocks in one file swapped places on every run and `fixed=N` could never reach zero. The block is now replaced **in place**, and every write is compared with `cmp` before `mv`: a repeat run prints `@@selfheal fixed=0`, meaning nothing changed.
- **Two further small failures fixed.** `agents_block_put` crashed with `tmp: unbound variable` under `set -u` (two `local` assignments in one statement expand before either variable exists), so the rules block was never written even after a successful AGP download. And the daemon printed every log line twice (`dup2` of stdout onto the log file plus an explicit `print()`), which made a single loop look like two competing daemons.
- **New document `docs/gradle-agp-toolchain.md`** — the truststore analysis, the directory layout, the AGP ↔ Gradle ↔ JDK compatibility matrix and the self-heal rules.
- **Java 17 is fixed — it was broken while the check still reported "green".** `java-17-openjdk/lib/security/cacerts` was a dangling symlink to `/data/data/com.termux/files/usr/etc/tls/certs/java/cacerts` — a path from someone else's sandbox that does not exist here, while the same file in Java 21 was real. Java 17 could validate no HTTPS certificate at all, and `verify jvm` only looked at the active JDK, so it never noticed. Normalisation now runs for every installed JDK: each one gets its own union store, dangling symlinks are removed before writing, the result is verified by a flag-free JVM per version, and on failure that particular JDK is restored from its backup. Measured: `@@ok jvm truststore ok: java-17-openjdk anchors=149 default=149, java-21-openjdk anchors=149 default=149`.
- **`AgyTruststore` is no longer compiled for the wrong JDK.** The class used to be built by Java 21 (class file 65) and failed on Java 17 with `UnsupportedClassVersionError: runtime accepts up to 61.0`. Compilation now walks the targets `11 → 17 → 8 → default`, an `AgyTruststore.release` marker is written next to the class, and the class is accepted only when the target is compatible — otherwise it is rebuilt. An existing class with a newer mtime is no longer taken as proof of compatibility.
- **`verify` is a real check now, not `--version`.** `ffmpeg` actually encodes one frame (lavfi → mp4), `imagemagick` renders a 16×16 image, `tesseract` reads its language list and `numpy` is imported. `verify all` was added: the list of checks is built from what is actually installed, with nothing to enumerate by hand.
- **Broken executables are now detected (`scan_broken`).** `op_status` reports dangling symlinks (`@@broken <name> dangling -> <target>`), scripts with a foreign shebang, a missing interpreter and a `#!/usr/bin/env` that Android does not have; ELF binaries are skipped. These are precisely the "broken tools" that are formally installed but will not start.
- **Media tools appeared in "Tools".** A new "Media, recognition and images" group plus a "Media and recognition" preset: FFmpeg (with an encode check), Tesseract OCR, ImageMagick, NumPy. Previously they could only be installed from the terminal and the app did not know about them.
- **Tesseract could not find its language data.** The package is built for the `/data/data/com.termux/...` prefix, so `tesseract --list-langs` answered "0 languages" despite 23 MB of data in `$PREFIX/share/tessdata` — installed but useless. The environment profile now exports `TESSDATA_PREFIX`, and the check itself sets it and states plainly which directory is missing the models.
- **Background tasks no longer "hang" after they finish.** Four causes were found. First: `RUNNING_JOBS` was cleared only on the success path, so an exception in the notification left the task "running" forever — the result write, the notification and the flag release now all live in `finally`. Second: `subprocess.run(timeout=…)` killed only the shell while the children kept the pipes open — the process is now started in its own group (`start_new_session`) and on timeout the group is signalled with `SIGTERM`, then `SIGKILL`. Third: the scheduler saved its whole stale snapshot of the task file and overwrote the result that had just been written — now only the touched fields are written (`patch_tasks`) under a file lock (`flock`). Fourth: the task had no `state` field at all, so the interface could not tell a live run from a finished one.
- **Stale "running" markers are now recovered (`reap_stale`).** If the daemon was killed or a child process died, the `running` marker stayed forever and `execute_action_async` refused to start the task again — one death in an unlucky place disabled the task entirely. The scheduler now checks the liveness of `run_pid` on every tick (recording the real child pid, not its own) and clears the marker, marking the run `aborted`. `agy-daemon task list` honestly shows `running` or `aborted` instead of passing a completed task off as running. Verified live: a task with `--delay 3s` moves `running` → `idle`/`success` (`hello-from-e2e`), and a `sleep 300` task whose parent was killed is marked `aborted`. A dead child pid is not proof of a hang by itself: between the shell exiting and the result being written there is a window, and reaping inside it marked a successful run as `aborted`. A dead pid now gets a 60-second grace period, and the write is re-checked against the fresh file under the lock — verified: a task that finished in 7 s stays `success` and the log no longer contains a false `Reaped stale running marker(s)`.
- **Android shade notifications now arrive in the interface language.** `agy-notify` did not know the selected language and always wrote in Russian, even with the app in English. The language is now resolved by priority `--lang`/`-L` → `$AGY_LANG` → `$HOME/.agy_lang` (written by the `setlang` operation) → `$LANG` → `ru`, and it covers not only the notification texts but also the usage text, error messages and the status line, so background tasks and their completion speak the same language as the interface.
- **The detailed release view is no longer truncated.** The body of the largest release (`v3.1.0` ≈ 29 KB) did not fit into the "What's new" window and ended with "…" in the middle of the list: the limit was raised from 14 000 to 32 000 characters. The recent-releases list still shows 700 characters per release.
- **Two new rule blocks were added to `AGENTS.md`.** `AGY-LANG` — the agent must answer and write in the user's language (including commits, `CHANGELOG.md`, forum and release texts and code comments), technical identifiers are not translated, and bilingual documentation is edited in both halves. `AGY-BUILD-VERSION` — the version is bumped once per build, fixes and features found mid-build go into the current version without skipping a number, adding functionality to an in-flight build requires the user's confirmation, and `CHANGELOG.md` is written only after a successful build and must match the APK name and `SHA256SUMS`. The blocks live in the shipped `AGENTS.md` and are carried into the live rules file automatically by `agy-selfheal` (a repeat run prints `fixed=0`).
- **Python bytecode no longer ships inside the build.** The `__pycache__` of `app/assets/env/overlay` travelled into the APK: `rebuild.py` excluded it only when packing the source archive, not when building the APK. The five `.pyc` files (the daemon and the scheduler modules) are gone from the installation package.
- **These release notes now match what the APK actually contains.** The published 3.1.9 build was uploaded before the truststore work, `agy-selfheal`, the background-task fix, the notification language and the `AGENTS.md` rules existed — its APK contains neither `agy-selfheal` nor `AgyTruststore`. All of those changes are therefore listed here, in 3.1.10, rather than in the 3.1.9 text.
- **Version 3.1.10** (`versionCode` 36) in the manifest, in "About the app" and in the `index.html` cache-busters.
<!-- /EN -->

## v3.1.9 — 2026-11-15 (Полная локализация RU/EN, просмотр Changelog, загрузка обновлений)

<!-- RU -->
- **Полная локализация интерфейса на английский язык.** Раньше английский интерфейс был наполовину русским: часть строк вообще не проходила через словарь. Теперь переведено всё, что видит пользователь:
  - `agy_tools.js` — статусы «Инструментов», сообщения об ошибках (`Ошибка:` / `Error:`), единицы размера (`МиБ` / `MiB`, `МБ` / `MB`), сохранение selftest-лога;
  - `agy_brand.js` — описания всех девяти шрифтов (`den:` у каждой записи `FONTS`) и предложение-образец в предпросмотре шрифта;
  - `agy_mcp.js` — 21 тег MCP-серверов (`TAG_EN`) и описания четырёх компонентов;
  - `agy_customizations.js` — 16 тегов правил, скиллов и плагинов, а также три шаблона правил (краткость, строгость, русский язык);
  - `agy_ru.js` — заголовки уведомлений в шторке, каталог из 8 субагентов, «Кастомный субагент», подписи кнопок композера (добавлены хелперы `ruLang()` и `T(ru, en)`);
  - `agy_fun_notify.js` — вся панель настроек мем-гифок: переключатель GIF, три поля ввода, раздел звука, пресеты, кнопка предпросмотра;
  - `agy_export_session.js` — заголовки `transcript.md` (`User` / `Assistant` / `Tool` / `Thinking`), все всплывающие сообщения, шапка `MANIFEST.txt`, пути, ошибки, примечание к ZIP и сообщение о превышении размера.
- **Язык интерфейса теперь передаётся в shell-бэкенд.** Добавлена операция `setlang`: она записывает выбранный язык в `$HOME/.agy_lang`, откуда его читают фоновые скрипты (`AGY_LANG` тоже учитывается). В `agy_tools.sh` появился общий хелпер `L(ru, en)`, поэтому уведомления в шторке больше не приходят по-русски при английском интерфейсе.
- **Уведомления о загрузке обновления стали двуязычными** (`updatedownload`): заголовок, текст о ходе загрузки и сообщение об установке формируются через `L()`.
- **Встроенная карточка «Обновления» переписана с нуля** («О приложении»):
  - бейдж текущей версии и мини-кнопка рядом с номером релиза — по нажатию открывается всплывающее окно с Changelog именно этого релиза;
  - проверка новой версии идёт через GitHub Releases API, кэш хранится в `$HOME/.agy_changelog.json`, кнопка «Проверить обновления» умеет обходить кэш;
  - загрузка APK показывает реальный прогресс (процент и объём), а не прежние «5–7 %, потом резко 100 %»;
  - загрузка видна и в шторке Android: отдельное уведомление с процветом, по завершении — уведомление «Обновление скачано, откройте установщик»;
  - по нажатию «Обновить» запускается системный установщик Android (`Intent.ACTION_VIEW` на скачанный APK), приложение обновляется штатно, без ручного поиска файла;
  - весь текст карточки проходит через `T(ru, en)` и меняется вместе с языком интерфейса.
- **Changelog подтягивается с GitHub и показывается на языке интерфейса.** Тела релизов на GitHub теперь содержат обе версии текста, разделённые маркерами `<!-- RU --> … <!-- /RU -->` и `<!-- EN --> … <!-- /EN -->`; `op_changelog` выбирает нужную по языку, а если английского блока в старом релизе нет — аккуратно показывает русский.
- **`CHANGELOG.md` стал двуязычным.** Каждая секция релиза сохранена дословно под маркером RU и продублирована английским переводом под маркером EN — это единый источник и для файла в репозитории, и для тел релизов на GitHub.
- **Окно «Что нового» грузится целиком и всегда свежее.** `AgyTools.read()` отдаёт только 24 КБ хвоста лога, а сырой base64 кириллицы занимает ≈2.7 байта на символ — `v3.1.0` (≈13.6 КБ текста) не влезал и обрезался. Теперь `op_changelog` упаковывает результат в **gzip + base64** и отдаёт чанками `@@CLGZ i/n` (весь список из 12 релизов — ≈6.8 КБ, крупнейший релиз — ≈11 КБ), а `agy_tools.js` распаковывает его через `DecompressionStream`. Парсер маркеров больше не требует их строго в начале строки (регулярка + снятие `\r`), а данные всегда запрашиваются у GitHub API (кеш — только офлайн-фоллбэк), поэтому правки описаний релизов видны сразу.
- **Добавлена Telegram-группа для связи.** В карточке «О разработчике» появился контакт «Telegram · группа Leostryx» (долгое нажатие копирует ссылку-приглашение, обычный тап открывает её), а в «Обратной связи» — строка «Быстрее получить ответ можно в группе **Telegram**». Ссылка: `https://t.me/+qji9jQ68cWRmZDky`.
- **Всё от блока truststore/тулчейна до правил в `AGENTS.md` вышло в 3.1.10, а не в опубликованной 3.1.9.** Эта сборка 3.1.9 была выложена раньше, чем появились эти работы — в её APK нет ни `agy-selfheal`, ни `AgyTruststore`. Полный список — в секции 3.1.10 выше.
- **Версия 3.1.9** (`versionCode` 34) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
- **Complete localisation of the interface into English.** Previously the English interface was half Russian: some strings never went through the dictionary at all. Now everything the user can see is translated:
  - `agy_tools.js` — "Tools" statuses, error messages (`Ошибка:` / `Error:`), size units (`МиБ` / `MiB`, `МБ` / `MB`), saving the selftest log;
  - `agy_brand.js` — the descriptions of all nine fonts (`den:` on every `FONTS` entry) and the sample sentence in the font preview;
  - `agy_mcp.js` — 21 MCP-server tags (`TAG_EN`) and the descriptions of four components;
  - `agy_customizations.js` — 16 rule/skill/plugin tags, plus three rule templates (concise, strict, Russian language);
  - `agy_ru.js` — notification titles in the shade, the 8-entry subagent catalog, "Custom subagent", the composer button captions (the `ruLang()` and `T(ru, en)` helpers were added);
  - `agy_fun_notify.js` — the whole meme-gif settings panel: the GIF toggle, three input fields, the sound section, the presets, the preview button;
  - `agy_export_session.js` — `transcript.md` headings (`User` / `Assistant` / `Tool` / `Thinking`), all toasts, the `MANIFEST.txt` header, paths, errors, the ZIP note and the size-limit message.
- **The interface language is now passed to the shell backend.** A `setlang` operation was added: it stores the selected language in `$HOME/.agy_lang`, which background scripts read (`AGY_LANG` is honoured too). `agy_tools.sh` gained a shared `L(ru, en)` helper, so notifications in the shade no longer arrive in Russian while the interface is in English.
- **Update download notifications are now bilingual** (`updatedownload`): the title, the progress text and the install message are all produced through `L()`.
- **The built-in "Updates" card was rewritten from scratch** ("About the app"):
  - a badge with the current version and a mini-button next to the release number — tapping it opens a popup with the changelog of exactly that release;
  - the new-version check goes through the GitHub Releases API, the cache lives in `$HOME/.agy_changelog.json`, and the "Check for updates" button can bypass the cache;
  - the APK download shows real progress (percentage and size), instead of the previous "5–7 %, then a sudden 100 %";
  - the download is also visible in the Android shade: a dedicated notification with a percentage, and on completion a "Update downloaded, open the installer" notification;
  - pressing "Update" launches the system Android installer (`Intent.ACTION_VIEW` on the downloaded APK), so the app updates through the normal flow with no manual file search;
  - every string on the card goes through `T(ru, en)` and follows the interface language.
- **The changelog is pulled from GitHub and shown in the interface language.** GitHub release bodies now carry both versions of the text, separated by the `<!-- RU --> … <!-- /RU -->` and `<!-- EN --> … <!-- /EN -->` markers; `op_changelog` picks the right one for the language and, if an older release has no English block, gracefully falls back to Russian.
- **`CHANGELOG.md` is bilingual.** Every release section is preserved verbatim under the RU marker and duplicated with an English translation under the EN marker — one source of truth for both the repository file and the GitHub release bodies.
- **The "What's new" window loads in full and is always fresh.** `AgyTools.read()` returns only the last 24 KB of the log, and raw base64 of Cyrillic takes ≈2.7 bytes per character — `v3.1.0` (≈13.6 KB of text) did not fit and was cut off. `op_changelog` now packs the result as **gzip + base64** and streams it in `@@CLGZ i/n` chunks (the whole list of 12 releases is ≈6.8 KB, the largest release ≈11 KB), and `agy_tools.js` unpacks it through `DecompressionStream`. The marker parser no longer requires markers strictly at the start of a line (regex + `\r` stripping), and the data is always requested from the GitHub API (the cache is only an offline fallback), so edits to release descriptions show up immediately.
- **A Telegram group was added for contact.** The "About the developer" card now shows a "Telegram · Leostryx group" contact (long-press copies the invite link, a normal tap opens it), and the Feedback screen gained the line "For a faster reply, join the group **Telegram**". Link: `https://t.me/+qji9jQ68cWRmZDky`.
- **Everything from the truststore/toolchain block to the `AGENTS.md` rules shipped in 3.1.10, not in the published 3.1.9.** This 3.1.9 build was uploaded before that work existed — its APK contains neither `agy-selfheal` nor `AgyTruststore`. The full list is in the 3.1.10 section above.
- **Version 3.1.9** (`versionCode` 34) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.8 — 2026-11-15 (Прикрепление файлов любых типов)

<!-- RU -->
Раньше композер принимал только изображения, PDF, офисные документы, zip, текст, аудио и видео. Любой другой файл — скрипт без известного расширения, `Dockerfile`, `Makefile`, `.env`, дамп, конфиг, неизвестный бинарник — упирался в тупиковое `Unsupported file format`. Причём до этой проверки дело часто даже не доходило: `drag&drop` отбрасывал файл раньше.

- **Включает исправление из сборки 3.1.7** — фикс конвертера сторонних провайдеров (`liblanguage_server.so`, не-графические `inlineData`) вошёл в этот релиз: 3.1.7 выходила как промежуточная сборка, отдельно не публиковалась;
- **Убрано сообщение `Unsupported file format`** (`app/assets/web/generated/main.js`, функция-валидатор `u5a`, терминальная ветка `else`). Вместо отказа работает общая ветка прикрепления: файл читается как `ArrayBuffer`, упаковывается в `I.MediaSchema` с блоком `inlineData` и добавляется к сообщению — тем же путём, что и уже поддерживаемые типы.
- **Расширенный определитель MIME `agyMimeForName()`** — новая функция перед `u5a`. Таблица на ~120 расширений: код (`py`, `js`, `ts`, `tsx`, `go`, `rs`, `java`, `c`, `cpp`, `cs`, `rb`, `php`, `lua`, `kt`, `swift`, `dart`, `sql`, `proto`, `graphql`), конфиги (`json`, `jsonl`, `yaml`, `toml`, `ini`, `cfg`, `conf`, `properties`, `env`, `gradle`, `mk`, `dockerfile`, `gitignore`), разметка и текст (`md`, `rst`, `txt`, `log`, `csv`, `tsv`, `html`, `css`, `scss`, `xml`, `svg`, `tex`, `vtt`), скрипты (`sh`, `bash`, `zsh`, `fish`, `bat`, `cmd`, `ps1`), архивы (`zip`, `gz`, `tgz`, `tar`, `7z`, `rar`, `apk`), шрифты (`ttf`, `otf`, `woff`, `woff2`), а также изображения, аудио, видео и офисные форматы — они нужны, когда браузер отдаёт пустой `File.type`.
- **Определение по содержимому**: если тип остался пустым или равен `application/octet-stream`, проверяются первые 64 КБ. Наличие нулевых байтов, `0x7F` или служебных управляющих символов (более 2 % выборки) означает бинарник — он уходит как `application/octet-stream`, иначе как `text/plain`. Проверка не читает файл целиком и не влияет на скорость.
- **`drag&drop` больше не фильтрует по белому списку.** В `m5a` (`dragover`) условие `CB("",w.type) || image/ || video/ || audio/ || application/pdf || xNa() || pNa.includes()` заменено на `w.kind==="file"`, а в обработчике `drop` убрано `CB(C.name,C.type)` перед `B.items.add(C)`. Именно второй фильтр молча съедал неподдерживаемые файлы: `CB` пропускает только MIME-префиксы `image/`/`video/`/`audio/`, `application/pdf`, резолверы `xNa`/`tB` и набор из 22 расширений `QNa`. Файл без расширения и с пустым `type` до валидатора не доходил вообще.
- **Предохранители вместо тихого сбоя**: пустой файл отклоняется с `File is empty`, файл больше 20 МБ — с `File size exceeds 20MB limit` (тот же потолок, что у zip и аудио). Обе ветки пишут событие `validation_check_failed` в аналитику, как и остальные отказы.
- **Лимит текстовых вложений 1 МБ → 10 МБ** (`Text file size exceeds 10MB limit`). Крупный лог или большой исходник больше не отваливается; ограничение выровнено с PDF и офисными документами.
- **Указатель файла для нативного пути сохранён**: после сборки `Media` вызывается `BB(m) && AB.set(B,m)` — если у файла есть реальный путь (`electronNative.getPathForFile` / `File.path`), он остаётся доступен модулю загрузки `v5a` и файл не дублируется в `inlineData` без необходимости.
- **Синхронизация**: `app/assets/web/generated/main.js` (репозиторий) и `/data/user/0/com.agyru.t2/files/web/generated/main.js` (живая копия) совпадают побайтово; cache-buster `./generated/main.js` → `?v=3.1.8` в обоих `index.html`.
- **Версия 3.1.8** (`versionCode` 33) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
**Attaching files of any type**

Previously the composer accepted only images, PDFs, office documents, zip, text, audio and video. Every other file — a script with an unknown extension, `Dockerfile`, `Makefile`, `.env`, a dump, a config, an unknown binary — hit the dead-end `Unsupported file format`. And often it never even reached that check: `drag&drop` dropped the file earlier.

- **Includes the fix from build 3.1.7** — the third-party provider converter fix (`liblanguage_server.so`, non-image `inlineData`) shipped in this release; 3.1.7 was an intermediate build and was not published separately;
- **Removed the `Unsupported file format` message** (`app/assets/web/generated/main.js`, the validator function `u5a`, terminal `else` branch). Instead of refusing, the generic attachment path runs: the file is read as an `ArrayBuffer`, packed into `I.MediaSchema` with an `inlineData` block and added to the message — the same path already supported types use.
- **Extended MIME resolver `agyMimeForName()`** — a new function in front of `u5a`. A table of ~120 extensions: code (`py`, `js`, `ts`, `tsx`, `go`, `rs`, `java`, `c`, `cpp`, `cs`, `rb`, `php`, `lua`, `kt`, `swift`, `dart`, `sql`, `proto`, `graphql`), configs (`json`, `jsonl`, `yaml`, `toml`, `ini`, `cfg`, `conf`, `properties`, `env`, `gradle`, `mk`, `dockerfile`, `gitignore`), markup and text (`md`, `rst`, `txt`, `log`, `csv`, `tsv`, `html`, `css`, `scss`, `xml`, `svg`, `tex`, `vtt`), scripts (`sh`, `bash`, `zsh`, `fish`, `bat`, `cmd`, `ps1`), archives (`zip`, `gz`, `tgz`, `tar`, `7z`, `rar`, `apk`), fonts (`ttf`, `otf`, `woff`, `woff2`), plus images, audio, video and office formats — the latter are needed when the browser reports an empty `File.type`.
- **Content-based detection**: if the type is still empty or equals `application/octet-stream`, the first 64 KB are inspected. The presence of zero bytes, `0x7F` or service control characters (more than 2 % of the sample) means a binary — it is sent as `application/octet-stream`, otherwise as `text/plain`. The check does not read the whole file and does not affect speed.
- **`drag&drop` no longer filters by an allow-list.** In `m5a` (`dragover`) the condition `CB("",w.type) || image/ || video/ || audio/ || application/pdf || xNa() || pNa.includes()` was replaced with `w.kind==="file"`, and in the `drop` handler `CB(C.name,C.type)` before `B.items.add(C)` was removed. It was precisely that second filter that silently ate unsupported files: `CB` lets through only the MIME prefixes `image/`/`video/`/`audio/`, `application/pdf`, the `xNa`/`tB` resolvers and a set of 22 extensions `QNa`. A file without an extension and with an empty `type` never reached the validator at all.
- **Guards instead of a silent failure**: an empty file is rejected with `File is empty`, a file larger than 20 MB with `File size exceeds 20MB limit` (the same ceiling as for zip and audio). Both branches record a `validation_check_failed` event in analytics, like all other rejections.
- **Text attachment limit raised from 1 MB to 10 MB** (`Text file size exceeds 10MB limit`). A large log or a big source file no longer fails; the restriction is now aligned with PDFs and office documents.
- **File handle for the native path preserved**: after building `Media`, `BB(m) && AB.set(B,m)` is called — if the file has a real path (`electronNative.getPathForFile` / `File.path`), it stays available to the upload module `v5a` and the file is not duplicated into `inlineData` needlessly.
- **Synchronisation**: `app/assets/web/generated/main.js` (repository) and `/data/user/0/com.agyru.t2/files/web/generated/main.js` (live copy) are byte-for-byte identical; cache-buster `./generated/main.js` → `?v=3.1.8` in both `index.html` files.
- **Version 3.1.8** (`versionCode` 33) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.7 — 2026-11-15 (Фикс работы сторонних провайдеров со вложенными файлами)

<!-- RU -->
- **Устранена критическая ошибка сторонних провайдеров (OpenAI / DeepSeek / Claude / локальные серверы)**:
  - **Причина бага**: при отправке сообщения со вложенными файлами (скрипты `.py`, документы `.md`, код `.ts`/`.js`, файлы `.json`, `.pdf`, `.txt`) фронтенд создаёт в истории переписки объект `Media` с MIME-типом (`text/x-python`, `text/markdown` и т. д.) и блоком `inlineData`. При переключении на **стороннего провайдера** (OpenAI-совместимый протокол шлюза `AGY_LLM_GATEWAY_WIRE_PROTOCOL=openai`) встроенный конвертер ядра `liblanguage_server.so` (`convertRequestToOpenAI` / `AgentExecutor.Run`) ожидал в `inlineData` **исключительно картинки** (`image/*` — `0x667dfa8–0x667dfdc`). При встрече любого другого MIME-типа конвертер немедленно завершал работу ошибкой:
    `failed to convert request to OpenAI format: unsupported inline data mime type: "text/x-python": invalid argument`
    Из-за этого чат, в который был прикреплён скрипт или документ, перманентно крашился при любых последующих запросах к сторонним моделям (включая этап суммаризации контекста `context summarization`).
  - **Исправление ядра (`liblanguage_server.so`)**: в процедуре конвертации медиа-частей запроса (`0x667dfa8–0x667dfdc`) проверки длины MIME-типа (`b.lt`) и префикса `"image/"` (`tbz`) перенаправлены с блока генерации ошибки (`0x667e0b4`) на метку перехода к следующей части сообщения (`0x667ddbc`). Не-графические `inlineData` теперь безопасно пропускаются конвертером OpenAI-формата, запрос формируется корректно, а модель получает текстовый запрос и доступ к файлам на диске без сбоя.
  - Обновлены хеши SHA-256 в манифестах `app/assets/runtime/manifest.json` и `variants/bypass/assets/runtime/manifest.json`.
- **Сборка не публиковалась отдельно** — правки вошли в релиз 3.1.8; отдельного коммита у 3.1.7 нет, изменения зафиксированы вместе с 3.1.8;
- **Версия 3.1.7** (`versionCode` 32) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
- **Fixed a critical third-party provider bug (OpenAI / DeepSeek / Claude / local servers)**:
  - **Root cause**: when a message with attached files is sent (`.py` scripts, `.md` documents, `.ts`/`.js` code, `.json`, `.pdf`, `.txt` files), the frontend creates a `Media` object in the conversation history with a MIME type (`text/x-python`, `text/markdown`, etc.) and an `inlineData` block. When switching to a **third-party provider** (OpenAI-compatible gateway protocol `AGY_LLM_GATEWAY_WIRE_PROTOCOL=openai`), the built-in converter in the core `liblanguage_server.so` (`convertRequestToOpenAI` / `AgentExecutor.Run`) expected **images only** in `inlineData` (`image/*` — `0x667dfa8–0x667dfdc`). On encountering any other MIME type the converter immediately aborted with an error:
    `failed to convert request to OpenAI format: unsupported inline data mime type: "text/x-python": invalid argument`
    As a result, a conversation with an attached script or document crashed permanently on every subsequent request to third-party models (including the `context summarization` stage).
  - **Core fix (`liblanguage_server.so`)**: in the media-part conversion routine (`0x667dfa8–0x667dfdc`) the MIME-length check (`b.lt`) and the `"image/"` prefix check (`tbz`) were redirected from the error-generation block (`0x667e0b4`) to the label that jumps to the next message part (`0x667ddbc`). Non-image `inlineData` is now safely skipped by the OpenAI-format converter, the request is built correctly, and the model receives the text prompt plus access to the files on disk without failing.
  - SHA-256 hashes updated in the manifests `app/assets/runtime/manifest.json` and `variants/bypass/assets/runtime/manifest.json`.
- **Not published as a standalone build** — its changes shipped in release 3.1.8; 3.1.7 has no commit of its own, the changes were recorded together with 3.1.8;
- **Version 3.1.7** (`versionCode` 32) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.6 — 2026-11-15 (Собственные звуки завершения: Bell и Portal)

<!-- RU -->
- **Объединённый релиз: включает правки 3.1.3, 3.1.4 и 3.1.5** — эти сборки выходили как промежуточные и отдельно не публиковались; всё, что в них было (гифка в старой переписке, «отрыв» чата от клавиатуры и его настоящая причина, положение гифки под ответом), собрано здесь;
- **Пресеты звука `Chime` и `Pop` больше не зависят от интернета**: раньше `SOUNDS` в `agy_fun_notify.js` указывал на `https://cdn.jsdelivr.net/gh/hyprwm/hyprland-assets@main/sounds/{chime,pop}.mp3`. Без сети `new Audio(url).play()` молча падал (ошибка гасилась пустым `catch`), а при наличии сети каждый показ гифки тянул файл со стороннего CDN;
- **в APK добавлены два собственных файла**: `app/assets/web/leostryx_bell.mp3` (31 808 Б) и `app/assets/web/leostryx_portal.mp3` (43 354 Б) — исходники `Bell.mp3` и `Portal.mp3` из каталога проекта. Они пакуются в APK штатным обходом `app/` в `rebuild.py`, отдельного кода сборки не потребовалось;
- **`SOUNDS`**: `pop → /leostryx_bell.mp3`, `chime → /leostryx_portal.mp3`. Ключи `pop`/`chime` намеренно оставлены прежними — в `localStorage` у пользователя уже может быть сохранён `agy.funDoneSound`, и смена ключей сбросила бы выбор на «Стандартный»;
- **подписи кнопок**: `🎵 Chime` → `🌀 Portal`, `💧 Pop` → `🛎 Bell` — теперь название пресета совпадает с именем файла;
- cache-buster `agy_fun_notify.js` → `?v=3.1.8`;
- **Версия 3.1.6** (`versionCode` 31) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
- **Merged release: includes the changes from 3.1.3, 3.1.4 and 3.1.5** — those builds were intermediate and were never published on their own; everything they contained (the gif in an old conversation, the chat detaching from the keyboard and its real cause, the gif position under the answer) is collected here;
- **The `Chime` and `Pop` sound presets no longer depend on the internet**: previously `SOUNDS` in `agy_fun_notify.js` pointed at `https://cdn.jsdelivr.net/gh/hyprwm/hyprland-assets@main/sounds/{chime,pop}.mp3`. Offline, `new Audio(url).play()` failed silently (the error was swallowed by an empty `catch`), and online every gif display pulled the file from a third-party CDN;
- **two of our own files added to the APK**: `app/assets/web/leostryx_bell.mp3` (31 808 B) and `app/assets/web/leostryx_portal.mp3` (43 354 B) — the sources `Bell.mp3` and `Portal.mp3` from the project directory. They are packed into the APK by the standard `app/` walk in `rebuild.py`, so no separate build code was needed;
- **`SOUNDS`**: `pop → /leostryx_bell.mp3`, `chime → /leostryx_portal.mp3`. The `pop`/`chime` keys are deliberately kept as before — a user may already have `agy.funDoneSound` stored in `localStorage`, and renaming the keys would reset their choice to "Standard";
- **button captions**: `🎵 Chime` → `🌀 Portal`, `💧 Pop` → `🛎 Bell` — the preset name now matches the file name;
- cache-buster `agy_fun_notify.js` → `?v=3.1.8`;
- **Version 3.1.6** (`versionCode` 31) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.5 — 2026-11-15 (Гифка встаёт вплотную под текстом ответа)

<!-- RU -->
- **Мем-гифка больше не «улетает» в низ экрана**: она вставлялась после всего списка сообщений (`div.mx-auto.w-full` → за `[ref=contentRef]`), а **внешний контейнер последнего хода** в бандле получает `min-height: calc(100cqh - 50px)` (у `autoscroll-viewport` стоит `container-type: size`). Из-за этого последний ход растянут почти на всю высоту ленты, и всё, что вставлено после него, оказывалось у нижней кромки вьюпорта — гифка отрывалась от текста примерно на пол-экрана, хотя в ленте между ними ничего нет;
- **`agy_fun_notify.js`**: новый поиск `lastTurnContent()` — берётся `[data-turn-content="latest"]` (внутренний `flex flex-col gap-0.5 w-full`), и гифка добавляется **в конец последнего хода**, сразу под `[aria-label="Agent response"]`. Это flex-столбец по высоте содержимого, поэтому растянутость хода больше ни на что не влияет;
- заодно: удаление старой гифки ищется по всему документу (`.agy-fun-chat`), а не только внутри контейнера; отступы карточки уменьшены (`margin: 8px auto 4px` вместо `14px auto`);
- fallback-ветки (без `[data-turn-content]`) сохранены — вставка перед блоком ввода или в конец контейнера;
- cache-buster `agy_fun_notify.js` → `?v=3.1.7`;
- **Сборка не публиковалась отдельно** — APK этой версии не выпускался, правки вошли в релиз 3.1.6;
- **Версия 3.1.5** (`versionCode` 30) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
- **The meme gif no longer "flies away" to the bottom of the screen**: it was inserted after the whole message list (`div.mx-auto.w-full` → behind `[ref=contentRef]`), while **the outer container of the last turn** gets `min-height: calc(100cqh - 50px)` in the bundle (`autoscroll-viewport` has `container-type: size`). Because of this the last turn is stretched to almost the full height of the feed, and anything inserted after it ended up at the bottom edge of the viewport — the gif was torn away from the text by about half a screen, even though nothing sits between them in the feed;
- **`agy_fun_notify.js`**: new lookup `lastTurnContent()` — it takes `[data-turn-content="latest"]` (the inner `flex flex-col gap-0.5 w-full`) and the gif is appended **to the end of the last turn**, directly under `[aria-label="Agent response"]`. That is a flex column sized by its content, so the stretched turn no longer affects anything;
- as a bonus: removal of the old gif now searches the whole document (`.agy-fun-chat`) instead of only inside the container; the card margins were reduced (`margin: 8px auto 4px` instead of `14px auto`);
- the fallback branches (without `[data-turn-content]`) are preserved — insertion before the input block or at the end of the container;
- cache-buster `agy_fun_notify.js` → `?v=3.1.7`;
- **Not published as a standalone build** — no APK was produced for this version, its changes shipped in release 3.1.6;
- **Version 3.1.5** (`versionCode` 30) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.4 — 2026-11-15 (Настоящая причина «отрыва» чата от клавиатуры)

<!-- RU -->
Диагностика 3.1.3 была неверной: правки `installScrollGuard()` и `html,body,#root{overflow:hidden}` лечили документ, который при открытии IME **вообще не скроллится**.

- **Найден реальный виновник — `[data-testid="conversation-view"]`**:
  - в бандле `generated/main.js` этот узел рендерится как `flex h-full min-h-0 flex-col items-center relative overflow-y-auto` и содержит **соседями** и ленту сообщений (`autoscroll-viewport` внутри `div.relative.flex.flex-col.flex-1.grow.h-full.w-full.min-h-0`), и строку ввода (`agent-input-box`, `shrink-0`);
  - то есть это **второй, внешний скролл-контейнер, внутри которого лежит предок каретки**. Chromium при появлении клавиатуры прокручивает ближайший скроллируемый предок, чтобы показать каретку — прокручивался именно этот блок: вся панель чата уезжала вверх вместе с полем ввода, а клавиатура оставалась на месте. Отсюда и ощущение «чат открепился от контейнера»;
- **`agy_ru.css`**: `[data-testid="conversation-view"] { overflow: hidden !important; }` (блок с подробным комментарием над правилом). `overscroll-behavior: contain` для него сохранён;
- **`agy_ru.js`**: добавлен сторож `pinConvoScroll()` — обнуляет `scrollTop` / `scrollLeft` у всех `conversation-view`; вызывается из capture-обработчика `scroll` и в начале `nudge()`;
- **`index.html`**: в `<meta name="viewport">` добавлен `interactive-widget=resizes-content` — без него `100dvh` в WebView не уменьшается под IME и оболочка приложения остаётся высотой в полный экран (переменная `--agy-vvh` вычислялась в `installViewport()`, но нигде не использовалась);
- **cache-buster'ы**: `agy_ru.css` → `?v=3.1.7`, `agy_ru.js` → `?v=3.1.7`;
- **Сборка не публиковалась отдельно** — APK этой версии не выпускался, правки вошли в релиз 3.1.6;
- **Версия 3.1.4** (`versionCode` 29) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
The 3.1.3 diagnosis was wrong: the `installScrollGuard()` changes and `html,body,#root{overflow:hidden}` treated a document that **does not scroll at all** when the IME opens.

- **The real culprit found — `[data-testid="conversation-view"]`**:
  - in the `generated/main.js` bundle this node renders as `flex h-full min-h-0 flex-col items-center relative overflow-y-auto` and contains **as siblings** both the message feed (`autoscroll-viewport` inside `div.relative.flex.flex-col.flex-1.grow.h-full.w-full.min-h-0`) and the input row (`agent-input-box`, `shrink-0`);
  - that is, it is a **second, outer scroll container, and the caret's ancestor lives inside it**. When the keyboard appears, Chromium scrolls the nearest scrollable ancestor to reveal the caret — this very block was scrolled: the whole chat panel slid up together with the input field while the keyboard stayed in place. Hence the feeling that "the chat detached from its container";
- **`agy_ru.css`**: `[data-testid="conversation-view"] { overflow: hidden !important; }` (a block with a detailed comment above the rule). Its `overscroll-behavior: contain` is preserved;
- **`agy_ru.js`**: added the guard `pinConvoScroll()` — it zeroes `scrollTop` / `scrollLeft` on every `conversation-view`; it is called from the capture `scroll` handler and at the start of `nudge()`;
- **`index.html`**: added `interactive-widget=resizes-content` to `<meta name="viewport">` — without it `100dvh` does not shrink under the IME inside WebView and the app shell stays a full screen tall (the `--agy-vvh` variable was computed in `installViewport()` but never used);
- **cache-busters**: `agy_ru.css` → `?v=3.1.7`, `agy_ru.js` → `?v=3.1.7`;
- **Not published as a standalone build** — no APK was produced for this version, its changes shipped in release 3.1.6;
- **Version 3.1.4** (`versionCode` 29) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.3 — 2026-11-15 (Исправления: гифка в старых чатах, «отрыв» чата от клавиатуры)

<!-- RU -->
- **Мем-гифка завершения больше не появляется в старых переписках**:
  - Удалена отложенная очередь показа (`pendingChatGif` / `watchChatTimer`): раньше после завершения задачи вне чата гифка «ждала» до 30 секунд и затем вставлялась в любой открытый диалог — включая старую переписку, открытую позже.
  - Триггер переписан на конечный автомат: отправка запроса (`send-button` или Enter в поле ввода) → агент занят (`input-send-button-cancel-tooltip` / `agent-loading`) → пауза после последней активности (`GetTurnDiff`) 4,2 с.
  - Гифка показывается только в той переписке, где отправлялся запрос: `data-cascade-id` у `conversation-view` сравнивается с идентификатором на момент отправки. При несовпадении — `chatInsert:other-chat -> skip`, при отсутствии чата — `chatInsert:not-on-chat-screen -> skip` (без откладывания).
  - Enter не считается отправкой, если после нажатия текст остался в поле ввода (`skip:enter-not-sent`).
  - Кнопка «Показать пример» в «Оформление → Мем-гифки» всегда показывает предпросмотр поверх экрана и не блокируется 12-секундным кулдауном.
- **Чат больше не «отрывается» от контейнера при появлении клавиатуры**:
  - `agy_ru.css`: `html`, `body`, `#root` — `overflow: hidden`, у `conversation-view`, `autoscroll-viewport` и `agent-input-box` — `overscroll-behavior: contain`; прокрутка больше не «перетекает» на документ во время IME-анимации.
  - `web_optimizations.js`: новый патч `installScrollGuard()` — на любое событие `scroll` документа и `visualViewport` (`scroll` / `resize`) возвращает `scrollTop` / `scrollLeft` в 0.
  - Вставка гифки прокручивает только список сообщений (`autoscroll-viewport`) и мгновенно (`scrollTop = scrollHeight`), без `smooth`-анимации всей панели чата.
  - Обновлены cache-buster'ы `agy_ru.css`, `web_optimizations.js`, `agy_fun_notify.js` (`?v=3.1.6`), чтобы WebView не держал старые файлы.
  - ⚠️ **Пометка из 3.1.4:** эти правки причину не устраняли — документ при открытии IME не скроллится вообще. Реальный виновник — `conversation-view` (см. раздел v3.1.4).
- **Сборка не публиковалась отдельно** — правки вошли в релиз 3.1.6 вместе с исправлениями 3.1.4 и 3.1.5; отдельного коммита у 3.1.3 нет;
- **Версия 3.1.3** (`versionCode` 28) в манифесте и «О приложении».
<!-- /RU -->

<!-- EN -->
- **The completion meme gif no longer appears in old conversations**:
  - Removed the deferred display queue (`pendingChatGif` / `watchChatTimer`): previously, after a task finished outside the chat, the gif "waited" up to 30 seconds and then was inserted into whatever dialog was open — including an old conversation opened later.
  - The trigger was rewritten as a state machine: request sent (`send-button` or Enter in the input field) → agent busy (`input-send-button-cancel-tooltip` / `agent-loading`) → pause after the last activity (`GetTurnDiff`) of 4.2 s.
  - The gif is shown only in the conversation where the request was sent: `data-cascade-id` of `conversation-view` is compared with the identifier captured at send time. On mismatch — `chatInsert:other-chat -> skip`, when no chat is open — `chatInsert:not-on-chat-screen -> skip` (no deferral).
  - Enter is not treated as a send if text remained in the input field after the keypress (`skip:enter-not-sent`).
  - The "Show a preview" button in "Appearance → Meme gifs" always shows the preview as an overlay and is not blocked by the 12-second cooldown.
- **The chat no longer "detaches" from its container when the keyboard appears**:
  - `agy_ru.css`: `html`, `body`, `#root` — `overflow: hidden`; `conversation-view`, `autoscroll-viewport` and `agent-input-box` — `overscroll-behavior: contain`; scrolling no longer "spills over" onto the document during the IME animation.
  - `web_optimizations.js`: new patch `installScrollGuard()` — on any `scroll` event of the document and of `visualViewport` (`scroll` / `resize`) it resets `scrollTop` / `scrollLeft` to 0.
  - Inserting the gif scrolls only the message list (`autoscroll-viewport`) and does it instantly (`scrollTop = scrollHeight`), without a `smooth` animation of the whole chat panel.
  - Cache-busters updated for `agy_ru.css`, `web_optimizations.js`, `agy_fun_notify.js` (`?v=3.1.6`) so the WebView does not keep old files.
  - ⚠️ **Note added in 3.1.4:** these changes did not remove the cause — the document does not scroll at all when the IME opens. The real culprit is `conversation-view` (see the v3.1.4 section).
- **Not published as a standalone build** — its changes shipped in release 3.1.6 together with the 3.1.4 and 3.1.5 fixes; 3.1.3 has no commit of its own;
- **Version 3.1.3** (`versionCode` 28) in the manifest and in "About the app".
<!-- /EN -->

## v3.1.2 — 2026-11-14 (Мем-гифки в чате при завершении задач, стабильность сборки)

<!-- RU -->
- **Мем-гифки при завершении задач агента (в переписке)**:
  - Добавлена функция показа мем-анимации прямо в ленте чата (`[data-testid="conversation-view"]`) над строкой ввода.
  - Настоящие анимированные GIF-пресеты: Nice (Майкл Розен), DiCaprio (аплодисменты), Bateman (улыбка), Deadpool (Very Nice), Jeremiah Johnson (одобрительный кивок).
  - Поддержка пользовательских GIF/видео через ввод URL и предпросмотр в настройках «Оформление».
  - Конвертация в data URI через FileReader с предзагрузкой при старте — мгновенный рендер без сетевых задержек и SSL-ограничений WebView.
  - Умный триггер завершения задач: срабатывает строго после отправки запроса пользователем (`SendUserCascadeMessage` / Enter) и паузы стриминга (`GetTurnDiff`).
  - Полное устранение ложных срабатываний: при листании истории или открытии старых диалогов гифка не показывается.
  - Аварийный kill-switch (`agyFunSafeMode=1`) и полная изоляция триггеров в try/catch.
- **Оптимизация упаковки исходников в rebuild.py**:
  - Исключены директории `.git` и `dist` из архива исходников `Leostryx-repo.zip`, что уменьшило размер архива с 750 МБ до 275 МБ.
  - Ликвидированы зависания терминала и генерация мусорных временных файлов `zi*` на диске.
<!-- /RU -->

<!-- EN -->
- **Meme gifs when an agent task finishes (inside the conversation)**:
  - Added a function that shows the meme animation right in the chat feed (`[data-testid="conversation-view"]`) above the input row.
  - Real animated GIF presets: Nice (Michael Rosen), DiCaprio (applause), Bateman (smile), Deadpool (Very Nice), Jeremiah Johnson (approving nod).
  - Support for custom GIF/video via URL input with a preview in the "Appearance" settings.
  - Conversion to a data URI via FileReader with preloading at startup — instant rendering without network delays and without WebView SSL restrictions.
  - Smart completion trigger: fires strictly after the user has sent a request (`SendUserCascadeMessage` / Enter) and streaming has paused (`GetTurnDiff`).
  - Complete elimination of false positives: the gif is not shown when scrolling through history or opening old dialogs.
  - An emergency kill-switch (`agyFunSafeMode=1`) and full isolation of the triggers inside try/catch.
- **Optimised source packing in rebuild.py**:
  - The `.git` and `dist` directories are excluded from the `Leostryx-repo.zip` source archive, which shrank it from 750 MB to 275 MB.
  - Terminal freezes and the generation of junk temporary `zi*` files on disk were eliminated.
<!-- /EN -->

## v3.1.1 fix — 2026-11-14 (Исправления: плавный прогресс обновления, статус Gradle)

<!-- RU -->
- **Версия повышена до 3.1.1** (versionName/versionCode в манифесте, «О приложении»).
- **Плавный прогресс загрузки в встроенном обновлении** («О приложении → Обновить»):
  - Процент больше не «прыгает» (0 → 7 → 100): добавлен интерполяционный тикер (lerp, шаг 100 мс), который плавно доводит отображаемое значение до реального прогресса загрузки.
  - Интервал опроса прогресса сокращён с 350 до 250 мс; по завершении загрузки прогресс гарантированно доводится до 100%.
- **Статус Gradle: кнопка «Переключить» вместо «Установить» для скачанных версий**:
  - Подтверждена и зафиксирована передача `@@gradle-cached` в статусе «Инструментов»: скачанная в `$HOME/gradle-dist`, но неактивная версия Gradle всегда помечается бейджем «Скачана — переключение мгновенное» и кнопкой «Переключить» (мгновенное переключение симлинком, без повторного скачивания).
<!-- /RU -->

<!-- EN -->
- **Version raised to 3.1.1** (versionName/versionCode in the manifest, "About the app").
- **Smooth download progress in the built-in updater** ("About the app → Update"):
  - The percentage no longer "jumps" (0 → 7 → 100): an interpolation ticker was added (lerp, 100 ms step) that smoothly brings the displayed value up to the real download progress.
  - The progress polling interval was cut from 350 to 250 ms; when the download completes, the progress is guaranteed to reach 100%.
- **Gradle status: a "Switch" button instead of "Install" for downloaded versions**:
  - Passing `@@gradle-cached` in the "Tools" status is confirmed and locked in: a Gradle version downloaded into `$HOME/gradle-dist` but not active is always marked with the badge "Downloaded — switching is instant" and a "Switch" button (instant switch via a symlink, with no re-download).
<!-- /EN -->

## v3.1.0 — 2026-11-12 (Стабильный базовый релиз: устранение фризов прикрепления файлов, шторка, стеклянные окна)

<!-- RU -->
- **Диагностика и починка битых build-tools (главный баг Leostryx)**:
  - `status` в «Инструментах» теперь определяет, где установлен SDK (`@@sdkhome`): общее хранилище (`/storage/...`, noexec — ELF-бинарники оттуда не запускаются, `aidl` падает с «Permission denied») или внутреннее (`$HOME/android-sdk`). При shared-пути показывается предупреждение с рекомендацией переустановить SDK во внутреннее хранилище и указать `sdk.dir` на внутренний путь.
  - Обнаружение битых заглушек (`@@stub`): `aidl`/`apksigner`/`d8` с чужим shebang (например `#!/data/user/0/com.agr/...` от другой песочницы) помечаются в статусе.
  - Новая операция `repairbt` (кнопка «Починить»): перепривязывает `aidl/aapt/aapt2/zipalign/d8/apksigner` во всех `build-tools/*` на рабочие бинарники из `$PREFIX/bin` (настоящий aarch64 ELF `aidl`; `d8`/`apksigner` через `java` из PATH), оригиналы сохраняются как `.agy-original`.

- **Новый блок «Gradle & AGP» в «Настройки → Инструменты»**:
  - Выбор версии Gradle (8.9 / 8.14.7 / 9.1.0 / 9.9.1) через сворачиваемый селектор «Версии ▼» — по аналогии с Android-платформами и Build-tools. Дистрибутив скачивается с `services.gradle.org` в `$HOME/gradle-dist`, симлинк `$PREFIX/bin/gradle` переключается на выбранную версию (пакетный Gradle резервируется как `.agy-original`, мосты с `JAVA_TOOL_OPTIONS`/`GRADLE_OPTS` обновляются автоматически). Кнопка «Удалить» возвращает пакетный Gradle.
  - **Мультивыбор Gradle**: можно выбрать несколько версий сразу — устанавливаются все выбранные (каждая скачивается/кэшируется в `$HOME/gradle-dist`), активной становится последняя выбранная. Исправлен баг, при котором выбиралась только последняя версия из отмеченных.
  - **Кэширование версий**: скачанные версии Gradle сохраняются в `$HOME/gradle-dist` и переключаются мгновенно (симлинк) без повторного скачивания. В статусе добавлен `@@gradle-cached`, в UI скачанная, но неактивная версия помечается бейджем «Скачана — переключение мгновенное».
  - Из блока «Java и Kotlin» удалён дубль пункта Gradle — установка Gradle только через отдельный блок «Gradle & AGP»; пресет «Android-приложение (Gradle)» теперь ставит Gradle 8.14.7.
  - **Авто-выбор версии Gradle** («Gradle (авто)»): версия подбирается автоматически исходя из проекта — 1) из `gradle/wrapper/gradle-wrapper.properties` (distributionUrl), 2) из заметки AGP `# AGY-AGP:` в `AGENTS.md` (минимально совместимая), 3) последняя стабильная с `services.gradle.org/versions/current` (fallback 9.9.1 без сети).
  - Выбор версии Android Gradle Plugin (8.7.3 / 9.0.0): записывает совместимость (AGP 8.x → Gradle ≥ 8.9, JDK 17; AGP 9.x → Gradle ≥ 9.1, JDK 17+) в `AGENTS.md` проекта (идемпотентное обновление блока `# AGY-AGP:`), чтобы агент использовал корректные версии.
  - В статусе добавлены `@@gradle-active` (активная версия Gradle) и `@@agp-active` (выбранная AGP).

- **Мгновенное открытие меню медиа («+») без сдвига контейнера**:
  - Устранён сдвиг контейнера влево и появление полосы справа: функция блокировки скролла Base UI (`GMa` в `main.js`) уменьшала ширину `body` на 15px (`calc(100vw - 15px)`). Зафиксирована ширина `width: "100%"` и добавлены защитные правила в `agy_ru.css`.
  - Ликвидирована задержка открытия попапа: событие `pointerdown` на кнопке «+» обрабатывается мгновенно в кадре 0 без ожидания синтетического click, а фоновая загрузка кастомных скриптов агента отложена на 60мс через `setTimeout`.
- **Стабильная работа чата и агентов в фоне (без обрывов при сворачивании)**:
  - В `AppLifecycle.smali` порог `onTrimMemory` увеличен с 10 (`0xa`) до 80 (`0x50`, `TRIM_MEMORY_COMPLETE`). Сворачивание приложения (`TRIM_MEMORY_UI_HIDDEN = 20`) больше не вызывает очистку кэша WebView и агрессивный GC.
  - В `WebSettingsFactory.smali` включён `setOffscreenPreRaster(true)` для поддержания конвейера отрисовки WebView в фоновом режиме.
  - В `agy_ru.js` добавлен фоновый keep-alive аудиолуп на время активной генерации: сигнализирует Chromium о приоритетной медиа-сессии, предотвращая засыпание JS event loop и разрыв стриминговых fetch/SSE соединений.
- **Выбор шрифтов интерфейса в Настройки › Оформление**:
  - Блок «Шрифт интерфейса»: выпадающий список выбора выровнен по ширине на 100% блока предпросмотра, убрано усечение названий (`max-width: 140px`).
  - Каталог из 9 открытых шрифтов без нарушения авторских прав (лицензии SIL OFL 1.1, Apache 2.0, Ubuntu Font Licence) с одинаково выверенной поддержкой кириллицы и латиницы:
    1. *Системный (По умолчанию)* — Roboto / MiSans;
    2. *Inter* — эталонный современный UI-гротеск (SIL OFL);
    3. *JetBrains Mono* — специализированный шрифт для кода и редакторов (SIL OFL);
    4. *Fira Code* — моноширинный шрифт с лигатурами (SIL OFL);
    5. *Roboto* — нативный Android-гротеск (Apache 2.0);
    6. *Geist* — технический геометрический гротеск (SIL OFL);
    7. *Montserrat* — геометрический акцидентный гротеск (SIL OFL);
    8. *Ubuntu* — гуманистический гротеск с отличной читаемостью (Ubuntu Licence);
    9. *PT Root UI* — шрифт, специально созданный для цифровой кириллицы (SIL OFL).
  - Мгновенное применение через CSS-токены `--default-font-family`, `--font-sans`, `--font-mono` и синхронизация в `theme-bootstrap.js` до первой отрисовки страницы без мелькания (FOUT).
- **Мгновенное прикрепление файлов («Attach File» / «+») без задержек и черного экрана**:
  - Полностью устранён чёрный экран при открытии проводника: удалён нативный сброс анимации переходов `overridePendingTransition(0, 0)`, который уничтожал поверхность окна `MainActivity` до того, как DocumentsUI успевал отрисовать первый кадр. Теперь фоновая активность сохраняется плавно до появления окна выбора файла.
  - Устранена задержка открытия проводника DocumentsUI: заменён медленный массив из 50 MIME-типов (`accept={PYb}`) на прямой `*/*`, что исключило построение тяжелых SQL-фильтров в системном ContentProvider.
  - **Кнопка «Медиа» больше не тормозит**: `MainActivity.onShowFileChooser` переведён с `ACTION_GET_CONTENT` на `ACTION_OPEN_DOCUMENT`. `GET_CONTENT` сначала поднимает системный диалог выбора приложения, и только потом DocumentsUI — это и была задержка в несколько секунд; `OPEN_DOCUMENT` открывает файловый менеджер сразу, как и кнопка «Папка» (`OPEN_DOCUMENT_TREE`).
  - Побочный, но важный эффект: `takePersistableUriPermission()` в `onActivityResult` теперь работает корректно — постоянные разрешения выдаются только для URI, полученных через `OPEN_DOCUMENT`.
  - Исключена рассинхронизация soft-keyboard: убран синхронный `hideSoftInputFromWindow` перед запуском `startActivityForResult`, предотвращая лишний рефлоу окна.
  - В `main.js` клик по элементу контекстного меню выполняется без лишней синхронной работы, что позволяет меню Radix UI плавно закрыться до появления нативного файлового диалога.
  - **Вторая причина тормозов «Медиа»** — список из ~50 MIME-типов в `accept` у общего поля ввода: пункт «Медиа» переиспользует инпут композера (`accept={PYb}`), тогда как «Папка» использует отдельный голый `webkitdirectory`-инпут. Нативный `onShowFileChooser` всё равно открывает `*/*` и игнорирует `accept`, поэтому список был чистой нагрузкой и удалён из бандла (`PYb` схлопнут до wildcard-MIME). В `agy_ru.js` осталась только регресс-защита: если длинный список вернётся с обновлением бандла, он схлопывается на клике. Клик при этом **не перехватывается** — `preventDefault`/`stopPropagation` не вызываются, диалог открывает сам React, поэтому кнопка «Медиа» работает и в тех случаях, когда синтетический путь не срабатывает.
  - Устранён бесконечный спиннер терминала при инициализации xterm.
  - Оптимизирован рефлоу в `agy_ru.js` (замена `innerText` на `textContent`).
- **Чип `/browser` и упоминания удаляются тапом**:
  - `/browser` вставляется не текстом, а inline-узлом Lexical `beautifulMention`, поэтому нативный Backspace рядом с ним не удалял его.
  - В `agy_ru.js` добавлен перехват клика по чипу: удаление через API самого редактора (`__lexicalEditor` → `editor.update()` → `node.remove()`), а если API недоступен — синтетический `Backspace` сразу после каретки, с повтором через 130 мс.
- **Клавиатура открывается сразу после вложения и вставки чипа**:
  - `focusEditor()` возвращает фокус в `[contenteditable='true']` внутри `[data-testid='agent-input-box']` через 120 мс после появления `[data-testid='input-attachment']` и через 140 мс после клика по пунктам Mentions / Actions / Browser.
  - Кнопки `+`, селектор модели, щит и микрофон по-прежнему не открывают клавиатуру — защита `guard` не менялась.
- **Выразительная прозрачность стеклянных окон и списков (Glass UI)**:
  - Плотность стекла: **0.88** в тёмных темах и **0.72** в светлых. 0.88 — исторически «идеальная» плотность из эталонного коммита: сквозь попап читаются карточки и текст, но панель остаётся плотной и не «плывёт».
  - Поверхность стекла — **ровно `--background` активной темы**, без подмешивания `--primary`. Акцент в поверхности давал грязный оттенок, не совпадающий с фоном (Monokai уходил в оливковый, Dracula — в фиолетовый), поэтому `--primary` остаётся только в рамке, ховере, активном состоянии и тени.
  - В светлых темах фон темы **затемняется на 12 %** перед наложением альфы: белое стекло поверх белой страницы физически не даёт видимой прозрачности ни при какой альфе (`C = α·255 + (1−α)·255 = 255`).
  - Затемнение считается в `updateGlassTheme()` один раз, поэтому светлые темы получают ровно ту же видимую прозрачность, что и тёмные. CSS-фолбэки `--agy-glass-surface` синхронизированы с этими числами, чтобы стекло не вспыхивало другим оттенком до первого кадра JS.
  - `backdrop-filter` принудительно отключён (`none !important`) на всех стеклянных слоях: требование — **чистая прозрачность без размытия**, а не матовое стекло.
  - Устранены непрозрачные участки («местами»): селектор `[class*="animate-slideIn"]` и очистка внутренних слоев применены универсально ко всем попапам вне зависимости от родительского z-index, исключая перекрытие белыми непрозрачными слоями.
  - Восстановлена естественная геометрия выпадающих списков Base UI в Настройках без вылетов за границы экрана.
- **Сессия больше не обрывается при уходе в фон и блокировке экрана**:
  - **Причина.** На MIUI/HyperOS включён `mDozeAfterScreenOff=true`: Doze стартует сразу после гашения экрана и блокирует приложению сеть. Передний сервис и `PARTIAL_WAKE_LOCK` держат CPU, но не спасают поток `core ↔ gateway`, поэтому активный чат рвался, а после разблокировки оставался «мёртвым». Пакета не было в исключениях энергосбережения (`dumpsys deviceidle whitelist`).
  - **Восстановление при возврате.** `agy_ru.js` подписан на `agy:host-resume` (событие приходит из `WebViewLifecycle.resume()`) и `resume`: заново поднимает silent-media keep-alive, если чат выполняется, и диспатчит синтетический `online`, чтобы стрим-хелпер `$i` в `main.js` сделал немедленный ретрай вместо ожидания следующего тика.
  - **Исключение из Doze.** В `agy_tools.sh` добавлена операция `power`: через Shizuku (`rish`) проверяет `dumpsys deviceidle whitelist` и при необходимости выполняет `cmd deviceidle whitelist +com.agyru.t2`, затем пишет состояние в лог (`@@power … whitelisted=yes|no|no-rish`). Без Shizuku операция честно сообщает `no-rish` и ничего не меняет.
  - **Тихий автозапуск.** `agy_ru.js` вызывает операцию не чаще одного раза в 6 часов (`localStorage["agyPowerExemptCheck"]`) и только пишет `console.warn`, если исключение получить не удалось — никаких диалогов и новых экранов.
  - **Медиа-сессия.** После гашения экрана система обычно сносит silent-audio сессию, из-за чего следующий уход в фон оставался без защиты — теперь она пересоздаётся при каждом возврате в приложение.
- **Уведомления подтверждения из шторки больше не спамят**:
  - Пока приложение **открыто** — уведомления из шторки не отправляются вообще
    (`nativeNotifications.send` пропускает отправку при `!document.hidden`);
  - Полностью удалено лишнее пассивное уведомление «Leostryx — Агент работает / Задача выполняется в фоне…»:
    в шторке уже горит постоянный статус ядра «Leostryx core running», дублирующие уведомления удалены;
  - Одно и то же ожидающее подтверждение уведомляет **один раз** (дедупликация
    по тексту сниппета, а не по DOM-кнопке, которую React пересоздаёт);
  - После разрешения подтверждения уведомление из шторки **автоматически
    отменяется**;
  - События завершения `agent-finished-*` теперь всегда пассивные — без кнопок
    «Разрешить / Продолжить».
- **Логотип акцентного цвета на сплэш-скрине и при запуске приложения**:
  - `tools/brand.py` динамически считывает активный цвет пользователя (`#ec4899`) и тинтирует
    `res/drawable-nodpi-v4/splash_logo.png`, иконки лаунчера и уведомлений в выбранный акцент;
  - Нативный экран загрузки ОС Android 12+ (SplashScreen) отображает рысь в розовом цвете;
  - `theme-bootstrap.js` мгновенно применяет переменные акцента (`--primary`, `--accent`)
    из `localStorage["agyBrandConfig"]` до первой отрисовки страницы;
  - `brand_logo.js` распознаёт `props.color: true` на экране входа/запуска и
    гарантированно перекрашивает логотип в брендовый акцентный цвет.
- **Селектор моделей — разделители и названия провайдеров**:
  - Кастомные модели (`RXb`) получили селекторные атрибуты `data-testid="model-selector-item"`
    и `data-model-label`;
  - Метаданные `__agyProviderSpecs` и `cKa` теперь содержат `providerName` и `providerType`;
  - Модели в секции Custom автоматически группируются по провайдерам;
  - Перед моделями каждого провайдера отображаются четкие разделители и названия
    (OpenAI, Claude, Gemini и др.).
- **Исправлен фейковый чат с точкой на экране «Проекты»** при переключении провайдера:
  - Устранена утечка пустого `conversationId` в состоянии моделей `fKa` (`main.js`);
  - Запрещена фоновая отправка завершающих heads-up уведомлений при открытом приложении.
- **Java-сторона (`AgyShade`)**: булев параметр `needsAction` теперь реально
  управляет добавлением кнопок (раньше игнорировался и кнопки добавлялись
  всегда); добавлен `Notification.Builder.setOnlyAlertOnce(true)` — обновление
  уведомления больше не «прыгает» шторкой повторно.
- **Полное руководство по исправленным багам** оформлено в отдельном документе:
  [`docs/BUGFIXES_3.1.0.md`](docs/BUGFIXES_3.1.0.md).
<!-- /RU -->

<!-- EN -->
**Stable base release: file-attachment freezes fixed, notification shade, glass windows**

- **Diagnosis and repair of broken build-tools (the main Leostryx bug)**:
  - `status` in "Tools" now detects where the SDK is installed (`@@sdkhome`): shared storage (`/storage/...`, noexec — ELF binaries cannot be executed from there and `aidl` dies with "Permission denied") or internal storage (`$HOME/android-sdk`). With a shared path a warning is shown recommending reinstalling the SDK into internal storage and pointing `sdk.dir` at the internal path.
  - Detection of broken stubs (`@@stub`): `aidl`/`apksigner`/`d8` with a foreign shebang (for example `#!/data/user/0/com.agr/...` from another sandbox) are flagged in the status.
  - New operation `repairbt` (the "Repair" button): re-binds `aidl/aapt/aapt2/zipalign/d8/apksigner` in every `build-tools/*` to working binaries from `$PREFIX/bin` (a real aarch64 ELF `aidl`; `d8`/`apksigner` via `java` from PATH); the originals are kept as `.agy-original`.

- **New "Gradle & AGP" block in "Settings → Tools"**:
  - Gradle version selection (8.9 / 8.14.7 / 9.1.0 / 9.9.1) through a collapsible "Versions ▼" selector — mirroring Android platforms and Build-tools. The distribution is downloaded from `services.gradle.org` into `$HOME/gradle-dist`, the `$PREFIX/bin/gradle` symlink is switched to the selected version (the packaged Gradle is preserved as `.agy-original`, the `JAVA_TOOL_OPTIONS`/`GRADLE_OPTS` bridges are updated automatically). The "Delete" button restores the packaged Gradle.
  - **Gradle multi-select**: several versions can be chosen at once — all selected ones are installed (each downloaded/cached in `$HOME/gradle-dist`) and the last selected one becomes active. Fixed a bug where only the last of the ticked versions was installed.
  - **Version caching**: downloaded Gradle versions are kept in `$HOME/gradle-dist` and switch instantly (symlink) with no re-download. `@@gradle-cached` was added to the status; in the UI a downloaded but inactive version is marked with the badge "Downloaded — switching is instant".
  - The duplicate Gradle entry was removed from the "Java and Kotlin" block — Gradle is installed only through the dedicated "Gradle & AGP" block; the "Android app (Gradle)" preset now installs Gradle 8.14.7.
  - **Automatic Gradle version selection** ("Gradle (auto)"): the version is picked automatically from the project — 1) from `gradle/wrapper/gradle-wrapper.properties` (distributionUrl), 2) from the AGP note `# AGY-AGP:` in `AGENTS.md` (the minimum compatible one), 3) the latest stable from `services.gradle.org/versions/current` (fallback 9.9.1 when offline).
  - Android Gradle Plugin version selection (8.7.3 / 9.0.0): writes the compatibility matrix (AGP 8.x → Gradle ≥ 8.9, JDK 17; AGP 9.x → Gradle ≥ 9.1, JDK 17+) into the project's `AGENTS.md` (idempotent update of the `# AGY-AGP:` block) so the agent uses the correct versions.
  - `@@gradle-active` (active Gradle version) and `@@agp-active` (selected AGP) were added to the status.

- **Instant opening of the media menu ("+") without shifting the container**:
  - Removed the container shift to the left and the stripe appearing on the right: Base UI's scroll-lock helper (`GMa` in `main.js`) shrank `body` width by 15px (`calc(100vw - 15px)`). The width is pinned to `width: "100%"` and defensive rules were added to `agy_ru.css`.
  - The popup opening delay is gone: the `pointerdown` event on the "+" button is handled instantly on frame 0 without waiting for a synthetic click, and the background loading of custom agent scripts is deferred by 60 ms via `setTimeout`.
- **Stable chat and agent operation in the background (no drops when minimising)**:
  - In `AppLifecycle.smali` the `onTrimMemory` threshold was raised from 10 (`0xa`) to 80 (`0x50`, `TRIM_MEMORY_COMPLETE`). Minimising the app (`TRIM_MEMORY_UI_HIDDEN = 20`) no longer triggers a WebView cache purge and aggressive GC.
  - `setOffscreenPreRaster(true)` was enabled in `WebSettingsFactory.smali` to keep the WebView rendering pipeline alive in the background.
  - A background keep-alive audio loop was added in `agy_ru.js` while generation is active: it signals Chromium that a priority media session exists, preventing the JS event loop from sleeping and the streaming fetch/SSE connections from dropping.
- **Interface font selection in Settings › Appearance**:
  - "Interface font" block: the dropdown is aligned to 100% of the preview block's width and name truncation is gone (`max-width: 140px`).
  - A catalogue of 9 open fonts with no copyright issues (SIL OFL 1.1, Apache 2.0, Ubuntu Font Licence) and equally verified Cyrillic and Latin coverage:
    1. *System (Default)* — Roboto / MiSans;
    2. *Inter* — the reference modern UI grotesque (SIL OFL);
    3. *JetBrains Mono* — a typeface purpose-built for code and editors (SIL OFL);
    4. *Fira Code* — a monospaced font with ligatures (SIL OFL);
    5. *Roboto* — the native Android grotesque (Apache 2.0);
    6. *Geist* — a technical geometric grotesque (SIL OFL);
    7. *Montserrat* — a geometric display grotesque (SIL OFL);
    8. *Ubuntu* — a humanist grotesque with excellent legibility (Ubuntu Licence);
    9. *PT Root UI* — a font created specifically for digital Cyrillic (SIL OFL).
  - Instant application through the CSS tokens `--default-font-family`, `--font-sans`, `--font-mono` and synchronisation in `theme-bootstrap.js` before the first paint, with no flicker (FOUT).
- **Instant file attachment ("Attach File" / "+") with no delays and no black screen**:
  - The black screen when opening the file picker is completely gone: the native transition-animation reset `overridePendingTransition(0, 0)` was removed — it destroyed `MainActivity`'s window surface before DocumentsUI could render its first frame. The background activity now survives smoothly until the file chooser appears.
  - The DocumentsUI opening delay is gone: the slow array of 50 MIME types (`accept={PYb}`) was replaced with a plain `*/*`, which avoided building heavy SQL filters in the system ContentProvider.
  - **The "Media" button no longer lags**: `MainActivity.onShowFileChooser` was switched from `ACTION_GET_CONTENT` to `ACTION_OPEN_DOCUMENT`. `GET_CONTENT` first raises the system app-picker dialog and only then DocumentsUI — that was the several-second delay; `OPEN_DOCUMENT` opens the file manager immediately, exactly like the "Folder" button (`OPEN_DOCUMENT_TREE`).
  - A side effect, but an important one: `takePersistableUriPermission()` in `onActivityResult` now works correctly — persistent permissions are only granted for URIs obtained through `OPEN_DOCUMENT`.
  - Soft-keyboard desynchronisation eliminated: the synchronous `hideSoftInputFromWindow` before `startActivityForResult` was removed, preventing an extra window reflow.
  - In `main.js` a click on a context-menu item now runs without extra synchronous work, letting the Radix UI menu close smoothly before the native file dialog appears.
  - **The second cause of "Media" lag** — the list of ~50 MIME types in the shared input field's `accept`: the "Media" item reuses the composer input (`accept={PYb}`), whereas "Folder" uses a separate bare `webkitdirectory` input. Native `onShowFileChooser` opens `*/*` anyway and ignores `accept`, so the list was pure overhead and was removed from the bundle (`PYb` collapsed to a wildcard MIME). What remains in `agy_ru.js` is only regression protection: if the long list returns with a bundle update, it is collapsed on click. The click itself is **not intercepted** — `preventDefault`/`stopPropagation` are not called and React opens the dialog, so the "Media" button also works in cases where the synthetic path fails.
  - The endless terminal spinner during xterm initialisation is fixed.
  - Reflow in `agy_ru.js` optimised (`innerText` replaced with `textContent`).
- **The `/browser` chip and mentions are deleted by tapping**:
  - `/browser` is inserted not as text but as a Lexical inline node `beautifulMention`, so a native Backspace next to it did not delete it.
  - A click interceptor on the chip was added in `agy_ru.js`: deletion goes through the editor's own API (`__lexicalEditor` → `editor.update()` → `node.remove()`), and if that API is unavailable a synthetic `Backspace` is sent right after the caret, repeated after 130 ms.
- **The keyboard opens immediately after attaching a file or inserting a chip**:
  - `focusEditor()` returns focus to `[contenteditable='true']` inside `[data-testid='agent-input-box']` 120 ms after `[data-testid='input-attachment']` appears and 140 ms after a click on the Mentions / Actions / Browser items.
  - The `+` button, the model selector, the shield and the microphone still do not open the keyboard — the `guard` protection is unchanged.
- **Expressive transparency of the glass windows and lists (Glass UI)**:
  - Glass density: **0.88** in dark themes and **0.72** in light ones. 0.88 is historically the "ideal" density from the reference commit: cards and text read through the popup, yet the panel stays dense and does not "float".
  - The glass surface is **exactly `--background` of the active theme**, with no `--primary` mixed in. The accent in the surface produced a dirty tint that clashed with the background (Monokai drifted olive, Dracula purple), so `--primary` now remains only in the border, hover, active state and shadow.
  - In light themes the theme background is **darkened by 12 %** before the alpha is composited: white glass over a white page physically produces no visible transparency at any alpha (`C = α·255 + (1−α)·255 = 255`).
  - The darkening is computed once in `updateGlassTheme()`, so light themes get exactly the same visible transparency as dark ones. The CSS fallbacks of `--agy-glass-surface` are synced to these numbers so the glass does not flash a different tint before the first JS frame.
  - `backdrop-filter` is force-disabled (`none !important`) on every glass layer: the requirement is **clean transparency without blur**, not frosted glass.
  - Opaque patches ("in places") eliminated: the `[class*="animate-slideIn"]` selector and the clearing of inner layers are applied universally to all popups regardless of the parent z-index, ruling out coverage by opaque white layers.
  - The natural geometry of Base UI dropdowns in Settings is restored, with no overflow beyond the screen edges.
- **The session no longer drops when the app goes to the background or the screen locks**:
  - **Cause.** MIUI/HyperOS ships with `mDozeAfterScreenOff=true`: Doze starts as soon as the screen turns off and blocks the app's network. The foreground service and the `PARTIAL_WAKE_LOCK` keep the CPU alive but do not save the `core ↔ gateway` stream, so an active chat broke and stayed "dead" after unlocking. The package was not in the battery-saving allow-list (`dumpsys deviceidle whitelist`).
  - **Recovery on return.** `agy_ru.js` subscribes to `agy:host-resume` (the event comes from `WebViewLifecycle.resume()`) and to `resume`: it restarts the silent-media keep-alive if a chat is running and dispatches a synthetic `online` so the stream helper `$i` in `main.js` retries immediately instead of waiting for the next tick.
  - **Exemption from Doze.** A new `power` operation was added to `agy_tools.sh`: through Shizuku (`rish`) it checks `dumpsys deviceidle whitelist` and, if needed, runs `cmd deviceidle whitelist +com.agyru.t2`, then writes the state to the log (`@@power … whitelisted=yes|no|no-rish`). Without Shizuku the operation honestly reports `no-rish` and changes nothing.
  - **Silent autostart.** `agy_ru.js` calls the operation no more than once every 6 hours (`localStorage["agyPowerExemptCheck"]`) and only writes `console.warn` if the exemption could not be obtained — no dialogs and no new screens.
  - **Media session.** After the screen turns off the system usually tears down the silent-audio session, leaving the next background trip unprotected — it is now recreated on every return to the app.
- **Confirmation notifications from the shade no longer spam**:
  - While the app is **open**, shade notifications are not sent at all
    (`nativeNotifications.send` skips sending when `!document.hidden`);
  - The superfluous passive notification "Leostryx — Agent is working / A task is running in the background…" was removed entirely:
    the shade already shows the persistent core status "Leostryx core running", so duplicate notifications are gone;
  - The same pending confirmation notifies **once** (deduplication
    by snippet text rather than by the DOM button React recreates);
  - Once a confirmation is resolved, the shade notification is **cancelled
    automatically**;
  - The `agent-finished-*` completion events are now always passive — without
    "Allow / Continue" buttons.
- **Accent-coloured logo on the splash screen and at app launch**:
  - `tools/brand.py` dynamically reads the user's active colour (`#ec4899`) and tints
    `res/drawable-nodpi-v4/splash_logo.png`, the launcher icons and the notification icons to the selected accent;
  - The native Android 12+ boot screen (SplashScreen) shows the lynx in pink;
  - `theme-bootstrap.js` applies the accent variables (`--primary`, `--accent`)
    from `localStorage["agyBrandConfig"]` instantly, before the first paint;
  - `brand_logo.js` recognises `props.color: true` on the sign-in/launch screen and
    reliably recolours the logo to the brand accent.
- **Model selector — separators and provider names**:
  - Custom models (`RXb`) received the selector attributes `data-testid="model-selector-item"`
    and `data-model-label`;
  - The `__agyProviderSpecs` and `cKa` metadata now carry `providerName` and `providerType`;
  - Models in the Custom section are grouped by provider automatically;
  - Before each provider's models, clear separators and names are displayed
    (OpenAI, Claude, Gemini and others).
- **Fixed the fake chat with a dot on the "Projects" screen** when switching provider:
  - An empty `conversationId` leak in the model state `fKa` (`main.js`) is eliminated;
  - Background sending of closing heads-up notifications while the app is open is forbidden.
- **Java side (`AgyShade`)**: the boolean `needsAction` parameter now genuinely
  controls whether buttons are added (previously it was ignored and buttons were added
  always); `Notification.Builder.setOnlyAlertOnce(true)` was added — updating a
  notification no longer re-raises the shade.
- **The complete guide to the fixed bugs** is written up in a separate document:
  [`docs/BUGFIXES_3.1.0.md`](docs/BUGFIXES_3.1.0.md).
<!-- /EN -->

## v3.0.9 — 2026-11-11 (Comprehensive Fixes & System Integrations)

<!-- RU -->
- **Восстановление истинной прозрачности и матового стекла (Frosted Glass)**:
  - Исправлены CSS-переменные `--popover`, `--card` и `--background` для обеих тем (светлой и тёмной);
  - Добавлено принудительное размытие `backdrop-filter: blur(22px) saturate(180%) !important` на все шторки, меню, поповеры и диалоги без перекрытия фоновыми подложками.
- **Обновление номера билда при установке поверх**:
  - В бинарном `AndroidManifest.xml` обновлены атрибуты `versionCode` (до 25) и `versionName` (до "3.0.9");
  - Номер версии теперь корректно обновляется в информации о приложении и контекстном меню ярлыка Android.
- **Динамическое переключение значка на рабочем столе Android**:
  - В `agy_tools.sh` (`op_brand`) добавлено мгновенное переключение активного `activity-alias` (`LauncherOwl`, `LauncherLynx`, `LauncherLsx`, `LauncherAngularX`) через `pm` и Shizuku (`rish`), позволяя иконке на рабочем столе сразу менять стиль.
- **Устранение региональной блокировки аккаунтов**:
  - Решена проблема «Этот аккаунт не может использовать Leostryx»: бинарник `liblanguage_server.so` с обходом региональных ограничений интегрирован напрямую в базу приложения `app/`;
  - Встроенный установщик обновлений теперь в первую очередь скачивает `-bypass.apk`.
- **Автоматическое закрытие устаревшего уведомления о моделях Claude**:
  - Полностью переписан сканер закрытия уведомлений в `agy_ru.js`: диалог с предупреждением о переходе на версии 5.5 от 2 ноября мгновенно скрывается вместе с оверлеем и подтверждается по кнопке.
- **Пакеты zip и unzip в категории «Архивы»**:
  - Пакеты `zip` и `unzip` перенесены в раздел «Архивы» каталога инструментов над остальными форматами.
- **Полные краткие описания для всех пакетов**:
  - Добавлены краткие описания на русском и английском языках для всех пакетов (`make`, `cmake`, `ninja`, `pkg-config`, `pip`, `kotlin`, `maven`, `rust`, `go`, `git`, `gh`, `openssh`, `curl`, `wget`, `jq`, `ripgrep`, `fd`, `tree`, SDK platforms и build-tools).
- **Исправление установки Android SDK (37.x)**:
  - Для preview/canary платформ (`android-37.0`, `android-37.1`) и `build-tools;37.0.0` в `op_sdk` автоматически подключается флаг `--channel=3` (canary) в `sdkmanager`.
- **Кнопка вызова субагентов в чате**:
  - Полностью переработан механизм встраивания кнопки 🤖 в панель ввода чата: многоуровневый поиск панели инструментов с резервными селекторами и автоматическим восстановлением при переходах между чатами.
<!-- /RU -->

<!-- EN -->
- **Restoring genuine transparency and frosted glass**:
  - The CSS variables `--popover`, `--card` and `--background` are fixed for both themes (light and dark);
  - `backdrop-filter: blur(22px) saturate(180%) !important` is force-applied to all sheets, menus, popovers and dialogs without being covered by background layers.
- **Build number updated when installing over an existing version**:
  - The `versionCode` (to 25) and `versionName` (to "3.0.9") attributes are updated in the binary `AndroidManifest.xml`;
  - The version number now updates correctly in the app info screen and in the Android shortcut context menu.
- **Dynamic switching of the desktop icon**:
  - Instant switching of the active `activity-alias` (`LauncherOwl`, `LauncherLynx`, `LauncherLsx`, `LauncherAngularX`) through `pm` and Shizuku (`rish`) was added to `agy_tools.sh` (`op_brand`), letting the desktop icon change style immediately.
- **Removal of the regional account lock**:
  - The "This account cannot use Leostryx" problem is solved: the `liblanguage_server.so` binary with the regional restriction bypass is integrated directly into the app base `app/`;
  - The built-in updater now downloads `-bypass.apk` first.
- **Automatic dismissal of the outdated Claude models notification**:
  - The notification-closing scanner in `agy_ru.js` was fully rewritten: the warning dialog about moving to version 5.5 dated 2 November is dismissed instantly along with its overlay and confirmed by the button.
- **`zip` and `unzip` packages in the "Archives" category**:
  - The `zip` and `unzip` packages were moved to the "Archives" section of the tools catalogue above the other formats.
- **Full short descriptions for all packages**:
  - Short descriptions in Russian and English were added for all packages (`make`, `cmake`, `ninja`, `pkg-config`, `pip`, `kotlin`, `maven`, `rust`, `go`, `git`, `gh`, `openssh`, `curl`, `wget`, `jq`, `ripgrep`, `fd`, `tree`, SDK platforms and build-tools).
- **Fix for installing the Android SDK (37.x)**:
  - For preview/canary platforms (`android-37.0`, `android-37.1`) and `build-tools;37.0.0`, the `--channel=3` (canary) flag is now passed to `sdkmanager` automatically in `op_sdk`.
- **Subagent invocation button in the chat**:
  - The mechanism for embedding the 🤖 button into the chat input panel was fully reworked: a multi-level toolbar search with fallback selectors and automatic recovery when switching between chats.
<!-- /EN -->

## v3.0.8 — 2026-11-11 (Leostryx In-App Updater & UI Polish)

<!-- RU -->
- **Переключатель акцентного цвета логотипов и значков**:
  - В раздел «Настройки › Оформление» добавлен переключатель «Перекрашивать логотипы и значки»;
  - В выключенном состоянии (по умолчанию) все 4 логотипа (Owl, Lynx, LSX, Angular X) и системные иконки сохраняют свои оригинальные дизайнерские цвета, полностью соответствующие иконке приложения на рабочем столе Android;
  - При включении переключателя логотипы и значки тонируются выбранным пользователем акцентным цветом.
- **Матовое стекло (Frosted Glass) в светлой теме**:
  - Исправлена непрозрачность в светлой теме: системная переменная `--popover` настроена на `rgba(255, 255, 255, 0.88)` с эффектом размытия `backdrop-filter: blur(22px) saturate(180%)`;
  - Все всплывающие меню, списки и карточки получили аутентичный полупрозрачный вид как в тёмной, так и в светлой теме.
- **Возврат оригинального селектора моделей и исправление шторок**:
  - Селектор выбора моделей возвращён к оригинальной полноценной нижней шторке (как в билдах до 3.0.6);
  - Верхняя правая кнопка в чате (шторка рабочей области: файлы, терминал, история, артефакты) теперь открывается в виде полноценной боковой/нижней шторки без ошибочного сжатия в компактный попап;
  - Исправлено зависание и схлопывание в узкую полоску окна настроек из главного меню.
- **Быстрый вызов субагентов прямо в чате**:
  - В панель инструментов поля ввода чата добавлена кнопка вызова субагентов (🤖) со всплывающим меню быстрого выбора;
  - По нажатию на субагента в поле ввода автоматически вставляется префикс `@<имя_субагента> `;
  - При вызове субагента из раздела «Настройки › Кастомизация › Субагенты» шторка настроек корректно закрывается перед фокусировкой на поле ввода.
- **Встроенная система обновлений и автоматическая установка (In-App Updater)**:
  - Добавлено системное разрешение `android.permission.REQUEST_INSTALL_PACKAGES` в `AndroidManifest.xml` для установки обновлений из приложения;
  - В нативный мост `AgyTools` добавлен метод `installApk(path)` с вызовом системного `PackageInstaller` через `AppFileProvider`;
  - Устранено дублирование кнопок обновления: теперь кнопка одна и плавно меняет состояние: «Проверить обновления» → «Скачать обновление (vX.X.X)» → отображение прогресса скачивания в процентах (`Скачивание… X%`) → «Обновить и установить»;
  - По завершении скачивания автоматически запускается системный установщик пакетов, а повторное нажатие кнопки повторно вызывает установку;
  - Добавлен fallback через elevated Shizuku (`rish`) и `pm install -r`.
- Пересборка и подпись релизных APK `Leostryx-3.0.8-standard.apk` и `Leostryx-3.0.8-bypass.apk`.
<!-- /RU -->

<!-- EN -->
- **Accent colour toggle for logos and icons**:
  - A "Recolour logos and icons" toggle was added to "Settings › Appearance";
  - When off (the default), all 4 logos (Owl, Lynx, LSX, Angular X) and the system icons keep their original designer colours, fully matching the app icon on the Android home screen;
  - Turning the toggle on tints the logos and icons with the accent colour chosen by the user.
- **Frosted glass in the light theme**:
  - Opacity in the light theme is fixed: the system variable `--popover` is set to `rgba(255, 255, 255, 0.88)` with the blur effect `backdrop-filter: blur(22px) saturate(180%)`;
  - All popup menus, lists and cards now have an authentic translucent look in both dark and light themes.
- **Restoring the original model selector and fixing the sheets**:
  - The model selector is back to the original full-height bottom sheet (as in builds before 3.0.6);
  - The top-right button in the chat (the workspace sheet: files, terminal, history, artifacts) now opens as a proper side/bottom sheet instead of being wrongly collapsed into a compact popup;
  - Fixed the freeze and the collapse into a narrow strip of the settings window opened from the main menu.
- **Quick subagent invocation right in the chat**:
  - A subagent button (🤖) with a quick-selection popup menu was added to the chat input toolbar;
  - Tapping a subagent inserts the prefix `@<subagent_name> ` into the input field automatically;
  - When a subagent is invoked from "Settings › Customizations › Subagents", the settings sheet now closes correctly before focus moves to the input field.
- **Built-in update system and automatic installation (In-App Updater)**:
  - The system permission `android.permission.REQUEST_INSTALL_PACKAGES` was added to `AndroidManifest.xml` to allow installing updates from inside the app;
  - A method `installApk(path)` calling the system `PackageInstaller` through `AppFileProvider` was added to the native `AgyTools` bridge;
  - Duplicate update buttons removed: there is now one button whose state changes smoothly: "Check for updates" → "Download update (vX.X.X)" → download progress as a percentage (`Downloading… X%`) → "Update and install";
  - When the download completes the system package installer launches automatically, and pressing the button again re-triggers the installation;
  - A fallback through elevated Shizuku (`rish`) and `pm install -r` was added.
- Rebuild and signing of the release APKs `Leostryx-3.0.8-standard.apk` and `Leostryx-3.0.8-bypass.apk`.
<!-- /EN -->

## v3.0.7 — 2026-11-10 (Leostryx UI & Fluidity Polish)

<!-- RU -->
- **Адаптация селектора выбора моделей к темам и прозрачности** — панель выбора модели (`[data-testid="model-selector-panel"]`, `.agy-model-menu`) теперь полностью интегрирована в дизайн-систему тем:
  - Поддержка матового стекла (frosted glass) с фоном `var(--agy-glass-surface)`, эффектом `backdrop-filter: blur(22px) saturate(190%)` и тонкой границей `var(--agy-glass-border)`;
  - Гармоничный вид как в тёмной (`rgba(26, 26, 30, 0.84)`), так и в светлой (`rgba(255, 255, 255, 0.82)`) теме;
  - Корректная стилизация пунктов выбора моделей и параметров effort с закруглёнными углами и подсветкой при наведении.
- **Истинная прозрачность выпадающих списков и попапов в светлой теме** — устранены непрозрачные сплошные белые подложки во всех выпадающих меню, Radix Popper контейнерах, контекстных списках и всплывающих окнах:
  - Дочерние контейнеры `div`, `ul`, `section` внутри всплывающих окон очищены от перекрывающего непрозрачного фона (`background-color: transparent !important`);
  - Эффект матового стекла (blur + saturation) теперь беспрепятственно отображается во всех всплывающих элементах интерфейса в светлой теме.
- **Мгновенное и плавное открытие проводника файлов (+ / Медиа)** — устранены рывки, чёрный экран, полоса сбоку и задержки при выборе файлов:
  - В нативном слое `MainActivity` убран медленный системный посредник `Intent.createChooser` при открытии медиа/файлов;
  - Добавлено принудительное скрытие экранной клавиатуры перед запуском диалога файлов;
  - Отключена рывковая анимация окон Android (`overridePendingTransition(0, 0)`), благодаря чему проводник открывается моментально и абсолютно плавно.
- **Плавное опускание чата при скрытии клавиатуры** — устранена визуальная задержка и пустой цветной заполнитель на месте закрывающейся клавиатуры:
  - Высота корневого WebView жестко привязана к размеру окна (`height: 100% !important`), минуя задержки пересчета dynamic viewport units Chromium (`dvh`);
  - Синхронизировано обновление переменной `--agy-vvh` при изменении `visualViewport`;
  - В обработчике закрытия клавиатуры отключены искусственные задержки и рывки прокрутки (`nudgeSeries`), благодаря чему чат опускается мгновенно и без артефактов.
- Пересборка и подпись релизных APK `Leostryx-3.0.7-standard.apk` и `Leostryx-3.0.7-bypass.apk`.
<!-- /RU -->

<!-- EN -->
- **Model selector adapted to themes and transparency** — the model selection panel (`[data-testid="model-selector-panel"]`, `.agy-model-menu`) is now fully integrated into the theme design system:
  - Frosted glass support with the `var(--agy-glass-surface)` background, the `backdrop-filter: blur(22px) saturate(190%)` effect and the thin `var(--agy-glass-border)` border;
  - A harmonious look in both the dark (`rgba(26, 26, 30, 0.84)`) and the light (`rgba(255, 255, 255, 0.82)`) theme;
  - Correct styling of the model and effort items with rounded corners and a hover highlight.
- **Genuine transparency of dropdowns and popups in the light theme** — opaque solid white layers are eliminated in all dropdown menus, Radix Popper containers, context lists and popups:
  - The child `div`, `ul`, `section` containers inside popups are cleared of the covering opaque background (`background-color: transparent !important`);
  - The frosted glass effect (blur + saturation) now shows through unimpeded in all popup elements of the light theme.
- **Instant and smooth opening of the file picker (+ / Media)** — jerks, the black screen, the side stripe and the delays when picking files are gone:
  - The slow system mediator `Intent.createChooser` was removed from the native `MainActivity` layer when opening media/files;
  - The on-screen keyboard is now force-hidden before the file dialog starts;
  - The jerky Android window animation is disabled (`overridePendingTransition(0, 0)`), so the picker opens instantly and perfectly smoothly.
- **Smooth chat lowering when the keyboard is hidden** — the visual delay and the empty coloured filler where the closing keyboard was are gone:
  - The root WebView height is hard-bound to the window size (`height: 100% !important`), bypassing the delayed recomputation of Chromium's dynamic viewport units (`dvh`);
  - Updating the `--agy-vvh` variable is synchronised with `visualViewport` changes;
  - The artificial delays and scroll jerks (`nudgeSeries`) are disabled in the keyboard-close handler, so the chat lowers instantly and without artefacts.
- Rebuild and signing of the release APKs `Leostryx-3.0.7-standard.apk` and `Leostryx-3.0.7-bypass.apk`.
<!-- /EN -->

## v3.0.6 — 2026-11-10 (Leostryx Major Update)

<!-- RU -->
- **Субагенты (Subagents) и каталог агентов в 1 клик** — в «Настройки › Кастомизация» добавлена новая вкладка «Субагенты»:
  - Просмотр списка встроенных (`self`, `research`, `image-generator`) и пользовательских субагентов с бейджами прав (`write`, `mcp`, `subagents`) и модели (`inherit`, `pro`, `flash`, `flash_lite`);
  - Создание, редактирование и удаление субагентов с автоматической синхронизацией в правила агента (`~/.gemini/config/rules/custom_subagents.md`);
  - Встроенный каталог готовых субагентов (Code Reviewer, Android Debugger, Security Auditor, Test Engineer, Docs Architect) с быстрой установкой;
  - Кнопка «Вызвать в чате» для моментальной вставки команды субагента в поле ввода;
  - Fallback-маршрутизация в `AgyGateway`: автоматическое перенаправление абстрактных моделей субагентов (`inherit`, `flash`, `pro`) на настроенную модель провайдера без ошибок 404.
- **Уведомления агента в шторке Android с прямым ответом и подтверждением** — реализован нативный мост `AgyShade` и канал высокой важности `agy_agent_chat`:
  - Раскрывающиеся уведомления (`BigTextStyle`) с вопросами и статусом работы агента;
  - Поле прямого ввода (`RemoteInput`) по кнопке «Ответить» в шторке — ответ сразу печатается и отправляется в чат;
  - Кнопка «Разрешить / Продолжить» для мгновенного подтверждения запросов действий без открытия приложения;
  - Двойная доставка: мгновенный JS-мост через `BroadcastReceiver` + очередь `pollReplies` при сворачивании WebView.
- **Оптимизация энергопотребления, скорости и памяти** — глубокая оптимизация рантайма и компонентов:
  - `WebSettings`: отключена избыточная внеэкранная предрастеризация (`setOffscreenPreRaster(false)`), экономящая 30–50% GPU и RAM на длинных переписках;
  - Go-ядро (`CoreEnvironment`): флаг `madvdontneed=1` в `GODEBUG` для немедленного возврата страниц RAM ядру Android, ограничение `GOMEMLIMIT=384MiB` и `GOGC=50`;
  - Очистка памяти в `AppLifecycle.trimMemory` и `WebViewLifecycle.freeMemory` (очистка кэша Chromium и GC при `onTrimMemory >= 10`);
  - `AgyVosk`: автоматическое освобождение 50+ МБ языковой модели из RAM при остановке голосового распознавания.
- **Фирменный баннер с рысью (Lynx)** — заменён баннер репозитория (`assets/leostryx-banner.svg`) в неоновом стиле с акцентной палитрой `#0b84ff` и маскотом рыси.
- **Устранение автоматического сброса на модель Gemini 4 Argon** — исправлена фоновая логика проверки моделей в `main.js`, сбрасывавшая выбранную пользователем модель (Gemini 3.8 Flash и другие) на дефолтный Argon.
- **Динамическая перекраска иконок и логотипа** — выбор акцентного цвета в оформлении теперь перекрашивает не только кнопки, но и логотип рыси, шапку и ключевые иконки через `brand_logo.js` и динамические стили;
- **Расширение лимитов нативного моста AgyTools** — лимит длины аргументов увеличен с 600 до 65536 символов, разрешены спецсимволы `|` и `#` (устранена ошибка `ERR:arg` при сохранении больших навыков и субагентов);
- Пересборка и подпись релизных APK `Leostryx-3.0.6-standard.apk` и `Leostryx-3.0.6-bypass.apk`.
<!-- /RU -->

<!-- EN -->
- **Subagents and a one-click agent catalogue** — a new "Subagents" tab was added to "Settings › Customizations":
  - Viewing the list of built-in (`self`, `research`, `image-generator`) and user-defined subagents with permission badges (`write`, `mcp`, `subagents`) and model badges (`inherit`, `pro`, `flash`, `flash_lite`);
  - Creating, editing and deleting subagents with automatic synchronisation into the agent rules (`~/.gemini/config/rules/custom_subagents.md`);
  - A built-in catalogue of ready-made subagents (Code Reviewer, Android Debugger, Security Auditor, Test Engineer, Docs Architect) with one-click installation;
  - An "Invoke in chat" button that instantly inserts the subagent command into the input field;
  - Fallback routing in `AgyGateway`: abstract subagent models (`inherit`, `flash`, `pro`) are automatically redirected to the configured provider model instead of failing with 404.
- **Agent notifications in the Android shade with direct reply and confirmation** — the native `AgyShade` bridge and the high-importance `agy_agent_chat` channel were implemented:
  - Expandable notifications (`BigTextStyle`) with the agent's questions and work status;
  - A direct-input field (`RemoteInput`) behind the "Reply" button in the shade — the reply is typed and sent to the chat immediately;
  - An "Allow / Continue" button for instant confirmation of action requests without opening the app;
  - Dual delivery: an instant JS bridge through a `BroadcastReceiver` plus a `pollReplies` queue when the WebView is backgrounded.
- **Power, speed and memory optimisation** — a deep optimisation of the runtime and components:
  - `WebSettings`: the redundant offscreen pre-rasterisation is disabled (`setOffscreenPreRaster(false)`), saving 30–50% GPU and RAM on long conversations;
  - Go core (`CoreEnvironment`): the `madvdontneed=1` flag in `GODEBUG` for immediate return of RAM pages to the Android kernel, plus the `GOMEMLIMIT=384MiB` and `GOGC=50` limits;
  - Memory cleanup in `AppLifecycle.trimMemory` and `WebViewLifecycle.freeMemory` (Chromium cache purge and GC at `onTrimMemory >= 10`);
  - `AgyVosk`: automatic release of the 50+ MB speech model from RAM when voice recognition stops.
- **Branded lynx banner** — the repository banner (`assets/leostryx-banner.svg`) was replaced with a neon-style one using the accent palette `#0b84ff` and the lynx mascot.
- **Removal of the automatic reset to the Gemini 4 Argon model** — the background model-check logic in `main.js` that reset the user's chosen model (Gemini 3.8 Flash and others) to the default Argon is fixed.
- **Dynamic recolouring of icons and the logo** — choosing an accent colour in the appearance settings now recolours not only the buttons but also the lynx logo, the header and the key icons, through `brand_logo.js` and dynamic styles;
- **Extended limits of the native AgyTools bridge** — the argument length limit was raised from 600 to 65536 characters, and the special characters `|` and `#` are allowed (fixing the `ERR:arg` error when saving large skills and subagents);
- Rebuild and signing of the release APKs `Leostryx-3.0.6-standard.apk` and `Leostryx-3.0.6-bypass.apk`.
<!-- /EN -->

## v3.0.5 — 2026-11-10 (Leostryx Release)

<!-- RU -->
- **Нативное переключение иконки рабочего стола без пересборки APK** — в манифест добавлены 4 `activity-alias` (`IconPack1Activity`..`IconPack4Activity`) и нативный мост `Android.setIconPack(token, packId)` (`IconPackSwitcher`), меняющий иконку лончера на лету из раздела «Настройки › Оформление»;
- **Живой векторный логотип и динамический акцентный цвет** — выбор логотипа (Сова, Рысь, LSX, Angular X) и акцентного цвета в «Оформлении» мгновенно перекрашивает SVG-логотипы на экране входа, в верхней панели, в превью настроек и все акцентные кнопки интерфейса (`--primary` с приоритетом над пресетами тем);
- **Полный брендинг экрана входа и локализации («Добро пожаловать в Leostryx»)** — обновлены идентификаторы продукта в React-бандле (`main.js`), словаре `agy_i18n.js` (включая полный перевод раздела резервного копирования «Бэкап»), `agy_tools.js`, `agy_mcp.js`, `agy_export_session.js` и заголовке диагностики (`=== Leostryx Diagnostics ===`);
- **Стабильная работа в фоне и устранение обрыва долгих задач** — отключён агрессивный 120-секундный сторож `AGY-P2-16` в `bridge.core.js` (который ошибочно разрывал реактивный канал `StreamCascadeReactiveUpdates` по совпадению `/cascade/i`), а в нативном слое (`WebViewLifecycle`, `AppLifecycle`, `LauncherIconSwitcher`) отключена заморозка таймеров `pauseTimers()`, сброс памяти `freeMemory()` и переключение компонентов при сворачивании приложения;
- **Чистый старт без мелькания экрана ошибки диагностики** — в `startup_ready.js` убран немедленный вызов `Android.onUiError` на некритичных стартовых промисах, а в `agy_tools.sh` добавлена автоочистка поля `skills` в `plugin.json` (устранён спам `customization.go` в `core.log`);
- Пересборка и подпись `Leostryx-3.0.5-standard.apk` и `Leostryx-3.0.5-bypass.apk` (`versionCode 22`).
<!-- /RU -->

<!-- EN -->
- **Native desktop icon switching without rebuilding the APK** — 4 `activity-alias` entries (`IconPack1Activity`..`IconPack4Activity`) were added to the manifest, plus the native bridge `Android.setIconPack(token, packId)` (`IconPackSwitcher`), which changes the launcher icon on the fly from "Settings › Appearance";
- **Live vector logo and dynamic accent colour** — choosing a logo (Owl, Lynx, LSX, Angular X) and an accent colour in "Appearance" instantly recolours the SVG logos on the sign-in screen, in the top bar, in the settings preview, and all accent buttons of the interface (`--primary` takes priority over the theme presets);
- **Full branding of the sign-in screen and localisation ("Welcome to Leostryx")** — product identifiers were updated in the React bundle (`main.js`), the `agy_i18n.js` dictionary (including the full translation of the "Backup" section), `agy_tools.js`, `agy_mcp.js`, `agy_export_session.js` and the diagnostics header (`=== Leostryx Diagnostics ===`);
- **Stable background operation and no dropping of long tasks** — the aggressive 120-second watchdog `AGY-P2-16` in `bridge.core.js` is disabled (it wrongly tore down the reactive channel `StreamCascadeReactiveUpdates` on a `/cascade/i` match), and on the native side (`WebViewLifecycle`, `AppLifecycle`, `LauncherIconSwitcher`) the timer freeze `pauseTimers()`, the memory reset `freeMemory()` and the component switching on app minimisation are turned off;
- **Clean start without the diagnostics error screen flashing** — the immediate `Android.onUiError` call on non-critical startup promises was removed from `startup_ready.js`, and automatic cleanup of the `skills` field in `plugin.json` was added to `agy_tools.sh` (removing the `customization.go` spam in `core.log`);
- Rebuild and signing of `Leostryx-3.0.5-standard.apk` and `Leostryx-3.0.5-bypass.apk` (`versionCode 22`).
<!-- /EN -->

## v3.0.4 — 2026-11-10 (Leostryx Patch Release)

<!-- RU -->
- **Разделители провайдеров в селекторе моделей** — модели из разных провайдеров (OpenAI-совместимые, Claude/Anthropic, Gemini-совместимые) теперь сгруппированы с заголовками провайдера;
- **Проверка отображения всех выбранных моделей** — все модели из настроек провайдеров корректно появляются в селекторе чата в разделе «Пользовательский»;
- **Папка бэкапа: Leostryx Backup**, рабочая папка: **Leostryx Projects** (в интерфейсе, путях по умолчанию и i18n);
- Пересборка standard и bypass APK (`rebuild.py both`) с новыми изменениями;
- Обновлён README.md и CHANGELOG.md под версию 3.0.4.
<!-- /RU -->

<!-- EN -->
- **Provider separators in the model selector** — models from different providers (OpenAI-compatible, Claude/Anthropic, Gemini-compatible) are now grouped under provider headings;
- **Verification that all selected models are displayed** — every model from the provider settings appears correctly in the chat selector under the "Custom" section;
- Backup folder: **Leostryx Backup**, working folder: **Leostryx Projects** (in the interface, in the default paths and in i18n);
- Rebuild of the standard and bypass APKs (`rebuild.py both`) with the new changes;
- README.md and CHANGELOG.md updated for version 3.0.4.
<!-- /EN -->

## v3.0.3 — 2026-11-10 (Leostryx Release)

<!-- RU -->
- **Проект переименован в Leostryx** (репозиторий: `Leostrange/Leostryx`);
- **Новый баннер и брендинг** в стиле Leostryx (цвет `#0b84ff`, маскот — рысь);
- **По умолчанию стоит значок и лого в виде рыси** (pack `02_lynx`);
- **Кастомизация иконок и splash screen** добавлена в оформление: 4 набора (Сова, Рысь, LSX, Angular X), переключение в настройках;
- **Pillow (PIL) интегрирован в приложение** — доступен в билде после сборки;
- **Иконки в SVG** загружены в архиве `Leostryx-4-SVG-logos.7z`;
- Версия bumped до **3.0.3** (versionCode 19);
- Оба APK (standard + bypass) подписаны с Leostryx брендингом: application-label, иконки, dex strings.
<!-- /RU -->

<!-- EN -->
- **The project was renamed to Leostryx** (repository: `Leostrange/Leostryx`);
- **New banner and branding** in the Leostryx style (colour `#0b84ff`, mascot — a lynx);
- **The lynx icon and logo are now the default** (pack `02_lynx`);
- **Icon and splash screen customisation** added to the appearance settings: 4 sets (Owl, Lynx, LSX, Angular X), switchable in settings;
- **Pillow (PIL) is integrated into the app** — available in the build after compilation;
- **SVG icons** uploaded in the archive `Leostryx-4-SVG-logos.7z`;
- Version bumped to **3.0.3** (versionCode 19);
- Both APKs (standard + bypass) are signed with Leostryx branding: application-label, icons, dex strings.
<!-- /EN -->

## Изменения

<!-- RU -->
1. **Полная русификация.**
   - Словарь `agy_i18n.js` (EN → RU) для всего интерфейса приложения.
   - +64 ключа в словаре: статусы действий агента в чате («Распаковка», «Загрузка», «Сборка», «Клонирование», «Анализ», «Тестирование»… и варианты с «…» для прогрессивных статусов), строки карточки и диалога.
   - Живой индикатор рассуждений на русском: «Размышление — N с».
   - Русская плюрализация счётчика вопросов: «N вопрос / вопроса / вопросов».
   - Диалог подтверждений: русские варианты «вне проекта» и «глобально» — убраны английские дубли, из-за которых варианты выглядели одинаковыми.
   - Строки карточки вопроса агента и ответа переведены.

2. **Вложение файлов до 10 штук.**
   - Лимит увеличен с 5 до 10.

3. **Правильное отображение прикреплённых файлов.**

4. **Возможность просмотра и удаления файлов, прикреплённых к чату.**

5. **Режим щита в чате — настройки работы чата (безопасность и JavaScript), режим «не спрашивает».**
   - Секции щита: профиль безопасности, доступ к файлам вне папок, **доступ в интернет** («Всегда спрашивать» / «Разрешить» / «Запретить»), автовыполнение команд терминала, песочница, JavaScript в браузере.
   - Автономная работа агента: выставлено «Не спрашивать» (EAGER) + песочница выключена — на Android нет bwrap, поэтому раньше связка «Выполнять в песочнице» требовала подтверждения на каждой команде. Теперь агент работает автономно и не переспрашивает подтверждения.
   - **Выборы в щите реально сохраняются**: запись через нативный мост `AgyTools` в `config.json` (новая операция `policy`), нормализация значений enum (числа и строки вида `AGENT_SETTING_POLICY_ALLOW`), липкий overlay для мгновенного отображения, синхронизация с конфигом при открытии щита. Ранее запись откатывалась (схема JS-бандла теряла поля `userSettings`) и настройки «не прилипали».
   - Попап щита — строго по ширине контекстного окна (убран лимит 360px).

6. **Начальный онбординг для выбора языка.**

7. **Компактные и аккуратные менюшки, выпадающие списки и окна.**
   - Компактные листы меню и якорные попапы (меню/select) в стиле Out27: скругления 14/12px, компактные пункты, тени; подложка меню полностью прозрачная.
   - Убраны лимиты ширины, центровка и корректное позиционирование в широких окнах.

8. **Применение стилей тем к менюшкам, выпадающим спискам и окнам.**
   - Фон/рамка берутся из токенов темы (`--popover` / `--card` / `--border` / `--foreground`) — одинаково в светлой и тёмной теме.
   - Плашка предупреждения о плагинах переведена на токены темы (без жёлтого `--color-warning`), текст по центру.

9. **Встроенные в настройки инструменты разработки** — установка компонентов из настроек, чтобы агент не скачивал их в чате.
   - Полный NDK: принимает архивы `.tar.xz` / `.tar.gz` / `.zip`, распаковка через `tar`, fallback без GitHub API (защита от rate-limit).
   - TypeScript закреплён на `typescript@5` — TS 7+ (нативный `tsgo`) не собирается под Android.
   - zipalign убран из списка инструментов и пресета «Android-приложение (Gradle)» — нет в репозитории pkg, подпись делает `apksigner`.
   - Мосты инструментов через `exec $(readlink -f …)` — shell-скрипты вроде `ndk-build` больше не ломаются на симлинках.
   - Фиксы пакетной установки пресетов и парсера статуса пакетов.

10. **Добавлена строка «Язык» в модуле настроек «Общие».**

11. **Реализована лёгкая прозрачность и затемнение.**
    - Компактные листы, якорные попапы и попап щита — 90% непрозрачности (10% «стекла»; ранее было 4%).
    - Подложки меню полностью прозрачные; тени `box-shadow` — только в светлой теме (в тёмной отключены); `backdrop-filter` не используется.

12. **Починена работа в фоне** — не виснет на логотипе, если свёрнут; запущенное в памяти приложение продолжает работать.

13. **Поправлены жесты.**
    - Из подменю выход в предыдущее меню, а не сразу в окно с проектами.
    - Настройки сворачиваются вниз, как шторка.

14. **Микрофон — транскрибация текста** для кастомных (добавленных пользователем вручную) провайдеров с помощью Android Speech Cognition.

15. **Кастомные модели видят изображения.**

16. **Настройки диктовки.**

17. **Режимы мышления.**

18. **Навигация «Открыть настройки провайдеров».**
    - Роутеру TanStack путь и query передаются раздельно (`navigate({to, search})`) — раньше URL с `?` превращался в мусорный pathname и переход не работал.
    - Чинит также «Provide Feedback» и переходы по секциям настроек.
    - Вместо ошибки «Plugins not supported for this auth method» — кнопка перехода в настройки провайдеров (в финальной версии — без кнопки, только текст-плашка под тему).

19. **Карточка вопроса агента — убраны дубли строк.**
    - Отключён кроссфейд текстовых переходов (старый и новый текст больше не рендерятся одновременно, «3 и 4 строки» больше не дублируются).

20. **Вкладка «Сочетания клавиш» убрана из настроек** — штатный флаг `hideShortcuts`; десктопные раскладки на Android не нужны.

21. **Полная ширина размышлений и терминала** — убраны боковые отступы `pl-2` / `ml-4`, шаги инструментов идут от левого края.

22. **Тест-харнесс щита** — 47 автопроверок логики щита против реального `config.json` (нормализация enum, запись через мост, синхронизация, защита свежих выборов).

23. **Исправление и адаптация MCP серверов под Android**:
    - Развёрнуто окружение Node.js (`nodejs-lts` 24.22.2) со шлюзами `npm` 12.2.1 и `npx`.
    - Установлены и адаптированы нативные MCP серверы: `sequential-thinking` (v2.0.0), `exa-search-server` (v3.4.2), `github-mcp-server` (v0.6.2, заменён недоступный Docker-контейнер на нативный JS-пакет), `mcp-remote` (StitchMCP).
    - Исправлены shebang-пути через `agy-fix-paths` под userspace префикс Android.
    - Сконфигурирован чистый запуск напрямую через бинарники без задержек и зависимостей от сети (`mcp_config.json`).
    - Удалён несовместимый `android-management-api` (требовавший Google Cloud Application Default Credentials).

24. **Для работы MCP серверов нужно их добавить из стандартного провайдера Antigravity, и переключить ядро.**

25. **Установить Node.js**:
    - Для запуска и работы большинства MCP серверов и их зависимостей требуется установленный в системе Node.js (`pkg install nodejs-lts`).

26. **Исправление работы MCP серверов с кастомными провайдерами**:
    - Устранена циклическая рекурсия shell-мостов (когда создание симлинков в `runtime/bin` приводило к перезаписи оригинальных бинарников в `$PREFIX/bin` скриптами-мостами и сбою `context deadline exceeded` / signal 36).
    - В окружение каждого MCP сервера (`mcp_config.json`) добавлен `LD_LIBRARY_PATH: $PREFIX/lib`, что решает проблему динамической линковки Bionic (`libz.so.1 not found: needed by main executable`) при спавне процессов ядром `language_server`.
    - Скорректированы прямые JS-точки входа: `stdio.cjs` для `exa-mcp-server` и `proxy.js` для `mcp-remote` (StitchMCP).
    - Все 4 MCP сервера (`sequential-thinking`, `exa`, `github-mcp-server`, `StitchMCP` — суммарно 45 инструментов) успешно переходят в статус `MCP_SERVER_STATUS_READY` и отдают свои схемы вызова функций без необходимости переключения ядра, а `AgyGateway` прозрачно перенаправляет вызовы инструментов в кастомные модели по протоколу OpenAI.

27. **Пересборка standard и bypass**:
    - Оба билда собраны заново из актуального дерева исходников (`rebuild.py both`) уже с учётом фиксов MCP-серверов (п. 26) и обновлённой документации.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-9-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-9-bypass.apk` — лежат в корне папки `Antigravity Projects/` рядом с репозиторием.
    - Папка `Antigravity Projects` приведена в порядок: оставлены только текущий исходный код (репозиторий с README и CHANGELOG) и два APK; удалены старые сборки (ui-8, базовый fixed-ui-9), промежуточные проекты, архивы и дублирующие рабочие копии.

28. **Устранение падения ядра и команд с кодом завершения 164 (signal 36 / SIGRTMIN+2)**:
    - Выявлен источник сигнала 36: системный фоновый профилировщик Android 16 (`traced_perf` / ART), рассылающий сигналы процессам приложения. Так как в glibc / bionic для сигнала 36 не был установлен обработчик, процессы немедленно завершались с кодом `164 = 128 + 36`.
    - В ядро `liblse_compat.c` добавлена низкоуровневая установка `SIG_IGN` на сигналы 36 и 37 через `raw_rt_sigaction` в конструкторе библиотеки, а также перехватчик `sigaction()`, предотвращающий сброс игнорирования сигнала runtime-компонентами. Так как POSIX гарантирует сохранение `SIG_IGN` при `execve()`, все дочерние процессы наследуют защиту. Перекомпилирован `app/assets/runtime/lib/liblse_compat.so`, обновлены манифесты runtime standard и bypass.
    - Во все стартовые шеллы (`00-env.sh`, `pkg`, `agy_tools.sh`, `bash`-обёртку) добавлен превентивный перехват `trap '' 36 37 2>/dev/null || true`.

29. **Сохранение выбранной кастомной модели при сворачивании приложения**:
    - В `app/assets/web/generated/main.js` (`fKa`) состояние кастомной модели инициализируется и синхронизируется с `localStorage` (`agyLastCustomModel`).
    - Ранее при сворачивании приложения и повторном рендере компонента состояние сбрасывалось в `null`, что приводило к откату выбора на стандартные модели Google. Теперь выбор надёжно сохраняется между сессиями и возвращениями из фона.

30. **Устранение зависания установки инструментов (Settings › Tools) и кнопка сброса**:
    - Диагностирована причина зависания: при аварийном завершении фонового скрипта файл кода завершения `rc` не создавался, из-за чего веб-интерфейс бесконечно опрашивал несуществующий процесс.
    - В интерфейс панели задач `agy_tools.js` добавлена кнопка принудительной отмены/сброса `[✕]`.
    - Добавлен автоматический тайм-аут и детекция зависания: если процесс не обновляет журнал более 45 секунд при общем времени работы более 90 секунд (или превышает 10 минут), задача автоматически помечается завершённой с ошибкой и журнал открывается для анализа.
    - В скрипты `pkg` и `agy_tools.sh` встроен перехват сигналов 36/37, предотвращающий падение пакетов на середине установки.

31. **Исправление запуска терминала (`libandroid-support.so not found`) и моста Bionic bash**:
    - В `overlay/bin/bash` добавлена системная обёртка для `$PREFIX/bin/bash`, которая гарантированно экспортирует `LD_LIBRARY_PATH="$PREFIX/lib"`, настраивает `PREFIX` и переменные Termux, и запускает реальный бинарник `bash.bin`.
    - Это полностью устраняет сбой динамического линкера Bionic при старте терминала из `CoreEnvironment` (где `LD_LIBRARY_PATH` умышленно очищается для изоляции glibc-ядра).
    - В `app/assets/env/manifest.json` обновлены хэши `overlaySha256`, `pkgSha256` и `bundleId` для автоматической накатки оверлея на существующих установках.

32. **Синхронизация репозитория с веткой «tools-log-fix» (ранее изменения жили только в собранном APK)**:
    - В `app/assets/web/` перенесены обновления `agy_tools.js` (уточнённые id проверок `node-lts`/`java17`, компоненты SDK API 36/37 и build-tools 36/37, `aidl`, «aapt + zipalign»), `agy_shield.js` (инициализационная запись политик в `config.json` через мост и игнорирование устаревших enum), `agy_ru.js`, а также добавлен `agy_resolver.sh`.
    - В `app/assets/env/pkg/lib/resolver.sh` перенесён улучшенный выбор альтернатив зависимостей: уже установленная альтернатива выбирается только если её версия удовлетворяет зависимости (защищает `nodejs-lts` от перезаписи `nodejs`).
    - Перенесены обновлённые `overlay/bin/bash`, пересобранный `liblse_compat.so` и актуальные манифесты runtime (standard и bypass) из сборки `*-tools-log-fix`.

33. **Надёжность установки инструментов (Settings › Tools) на нестабильной сети**:
    - Корневая причина прежних сбоев установки: обрывы соединения (curl error 35 «Recv failure: Connection reset by peer») — стандартный `curl --retry` их не повторяет, поэтому `pkg install` падал с первого раза и требовал 3–4 подхода.
    - В `pkg` (`lib/fetch.sh`, загрузка индекса) curl переведён на `--retry 5 --retry-all-errors` с бэкоффом.
    - В `agy_tools.sh` добавлен `pkg_retry` (до 3 попыток с паузами) вокруг всех `pkg update/install/upgrade`, `npm install` (плюс `--fetch-retries=5`); загрузка SDK усилена ретраями; загрузка NDK (~1 ГБ) докачивается с `-C -` с фолбэком на полную перезагрузку.
    - Ошибка `npm: command not found` при самопроверке была следствием того же (обрыв при `pkg install npm`).

34. **Провайдеры: «Загрузить модели» для Claude-совместимых API без каталога моделей**:
    - У провайдеров вроде MiMo Anthropic-эндпоинт работает (`POST /v1/messages` → 200), но список моделей не отдаёт (`GET /v1/models` → 404) — кнопка падала с ошибкой.
    - Добавлен фолбэк: если каталог для типа API недоступен, запрашивается OpenAI-совместимый каталог того же сервера (`<origin>/v1/models`), в сообщении ставится пометка источника.
    - Добавлено ручное добавление моделей (поле «ID модели» + «Добавить») и удаление моделей (✕) — для провайдеров вообще без каталога.
    - Нормализация Base URL: концевые `/` и лишний `/v1` для Anthropic-типа убираются автоматически; ошибки показываются чистым текстом без HTML-мусора.

35. **Пересборка standard и bypass (fixed-ui-10)**:
    - Оба билда собраны из актуального дерева (`rebuild.py both`) с фиксами пп. 32–34; слои `env/pkg` получили новые детекторы `pkgSha256`/`bundleId` в `app/assets/env/manifest.json` для автоматической накатки обновлений на существующие установки.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-10-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-10-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

36. **Автопроверка пакетов и устранение ложной красной плашки при входе в «Инструменты»**:
    - Устранена ложная красная плашка («Список пакетов ещё не загружен — состояние неполное») при входе в «Настройки → Инструменты».
    - В `app/assets/env/overlay/var/lib/pkg/index/` включён готовый индекс пакетов (`repo.1.tsv`, `repo.1.Packages`, `repo.1.url`) — индекс теперь доступен сразу после установки без ожидания загрузки по сети.
    - В `agy_tools.sh` (`op_status`) добавлена автоматическая генерация `.tsv` на лету из `.Packages` через `index.awk`, если файл отсутствует; оптимизирован опрос установленных пакетов в едином `awk` (~120 мс вместо 3+ секунд).
    - В `agy_tools.js` исправлено кэширование `hasIndex`, плашка скрывается при наличии установленных пакетов, а при входе в «Инструменты» (`__agyToolsMount`) проверка компонентов запускается автоматически (`refresh(true)`), делая все индикаторы зелёными без необходимости нажимать кнопку «Проверить» вручную.

37. **Выделенное подменю настроек «Серверы MCP» (ТЗ 14)**:
    - В меню «Настройки» добавлен отдельный раздел «Серверы MCP» (`agy_mcp.js`), зарегистрированный в роутере `main.js` и словарях русской локализации `agy_i18n.js`.
    - **Подменю компонентов**: диагностика и централизованная установка в 1 клик всех необходимых MCP-пакетов (`Node.js LTS`, `@modelcontextprotocol/server-sequential-thinking`, `exa-mcp-server`, `mcp-remote`, `@modelcontextprotocol/server-github`, `gopls`) с автоматическим вызовом `agy-fix-paths` и живым логом в терминале.
    - **Интеграция с кастомными провайдерами**: переключатель поддержки инструментов MCP для сторонних API (OpenAI, Claude, DeepSeek) с автоматической установкой флага `tools: true` в конфигурации моделей.
    - **Карточки серверов и авторизация**: ввод ключей (`EXA_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `X-Goog-Api-Key` для StitchMCP), тумблеры включения/отключения каждого сервера.
    - **Прямой нативный запуск**: автоматическая нормализация `mcp_config.json` на вызов `/runtime/bin/node` с корректными `LD_LIBRARY_PATH`, `PATH` и `NODE_PATH`, исключающая сбои `npx` и неработающего на Android `docker`. Кнопка быстрого перезапуска ядра через мост `AgyProviders.restartCore()`.

38. **Полноценный каталог и маркетплейс серверов MCP**:
    - Расширение подменю «Серверы MCP» до полноценного маркетплейса серверов.
    - В каталог включены проверенные серверы экосистемы MCP:
      - `Sequential Thinking` — пошаговое логическое мышление и планирование;
      - `Memory Graph` — долговременный граф знаний, сущностей и связей;
      - `Filesystem Access` — безопасный доступ к файлам хранилища устройства (`/storage/emulated/0`);
      - `Everything Reference` — эталонный MCP-сервер для тестирования промптов, ресурсов и инструментов;
      - `Exa AI Search` — интеллектуальный нейросетевой веб-поиск в реальном времени;
      - `Context7 Docs` — мгновенный поиск официальной документации библиотек, фреймворков и API;
      - `Brave Search` — поиск через официальный Brave Search API;
      - `Google Stitch MCP` — удаленный доступ к облачным инструментам Stitch API;
      - `GitHub MCP` — полный цикл работы с GitHub (репозитории, PR, issue, коммиты);
      - `Go Language Server (gopls)` — автодополнение, навигация и диагностика Go;
      - `Notion MCP` и `Sentry MCP` — интеграции с рабочими пространствами и мониторингом ошибок.
    - **Фильтрация и поиск**: быстрый поиск по названиям, тегам и описаниям; фильтрация по категориям («Все», «Рассуждения», «Поиск и веб», «Разработка», «Файлы», «Облако»).
    - **Добавление собственных серверов**: интерактивное модальное окно «+ Добавить свой MCP-сервер» с настройкой ID, команды запуска, аргументов и переменных окружения, а также возможность удаления серверов.
    - **Сквозная синхронизация с кастомными провайдерами**: кнопка моментальной синхронизации флага `tools: true` со всеми моделями сторонних провайдеров.
    - **1-клик установка стека**: одновременная установка всех необходимых npm-пакетов и бинарников с живым терминальным логом.

39. **Пересборка standard и bypass (fixed-ui-11)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) со всеми доработками каталога MCP.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-11-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-11-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

40. **Настройки пользователя: Навыки (Skills), Инструкции (AGENTS.md) и Плагины**:
    - Переработан встроенный раздел «Настройки пользователя» (`Customizations`), ранее зависавший на недоступном для standalone-установок Google Internal Language Server.
    - **Вкладка «Навыки» (Skills)**:
      - Отображение всех 36+ процедурных навыков (встроенные, навыки из плагинов Android CLI, Flutter, Modern Web, и пользовательские).
      - Фильтрация по категориям («Все», «Мои навыки», «Из плагинов», «Встроенные») и живой поиск по названию/описанию.
      - **Создание собственных навыков**: интерактивное модальное окно «+ Создать свой навык» с генерацией корректного YAML-манифеста в `~/.gemini/config/skills/<id>/SKILL.md` (автоматически подхватывается ядром во всех диалогах).
      - Тумблеры включения/отключения навыков и удаление кастомных навыков.
    - **Вкладка «Инструкции» (AGENTS.md)**:
      - Встроенный полноэкранный редактор глобальных инструкций и правил поведения агента (`~/.gemini/config/AGENTS.md`).
      - Пресеты для быстрой вставки правил (лаконичные ответы, строгая типизация, русский язык).
      - Кнопка восстановления эталонных инструкций Android.
    - **Вкладка «Плагины» (Plugins)**:
      - Обзор установленных плагинов (`android-cli-plugin`, `flutter`, `modern-web-guidance-plugin`) со статистикой включённых в них навыков, правил и MCP-серверов.
      - Переключатели активации плагинов с синхронизацией в `~/.gemini/config/config.json`.
    - **Сквозная интеграция с кастомными провайдерами**:
      - Гарантированная передача правил, инструкций и инструментов в сторонние модели (OpenAI, Claude, DeepSeek) с кнопкой моментальной синхронизации `tools: true`.

41. **Пересборка standard и bypass (fixed-ui-12)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) со всеми доработками подменю «Настройки пользователя».
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-12-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-12-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

42. **Реализация поддержки UTCP-серверов и спецификаций OpenAPI 3.0**:
    - Интеграция стандарта **Universal Tool Calling Protocol (UTCP)** (utcp.io) для прямого подключения внешних REST API, Swagger/OpenAPI спецификаций и кастомных JSON-мануалов без написания промежуточных MCP прокси-серверов.
    - Установлен и оптимизирован стек `@utcp/mcp-bridge`, `@utcp/sdk`, `@utcp/http`, `@utcp/file`, `@utcp/cli`, `@utcp/dotenv-loader`.
    - Выделенная вкладка **«🌐 UTCP & OpenAPI»** в настройках MCP-серверов:
      - Обзор состояния моста UTCP ↔ MCP, активного конфига (`~/.gemini/config/utcp_config.json`) и счетчика мануалов.
      - Карточки подключенных сервисов с бейджами типа (`OPENAPI`, `REST`, `FILE`), тумблерами активности, списком обнаруженных инструментов, кнопкой живого тестирования (`🔍 Проверить инструменты`) и удаления.
      - **Каталог готовых бесплатных UTCP API (1-клик подключение)**:
        - *Open-Meteo Weather API*: Прогноз погоды и текущая температура по координатам по всему миру без API ключа.
        - *IP Geolocation API*: Определение страны, города, провайдера и координат по любому IP адресу.
        - *REST Countries Global API*: Энциклопедия стран мира (столицы, валюты, население, языки).
        - *CoinGecko Crypto API*: Курсы криптовалют (BTC, ETH, TON, SOL) в реальном времени.
      - Интерактивное модальное окно **«+ Добавить UTCP мануал / OpenAPI сервис»** с поддержкой удалённых OpenAPI 3.0 спецификаций, REST эндпоинтов и локальных JSON-файлов, а также опциональной Bearer/API Key авторизацией.
    - Автоматическая трансляция всех зарегистрированных UTCP-инструментов через мост в ядро Antigravity и кастомные провайдеры (OpenAI, Claude, DeepSeek).

43. **Пересборка standard и bypass (fixed-ui-13)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) с полной поддержкой UTCP и OpenAPI.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-13-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-13-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

44. **Редизайн настроек MCP, UTCP и кастомизации в нативный стиль Antigravity IDE**:
    - Полная переработка визуального оформления экранов «MCP Серверы», «UTCP и OpenAPI» и «Настройки пользователя»:
      - Строгое следование архитектуре компонентов Antigravity IDE (`u3` / `v3` / `w3`): группировка настроек в монолитные карточки с горизонтальными разделителями (`rounded-xl border border-border divide-y divide-border bg-card/40`).
      - Сегментированные контролы переключения вкладок (`inline-flex p-1 rounded-lg bg-secondary/50 border border-border/40 gap-1`, активная вкладка `bg-background text-foreground shadow-sm`).
      - Полное удаление цветных эмодзи из табов, фильтров, заголовков и кнопок в пользу аутентичной IDE-эстетики: минималистичные SVG-иконки, строгие шрифты и нативные бейджи (`text-[10px] font-semibold bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full border border-border`).
      - Использование системных токенов темы Antigravity (`--background`, `--foreground`, `--muted-foreground`, `--card`, `--border`, `--secondary`, `--secondary-foreground`, `--primary`, `--destructive`).

45. **Пересборка standard и bypass (fixed-ui-14)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) с аутентичным оформлением Antigravity IDE.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-14-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-14-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

46. **Обновление раздела «Настройки пользователя» и прямые ссылки на получение API-токенов в MCP**:
    - **Навыки (Skills)**:
      - Добавлена возможность **просмотра** содержимого любого навыка (`SKILL.md`) в модальном окне с подсветкой синтаксиса и описанием триггера агента.
      - Реализована функция **копирования встроенных навыков и навыков из плагинов** в пользовательские навыки (`~/.gemini/config/skills/<name>/SKILL.md`). Пользователь может клонировать любой системный навык под своим именем для кастомизации инструкций.
      - Реализовано **редактирование** инструкций и триггеров пользовательских навыков прямо из интерфейса.
      - Сохранено и улучшено модальное окно **«+ Создать свой навык»** для быстрого добавления процедурных инструкций.
    - **Плагины (Plugins)**:
      - Возвращен и расширен **каталог готовых плагинов с 1-клик установкой**:
        - *Google Workspace & Cloud* (интеграция с Docs, Sheets, Drive и Cloud API).
        - *Python Data Science & ML* (пакет навыков EDA, визуализации данных и машинного обучения).
        - *Docker & Container DevOps* (оптимизация Dockerfile и docker-compose).
        - *Database Engineering & SQL* (проектирование схем и оптимизация SQL-запросов).
        - *Security Audit & Hardening* (поиск уязвимостей OWASP Top 10 и аудит секретов).
        - *Git Automation & Conventional Flow* (стандарты Conventional Commits и ревью PR).
      - Управление установленными плагинами: тумблеры включения/отключения, бейджи количества навыков, правил и MCP-серверов, кнопка удаления для пользовательских плагинов.
      - Функция «+ Создать свой плагин» для быстрого создания структуры плагина в `~/.gemini/config/plugins/`.
    - **Ссылки на получение API-токенов для MCP серверов**:
      - В карточках MCP-серверов рядом с полями ввода ключей добавлены прямые компактные ссылки на официальные порталы выдачи API-токенов (`dashboard.exa.ai`, `github.com/settings/tokens`, `aistudio.google.com`, `api.search.brave.com`, `notion.so/my-integrations`, `sentry.io/settings` и др.).
      - Ссылки открываются в браузере с сохранением контекста и возможностью быстро скопировать токен в буфер обмена.

47. **Пересборка standard и bypass (fixed-ui-15)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`).
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-15-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-15-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

48. **Курация каталогов под Android: убрано всё, что не работает на устройстве**:
    - Анализ штатной реализации «Настройки пользователя» (экран *Customizations* стокового Antigravity из репозитория на GitHub): Skills / Agents / MCP servers / Rules / Hooks / UI extensions + удалённый каталог *Build With Google Plugins* и магазин MCP-шаблонов («Add MCP», поиск по имени, установка в 1 клик). Локальная реализация приведена к той же логике: Installed + Marketplace, без лишнего.
    - **MCP-серверы**: из каталога удалены записи `notion` и `sentry` — они не имели пути установки на Android (npx-прокси без компонента) и только засоряли список. Остались 10 серверов, реально работающих на ARM64: sequential-thinking, memory, filesystem, everything, exa, brave-search, context7, github-mcp-server, gopls (через pkg), StitchMCP (mcp-remote).
    - **Плагины**: из каталога 1-клик установки удалён `docker-devops` (Docker на Android недоступен), `database-tools` перенацелен с Postgres/MySQL на **SQLite — нативную БД Android** (`sqlite-optimizer` + `schema-design`). Итоговый каталог: Google Workspace & Cloud, Python Data Science & ML, SQLite & Mobile Databases, Security Audit & Hardening, Git Automation & Conventional Flow — всё исполняется штатными рантаймами устройства (python3, git, sqlite, HTTP-API).
    - Теги каталога плагинов переведены на русский для единообразия интерфейса.
    - **Порядок в разделе «Навыки»**: список (40+ записей из builtin/плагинов) теперь группируется по секциям — «Пользовательские», «Из плагинов», «Встроенные» — с заголовками и счётчиками; убраны дублирующие path-строки в подвале карточек и избыточные бейджи типа (тип теперь задаёт группа).

49. **Пересборка standard и bypass (fixed-ui-16)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) с очищенными каталогами MCP и плагинов.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-16-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-16-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

50. **Исправлен критический баг «Навыки (0) / Плагины (0)» в настройках пользователя**:
    - Причина: при открытии экрана параллельно запускались два опроса моста (`status` и `read-instructions`), а глобальный `pollTimer` первого опроса отменялся вторым — результат скана навыков и плагинов **никогда не парсился**, и список всегда был пустым (инструкции при этом загружались — они шли вторым опросом).
    - Исправление: опрос переведён на **независимые таймеры на каждый job** (`pollTimers[id]`), каждый опрос разбирает **собственный лог** (`r.log`), счётчик `activeJobs` заменяет единственный `job`; эагер-загрузка инструкций при монтировании убрана (вкладка подхватывает её при открытии).
    - Результат: при открытии раздела отображаются все **36 навыков** (8 встроенных + 28 из плагинов flutter/android-cli/modern-web) и **3 установленных плагина**.

51. **Анализ и очистка работающих MCP-серверов, каталог пополнен плагинами из Build With Google**:
    - Полный smoke-test всех серверов через JSON-RPC `initialize`: **OK** — sequential-thinking, memory, filesystem, everything, exa, context7, github, StitchMCP (mcp-remote), UTCP-мост (загружает 4 мануала), gopls; компоненты node v24.22.2 / npm 12.2.2 / python 3.14.10 / git 2.56.0 установлены.
    - `brave-search` оставлен **отключённым** — в конфиге плейсхолдер `YOUR_BRAVE_KEY`; включится после вставки реального ключа (ссылка на выдачу ключа есть в карточке сервера).
    - Очищен конфиг: удалён мёртвый стоковый `android-management-api` (disabled, пустые args); для `memory` задан `MEMORY_FILE_PATH` вне `node_modules` (защита графа знаний от затирания при обновлении npm-пакета).
    - Каталог плагинов пополнен тремя позициями из магазина Build With Google (фото 4): **Google Antigravity SDK** (Python SDK для агентов), **Science** (научные задачи), **Firebase** (Auth/Firestore/Functions) — все на текстовых навыках, работают на Android без дополнительных рантаймов.

52. **Пересборка standard и bypass (fixed-ui-17)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) с починенным сканом навыков/плагинов и обновлённым каталогом.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-17-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-17-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

53. **Тулчейн-фиксы: JVM-пути Termux-JDK и Flutter/Dart на Android (автоматизация)**:
    - **Корневая причина JVM-ошибок** (jadx/apktool/d8/apksigner/Gradle: `AccessDeniedException` в `/data/data/com.termux/...`): Termux-OpenJDK зашивает `user.home` и `java.io.tmpdir` в недоступные пути; JVM игнорирует `TMPDIR` для `java.io.tmpdir`.
    - Новый профиль **`$PREFIX/etc/profile.d/65-agy-jvm.sh`** (входит в overlay): выставляет `JAVA_TOOL_OPTIONS="-Duser.home=$HOME -Djava.io.tmpdir=…"` для **всех** Java-инструментов сразу; выбор tmp-каталога — с проверкой записываемости `TMPDIR`. `agy-fix-paths` дополнен шагом 3 — профиль самовосстанавливается при отсутствии.
    - Новая обёртка **`jadx-agy`**: песочные JVM-флаги + `-Xmx1500m` (защита от OOM-kill/137 на ~2 ГБ RAM), рекомендация `-j 2 --no-res`; `--single-class-thread` не существует в jadx 1.5.x.
    - Новый идемпотентный скрипт **`agy-fix-flutter`** (все 7 разделов документа фиксов): подмена glibc `cache/dart-sdk` на bionic-сборку `pkg install dart` (сверка версий, оригинал → `dart-sdk.glibc`), патчи `os.dart` / `platform.dart` / pub-cache `local_platform.dart` (все `platform-*`), инвалидация `flutter_tools.snapshot` только при реальных правках, `gradle.properties` (`-Duser.home`/`-Djava.io.tmpdir`), очистка битого `~/.gradle/native` (проверка ELF-магии). Проверен на устройстве: повторный запуск — «всё [ok], 0 fix(es)».
    - **Механизм доставки**: `overlaySha256` в `app/assets/env/manifest.json` — версионный токен (декомпиляция `EnvInstaller` подтвердила: несовпадение с маркером `$PREFIX/.installed` → перекопирование overlay слиянием, без стирания). Токен пересчитан генератором `tools/gen_env_overlay_sha.py` (схема: sha256 по отсортированным «sha256 relpath»-строкам) → новые файлы попадут в `$PREFIX` при следующем старте приложения.
    - Документация: `docs/jadx-fixes.md` и `docs/flutter-toolchain.md` (полные документы фиксов), раздел 8 «Toolchain Fixes» добавлен в seed `AGENTS.md` и `AGENTS.md` окружения — агент знает про `agy-fix-flutter` и `jadx-agy`.

54. **Пересборка standard и bypass (fixed-ui-18)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) с тулчейн-фиксами JVM/Flutter/jadx в overlay.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-18-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-18-bypass.apk` в корне `Antigravity Projects/` (контрольные суммы — `SHA256SUMS.txt`).

55. **Интеграция Flutter SDK в инструменты, исправление сбоя MCP-конфигурации и ссылки Stitch (fixed-ui-19)**:
    - **Интеграция Flutter SDK в «Настройки → Инструменты» (`agy_tools.js`, `agy_tools.sh`)**:
      - Добавлена группа компонентов «Flutter & Dart» (компонент `flutter-sdk`, проверка `flutter,dart`) и готовый пресет «Flutter-разработка» для быстрой установки в 1 клик.
      - Скрипт автоматической установки `op_flutter()`: автоматическая загрузка системных пакетов (`dart`, `git`, `curl`, `tar`, `xz-utils`, `python`), клонирование официального SDK ветки `stable` в `$HOME/flutter_sdk`, экспорт путей `FLUTTER_ROOT` и `$HOME/flutter_sdk/bin` в окружение (`write_env()`), запуск bionic-патчера `agy-fix-flutter` (замена glibc Dart SDK на нативный Dart из `pkg`, адаптация `os.dart`, `platform.dart` и `local_platform.dart` в pub-cache).
      - Добавлена проверка жизнеспособности инструментов `flutter` и `dart` в общую верификацию (`op_verify`).
      - Реализована функция полного и чистого удаления Flutter SDK (`op_flutterremove`) с очисткой экспортируемых путей.
      - Добавлено отслеживание прогресса установки Flutter в UI (`agy_tools.js`).
    - **Исправление сбоя работы и сохранения MCP-серверов (`mcp_config.json`)**:
      - Устранена ошибка `json.decoder.JSONDecodeError`, возникавшая при сохранении API-ключей (`set-key`) и переключении тумблеров серверов (`toggle`) при пустом (0-байтовом) файле `~/.gemini/config/mcp_config.json`.
      - Добавлен автоматический fallback с инициализацией структуры `{"mcpServers": {}}` во всех операциях чтения/записи `op_mcp`.
    - **Маскирование API-ключей звёздочками (`***`)**:
      - Исправлено определение приватных полей в `agy_mcp.js`: проверка заменена с регистрозависимой `indexOf("KEY")` на регулярное выражение `/key|token|secret|auth|password/i`. Теперь ключи `X-Goog-Api-Key` (Stitch), `api_token` и `access_token` надёжно маскируются как `type="password"`.
    - **Исправление StitchMCP**:
      - Исправлен официальный URL получения ключа / авторизации: ссылка перенаправлена с `aistudio.google.com` на `https://stitch.withgoogle.com/`.
      - Добавлена автогенерация валидной конфигурации StitchMCP в `mcp_config.json` с вызовом через `node`, прокси `mcp-remote`, аргументами и корректным окружением `LD_LIBRARY_PATH`.

56. **Пересборка standard и bypass (fixed-ui-19)**:
    - Сборка standard и bypass APK из актуального дерева репозитория (`rebuild.py both`) со всеми исправлениями инструментов, Flutter SDK и MCP-серверов.
    - Готовые APK: `Antigravity-BP-2.4.1-ru.fixed-ui-19-standard.apk` и `Antigravity-BP-2.4.1-ru.fixed-ui-19-bypass.apk`.

57. **Переход на мажорную версию 3.0 (v3.0)**:
    - Обновление нумерации проекта на собственную мажорную версию **3.0**:
      - В манифесте `app/AndroidManifest.xml` прописана версия `3.0.0-ru.s7p1` (`versionName`).
      - В `rebuild.py` обновлена конфигурация сборки под релиз 3.0.
      - Все 29 крупных блоков улучшений и исправлений (пп. 28–56), разработанных после публичного аудита v2.4.1 на GitHub, консолидированы в единую стабильную ветку 3.0.
    - Собраны официальные релизные пакеты:
      - `Antigravity-BP-3.0-standard.apk` (базовая сборка)
      - `Antigravity-BP-3.0-bypass.apk` (сборка с region bypass)
    - Сгенерированы контрольные суммы SHA-256 в `SHA256SUMS.txt`.

---
<!-- /RU -->

<!-- EN -->
1. **Full Russian localisation.**
   - The `agy_i18n.js` dictionary (EN → RU) for the whole app interface.
   - +64 dictionary keys: the agent's action statuses in the chat ("Unpacking", "Downloading", "Building", "Cloning", "Analysing", "Testing"… and the "…" variants for progressive statuses), the card and dialog strings.
   - A live reasoning indicator in Russian: "Thinking — N s".
   - Russian pluralisation of the question counter: "N вопрос / вопроса / вопросов".
   - The confirmation dialog: Russian variants "outside the project" and "globally" — the English duplicates that made the variants look identical were removed.
   - The strings of the agent question card and of the answer are translated.

2. **Attaching up to 10 files.**
   - The limit was raised from 5 to 10.

3. **Correct display of attached files.**

4. **Ability to view and delete files attached to the chat.**

5. **Shield mode in the chat — chat behaviour settings (security and JavaScript), "does not ask" mode.**
   - Shield sections: security profile, access to files outside folders, **internet access** ("Always ask" / "Allow" / "Deny"), automatic execution of terminal commands, sandbox, JavaScript in the browser.
   - Autonomous agent operation: "Do not ask" (EAGER) is set and the sandbox is off — Android has no bwrap, so previously the "Run in sandbox" combination required confirmation for every command. Now the agent works autonomously and does not ask for confirmation again.
   - **Shield choices are actually persisted**: writing through the `AgyTools` native bridge into `config.json` (new `policy` operation), enum value normalisation (numbers and strings like `AGENT_SETTING_POLICY_ALLOW`), a sticky overlay for instant display, and synchronisation with the config when the shield opens. Previously the write was rolled back (the JS bundle schema dropped the `userSettings` fields) and the settings "did not stick".
   - The shield popup is strictly the width of the context window (the 360px limit is gone).

6. **Initial onboarding for choosing the language.**

7. **Compact and tidy menus, dropdowns and windows.**
   - Compact menu sheets and anchored popups (menu/select) in the Out27 style: 14/12px radii, compact items, shadows; the menu backing layer is fully transparent.
   - Width limits removed, centring and correct positioning in wide windows.

8. **Applying theme styles to the menus, dropdowns and windows.**
   - Background/border come from the theme tokens (`--popover` / `--card` / `--border` / `--foreground`) — identically in the light and dark theme.
   - The plugin warning banner is switched to theme tokens (no yellow `--color-warning`), the text is centred.

9. **Developer tools built into the settings** — installing components from the settings so the agent does not download them in the chat.
   - Full NDK: accepts `.tar.xz` / `.tar.gz` / `.zip` archives, unpacked with `tar`, with a fallback that avoids the GitHub API (rate-limit protection).
   - TypeScript pinned to `typescript@5` — TS 7+ (the native `tsgo`) does not build on Android.
   - zipalign removed from the tool list and from the "Android app (Gradle)" preset — it is absent from the pkg repository and `apksigner` does the signing.
   - Tool bridges through `exec $(readlink -f …)` — shell scripts such as `ndk-build` no longer break on symlinks.
   - Fixes for batch preset installation and for the package status parser.

10. **A "Language" row added to the "General" settings module.**

11. **Light transparency and darkening implemented.**
    - Compact sheets, anchored popups and the shield popup — 90% opacity (10% of "glass"; previously 4%).
    - Menu backings fully transparent; `box-shadow` shadows only in the light theme (disabled in the dark one); `backdrop-filter` is not used.

12. **Background operation fixed** — it no longer hangs on the logo when minimised; an app kept in memory keeps working.

13. **Gestures fixed.**
    - Back from a submenu returns to the previous menu instead of jumping straight to the projects window.
    - Settings collapse downwards like a sheet.

14. **Microphone — text transcription** for custom providers (added by the user manually) using Android Speech Cognition.

15. **Custom models can see images.**

16. **Dictation settings.**

17. **Thinking modes.**

18. **The "Open provider settings" navigation.**
    - The path and the query are passed to the TanStack router separately (`navigate({to, search})`) — previously a URL with `?` turned into a garbage pathname and the transition did not work.
    - This also fixes "Provide Feedback" and navigation between settings sections.
    - Instead of the "Plugins not supported for this auth method" error — a button that goes to the provider settings (in the final version — no button, only a theme-aware text banner).

19. **Agent question card — duplicate strings removed.**
    - The crossfade of text transitions is disabled (the old and the new text are no longer rendered at the same time, "lines 3 and 4" are no longer duplicated).

20. **The "Keyboard shortcuts" tab is removed from the settings** — via the stock `hideShortcuts` flag; desktop layouts are not needed on Android.

21. **Full width for reasoning and the terminal** — the side paddings `pl-2` / `ml-4` are gone, tool steps start from the left edge.

22. **Shield test harness** — 47 automatic checks of the shield logic against the real `config.json` (enum normalisation, writing through the bridge, synchronisation, protection of fresh choices).

23. **Fixing and adapting MCP servers for Android**:
    - A Node.js environment was deployed (`nodejs-lts` 24.22.2) with the `npm` 12.2.1 and `npx` gateways.
    - Native MCP servers were installed and adapted: `sequential-thinking` (v2.0.0), `exa-search-server` (v3.4.2), `github-mcp-server` (v0.6.2, the unavailable Docker container replaced with a native JS package), `mcp-remote` (StitchMCP).
    - Shebang paths fixed through `agy-fix-paths` for the Android userspace prefix.
    - Clean startup configured directly through the binaries, without delays and without network dependencies (`mcp_config.json`).
    - The incompatible `android-management-api` removed (it required Google Cloud Application Default Credentials).

24. **For MCP servers to work they must be added from the standard Antigravity provider, and the core must be switched.**

25. **Install Node.js**:
    - Running and operating most MCP servers and their dependencies requires Node.js installed on the system (`pkg install nodejs-lts`).

26. **Fixing MCP server operation with custom providers**:
    - Cyclic recursion of the shell bridges eliminated (when creating symlinks in `runtime/bin` overwrote the original binaries in `$PREFIX/bin` with bridge scripts and caused `context deadline exceeded` / signal 36 failures).
    - `LD_LIBRARY_PATH: $PREFIX/lib` added to the environment of every MCP server (`mcp_config.json`), which solves the Bionic dynamic linking problem (`libz.so.1 not found: needed by main executable`) when the `language_server` core spawns processes.
    - The direct JS entry points corrected: `stdio.cjs` for `exa-mcp-server` and `proxy.js` for `mcp-remote` (StitchMCP).
    - All 4 MCP servers (`sequential-thinking`, `exa`, `github-mcp-server`, `StitchMCP` — 45 tools in total) successfully reach `MCP_SERVER_STATUS_READY` and expose their function-calling schemas without needing to switch the core, and `AgyGateway` transparently forwards tool calls to custom models over the OpenAI protocol.

27. **Rebuild of standard and bypass**:
    - Both builds were rebuilt from the current source tree (`rebuild.py both`), now including the MCP server fixes (item 26) and the updated documentation.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-9-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-9-bypass.apk` — located in the root of the `Antigravity Projects/` folder next to the repository.
    - The `Antigravity Projects` folder was tidied up: only the current source code (the repository with README and CHANGELOG) and the two APKs were kept; old builds (ui-8, the base fixed-ui-9), intermediate projects, archives and duplicate working copies were deleted.

28. **Eliminating core and command crashes with exit code 164 (signal 36 / SIGRTMIN+2)**:
    - The source of signal 36 was identified: the Android 16 system background profiler (`traced_perf` / ART), which broadcasts signals to app processes. Because no handler for signal 36 was installed in glibc / bionic, the processes terminated immediately with code `164 = 128 + 36`.
    - A low-level `SIG_IGN` installation for signals 36 and 37 through `raw_rt_sigaction` was added to the `liblse_compat.c` core in the library constructor, together with a `sigaction()` interceptor that prevents the ignore flag from being reset by runtime components. Since POSIX guarantees `SIG_IGN` survives `execve()`, all child processes inherit the protection. `app/assets/runtime/lib/liblse_compat.so` was recompiled and the runtime manifests for standard and bypass were updated.
    - A preventive `trap '' 36 37 2>/dev/null || true` was added to all startup shells (`00-env.sh`, `pkg`, `agy_tools.sh`, the `bash` wrapper).

29. **Preserving the selected custom model when the app is minimised**:
    - In `app/assets/web/generated/main.js` (`fKa`) the custom-model state is initialised and synchronised with `localStorage` (`agyLastCustomModel`).
    - Previously, when the app was minimised and the component re-rendered, the state was reset to `null`, which rolled the selection back to the standard Google models. The choice is now reliably preserved across sessions and returns from the background.

30. **Fixing the tool installation hang (Settings › Tools) and the reset button**:
    - The cause of the hang was diagnosed: when the background script terminated abnormally, the `rc` exit-code file was never created, so the web UI polled a non-existent process forever.
    - A forced cancel/reset `[✕]` button was added to the task panel UI in `agy_tools.js`.
    - Automatic timeout and hang detection were added: if a process does not update its journal for more than 45 seconds while having run for more than 90 seconds in total (or exceeds 10 minutes), the job is automatically marked as failed and the journal is opened for analysis.
    - Signals 36/37 are intercepted inside the `pkg` and `agy_tools.sh` scripts, preventing packages from dying in the middle of an installation.

31. **Fixing terminal startup (`libandroid-support.so not found`) and the Bionic bash bridge**:
    - A system wrapper for `$PREFIX/bin/bash` was added to `overlay/bin/bash`; it reliably exports `LD_LIBRARY_PATH="$PREFIX/lib"`, sets `PREFIX` and the Termux variables, and launches the real `bash.bin` binary.
    - This completely removes the Bionic dynamic linker failure when the terminal starts from `CoreEnvironment` (where `LD_LIBRARY_PATH` is deliberately cleared to isolate the glibc core).
    - The `overlaySha256`, `pkgSha256` and `bundleId` hashes in `app/assets/env/manifest.json` were updated so the overlay is rolled onto existing installations automatically.

32. **Synchronising the repository with the "tools-log-fix" branch (previously the changes only lived in the built APK)**:
    - The updates to `agy_tools.js` (refined check ids for `node-lts`/`java17`, SDK API 36/37 and build-tools 36/37 components, `aidl`, "aapt + zipalign"), `agy_shield.js` (initial policy write into `config.json` through the bridge and ignoring outdated enums) and `agy_ru.js` were moved into `app/assets/web/`, and `agy_resolver.sh` was added.
    - Improved dependency-alternative selection was moved into `app/assets/env/pkg/lib/resolver.sh`: an already installed alternative is chosen only if its version satisfies the dependencies (protecting `nodejs-lts` from being overwritten by `nodejs`).
    - The updated `overlay/bin/bash`, the rebuilt `liblse_compat.so` and the current runtime manifests (standard and bypass) were moved over from the `*-tools-log-fix` build.

33. **Reliability of tool installation (Settings › Tools) on an unstable network**:
    - The root cause of the earlier installation failures: connection resets (curl error 35 "Recv failure: Connection reset by peer") — the standard `curl --retry` does not retry them, so `pkg install` failed on the first attempt and needed 3–4 tries.
    - In `pkg` (`lib/fetch.sh`, index download) curl was switched to `--retry 5 --retry-all-errors` with backoff.
    - `pkg_retry` (up to 3 attempts with pauses) was added to `agy_tools.sh` around all `pkg update/install/upgrade` and `npm install` calls (plus `--fetch-retries=5`); the SDK download is hardened with retries; the NDK download (~1 GB) resumes with `-C -` and falls back to a full re-download.
    - The `npm: command not found` error during self-test was a consequence of the same problem (an interruption during `pkg install npm`).

34. **Providers: "Load models" for Claude-compatible APIs without a model catalogue**:
    - For providers such as MiMo the Anthropic endpoint works (`POST /v1/messages` → 200) but does not expose a model list (`GET /v1/models` → 404) — the button failed with an error.
    - A fallback was added: if the catalogue for the API type is unavailable, the OpenAI-compatible catalogue of the same server (`<origin>/v1/models`) is requested and the source is noted in the message.
    - Manual model addition (a "Model ID" field + "Add") and model deletion (✕) were added — for providers with no catalogue at all.
    - Base URL normalisation: trailing `/` and a redundant `/v1` for the Anthropic type are stripped automatically; errors are shown as clean text without HTML noise.

35. **Rebuild of standard and bypass (fixed-ui-10)**:
    - Both builds were compiled from the current tree (`rebuild.py both`) with the fixes from items 32–34; the `env/pkg` layers received new `pkgSha256`/`bundleId` detectors in `app/assets/env/manifest.json` so updates roll onto existing installations automatically.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-10-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-10-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

36. **Automatic package check and removal of the false red banner when opening "Tools"**:
    - The false red banner ("The package list is not loaded yet — the state is incomplete") when opening "Settings → Tools" is eliminated.
    - A ready package index (`repo.1.tsv`, `repo.1.Packages`, `repo.1.url`) is now shipped in `app/assets/env/overlay/var/lib/pkg/index/` — the index is available immediately after installation without waiting for a network download.
    - Automatic on-the-fly `.tsv` generation from `.Packages` through `index.awk` was added to `agy_tools.sh` (`op_status`) for the case when the file is missing; polling of installed packages was optimised into a single `awk` (~120 ms instead of 3+ seconds).
    - In `agy_tools.js` the `hasIndex` caching was fixed, the banner is hidden when packages are installed, and opening "Tools" (`__agyToolsMount`) now triggers the component check automatically (`refresh(true)`), making all indicators green without having to press the "Check" button manually.

37. **A dedicated "MCP Servers" settings submenu (spec 14)**:
    - A separate "MCP Servers" section (`agy_mcp.js`) was added to the "Settings" menu, registered in the `main.js` router and in the Russian localisation dictionaries of `agy_i18n.js`.
    - **Components submenu**: diagnostics and centralised one-click installation of all required MCP packages (`Node.js LTS`, `@modelcontextprotocol/server-sequential-thinking`, `exa-mcp-server`, `mcp-remote`, `@modelcontextprotocol/server-github`, `gopls`) with automatic invocation of `agy-fix-paths` and a live terminal log.
    - **Integration with custom providers**: a toggle for MCP tool support in third-party APIs (OpenAI, Claude, DeepSeek) that automatically sets the `tools: true` flag in the model configuration.
    - **Server cards and authorisation**: key entry (`EXA_API_KEY`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `X-Goog-Api-Key` for StitchMCP) and on/off switches for each server.
    - **Direct native startup**: automatic normalisation of `mcp_config.json` to call `/runtime/bin/node` with correct `LD_LIBRARY_PATH`, `PATH` and `NODE_PATH`, ruling out `npx` failures and the Android-incompatible `docker`. A quick core-restart button through the `AgyProviders.restartCore()` bridge.

38. **A full catalogue and marketplace of MCP servers**:
    - The "MCP Servers" submenu was expanded into a full server marketplace.
    - The catalogue includes vetted MCP ecosystem servers:
      - `Sequential Thinking` — step-by-step logical reasoning and planning;
      - `Memory Graph` — a long-term graph of knowledge, entities and relations;
      - `Filesystem Access` — safe access to the device storage files (`/storage/emulated/0`);
      - `Everything Reference` — the reference MCP server for testing prompts, resources and tools;
      - `Exa AI Search` — intelligent neural web search in real time;
      - `Context7 Docs` — instant lookup of official documentation for libraries, frameworks and APIs;
      - `Brave Search` — search through the official Brave Search API;
      - `Google Stitch MCP` — remote access to the cloud Stitch API tools;
      - `GitHub MCP` — the full GitHub workflow (repositories, PRs, issues, commits);
      - `Go Language Server (gopls)` — autocompletion, navigation and diagnostics for Go;
      - `Notion MCP` and `Sentry MCP` — workspace integrations and error monitoring.
    - **Filtering and search**: quick search by name, tags and descriptions; filtering by category ("All", "Reasoning", "Search & web", "Development", "Files", "Cloud").
    - **Adding your own servers**: an interactive "+ Add your own MCP server" modal for configuring the id, launch command, arguments and environment variables, plus the ability to delete servers.
    - **End-to-end synchronisation with custom providers**: a button that instantly syncs the `tools: true` flag to all models of third-party providers.
    - **One-click stack installation**: simultaneous installation of all required npm packages and binaries with a live terminal log.

39. **Rebuild of standard and bypass (fixed-ui-11)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with all the MCP catalogue work.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-11-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-11-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

40. **User settings: Skills, Instructions (AGENTS.md) and Plugins**:
    - The built-in "User settings" (`Customizations`) section was reworked; it previously hung on the Google Internal Language Server that is unavailable to standalone installations.
    - **The "Skills" tab**:
      - Display of all 36+ procedural skills (built-in ones, skills from the Android CLI, Flutter and Modern Web plugins, and user-defined ones).
      - Filtering by category ("All", "My skills", "From plugins", "Built-in") and live search by name/description.
      - **Creating your own skills**: an interactive "+ Create your own skill" modal that generates a valid YAML manifest in `~/.gemini/config/skills/<id>/SKILL.md` (picked up by the core in all conversations automatically).
      - Toggles to enable/disable skills and deletion of custom skills.
    - **The "Instructions" (AGENTS.md) tab**:
      - A built-in full-screen editor for the global agent instructions and behaviour rules (`~/.gemini/config/AGENTS.md`).
      - Presets for quick insertion of rules (concise answers, strict typing, Russian language).
      - A button to restore the reference Android instructions.
    - **The "Plugins" tab**:
      - An overview of the installed plugins (`android-cli-plugin`, `flutter`, `modern-web-guidance-plugin`) with statistics on the skills, rules and MCP servers they contain.
      - Plugin activation switches synchronised into `~/.gemini/config/config.json`.
    - **End-to-end integration with custom providers**:
      - Guaranteed delivery of rules, instructions and tools to third-party models (OpenAI, Claude, DeepSeek) with an instant `tools: true` sync button.

41. **Rebuild of standard and bypass (fixed-ui-12)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with all the "User settings" submenu work.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-12-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-12-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

42. **Implementing UTCP server and OpenAPI 3.0 specification support**:
    - Integration of the **Universal Tool Calling Protocol (UTCP)** standard (utcp.io) for directly connecting external REST APIs, Swagger/OpenAPI specifications and custom JSON manuals without writing intermediate MCP proxy servers.
    - The `@utcp/mcp-bridge`, `@utcp/sdk`, `@utcp/http`, `@utcp/file`, `@utcp/cli`, `@utcp/dotenv-loader` stack was installed and optimised.
    - A dedicated **"🌐 UTCP & OpenAPI"** tab in the MCP server settings:
      - An overview of the UTCP ↔ MCP bridge state, the active config (`~/.gemini/config/utcp_config.json`) and a manual counter.
      - Cards of connected services with type badges (`OPENAPI`, `REST`, `FILE`), activity toggles, a list of discovered tools, a live test button (`🔍 Check tools`) and deletion.
      - **A catalogue of ready-made free UTCP APIs (one-click connection)**:
        - *Open-Meteo Weather API*: weather forecast and current temperature by coordinates worldwide, with no API key.
        - *IP Geolocation API*: country, city, provider and coordinates for any IP address.
        - *REST Countries Global API*: an encyclopaedia of the world's countries (capitals, currencies, population, languages).
        - *CoinGecko Crypto API*: real-time cryptocurrency rates (BTC, ETH, TON, SOL).
      - An interactive **"+ Add UTCP manual / OpenAPI service"** modal supporting remote OpenAPI 3.0 specifications, REST endpoints and local JSON files, plus optional Bearer/API Key authorisation.
    - Automatic translation of all registered UTCP tools through the bridge into the Antigravity core and into custom providers (OpenAI, Claude, DeepSeek).

43. **Rebuild of standard and bypass (fixed-ui-13)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with full UTCP and OpenAPI support.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-13-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-13-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

44. **Redesigning the MCP, UTCP and customisation settings in the native Antigravity IDE style**:
    - A complete rework of the visual styling of the "MCP Servers", "UTCP and OpenAPI" and "User settings" screens:
      - Strict adherence to the Antigravity IDE component architecture (`u3` / `v3` / `w3`): settings grouped into monolithic cards with horizontal dividers (`rounded-xl border border-border divide-y divide-border bg-card/40`).
      - Segmented tab-switching controls (`inline-flex p-1 rounded-lg bg-secondary/50 border border-border/40 gap-1`, active tab `bg-background text-foreground shadow-sm`).
      - Complete removal of coloured emoji from tabs, filters, headings and buttons in favour of the authentic IDE aesthetic: minimalist SVG icons, strict typefaces and native badges (`text-[10px] font-semibold bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full border border-border`).
      - Use of the Antigravity system theme tokens (`--background`, `--foreground`, `--muted-foreground`, `--card`, `--border`, `--secondary`, `--secondary-foreground`, `--primary`, `--destructive`).

45. **Rebuild of standard and bypass (fixed-ui-14)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with the authentic Antigravity IDE styling.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-14-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-14-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

46. **Updating the "User settings" section and direct links for obtaining API tokens in MCP**:
    - **Skills**:
      - The ability to **view** the contents of any skill (`SKILL.md`) in a modal with syntax highlighting and an agent-trigger description was added.
      - A function to **copy built-in skills and plugin skills** into user skills (`~/.gemini/config/skills/<name>/SKILL.md`) was implemented. The user can clone any system skill under their own name to customise its instructions.
      - **Editing** of the instructions and triggers of user skills directly from the interface was implemented.
      - The **"+ Create your own skill"** modal for quickly adding procedural instructions was kept and improved.
    - **Plugins**:
      - The **catalogue of ready-made plugins with one-click installation** was restored and extended:
        - *Google Workspace & Cloud* (integration with Docs, Sheets, Drive and the Cloud API).
        - *Python Data Science & ML* (a skill pack for EDA, data visualisation and machine learning).
        - *Docker & Container DevOps* (Dockerfile and docker-compose optimisation).
        - *Database Engineering & SQL* (schema design and SQL query optimisation).
        - *Security Audit & Hardening* (finding OWASP Top 10 vulnerabilities and auditing secrets).
        - *Git Automation & Conventional Flow* (Conventional Commits standards and PR review).
      - Management of installed plugins: enable/disable toggles, badges with the number of skills, rules and MCP servers, and a delete button for user plugins.
      - A "+ Create your own plugin" function for quickly scaffolding a plugin structure in `~/.gemini/config/plugins/`.
    - **Links for obtaining API tokens for MCP servers**:
      - Compact direct links to the official API-token portals (`dashboard.exa.ai`, `github.com/settings/tokens`, `aistudio.google.com`, `api.search.brave.com`, `notion.so/my-integrations`, `sentry.io/settings` and others) were added next to the key input fields in the MCP server cards.
      - The links open in the browser while preserving context and allow the token to be copied to the clipboard quickly.

47. **Rebuild of standard and bypass (fixed-ui-15)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`).
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-15-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-15-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

48. **Curating the catalogues for Android: everything that does not work on the device is removed**:
    - An analysis of the stock "User settings" implementation (the *Customizations* screen of upstream Antigravity from the GitHub repository): Skills / Agents / MCP servers / Rules / Hooks / UI extensions, plus the remote *Build With Google Plugins* catalogue and the MCP template store ("Add MCP", search by name, one-click installation). The local implementation was brought to the same logic: Installed + Marketplace, nothing extra.
    - **MCP servers**: the `notion` and `sentry` entries were removed from the catalogue — they had no installation path on Android (an npx proxy without the component) and only cluttered the list. 10 servers that genuinely work on ARM64 remain: sequential-thinking, memory, filesystem, everything, exa, brave-search, context7, github-mcp-server, gopls (via pkg), StitchMCP (mcp-remote).
    - **Plugins**: `docker-devops` was removed from the one-click installation catalogue (Docker is unavailable on Android) and `database-tools` was retargeted from Postgres/MySQL to **SQLite — the native Android database** (`sqlite-optimizer` + `schema-design`). The final catalogue: Google Workspace & Cloud, Python Data Science & ML, SQLite & Mobile Databases, Security Audit & Hardening, Git Automation & Conventional Flow — all of them run on the device's stock runtimes (python3, git, sqlite, HTTP APIs).
    - The plugin catalogue tags were translated into Russian for interface consistency.
    - **Order in the "Skills" section**: the list (40+ entries from builtin/plugins) is now grouped into sections — "User-defined", "From plugins", "Built-in" — with headings and counters; the duplicate path lines in the card footers and the redundant type badges were removed (the group now conveys the type).

49. **Rebuild of standard and bypass (fixed-ui-16)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with the cleaned MCP and plugin catalogues.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-16-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-16-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

50. **Fixed the critical "Skills (0) / Plugins (0)" bug in the user settings**:
    - Cause: when the screen opened, two bridge polls started in parallel (`status` and `read-instructions`), and the global `pollTimer` of the first poll was cancelled by the second — the result of the skills and plugins scan **was never parsed**, and the list was always empty (the instructions did load, because they went through the second poll).
    - Fix: polling was switched to **independent timers per job** (`pollTimers[id]`), each poll parses **its own log** (`r.log`), the `activeJobs` counter replaces the single `job`; the eager instruction load on mount was removed (the tab picks it up when opened).
    - Result: opening the section now shows all **36 skills** (8 built-in + 28 from the flutter/android-cli/modern-web plugins) and **3 installed plugins**.

51. **Analysis and cleanup of the working MCP servers, catalogue extended with plugins from Build With Google**:
    - A full smoke test of all servers through a JSON-RPC `initialize`: **OK** — sequential-thinking, memory, filesystem, everything, exa, context7, github, StitchMCP (mcp-remote), the UTCP bridge (loads 4 manuals), gopls; the components node v24.22.2 / npm 12.2.2 / python 3.14.10 / git 2.56.0 are installed.
    - `brave-search` is left **disabled** — the config holds the `YOUR_BRAVE_KEY` placeholder; it will enable once a real key is inserted (the link for issuing a key is in the server card).
    - The config was cleaned: the dead stock `android-management-api` was removed (disabled, empty args); `MEMORY_FILE_PATH` for `memory` was set outside `node_modules` (protecting the knowledge graph from being wiped when the npm package updates).
    - The plugin catalogue gained three entries from the Build With Google store (photo 4): **Google Antigravity SDK** (a Python SDK for agents), **Science** (scientific tasks) and **Firebase** (Auth/Firestore/Functions) — all built on text skills and working on Android without extra runtimes.

52. **Rebuild of standard and bypass (fixed-ui-17)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with the fixed skills/plugins scan and the updated catalogue.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-17-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-17-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

53. **Toolchain fixes: Termux-JDK JVM paths and Flutter/Dart on Android (automation)**:
    - **Root cause of the JVM errors** (jadx/apktool/d8/apksigner/Gradle: `AccessDeniedException` in `/data/data/com.termux/...`): the Termux OpenJDK hard-codes `user.home` and `java.io.tmpdir` to inaccessible paths; the JVM ignores `TMPDIR` for `java.io.tmpdir`.
    - A new profile **`$PREFIX/etc/profile.d/65-agy-jvm.sh`** (part of the overlay): it sets `JAVA_TOOL_OPTIONS="-Duser.home=$HOME -Djava.io.tmpdir=…"` for **all** Java tools at once; the tmp directory is chosen after checking that `TMPDIR` is writable. `agy-fix-paths` gained step 3 — the profile restores itself when missing.
    - A new wrapper **`jadx-agy`**: sandbox JVM flags + `-Xmx1500m` (protection against OOM-kill/137 on ~2 GB of RAM), with `-j 2 --no-res` recommended; `--single-class-thread` does not exist in jadx 1.5.x.
    - A new idempotent script **`agy-fix-flutter`** (all 7 sections of the fixes document): swaps the glibc `cache/dart-sdk` for the bionic build from `pkg install dart` (with version comparison, the original kept as `dart-sdk.glibc`), patches `os.dart` / `platform.dart` / the pub-cache `local_platform.dart` (every `platform-*`), invalidates `flutter_tools.snapshot` only when real edits happen, fixes `gradle.properties` (`-Duser.home`/`-Djava.io.tmpdir`) and purges a broken `~/.gradle/native` (ELF magic check). Verified on the device: a second run reports "everything [ok], 0 fix(es)".
    - **Delivery mechanism**: `overlaySha256` in `app/assets/env/manifest.json` is a version token (decompiling `EnvInstaller` confirmed it: a mismatch with the `$PREFIX/.installed` marker triggers a merge copy of the overlay without erasing). The token is recomputed by the `tools/gen_env_overlay_sha.py` generator (scheme: sha256 over sorted "sha256 relpath" lines) → the new files land in `$PREFIX` on the next app start.
    - Documentation: `docs/jadx-fixes.md` and `docs/flutter-toolchain.md` (the complete fix documents), and section 8 "Toolchain Fixes" was added to the seed `AGENTS.md` and the environment `AGENTS.md` — the agent knows about `agy-fix-flutter` and `jadx-agy`.

54. **Rebuild of standard and bypass (fixed-ui-18)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with the JVM/Flutter/jadx toolchain fixes in the overlay.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-18-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-18-bypass.apk` in the root of `Antigravity Projects/` (checksums — `SHA256SUMS.txt`).

55. **Integrating the Flutter SDK into the tools, fixing the MCP configuration failure and the Stitch links (fixed-ui-19)**:
    - **Flutter SDK integration into "Settings → Tools" (`agy_tools.js`, `agy_tools.sh`)**:
      - A "Flutter & Dart" component group was added (component `flutter-sdk`, check `flutter,dart`) along with a ready "Flutter development" preset for one-click installation.
      - An automatic installation script `op_flutter()`: downloads the system packages (`dart`, `git`, `curl`, `tar`, `xz-utils`, `python`) automatically, clones the official `stable` SDK branch into `$HOME/flutter_sdk`, exports `FLUTTER_ROOT` and `$HOME/flutter_sdk/bin` into the environment (`write_env()`) and runs the bionic patcher `agy-fix-flutter` (replacing the glibc Dart SDK with the native Dart from `pkg`, adapting `os.dart`, `platform.dart` and `local_platform.dart` in the pub-cache).
      - Viability checks for the `flutter` and `dart` tools were added to the general verification (`op_verify`).
      - A function for a complete and clean removal of the Flutter SDK (`op_flutterremove`) was implemented, including clearing the exported paths.
      - Flutter installation progress tracking was added to the UI (`agy_tools.js`).
    - **Fixing the failure and persistence of MCP servers (`mcp_config.json`)**:
      - The `json.decoder.JSONDecodeError` that occurred when saving API keys (`set-key`) and toggling servers (`toggle`) with an empty (0-byte) `~/.gemini/config/mcp_config.json` file is eliminated.
      - An automatic fallback that initialises the `{"mcpServers": {}}` structure was added to all read/write operations of `op_mcp`.
    - **Masking API keys with asterisks (`***`)**:
      - Private-field detection in `agy_mcp.js` was fixed: the case-sensitive `indexOf("KEY")` check was replaced with the regular expression `/key|token|secret|auth|password/i`. The `X-Goog-Api-Key` (Stitch), `api_token` and `access_token` keys are now reliably masked as `type="password"`.
    - **Fixing StitchMCP**:
      - The official key-obtaining/authorisation URL was corrected: the link now points to `https://stitch.withgoogle.com/` instead of `aistudio.google.com`.
      - Automatic generation of a valid StitchMCP configuration in `mcp_config.json` was added, invoking it through `node`, the `mcp-remote` proxy, the arguments and a correct `LD_LIBRARY_PATH` environment.

56. **Rebuild of standard and bypass (fixed-ui-19)**:
    - Standard and bypass APKs built from the current repository tree (`rebuild.py both`) with all the tool, Flutter SDK and MCP server fixes.
    - Ready APKs: `Antigravity-BP-2.4.1-ru.fixed-ui-19-standard.apk` and `Antigravity-BP-2.4.1-ru.fixed-ui-19-bypass.apk`.

57. **Moving to the major version 3.0 (v3.0)**:
    - The project numbering was updated to its own major version **3.0**:
      - The manifest `app/AndroidManifest.xml` now declares version `3.0.0-ru.s7p1` (`versionName`).
      - The build configuration in `rebuild.py` was updated for the 3.0 release.
      - All 29 major blocks of improvements and fixes (items 28–56) developed after the public v2.4.1 audit on GitHub were consolidated into a single stable 3.0 branch.
    - The official release packages were built:
      - `Antigravity-BP-3.0-standard.apk` (base build)
      - `Antigravity-BP-3.0-bypass.apk` (region-bypass build)
    - SHA-256 checksums were generated in `SHA256SUMS.txt`.
<!-- /EN -->

## Что нового в 3.0.1

<!-- RU -->
Изменения, внесённые после релиза 3.0 на GitHub.

58. **Консоль приложения (Tools → Консоль приложения)**:
    - Команды выполняются отдельным запуском (`op_termrun`) в окружении приложения, без PTY сессии проекта — устранены ошибки `Terminal input failed: ENXIO/ENOENT` на `.agy-tools-terminal.fifo`.
    - Тулбар с кнопками «Копировать вывод» и «Очистить экран».
    - Кнопка `logcat` для быстрого снятия логов (`logcat -d -t 80 *:W`).
    - Каждая команда — отдельный job с кодом возврата; таймаут 25 с.

59. **История ошибок — фильтр настоящих сбоев**:
    - В журнал попадают только реальные ошибки (код возврата ≠ 0 или маркер `@@fail`).
    - Успешные установки, где слово «error» встречается в тексте лицензий или прогрессе, больше не засоряют окно.
    - Кнопки «Копировать всё» (clipboard API + fallback) и «Очистить» (`op_histclear`) в тулбаре.

60. **Прокрутка окна ошибок и терминала**:
    - Свой видимый ползунок (`attachScroll21`) — Android WebView не рисует `::-webkit-scrollbar`.
    - Позиция прокрутки сохраняется при догрузке текста; авто-прокрутка вниз только если пользователь уже у нижнего края.
    - Фоновая прокрутка чата заблокирована, пока модальное окно открыто (P2-22).

61. **PDF-экспорт сессий**:
    - Сборка PDF через `pymupdf` (`op_pdfin` + `op_pdf`), без пустого системного принтера.
    - Потоковая передача больших файлов через `@@PDFB64`-чанки.

62. **Защита потока чата (P2-16/P2-22)**:
    - Сторож зависшего потока сужен до URL генерации — фоновые запросы не обрываются.

63. **Подтверждение обновления пакетов (P2-11)**:
    - Перед `pkg upgrade` показывается число пакетов и объём загрузки; без подтверждения не запускается.

64. **Сортировка диалогов — узкое меню**:
    - Всплывающее меню сортировки («По дате обновления» / «Свой порядок») больше не растягивается на всю ширину панели: ширина по содержимому, максимум 210px поверх встроенного класса `w-56`.

65. **Экспорт сессий — текст и изображения**:
    - Markdown-файл и изображения сохраняются в исходном формате (`agy_export_session.js`).
<!-- /RU -->

<!-- EN -->
Changes made after the 3.0 release on GitHub.

58. **Application console (Tools → Application console)**:
    - Commands run as a separate invocation (`op_termrun`) in the app's environment, without a PTY session of the project — the `Terminal input failed: ENXIO/ENOENT` errors on `.agy-tools-terminal.fifo` are gone.
    - A toolbar with the "Copy output" and "Clear screen" buttons.
    - A `logcat` button for quickly capturing logs (`logcat -d -t 80 *:W`).
    - Every command is a separate job with a return code; timeout 25 s.

59. **Error history — a filter for genuine failures**:
    - Only real errors reach the log (non-zero return code or the `@@fail` marker).
    - Successful installations where the word "error" appears in licence text or progress output no longer clutter the window.
    - "Copy all" (clipboard API + fallback) and "Clear" (`op_histclear`) buttons in the toolbar.

60. **Scrolling of the error and terminal windows**:
    - Our own visible scrollbar (`attachScroll21`) — the Android WebView does not draw `::-webkit-scrollbar`.
    - The scroll position is preserved when more text loads; auto-scroll downwards only if the user is already at the bottom edge.
    - Background scrolling of the chat is blocked while the modal window is open (P2-22).

61. **PDF export of sessions**:
    - PDF assembly through `pymupdf` (`op_pdfin` + `op_pdf`), without the empty system printer.
    - Streaming of large files through `@@PDFB64` chunks.

62. **Chat stream protection (P2-16/P2-22)**:
    - The hung-stream watchdog is narrowed to the generation URL — background requests are not interrupted.

63. **Package upgrade confirmation (P2-11)**:
    - Before `pkg upgrade` the number of packages and the download size are shown; it does not start without confirmation.

64. **Conversation sorting — a narrow menu**:
    - The sorting popup ("By update date" / "Custom order") no longer stretches to the full width of the panel: width by content, at most 210px on top of the built-in `w-56` class.

65. **Session export — text and images**:
    - The Markdown file and the images are saved in their original format (`agy_export_session.js`).
<!-- /EN -->

## 3.1.0 — Динамический сплэш-скрин (Android 12+)

<!-- RU -->
- **Сплэш-скрин больше не захардкожен в розовый**: из `SplashTheme` (все конфигурации v31)
  удалён статический `windowSplashScreenAnimatedIcon` (`0x0101062d`).
  Android 12+ автоматически подставляет иконку **активного** `activity-alias`,
  поэтому при смене цвета/набора иконок в настройках сплэш-скрин меняется
  вместе с лаунчером без пересборки APK.
- `windowSplashScreenIconBackgroundColor` (`0x0101062e`) теперь ссылается на
  `@color/ic_launcher_background` (вместо невалидной ссылки на `@drawable/splash_icon`),
  фон иконки сплэша синхронизирован с активным набором.
- Патч автоматизирован в `tools/brand.py` (`build_overlay`): ретаргет и инвалидация
  выполняются на этапе сборки, попадание проверяется выводом
  `brand: dynamic splash: removed ... retargeted ...`.
<!-- /RU -->

<!-- EN -->
- **The splash screen is no longer hard-coded to pink**: the static `windowSplashScreenAnimatedIcon`
  (`0x0101062d`) was removed from `SplashTheme` (all v31 configurations).
  Android 12+ substitutes the icon of the **active** `activity-alias` automatically,
  so when the colour/icon set is changed in the settings the splash screen changes
  together with the launcher, with no APK rebuild.
- `windowSplashScreenIconBackgroundColor` (`0x0101062e`) now points at
  `@color/ic_launcher_background` (instead of an invalid reference to `@drawable/splash_icon`),
  so the splash icon background stays in sync with the active set.
- The patch is automated in `tools/brand.py` (`build_overlay`): the retargeting and invalidation
  run at build time, and the result is verified by the output
  `brand: dynamic splash: removed ... retargeted ...`.
<!-- /EN -->
