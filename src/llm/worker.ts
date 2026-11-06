import { WebWorkerMLCEngineHandler } from "@mlc-ai/web-llm";

// The WebLLM engine runs here, off the main thread.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message: MessageEvent) => handler.onmessage(message);
