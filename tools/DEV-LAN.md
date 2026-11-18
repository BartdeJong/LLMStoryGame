# Dev server over HTTPS on the local network (iPad)

The PWA service worker and the Bedrock gateway need a secure context, so the iPad must reach the dev server over trusted HTTPS.

1. On the PC run `npm run dev:lan`. It creates a local CA and a server certificate in `~/.llmstorygame-dev-certs` (your home folder, outside the project) and prints the URLs, for example `https://192.168.x.x:5173`. If your LAN IP changes, the server certificate is regenerated on the next run.
2. Windows may show a firewall prompt for Node.js the first time. Allow it on **Private** networks.
3. On the iPad (same Wi-Fi) open `https://<ip>:5173/dev-ca.crt` in Safari and allow the profile download.
4. Settings > General > VPN & Device Management > select the downloaded profile > Install.
5. Settings > General > About > Certificate Trust Settings > enable full trust for "LLMStoryGame Dev CA".
6. Open `https://<ip>:5173`. HMR runs over `wss` on the same port.

Notes:
- The "Ollama on this PC" option is hidden on the iPad (it only works on the PC itself); use the Bedrock gateway there.
- The feedback-save endpoint is loopback-only: it works from the PC (`https://localhost:5173`) but not from the iPad.
- Keep `~/.llmstorygame-dev-certs` private, especially `dev-ca.key`: anyone with it can mint certificates your iPad trusts. Never copy it into the project or share it.
- Remove the CA later: Settings > General > VPN & Device Management > "LLMStoryGame Dev CA" > Remove Profile. Delete `~/.llmstorygame-dev-certs` on the PC to discard the keys.
- Plain `npm run dev` is unchanged (HTTP, localhost only).
