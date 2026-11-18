// Generates a local dev CA and a LAN server cert into ~/.llmstorygame-dev-certs (outside the project) for `npm run dev:lan`.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

// Keep in sync with CERT_DIR in vite.config.ts. Outside the Vite root so keys are never served.
const certDir = join(homedir(), ".llmstorygame-dev-certs");
const paths = {
  caKey: join(certDir, "dev-ca.key"),
  caCrt: join(certDir, "dev-ca.crt"),
  key: join(certDir, "dev.key"),
  crt: join(certDir, "dev.crt"),
};

function findOpenssl() {
  const probe = spawnSync("openssl", ["version"], { encoding: "utf8" });
  if (probe.status === 0) return "openssl";
  const gitOpenssl = "C:/Program Files/Git/usr/bin/openssl.exe";
  if (existsSync(gitOpenssl)) return gitOpenssl;
  throw new Error("openssl not found on PATH or in Git for Windows (Program Files/Git/usr/bin).");
}

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) out.push(info.address);
    }
  }
  return [...new Set(out)];
}

const openssl = findOpenssl();
const run = (args, cwd) => execFileSync(openssl, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const tmp = mkdtempSync(join(tmpdir(), "llmstory-cert-"));
const lan = lanAddresses();

try {
  mkdirSync(certDir, { recursive: true });
  // MSYS openssl dislikes some Windows path forms; run from certDir with relative names.
  if (!existsSync(paths.caKey) || !existsSync(paths.caCrt)) {
    const caConf = join(tmp, "ca.cnf");
    writeFileSync(
      caConf,
      [
        "[req]", "distinguished_name=dn", "x509_extensions=ext", "prompt=no",
        "[dn]", "CN=LLMStoryGame Dev CA",
        "[ext]", "basicConstraints=critical,CA:TRUE", "keyUsage=critical,keyCertSign,cRLSign",
        "subjectKeyIdentifier=hash", "",
      ].join("\n"),
    );
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "dev-ca.key", "-out", "dev-ca.crt",
      "-days", "3650", "-sha256", "-config", caConf], certDir);
    console.log("Created dev CA.");
  }

  let needServer = !existsSync(paths.key) || !existsSync(paths.crt);
  if (!needServer) {
    try {
      const text = run(["x509", "-in", "dev.crt", "-noout", "-ext", "subjectAltName", "-checkend", "86400"], certDir);
      needServer = !lan.every((ip) => text.includes(`IP Address:${ip}`)) || /will expire/.test(text);
    } catch {
      needServer = true; // -checkend exits non-zero when expiring; unreadable certs are regenerated too
    }
  }
  if (needServer) {
    const srvConf = join(tmp, "server.cnf");
    const alt = ["DNS:localhost", "IP:127.0.0.1", ...lan.map((ip) => `IP:${ip}`)].join(",");
    writeFileSync(
      srvConf,
      [
        "[req]", "distinguished_name=dn", "prompt=no",
        "[dn]", "CN=LLMStoryGame Dev Server",
        "[ext]", "basicConstraints=critical,CA:FALSE", "keyUsage=critical,digitalSignature,keyEncipherment",
        "extendedKeyUsage=serverAuth", `subjectAltName=${alt}`, "subjectKeyIdentifier=hash",
        "authorityKeyIdentifier=keyid", "",
      ].join("\n"),
    );
    const csr = join(tmp, "server.csr");
    run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", "dev.key", "-out", csr, "-config", srvConf], certDir);
    run(["x509", "-req", "-in", csr, "-CA", "dev-ca.crt", "-CAkey", "dev-ca.key", "-CAcreateserial",
      "-out", "dev.crt", "-days", "800", "-sha256", "-extfile", srvConf, "-extensions", "ext"], certDir);
    console.log("Created server certificate.");
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`Dev certificates ready in ${certDir}`);
console.log("URLs:");
console.log("  https://localhost:5173");
for (const ip of lan) console.log(`  https://${ip}:5173   (CA: https://${ip}:5173/dev-ca.crt)`);
