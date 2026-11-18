// Runs dev-cert.mjs, then starts Vite over HTTPS on the LAN (LAN_HTTPS=1).
import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cert = spawnSync(process.execPath, [join(root, "tools", "dev-cert.mjs")], { cwd: root, stdio: "inherit" });
if (cert.status !== 0) process.exit(cert.status ?? 1);

console.log("Open the game from another device on your network at:");
for (const list of Object.values(networkInterfaces())) {
  for (const net of list ?? []) {
    if (net.family === "IPv4" && !net.internal) console.log(`  https://${net.address}:5173`);
  }
}

const viteBin = join(root, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, LAN_HTTPS: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
