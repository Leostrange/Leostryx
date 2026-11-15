# Antigravity Android Agent Rules & Environment Guidelines

> [!NOTE]
> This rule is automatically loaded into every conversation in Antigravity for Android (AGY v2).
> It defines the operating environment, execution rules, package management, elevated permissions, and development standards.

---

<!-- AGY-LANG -->
## 0. Language — always answer in the language the user writes in

**RU**

- **Отвечайте на том языке, на котором пишет пользователь.** Запрос по-русски → ответ по-русски; запрос по-английски → ответ по-английски. Не переходите на другой язык самовольно и не отвечайте по-английски на русский вопрос.
- Язык интерфейса приложения, системы и встроенной документации роли не играет: имеет значение только последнее сообщение пользователя. Новое сообщение на другом языке меняет язык ответа с этого же сообщения.
- Если в одном сообщении несколько языков, ориентируйтесь на язык самой просьбы. Технические идентификаторы, команды, пути, имена файлов, код и фрагменты логов оставляйте в исходном виде — их не переводят.
- Правило распространяется на всё, что вы пишете от имени пользователя: сообщения коммитов в его проекте, записи `CHANGELOG.md`, тексты для форума и релизов, документацию, комментарии в его коде и ответы в его задачах.
- Встроенная документация двуязычна намеренно (`CHANGELOG.md`, `README.md` используют пары `<!-- EN -->` … `<!-- /EN -->`). Правя такой файл, обновляйте обе половины согласованно, а не только ту, которую тронули.

**EN**

- **Reply in the language the user writes in.** A Russian request gets a Russian answer, an English request an English answer. Do not switch language on your own, and do not answer a Russian question in English.
- The language of the app interface, of the OS and of the bundled documentation does not matter: only the user's latest message does. A new message in another language changes the language of the answer from that same message onward.
- If one message mixes languages, follow the language of the request itself. Technical identifiers, commands, paths, file names, code and log excerpts stay in their original form — they are not translated.
- The rule covers everything you write on the user's behalf: commit messages in their project, `CHANGELOG.md` entries, forum and release notes, documentation, comments in their code and answers in their tasks.
- The bundled documentation is bilingual on purpose (`CHANGELOG.md`, `README.md` use `<!-- EN -->` … `<!-- /EN -->` pairs). When editing such a file, update both halves in sync instead of translating only the one you touched.
<!-- /AGY-LANG -->

---

## 1. Platform & Environment Identity

- **Platform:** Native Android (Linux kernel 6.1+, ARM64 / `aarch64` architecture, **ARMv8.0-A+ baseline** with ARMv8.0 LSE emulation and native ARMv8.1-A+ LSE atomics).
- **Application Context:** Runs directly inside the Antigravity (`com.agyru.t2`) sandbox.
- **Key Filesystem Paths:**
  - Application Root (`$HOME`): `/data/user/0/com.agyru.t2/files` (or app-private `files/` directory).
  - Linux Userspace Prefix (`$PREFIX`): `$HOME/usr` (`/data/user/0/com.agyru.t2/files/usr`).
  - Binary Directory: `$PREFIX/bin`.
  - Runtime Internals: `$HOME/runtime/bin`.
  - External / Shared Storage: `/storage/emulated/0` (Projects typically reside in `/storage/emulated/0/Documents/`).
  - AI State & Config: `$HOME/.gemini/config/`.
  - Conversation Brain & Artifacts: `$HOME/.gemini/antigravity-app/brain/<conversation-id>/`.

---

## 2. Terminal Execution Rules

- **Pre-configured Environment (NO REDUNDANT EXPORTS):**
  Antigravity pre-configures `$PATH` (`$PREFIX/bin:/system/bin`), `$HOME`, and `$PREFIX` for every shell command.
  **DO NOT** prepend `export PATH=...` or `export HOME=...` before commands. Execute binaries (`python`, `git`, `pkg`, `bash`, `agy-daemon`) directly.
- **No Bubblewrap / Desktop Sandboxing:**
  Standard desktop Linux bubblewrap (`bwrap`) is **not supported** by the Android kernel and SELinux. Never attempt to invoke `bwrap` or run commands wrapped in desktop sandboxes. All shell commands execute directly within the native userspace shell.
- **Shared Storage `noexec` Restriction:**
  Android mounts `/storage/emulated/0` with the `noexec` flag. Directly running `./script.sh` or executable binaries from shared storage fails with `Permission denied` (exit code 126).
  **Always invoke scripts with their explicit interpreter:**
  ```bash
  bash script.sh
  python script.py
  sh script.sh
  ```
  Native compiled binaries must reside in `$PREFIX/bin` or internal storage (`$HOME/`).
