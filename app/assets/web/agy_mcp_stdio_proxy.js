// Normalize legacy string arguments for stdio MCP tools/call requests.
"use strict";
const {spawn} = require("child_process");
const [command, ...args] = process.argv.slice(2);
if (!command) { process.stderr.write("MCP proxy: missing command\n"); process.exit(2); }
const child = spawn(command, args, {stdio: ["pipe", "inherit", "inherit"], env: process.env});
let pending = "";
child.stdin.on("error", () => {});
function forward(line) {
  try {
    const msg = JSON.parse(line);
    if (msg && msg.method === "tools/call" && msg.params && typeof msg.params.arguments === "string") {
      const args = JSON.parse(msg.params.arguments);
      if (args && typeof args === "object" && !Array.isArray(args)) {
        msg.params.arguments = args;
        line = JSON.stringify(msg);
      }
    }
  } catch (_) { /* Preserve requests that aren't valid JSON or arguments. */ }
  if (child.stdin.writable) child.stdin.write(line + "\n");
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  pending += chunk;
  let p;
  while ((p = pending.indexOf("\n")) !== -1) { const line = pending.slice(0, p); pending = pending.slice(p + 1); forward(line); }
});
process.stdin.on("end", () => { if (pending) forward(pending); child.stdin.end(); });
child.on("error", error => { process.stderr.write("MCP proxy: " + error.message + "\n"); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.stdin.destroy(); process.exitCode = code == null ? 1 : code; if (signal) process.stderr.write("MCP proxy child signal: " + signal + "\n"); });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { if (!child.killed) child.kill(signal); });
