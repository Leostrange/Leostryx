# 65-agy-jvm.sh — Antigravity JVM sandbox paths.
#
# Termux-OpenJDK (bundled in AGY) hardcodes Termux locations:
#   user.home      -> /data/data/com.termux/files/home
#   java.io.tmpdir -> /data/data/com.termux/files/usr/tmp
# Both are inaccessible from this sandbox -> java.nio.file.AccessDeniedException
# in jadx, apktool, d8, apksigner, jadx-gui, Gradle client/daemon, etc.
# The JVM ignores TMPDIR for java.io.tmpdir, so the flags must be explicit.
# JAVA_TOOL_OPTIONS is honored by EVERY JVM, which fixes all Java tools at once.
# Sourced by $PREFIX/etc/profile; idempotent.

_agy_jvm_tmp=""
if [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ] && touch "$TMPDIR/.agy_jvm_w" 2>/dev/null; then
    _agy_jvm_tmp="$TMPDIR"
    rm -f "$TMPDIR/.agy_jvm_w"
fi
[ -n "$_agy_jvm_tmp" ] || _agy_jvm_tmp="$PREFIX/tmp"
[ -d "$_agy_jvm_tmp" ] || _agy_jvm_tmp="$HOME/.cache/tmp"
mkdir -p "$_agy_jvm_tmp" 2>/dev/null || true

_agy_cacerts="$PREFIX/etc/tls/certs/java/cacerts"
[ -f "$_agy_cacerts" ] || _agy_cacerts="$PREFIX/lib/jvm/java-17-openjdk/lib/security/cacerts"
[ -f "$_agy_cacerts" ] || _agy_cacerts="$PREFIX/lib/jvm/java-21-openjdk/lib/security/cacerts"

case "${JAVA_TOOL_OPTIONS:-}" in
    *-Duser.home=*) : ;;  # already configured (e.g. by jadx-agy)
    *)
        _agy_ts_opt=""
        [ -f "$_agy_cacerts" ] && _agy_ts_opt=" -Djavax.net.ssl.trustStore=$_agy_cacerts"
        export JAVA_TOOL_OPTIONS="-Duser.home=$HOME -Djava.io.tmpdir=$_agy_jvm_tmp$_agy_ts_opt${JAVA_TOOL_OPTIONS:+ $JAVA_TOOL_OPTIONS}"
        unset _agy_ts_opt
        ;;
esac
unset _agy_jvm_tmp _agy_cacerts
