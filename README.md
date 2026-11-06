# Cozy Mystery

The M1 engine skeleton is a small Vite and TypeScript canvas game. Run it locally with:

```sh
npm install
npm run dev
```

Move with **WASD** or the **arrow keys**. Walk onto a door or stand nearby and press **A**, **E**, or **Space** to travel. On a touch screen, drag the joystick; press **A** near a door.

Run `npm run build` to type-check and create the static site in `dist/`.

Run `npm test` for unit tests. Open `http://localhost:5173/?debug=art` to review
the procedural art, or `http://localhost:5173/?debug=world` to regenerate maps
by biome and seed.

The on-device story model requires WebGPU. On iPhone and iPad, use Safari on
iOS/iPadOS 26 or newer. WebGPU requires HTTPS; if opening the dev server from
another device, its local-network HTTP address is not treated as `localhost`.

To test on an iPhone connected to the same Wi-Fi:

1. Install [mkcert](https://github.com/FiloSottile/mkcert) on the development PC.
2. Create a `.local-certs` directory and run:
   `mkcert -cert-file .local-certs/dev-cert.pem -key-file .local-certs/dev-key.pem 192.168.1.216 localhost 127.0.0.1`
3. Install and fully trust mkcert's root CA on the iPhone. The root CA file is
   at the path printed by `mkcert -CAROOT` (named `rootCA.pem`).
4. Run `npm run dev:iphone` and open
   `https://192.168.1.216:5199/?debug=llm` in Safari.

The certificate and private key stay in the ignored `.local-certs` directory.
