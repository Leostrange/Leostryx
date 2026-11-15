# 65-agy-jvm.sh — Antigravity JVM sandbox paths + truststore.
# JVM-TRUSTSTORE-FIX-v3 — bump when the logic below changes; agy-fix-paths
# rewrites any copy that does not carry the current marker.
#
# Termux-OpenJDK (bundled in AGY) hardcodes Termux locations:
#   user.home      -> /data/data/com.termux/files/home
#   java.io.tmpdir -> /data/user/0/com.agyru.t2/files/usr/tmp
# Both are inaccessible from this sandbox -> java.nio.file.AccessDeniedException
# in jadx, apktool, d8, apksigner, jadx-gui, Gradle client/daemon, etc.
# The JVM ignores TMPDIR for java.io.tmpdir, so the flags must be explicit.
# JAVA_TOOL_OPTIONS is honored by EVERY JVM, which fixes all Java tools at once.
#
# Truststore: the bundled $JAVA_HOME/lib/security/cacerts is a PKCS12 store
# protected by the password "changeit". The JVM default is an EMPTY password,
# so loading silently fails and the store ends up with ZERO trust anchors.
# Every HTTPS call then dies with:
#   java.security.InvalidAlgorithmParameterException:
#   the trustAnchors parameter must be non-empty
# which breaks Gradle/AGP resolution, sdkmanager, Maven, etc.
#
# v3: flags are no longer the primary fix. agy-selfheal (`agy-selfheal`, hourly
# from agy-daemon) installs a union CA store as an empty-password JKS at the
# JDK default path, so ANY JVM - including the ones the app core forks with its
# own environment, where this profile never runs - opens it with no flags at
# all. Flags are only added as a fallback for stores that still need a password.
#
# Sourced by $PREFIX/etc/profile; idempotent.

_agy_jvm_tmp=""
if [ -n "${TMPDIR:-}" ] && [ -d "$TMPDIR" ] && touch "$TMPDIR/.agy_jvm_w" 2>/dev/null; then
    _agy_jvm_tmp="$TMPDIR"
    rm -f "$TMPDIR/.agy_jvm_w"
fi
[ -n "$_agy_jvm_tmp" ] || _agy_jvm_tmp="$PREFIX/tmp"
[ -d "$_agy_jvm_tmp" ] || _agy_jvm_tmp="$HOME/.cache/tmp"
mkdir -p "$_agy_jvm_tmp" 2>/dev/null || true

# Pick the first cacerts that is a regular file, and derive its password from
# the store magic:  FEEDFEED = JKS (empty default password), 3082/3083 = PKCS12
# (Termux builds these with "changeit").
_agy_ts_store=""
_agy_ts_pass=""
_agy_ts_selfsuff=""
for _agy_c in \
    "$JAVA_HOME/lib/security/cacerts" \
    "$PREFIX/lib/jvm/java-21-openjdk/lib/security/cacerts" \
    "$PREFIX/lib/jvm/java-17-openjdk/lib/security/cacerts" \
    "$PREFIX/etc/tls/certs/java/cacerts"
do
    [ -f "$_agy_c" ] || continue
    _agy_magic=$(od -An -tx1 -N4 "$_agy_c" 2>/dev/null | tr -d ' \n')
    case "$_agy_magic" in
        feedfeed)        _agy_p="" ;;         # JKS, default (empty) password
        3082*|3083*)     _agy_p="changeit" ;; # DER/PKCS12
        *)               _agy_p="changeit" ;;
    esac
    # agy-selfheal normalises the JDK store into an empty-password JKS. Such a
    # store is opened by a flag-free JVM with all certs intact, so forcing
    # trustStorePassword onto it would only break the key-store MAC.
    case "$_agy_magic:$_agy_c" in
        feedfeed:*"/lib/security/cacerts") _agy_ts_selfsuff=1 ;;
    esac
    _agy_ts_store="$_agy_c"
    _agy_ts_pass="$_agy_p"
    break
done
unset _agy_c _agy_magic _agy_p

# Build only the flags that are still missing, so an already-populated
# JAVA_TOOL_OPTIONS (e.g. injected by the app) is never duplicated, and a
# missing one (the historical bug: user.home present => truststore skipped)
# is always added.
_agy_add=""
case "${JAVA_TOOL_OPTIONS:-}" in
    *-Duser.home=*) : ;;
    *) _agy_add="$_agy_add -Duser.home=$HOME" ;;
esac
case "${JAVA_TOOL_OPTIONS:-}" in
    *-Djava.io.tmpdir=*) : ;;
    *) _agy_add="$_agy_add -Djava.io.tmpdir=$_agy_jvm_tmp" ;;
esac
if [ -n "$_agy_ts_store" ] && [ -z "$_agy_ts_selfsuff" ]; then
    case "${JAVA_TOOL_OPTIONS:-}" in
        *-Djavax.net.ssl.trustStore=*) : ;;
        *) _agy_add="$_agy_add -Djavax.net.ssl.trustStore=$_agy_ts_store -Djavax.net.ssl.trustStorePassword=$_agy_ts_pass" ;;
    esac
fi
if [ -n "$_agy_add" ]; then
    export JAVA_TOOL_OPTIONS="${_agy_add# }${JAVA_TOOL_OPTIONS:+ $JAVA_TOOL_OPTIONS}"
fi

unset _agy_jvm_tmp _agy_ts_store _agy_ts_pass _agy_ts_selfsuff _agy_add