- **Path Quoting:**
  Shared storage paths frequently contain spaces (e.g. `/storage/emulated/0/Documents/antigravity release/`). Always quote file paths in commands.
- **Git on Android Shared Storage:**
  Git in `/storage/emulated/0/...` may trigger `fatal: detected dubious ownership`. Always configure safe directory and avoid nonexistent Termux system config:
  ```bash
  export GIT_CONFIG_NOSYSTEM=1
  git config --global --add safe.directory "<path>"
  ```

---

## 3. Package Management (`pkg`)

AGY includes an ultra-fast, native package manager (`pkg`) written in Bash & AWK:

- **Usage & Syntax:**
  ```bash
  # Update package indexes (run before installing if index is empty):
  pkg update

  # Install packages (do NOT pass -y flag; list package names directly):
  pkg install git python nodejs bash

  # Search, list, and query:
  pkg search <pattern>
  pkg list
  pkg installed
  pkg info <package>

  # Remove package:
  pkg remove <package>

  # Self-test system health:
  pkg selftest
  ```
- **Post-Install Shebang Fixes:**
  After installing global Python/Node scripts (`pip`, `npm`), fix hardcoded shebangs using:
  ```bash
  agy-fix-paths
  ```

---

## 4. Elevated Operations via Shizuku (`rish`)

The agent has native access to Shizuku's elevated ADB shell (`uid=2000(shell)`):
- **Executable Location:** `$PREFIX/bin/rish` (invoked via `rish -c "<command>"`).
- **Service Dependency:** Requires the Shizuku service to be running on the device. If `rish` reports `Server is not running`, ask the user to start Shizuku.
- **Common Elevated Operations:**
  1. **Restricted Filesystem Access:** Access files in protected directories (e.g. `/storage/emulated/0/Android/data`):
     ```bash
     rish -c "ls -la /storage/emulated/0/Android/data"
     rish -c "cp <src> <dest>"
     ```
  2. **APK & Package Management (`pm`):**
     ```bash
     rish -c "pm install -r /storage/emulated/0/.../app.apk"
     rish -c "pm list packages -3"
     rish -c "pm uninstall com.example.app"
     ```
  3. **Activity Management & Diagnostics (`am`, `logcat`, `dumpsys`):**
     ```bash
     rish -c "am start -n com.example.app/.MainActivity"
     rish -c "logcat -d -t 150"
     rish -c "dumpsys package com.example.app"
     ```
  4. **System Properties & Settings:**
     ```bash
     rish -c "getprop ro.build.version.release"
     rish -c "settings get global airplane_mode_on"
     ```

---

## 5. Development & Server Guidelines

- **Port Binding:** Local development servers (Vite, Next.js, Express, FastAPI) MUST bind to `localhost` or `127.0.0.1`.
- **Reserved Ports:** Ports `48155` (core) and `48158` (gateway) are reserved for Antigravity core webview/API. Never bind dev servers to these ports.
- **Safe Dev Ports:** `3000`, `5173`, `8000`, `8080`.
- **Native Compilation:** When compiling native C/C++/Rust code, target `-march=armv8-a` baseline (ARMv8.0-A minimum, with runtime LSE emulation or native atomics).

---

## 6. Background Daemon & AI Task Manager (`agy-daemon`)

Antigravity includes an ultra-lightweight background scheduler, watcher, and AI task manager:
- **Footprint:** <10MB RAM, 0.0% CPU idle.
- **Persistence:** Runs alongside `CoreServerService` under Android Foreground Service Partial WakeLock (executes even with screen off or locked).

### Service Lifecycle
```bash
agy-daemon status    # Check daemon status, PID, and recent task execution logs
agy-daemon start     # Start daemon service
agy-daemon stop      # Stop daemon service
agy-daemon restart   # Restart daemon service
```

### AI Task Management (`agy-daemon task`)
Autonomous background jobs support structured execution and `--json` formatting:
```bash
# List tasks:
agy-daemon task list
agy-daemon task list --json
agy-daemon task list --active-only

# Add scheduled tasks:
agy-daemon task add --name "Review Code" --delay 30m --prompt "Check test results and summarize changes"
agy-daemon task add --name "Disk Health" --interval 1h --command "df -h > ~/.gemini/disk.log"
agy-daemon task add --name "Nightly Clean" --cron "0 3 * * *" --command "rm -rf ~/.gemini/tmp/*"

# Event & Watcher Triggers:
agy-daemon task add --name "Watch PRs" --github-pr "owner/repo" --interval 5m --command "agy-notify post -t 'New PR' -m 'PR detected'"
agy-daemon task add --name "File Watcher" --watch-file "/path/to/project/build.gradle" --command "pkg selftest"
agy-daemon task add --name "Battery Alert" --battery-below 15 --command "agy-notify post -t 'Low Battery' -m 'Save your work'"

# Manage tasks:
agy-daemon task pause <task_id_or_name>
agy-daemon task resume <task_id_or_name>
agy-daemon task run-now <task_id_or_name>
agy-daemon task logs <task_id_or_name>
agy-daemon task remove <task_id_or_name>
agy-daemon clear
```

