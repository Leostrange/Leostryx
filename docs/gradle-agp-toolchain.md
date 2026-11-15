# Gradle & AGP на Antigravity Android — полный документ тулчейна

> [!IMPORTANT]
> Это **единственный источник правды** о том, как на устройстве сосуществуют
> несколько версий Gradle и Android Gradle Plugin, как они переключаются и как
> чинится сломанный тулчейн. Все команды идемпотентны — их можно повторять.

> [!NOTE]
> Всё автоматизировано: `agy-selfheal` (или `Settings › Tools › Repair environment`)
> выполняет разделы 4–6 идемпотентно, а `agy-daemon` запускает его каждый час.
> Ручной текст ниже — для понимания и отладки.

---

## Быстрая диагностика: симптом → причина → фикс

| Симптом | Причина | Раздел |
|---|---|---|
| `the trustAnchors parameter must be non-empty` при любой загрузке Gradle/AGP/Maven | `cacerts` — это PKCS12, защищённый паролем `changeit`, а JVM по умолчанию использует **пустой** пароль → 0 trust anchors | [1](#1-truststore-jvm-почему-любой-https-падает) |
| То же, но `verify jvm` показывает `anchors=0` | `65-agy-jvm.sh` не применился: старый профиль или шелл унаследовал `JAVA_TOOL_OPTIONS` без truststore | [1](#1-truststore-jvm-почему-любой-https-падает) |
| `SSLException` при `./gradlew` | `/bin/sh` не существует на Android, а wrapper пытается скачать дистрибутив | [2](#2-почему-нельзя-запускать-gradlew) |
| `gradle: command not found` / версия не та | сломан симлинк `$PREFIX/bin/gradle` | [4](#4-переключение-версий-gradle) |
| AGP не резолвится, хотя «установлен» | артефакта нет в `~/.gradle/caches` (прерванная загрузка) | [5](#5-версии-agp-и-кэш-артефактов) |
| `Unsupported class file major version` / `AGP requires Gradle X` | несовместимая пара Gradle ↔ AGP ↔ JDK | [6](#6-матрица-совместимости) |
| После обновления приложения всё сломалось снова | апдейт перезаписал `$PREFIX` и потерял симлинки/профиль | [7](#7-self-heal-и-демон) |

---

## 1. Truststore JVM: почему любой HTTPS падает

Встроенный в Termux-OpenJDK `cacerts` — это **PKCS12**, защищённый паролем
`changeit`. Пароль по умолчанию у JVM — **пустой**, поэтому хранилище
загружается «молча» и остаётся с **нулём** доверенных корней. Любой HTTPS-запрос
умирает с

```
java.security.InvalidAlgorithmParameterException:
        the trustAnchors parameter must be non-empty
```

Это ломает Gradle, AGP, `sdkmanager`, Maven — всё, что ходит по TLS.

На устройстве есть три кандидата, и они **не эквивалентны**:

| Путь | Формат (magic) | Пароль | Trust anchors |
|---|---|---|---|
| `lib/jvm/java-21-openjdk/lib/security/cacerts` | `3083` (PKCS12) | `changeit` | **149** ✅ |
| `etc/tls/certs/java/cacerts` | `FEEDFEED` (JKS) | пустой | 118 |
| `lib/jvm/java-17-openjdk/lib/security/cacerts` | битый симлинк → Termux | — | — |

### 1.1 Почему флагов окружения недостаточно (v3)

До v3 фиксом считались флаги `-Djavax.net.ssl.trustStore` /
`-Djavax.net.ssl.trustStorePassword` в `JAVA_TOOL_OPTIONS`. Их видит только тот
процесс, который **сам** подхватил окружение: логин-шелл (через
`profile.d/65-agy-jvm.sh`) или скрипт, вызвавший `jvm_env_ensure()`. Ядро
приложения форкает JVM — Gradle single-use daemon, `sdkmanager`, Maven, `jadx` —
с окружением, которое было у приложения при старте, а там есть `-Duser.home` и
**нет** truststore-флагов.

Измерено на этом устройстве:

| Окружение | `bash $HOME/web/agy_tools.sh verify jvm` (старая проверка) | `gradle resolveProbe --no-daemon` |
|---|---|---|
| логин-шелл, флаги есть | `anchors=149` ✅ | `BUILD SUCCESSFUL`, guava + AGP реально скачаны |
| шелл без флагов (как у агента и демона) | `anchors=149` ✅ (потому что проверка вызывала `jvm_env_ensure`) | `the trustAnchors parameter must be non-empty` ❌ |

Отсюда правило v3: **чинить хранилище, а не окружение**.

1. `AgyTruststore` (`$HOME/web/AgyTruststore.java`, класс компилируется в
   `$PREFIX/etc/antigravity/truststore/`) собирает **union** всех найденных
   CA-бандлов — дедупликация по SHA-256 отпечатку сертификата;
2. пишет его как **JKS с пустым паролем** — единственная кодировка, которую
   дефолтная JVM открывает целиком. Проверено: PKCS12, пересохранённый с пустым
   паролем, перезагружается с **0 записями**, JKS — со всеми 149;
3. ставит результат на место `$JAVA_HOME/lib/security/cacerts`, оригинал
   сохраняя в `cacerts.pkcs12.orig`;
4. проверяет результат **без единого флага**
   (`env -u JAVA_TOOL_OPTIONS -u _JAVA_OPTIONS java -cp … AgyTruststore defcheck`)
   и откатывается на бэкап, если корней 0.

После этого `65-agy-jvm.sh` (маркер `JVM-TRUSTSTORE-FIX-v3`) флаги truststore
**не добавляет вообще**: для JKS с пустым паролем
`-Djavax.net.ssl.trustStorePassword` только ломает MAC хранилища. Флаги
остаются лишь как fallback для ненормализованного PKCS12 (свежая установка до
первого self-heal).

Проверки (обе считают реальные корни, а не менеджеры):

```bash
bash $HOME/web/agy_tools.sh verify jvm
# @@ok jvm truststore ok: java-17-openjdk anchors=149 default=149, java-21-openjdk anchors=149 default=149
#                                          ^ в файле   ^ без флагов   ^ каждая установленная JDK

java -cp "$PREFIX/etc/antigravity/truststore" AgyTruststore https
# @@https 200 https://repo.maven.apache.org/maven2/
```

> [!WARNING]
> `anchors>0`, но `default=0` — это ровно тот сценарий «всё зелёное, но ничего
> не качается»: хранилище открывается только с флагами, которых у форкнутых JVM
> нет. `verify jvm` теперь падает в этом случае намеренно.

> [!WARNING]
> Историческая ошибка, которую легко вернуть: профиль проверял
> `case "$JAVA_TOOL_OPTIONS" in *-Duser.home=*) : ;;` и на этом **заканчивал**.
> Приложение уже добавляет `-Duser.home`, поэтому truststore-флаги не
> добавлялись **никогда**. Сейчас каждый флаг проверяется и добавляется
> отдельно.

> [!NOTE]
> Раньше проверка использовала `getTrustManagers().length` — это **всегда 1**
> (считает менеджеры, а не корни). Правильный индикатор —
> `getAcceptedIssuers().length`.

---

## 2. Почему нельзя запускать `./gradlew`

`/bin/sh` на Android отсутствует. Wrapper-скрипт пытается скачать дистрибутив и
падает с `SSLException`/`cannot execute`. Используйте:

```bash
gradle -p <project> <task> --no-daemon
# или
bash ./gradlew <task> --no-daemon
```

---

## 3. Каталоги

| Что | Где |
|---|---|
| Дистрибутивы Gradle | `$HOME/gradle-dist/gradle-<ver>` |
| Активный Gradle | симлинк `$PREFIX/bin/gradle` |
| Артефакты AGP | `$HOME/.gradle/caches/modules-2/files-2.1/com.android.tools.build/gradle/<ver>` |
| Активный AGP | `$HOME/.gemini/config/agy-agp.state` |
| Отражение AGP в правилах | заметка `# AGY-AGP:` в `AGENTS.md` |
| Профиль окружения | `$PREFIX/etc/profile.d/60-agy-android.sh` |
| JVM-профиль | `$PREFIX/etc/profile.d/65-agy-jvm.sh` |
| `gradle.properties` | `$HOME/.gradle/gradle.properties` |

---

## 4. Переключение версий Gradle

```bash
bash $HOME/web/agy_tools.sh gradle "8.14.7 auto"
```

- `auto` резолвится под проект: `.agy-toolchain` → `gradle-wrapper.properties` →
  заметка `# AGY-AGP:` → последняя стабильная (сеть недоступна → `9.9.1`).
- Активируется **последняя** версия из списка, остальные остаются
  предзагруженными и переключаются мгновенно через симлинк.
- Уже скачанный дистрибутив никогда не перекачивается: `gradle_ensure` видит
  `bin/gradle` и выходит с `@@gradle-cached`.

---

## 5. Версии AGP и кэш артефактов

```bash
bash $HOME/web/agy_tools.sh agp "8.7.3 9.0.0 9.1.1"   # установить
bash $HOME/web/agy_tools.sh agp auto                   # под проект
```

Загрузка проверяется по факту попадания в кэш, а не по коду ответа:

- `@@agp-cached <ver>` — артефакт уже был;
- `@@fail agp-<ver> …` — загрузка прошла, но в кэш не попала (обрезанный архив);
- после успеха — `@@agp-active <ver>`, `agy-agp.state` и заметка `# AGY-AGP:`
  переписываются вместе.

`Settings › Tools › Gradle & AGP` показывает трёхпозиционный бейдж: не
установлено / в кэше / активно.

---

## 6. Матрица совместимости

| AGP | Минимальный Gradle | JDK |
|---|---|---|
| 8.7.3 | ≥ 8.9 | 17 |
| 9.0.0 | ≥ 9.1 | 17+ |
| 9.1.1 | ≥ 9.1 | 17+ |

Свои версии для проекта — файл `.agy-toolchain` в корне проекта:

```
gradle=8.14.7
agp=8.7.3
```

Резолвинг никогда не переписывает `build.gradle` проекта.

---

## 7. Self-heal и демон

```bash
agy-selfheal                        # то же, что кнопка «Починить окружение»
bash $HOME/web/agy_tools.sh selfheal
agy-daemon task list                # задача "Toolchain self-heal", interval 1h
agy-daemon task run-now "Toolchain self-heal"
```

Что чинится:

1. `60-agy-android.sh` и `65-agy-jvm.sh` (по маркеру `JVM-TRUSTSTORE-FIX-v3`);
2. **JVM trust store** — union CA-бандлов → JKS с пустым паролем на месте
   `$JAVA_HOME/lib/security/cacerts` (шаг `@@selfheal truststore`, см. §1.1);
3. мосты в `$HOME/runtime/bin`;
4. симлинк `$PREFIX/bin/gradle` → совместимая с активным AGP версия;
5. пара `agy-agp.state` ↔ заметка `# AGY-AGP:`;
6. блоки `<!-- AGY-GRADLE-AGP -->` в шаблоне и в «живых» правилах агента;
7. мусорный `$HOME/AGENTS.md` (архивируется в `.agy-stray-AGENTS.md`).

`fixed=N` считает **реальные** правки: второй запуск подряд печатает
`@@selfheal fixed=0`. Это и есть проверка идемпотентности — если число не
падает до нуля, значит какая-то функция пишет файл, не сравнивая содержимое.
Нормализация truststore идемпотентна по формату хранилища: пока
`$JAVA_HOME/lib/security/cacerts` остаётся JKS (`FEEDFEED`) размером ≥100 КБ,
шаг ничего не делает.

---

## 8. Что делать после обновления приложения

1. `agy-selfheal`
2. `bash $HOME/web/agy_tools.sh verify jvm,gradle,agp` → должно быть `@@verified 3 0`
3. Собрать проект: `gradle -p <project> assembleDebug --no-daemon`

Не переустанавливайте пакеты, чтобы починить симлинк, — `pkg` вернёт
Termux-пути, и проблема вернётся.
