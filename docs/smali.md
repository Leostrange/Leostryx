# smali / baksmali 3.0.10

Локальный пакет. В зеркалах Termux его нет, поэтому качать jar-ы с GitHub или Maven в каждой сессии не нужно.

## Команды

```bash
smali --version
baksmali --version
smali assemble -o classes.dex path/to/smali
baksmali disassemble -o out classes.dex
```

`smali --version` печатает `smali 3.0.10`. Сборка проверена: получается dex версии 035.

## Где лежит

- `$PREFIX/bin/smali`, `$PREFIX/bin/baksmali`
- `$PREFIX/share/java/smali/*.jar`
- мосты: `$HOME/runtime/bin/smali`, `$HOME/runtime/bin/baksmali`
- архив: `$HOME/.local/pkg/repo/pool/main/s/smali/smali_3.0.10_all.deb`

Зависимость: `openjdk-21` (уже стоит). Обёртка вызывает `com.android.tools.smali.smali.Main` и `com.android.tools.smali.baksmali.Main`. У jar-ов нет `Main-Class`.

## pkg

`pkg install smali` из зеркала Termux пакет не найдёт. Он уже зарегистрирован локально:

```bash
pkg installed | grep smali
pkg info smali
pkg why bin/smali
pkg remove smali
```

`pkg info` читает дополнительный индекс `$PREFIX/var/lib/pkg/index/repo.90.Packages`. `pkg update` обновляет только `repo.1` у первого живого зеркала и этот индекс не затирает.

Не добавляйте `file://$HOME/.local/pkg/repo` в начало `PKG_REPOS`. pkg качает индекс через curl, и первое доступное зеркало выигрывает: file URL либо падает, либо прячет индекс Termux.