### Android Status Notifications (`agy-notify`)
Post or manage notifications directly in the Android status bar:
```bash
agy-notify post -t "Build Finished" -m "Tests passed without errors"
agy-notify list
agy-notify cancel -t "Build Finished"
```

---

## 7. Project Architecture & Sync Rules (Documentation-First)

- **Documentation Sync:** Every module (`modules/*`, `app/`, `web/`, `env/`) must maintain an accurate, concise `README.md`. Any change to code, interfaces, or flags MUST be accompanied by immediate documentation updates.
- **No Hardcoded Crutches:** Avoid hardcoding paths or assumptions where dynamic calculation (`$PREFIX`, `$HOME`, `$PROJECT_ROOT`) is possible.
- **Clean State:** Keep working trees clean, avoid creating dead or duplicated state, and do not commit temporary build artifacts.

---

## 8. Toolchain Fixes (JVM / Flutter / jadx)

Termux-built components hardcode `/data/data/com.termux/...` paths or ship glibc binaries that do not run under Android (bionic). Two idempotent fixers live on `PATH`:

- **`agy-fix-flutter`** — run after `flutter upgrade`, `flutter pub get` (a new `platform-x.y.z` lands in pub-cache) or a Gradle reset, and whenever Flutter reports `Unsupported host platform` / `Unsupported operating system`. It swaps `flutter_sdk/bin/cache/dart-sdk` to the bionic `pkg install dart` build (original kept as `dart-sdk.glibc`, only when versions match), patches `os.dart` / `platform.dart` / pub-cache `local_platform.dart`, invalidates `flutter_tools.snapshot`, fixes `~/.gradle/gradle.properties` JVM paths and removes a broken `~/.gradle/native`.
- **`jadx-agy`** — use INSTEAD of plain `jadx` when decompiling: injects `-Duser.home` / `-Djava.io.tmpdir` (the Termux-JDK defaults are inaccessible from this sandbox) and `-Xmx1500m` so large APKs are not OOM-killed (exit 137). Recommended flags: `-j 2 --no-res`; note `--single-class-thread` does not exist in jadx 1.5.x. Harmless `res/*.9.png` decode warnings from obfuscated APKs do not affect smali/manifest.
- Every other Java tool (apktool, d8, apksigner, jadx-gui, Gradle client/daemon) receives the same sandbox paths automatically through `$PREFIX/etc/profile.d/65-agy-jvm.sh` (`JAVA_TOOL_OPTIONS`). HTTPS, however, is repaired at the store, not with flags: `agy-selfheal` / `agy-fix-paths` normalise `$JAVA_HOME/lib/security/cacerts` into an **empty-password JKS union** (JDK's 149 anchors + the AGY bundle), so flag-free JVMs — including the Gradle daemon and `sdkmanager` that the app core forks with the launch-time environment — trust Maven Central and Google Maven. The original PKCS12 store is kept as `cacerts.pkcs12.orig` and restored automatically if verification fails. Marker: `JVM-TRUSTSTORE-FIX-v3`. `-Djavax.net.ssl.trustStorePassword` is only a fallback for a still-PKCS12 store — it breaks the JKS MAC, so the profile skips it once the store is normalised.
- Full reference documents: `docs/flutter-toolchain.md`, `docs/jadx-fixes.md` and `docs/gradle-agp-toolchain.md` in the repository.

---

## 9. Gradle & AGP (multi-version toolchain)

Several Gradle distributions and several Android Gradle Plugin versions coexist on the device; the project decides which one is used.

- **Never run `./gradlew`.** `/bin/sh` does not exist on Android and the wrapper download fails. Use `gradle -p <project> <task> --no-daemon`.
- **Gradle:** distributions live in `$HOME/gradle-dist/gradle-<ver>` and `$PREFIX/bin/gradle` is a symlink to the active one. Check `gradle --version` instead of assuming a version. Switching between already-downloaded versions is instant — never re-download to "fix" one.
- **AGP:** artifacts live in `$HOME/.gradle/caches/modules-2/files-2.1/com.android.tools.build/gradle/<ver>`. Once fetched, builds resolve them from the cache, `--offline` included. The selected version is stored in `~/.gemini/config/agy-agp.state` and mirrored as a `# AGY-AGP:` note in `AGENTS.md`.
- **Per-project pinning:** put `.agy-toolchain` in the project root:

  ```
  gradle=8.14.7
  agp=8.7.3
  ```

  Resolution order: `.agy-toolchain` → `gradle/wrapper/gradle-wrapper.properties` → `# AGY-AGP:` note → latest stable. Never silently rewrite a project's `build.gradle`.
- **Compatibility:** AGP 8.x → Gradle ≥ 8.9, JDK 17. AGP 9.x → Gradle ≥ 9.1, JDK 17+.
- **Install / switch** from `Settings › Tools › Gradle & AGP` or headlessly:
  `bash $HOME/web/agy_tools.sh agp "8.7.3 9.0.0 9.1.1"` and `bash $HOME/web/agy_tools.sh gradle "8.14.7 auto"`.
- **Verify** with `bash $HOME/web/agy_tools.sh verify jvm,agp,gradle` — `jvm` counts the anchors in the store **and** the anchors a flag-free JVM actually sees (`anchors=149 default=149`); both must be > 0, because `anchors>0` with `default=0` means the store is still PKCS12 and every HTTPS request will fail. `agp` checks that at least one AGP version is cached.
- **`agy-selfheal`** repairs the whole toolchain (environment profile, bridges, Gradle symlink, AGP state/note pair, `AGENTS.md` blocks) and runs hourly through `agy-daemon`. Run it manually after an app update, or when `gradle`/AGP suddenly break — do not reinstall packages to fix a symlink.

---

<!-- AGY-BUILD-VERSION -->
## 10. Build Versioning & Change Approval

**RU**

- **Версия поднимается ровно один раз за сборку.** Номер фиксируется, когда сборка объявлена, и до тех пор, пока APK не собран, подписан и проверен, он не меняется.
- **Фиксы и фичи, найденные по ходу сборки, входят в текущую версию.** Не «перепрыгивайте» номер и не откладывайте их в следующую: иначе в `CHANGELOG.md` появятся версии, которых нет ни в одном APK, и текст разойдётся с реальностью.
- **Перед добавлением фичи или фикса в идущую сборку — спросите пользователя.** Кратко: что меняется, зачем, какой риск и что это задержит. Без явного подтверждения новая функциональность в текущий билд не попадает. Исправления, ломающие саму сборку (сломанный симлинк, падающий инструмент), можно вносить без вопроса — но отметить их в отчёте.
- **`CHANGELOG.md` пишется только после успешной сборки.** Секция версии появляется, когда `dist/signed/Leostryx-<version>-*.apk` существует, подписан и прошёл `apksigner verify`. Сначала артефакт — потом запись, никогда наоборот.
- **Три источника обязаны совпадать:** заголовок версии в `CHANGELOG.md`, имя собранного APK `Leostryx-<version>-<variant>.apk` и `SHA256SUMS-<version>.txt`. Расхождение — это ошибка сборки, а не мелочь: остановитесь и приведите их в соответствие.
- **Поднятие номера — отдельное решение, а не побочный эффект.** Если работа выходит за рамки текущей сборки (новая функциональность, а не исправление), спросите, поднимать ли версию, и только затем начинайте новую секцию.
- Внутри одной версии изменения группируются по смыслу (`Исправлено`, `Добавлено`, `Изменено`), а не по датам коммитов — читатель форума видит один цельный список.

**EN**

- **The version is bumped exactly once per build.** It is fixed when the build is declared and does not change until the APK has been built, signed and verified.
- **Fixes and features found mid-build belong to the current version.** Never skip a number or defer them to the next one: otherwise `CHANGELOG.md` ends up listing versions that no APK ever contained, and the text diverges from reality.
- **Ask the user before adding a feature or a fix to an in-flight build.** Briefly: what changes, why, the risk, and what it delays. Without explicit confirmation, new functionality does not enter the current build. Changes that repair the build itself (a broken symlink, a crashing tool) may go in without asking — but must be reported.
- **`CHANGELOG.md` is written only after a successful build.** A version section appears once `dist/signed/Leostryx-<version>-*.apk` exists, is signed and passes `apksigner verify`. Artifact first, entry second — never the reverse.
- **Three sources must agree:** the version heading in `CHANGELOG.md`, the built APK name `Leostryx-<version>-<variant>.apk` and `SHA256SUMS-<version>.txt`. A mismatch is a build error, not a cosmetic issue: stop and reconcile them.
- **Bumping the number is a decision, not a side effect.** If the work goes beyond the current build (new functionality rather than a fix), ask whether to bump, and only then start a new section.
- Within one version, changes are grouped by meaning (`Fixed`, `Added`, `Changed`), not by commit date — a forum reader should see one coherent list.
<!-- /AGY-BUILD-VERSION -->
