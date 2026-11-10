# Cozy Mystery

The game is a Vite and TypeScript canvas app. Run it locally with:

```sh
npm install
npm run dev
```

Move with **WASD** or the **arrow keys**. Walk onto a path, cave opening, gate, or door to travel; you can also stand nearby and press **A**, **E**, or **Space**. Press **M** for the map, **J** for the journal, **I** for inventory, and **Escape** to close a panel or pause. On a touch screen, drag the joystick; press **A** near an exit.

The **Map** button arranges explored areas by the direction of their connecting paths (north is up), highlights your current area, and can center the view on it. Open **Journal** to search and filter discovered story facts, evidence, and character requests. A request only shows a finding place after a character has told you where to look. The inventory can also be searched.

Run `npm run build` to type-check and create the static site in `dist/`.
Run `npm run preview` after building to test the production bundle locally.

Run `npm test` for unit tests and `npm run validate-stories` to validate every
story pack. Open `http://localhost:5173/?debug=art` to review procedural art,
or `http://localhost:5173/?debug=world` to regenerate maps by biome and seed.

## Test character dialogue and save feedback

Run `npm run dev` and open `http://localhost:5173/?debug=dialogue`. Load the
on-device model, choose a story, length, and character, then start a conversation.
After each character reply, add feedback or explicitly choose **No feedback**
before continuing. The optional story-context controls let you set known truths
and inventory items for a test.

The dialogue lab is development-only. It saves each session, including the full
chat and feedback attached to each character reply, under the git-ignored
`.dialogue-feedback/` folder. `?debug=dialogue&mock=1` opens the lab with a mock
model to check its interface without WebGPU or a model download; use the real
model for response-quality feedback. The local save endpoint is not included in
production builds.

### Qwen3.5-9B dialogue

Both Qwen3.5-9B on-device variants automatically use non-thinking mode. Dialogue
uses temperature 0.7, top-p 0.8, a minimum 256-token output budget, and neutral
repetition/frequency/presence penalties so important names and facts can recur.
Repair attempts keep these sampling settings rather than increasing temperature.
JSON schema guidance remains enabled; a grammar-initialization failure logs a
warning and uses prompt-only JSON until the next model load. Other runtime errors
are reported normally.

Qwen3.5-9B conversation prompts prioritize the latest question, selected facts and
actual handovers over quest reminders. They omit the static character goal in
favor of current needs and keep at most eight recent transcript entries, trimming
older entries to fit 2,400 characters. The latest message and current story facts
are never clipped. This is a history budget, not a guarantee that arbitrary input
fits WebLLM's 4,096-token context window; unusually long player input or story
context can still exceed it. The full conversation remains visible in the UI.
Other models and the Bedrock gateway keep their existing prompts and sampling.

Use the dialogue lab with the real model to assess relevance, character voice,
repetition and factual accuracy. Unit tests validate requests and game behavior,
not subjective dialogue quality.

The title screen offers **New game** (choose a save slot) and **Load game**.
Saved games autosave locally and show save status in the HUD; use **Export JSON**
in the load screen to keep a backup, or import that file on another device.
Pause or use the title screen settings to adjust text size, sound volume, walking
speed, reduced motion, high contrast, touch-control size, and control hints.

Choose an on-device model on the storyteller setup screen. During a game, open
the pause menu and choose **Change AI provider or model** to change providers or
models without leaving the app. The game saves the current slot before setup and
reloads it afterward; canceling returns to the game.

## Use an AWS Bedrock gateway

At startup, choose **AWS Bedrock gateway** and enter the HTTPS URL and bearer
secret for a gateway you trust. The PWA saves these values in that browser's
local storage for later use. They are not encrypted; anyone with access to the
browser profile can potentially read the saved secret. Do not enter AWS access
keys. The on-device model remains available as an alternative.

The configured URL must accept a `POST` with an `Authorization: Bearer <secret>`
header and a JSON body containing `messages`, `maxTokens`, `temperature`, and
`jsonSchema`. It must return JSON in the form `{ "text": "..." }`. The gateway
is responsible for authenticating the secret and translating requests to
Bedrock Agent Runtime. Keep AWS credentials and agent identifiers on the
gateway, and restrict its IAM role to the intended agent alias. The game client
does not create or deploy this gateway; it must already be available over HTTPS
and allow browser requests from the game's origin (CORS).

Deployment source and instructions are in
[infra/CozyStoryAgent/README.md](./infra/CozyStoryAgent/README.md).

The on-device story model requires WebGPU. On iPhone and iPad, use Safari on
iOS/iPadOS 26 or newer. WebGPU requires HTTPS; if opening the dev server from
another device, its local-network HTTP address is not treated as `localhost`.

## Artwork

The Lantern Tide lighthouse glyph adapts the 16×16 lighthouse from
[Pixnote Pixels](https://pixnote.net/en/pixels/lighthouse/), available under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The item glyph
catalog also uses Pixnote's CC0 sprites as references; source URLs and any
closest-match substitutions are recorded alongside the adapted glyphs in
`src/art/glyphs/`. Other entries are original pixel redraws to complete the
requested catalog.

## Test offline and install

1. Run `npm run build` and `npm run preview`.
2. Open the preview in a supported browser while online, load the game and a
   story once, and wait for the service worker to finish installing.
3. Use the browser's install option (or Safari's Share menu → Add to Home
   Screen). The app shell and all indexed story packs are cached for offline use.
4. Close the app, switch the device/browser offline, and reopen it. The model
   files are not copied into the app cache; WebLLM manages its own model cache.

## Deploy to GitHub Pages

The `.github/workflows/deploy.yml` workflow runs tests, validates the story
packs, builds with `/<repository-name>/` as Vite's base path, and deploys
`dist/` when changes reach `main`.

One-time repository setup: open **Settings → Pages**, choose **GitHub Actions**
as the build and deployment source, and allow Actions to run for the repository.
If the repository's deployment branch is not `main`, update the workflow's
push branch filter.

## Add a story

1. Add `public/stories/<id>.json` with a lowercase alphanumeric ID without
   separators; make its `identity.id` match the filename.
2. Add the story's title, logline, available lengths, and estimates to
   `public/stories/index.json`.
3. Run `npm run validate-stories`, then run
   `npm run story-readthrough -- <id> <short|medium|long>` for each length.
4. Run `npm test` and `npm run build`. No app code changes are needed for a
   valid story pack.

To test on an iPhone connected to the same Wi-Fi:

1. Install [mkcert](https://github.com/FiloSottile/mkcert) on the development PC.
2. Create a `.local-certs` directory and run:
   `mkcert -cert-file .local-certs/dev-cert.pem -key-file .local-certs/dev-key.pem 192.168.1.216 localhost 127.0.0.1`
3. Install and fully trust mkcert's root CA on the iPhone. The root CA file is
   at the path printed by `mkcert -CAROOT` (named `rootCA.pem`).
4. Run `npm run dev:iphone` and open
   `https://192.168.1.216:5199/?debug=llm` in Safari.

The certificate and private key stay in the ignored `.local-certs` directory.
