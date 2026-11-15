import java.io.*;
import java.net.*;
import java.security.*;
import java.security.cert.*;
import java.util.*;
import javax.net.ssl.*;

/**
 * AgyTruststore — builds and verifies a JKS trust store the JVM can open with
 * its DEFAULT (empty) password.
 *
 * Why this exists: the JDK bundled with AGY ships lib/security/cacerts as
 * PKCS12 protected by "changeit", while a JVM started without
 * -Djavax.net.ssl.trustStore* loads the default store with an EMPTY password.
 * The load "succeeds" and leaves ZERO trust anchors, so every HTTPS call dies
 * with:
 *   InvalidAlgorithmParameterException: the trustAnchors parameter must be non-empty
 * Environment flags (JAVA_TOOL_OPTIONS / profile.d) only reach shells that
 * source the profile; the app core forks JVMs with its own environment, so the
 * defect has to be fixed in the store itself — once, for every JVM.
 *
 * A JKS store written with an empty password reloads with every certificate
 * intact (PKCS12 does not: re-encoding with an empty password yields 0 entries),
 * which is exactly what the default JVM path needs.
 *
 * Usage:
 *   java AgyTruststore union <out.jks> <spec>...
 *       spec = <type>:<pass>:<path>     type = PKCS12|JKS, pass = "-" for empty
 *   java AgyTruststore check <spec>
 *       prints "@@entries N" for the first password that opens the store
 *   java AgyTruststore defcheck
 *       prints the anchors visible through the JVM DEFAULT trust manager and
 *       exits 3 when there are none
 *   java AgyTruststore https
 *       HTTPS HEAD against repo.maven.apache.org through the default trust
 *       manager; exits 4 on any TLS/IO failure
 */
public class AgyTruststore {

    private static final String PROBE_URL = "https://repo.maven.apache.org/maven2/";
    private static final String PROBE_FILE = "https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/maven-metadata.xml";

    private static String[] split(String spec) {
        int a = spec.indexOf(':');
        int b = spec.indexOf(':', a + 1);
        if (a < 0 || b < 0) throw new IllegalArgumentException("bad spec: " + spec);
        return new String[] { spec.substring(0, a), spec.substring(a + 1, b), spec.substring(b + 1) };
    }

    private static char[] pass(String p) {
        return "-".equals(p) ? new char[0] : p.toCharArray();
    }

    /** Loads a store, trying the supplied password first and the empty one second. */
    private static KeyStore load(String spec) throws Exception {
        String[] p = split(spec);
        String type = p[0];
        Exception first = null;
        for (char[] candidate : new char[][] { pass(p[1]), new char[0] }) {
            try (InputStream in = new FileInputStream(p[2])) {
                KeyStore ks = KeyStore.getInstance(type);
                ks.load(in, candidate);
                if (ks.size() > 0) return ks;
                if (first == null) first = new IOException("store " + p[2] + " opened with 0 entries");
            } catch (Exception e) {
                if (first == null) first = e;
            }
        }
        throw new IOException("cannot load " + p[2] + " (" + type + "): " + (first == null ? "unknown" : first.toString()));
    }

    private static int trusted(KeyStore ks) throws Exception {
        int n = 0;
        for (String alias : Collections.list(ks.aliases())) {
            if (ks.isCertificateEntry(alias)) n++;
        }
        return n;
    }

    private static void union(String out, String[] specs) throws Exception {
        KeyStore dest = KeyStore.getInstance("JKS");
        dest.load(null, null);
        Set<String> seen = new HashSet<>();
        int added = 0;
        for (String spec : specs) {
            KeyStore src;
            try {
                src = load(spec);
            } catch (Exception e) {
                // A broken extra source must not prevent the union.
                System.out.println("@@skip " + spec + " (" + e.getMessage() + ")");
                continue;
            }
            int from = 0;
            for (String alias : Collections.list(src.aliases())) {
                if (!src.isCertificateEntry(alias)) continue;
                java.security.cert.Certificate c = src.getCertificate(alias);
                if (!(c instanceof X509Certificate)) continue;
                MessageDigest md = MessageDigest.getInstance("SHA-256");
                String fp = Base64.getEncoder().encodeToString(md.digest(c.getEncoded()));
                if (!seen.add(fp)) continue;
                dest.setCertificateEntry("agy" + added, c);
                added++;
                from++;
            }
            System.out.println("@@read " + from + " from " + spec);
        }
        if (added == 0) throw new IOException("refusing to write an empty trust store");
        File tmp = new File(out + ".tmp");
        try (OutputStream os = new FileOutputStream(tmp)) {
            dest.store(os, new char[0]);
        }
        File dst = new File(out);
        if (!tmp.renameTo(dst)) throw new IOException("cannot rename " + tmp + " -> " + dst);
        System.out.println("@@entries " + added);
    }

    private static int defaultAnchors() throws Exception {
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        tmf.init((KeyStore) null);
        int anchors = 0;
        for (TrustManager tm : tmf.getTrustManagers()) {
            if (tm instanceof X509TrustManager) anchors += ((X509TrustManager) tm).getAcceptedIssuers().length;
        }
        return anchors;
    }

    private static void defaultCheck() throws Exception {
        int anchors = defaultAnchors();
        System.out.println("@@default type=" + KeyStore.getDefaultType()
                + " store=" + System.getProperty("javax.net.ssl.trustStore")
                + " anchors=" + anchors);
        if (anchors == 0) System.exit(3);
    }

    private static void https() throws Exception {
        int anchors = defaultAnchors();
        if (anchors == 0) {
            System.out.println("@@default anchors=0");
            System.exit(4);
        }
        for (String url : new String[] { PROBE_URL, PROBE_FILE }) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(20000);
            c.setRequestMethod("HEAD");
            try {
                int code = c.getResponseCode();
                System.out.println("@@https " + code + " " + url);
                if (code < 200 || code >= 400) System.exit(4);
            } catch (Exception e) {
                System.out.println("@@https fail " + url + ": " + e);
                System.exit(4);
            } finally {
                c.disconnect();
            }
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length == 0) {
            System.err.println("usage: union <out.jks> <spec>... | check <spec> | defcheck | https");
            System.exit(2);
        }
        switch (args[0]) {
            case "union":
                union(args[1], Arrays.copyOfRange(args, 2, args.length));
                break;
            case "check":
                System.out.println("@@entries " + trusted(load(args[1])));
                break;
            case "defcheck":
                defaultCheck();
                break;
            case "https":
                https();
                break;
            default:
                System.err.println("unknown mode " + args[0]);
                System.exit(2);
        }
    }
}
