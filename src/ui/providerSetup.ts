import { activateGamepadFocus } from "../input/focus";
import { listOllamaModels, pickOllamaModel } from "../llm/ollamaBackend";
import {
  getLLMProviderSettings,
  isOllamaAvailableHere,
  saveLLMProviderSettings,
  normalizeOpenAIBaseUrl,
  validateBedrockEndpoint,
  validateOpenAIBaseUrl,
} from "../llm/providerSettings";
import type { LLMProvider, LLMProviderSettings } from "../llm/providerSettings";
import { el } from "./dom";

export interface ProviderSetupSelection {
  readonly settings: LLMProviderSettings;
  readonly modelId: string;
}

// `initialError` shows why the previous attempt failed, so the user can retry or switch provider.
export function mountProviderSetup(root: HTMLElement, allowCancel?: false, initialError?: string): Promise<ProviderSetupSelection>;
export function mountProviderSetup(root: HTMLElement, allowCancel: true, initialError?: string): Promise<ProviderSetupSelection | undefined>;
export function mountProviderSetup(root: HTMLElement, allowCancel = false, initialError = ""): Promise<ProviderSetupSelection | undefined> {
  const saved = getLLMProviderSettings();
  const ollamaAvailable = isOllamaAvailableHere();
  root.replaceChildren();
  const screen = el("section", "llm-screen provider-screen");
  screen.append(
    el("h1", "llm-screen-title", "Choose your storyteller"),
    el(
      "p",
      "llm-screen-note",
      ollamaAvailable
        ? "Connect to an authorized Bedrock gateway, an OpenAI-compatible endpoint, or use a model running in Ollama on this PC."
        : "Connect to an authorized Bedrock gateway or an OpenAI-compatible endpoint.",
    ),
  );

  const form = document.createElement("form");
  form.className = "provider-form";
  const providerLabel = el("label", "provider-label", "AI provider");
  const provider = document.createElement("select");
  provider.name = "provider";
  provider.setAttribute("aria-label", "AI provider");
  const providerOptions: [LLMProvider, string][] = [
    ["bedrock", "AWS Bedrock gateway"],
    ["openai", "OpenAI-compatible endpoint (API key)"],
  ];
  if (ollamaAvailable) providerOptions.push(["ollama", "Ollama on this PC"]);
  for (const [value, label] of providerOptions) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    provider.append(option);
  }
  provider.value = saved.provider;
  providerLabel.append(provider);

  const ollama = el("div", "provider-connection");
  const modelLabel = el("label", "provider-label", "Ollama model");
  const model = document.createElement("select");
  model.name = "ollama-model";
  model.setAttribute("aria-label", "Ollama model");
  modelLabel.append(model);
  const refresh = el("button", "llm-button", "Refresh models");
  refresh.type = "button";
  ollama.append(modelLabel, refresh);

  const connection = el("div", "provider-connection");
  const endpointLabel = el("label", "provider-label", "Gateway URL");
  const endpoint = document.createElement("input");
  endpoint.type = "url";
  endpoint.name = "endpoint";
  endpoint.placeholder = "https://your-gateway.example.com/invoke";
  endpoint.value = saved.bedrockEndpoint;
  endpointLabel.append(endpoint);

  const tokenLabel = el("label", "provider-label", "Authorization secret");
  const token = document.createElement("input");
  token.type = "password";
  token.name = "token";
  token.autocomplete = "current-password";
  token.value = saved.bedrockToken;
  tokenLabel.append(token);
  connection.append(endpointLabel, tokenLabel);

  const openaiConnection = el("div", "provider-connection");
  const openaiBaseUrlLabel = el("label", "provider-label", "Base URL");
  const openaiBaseUrl = document.createElement("input");
  openaiBaseUrl.type = "url";
  openaiBaseUrl.name = "openai-base-url";
  openaiBaseUrl.placeholder = "https://api.openai.com/v1";
  openaiBaseUrl.value = saved.openaiBaseUrl;
  openaiBaseUrlLabel.append(openaiBaseUrl);

  const openaiApiKeyLabel = el("label", "provider-label", "API key");
  const openaiApiKey = document.createElement("input");
  openaiApiKey.type = "password";
  openaiApiKey.name = "openai-api-key";
  openaiApiKey.autocomplete = "off";
  openaiApiKey.value = saved.openaiApiKey;
  openaiApiKeyLabel.append(openaiApiKey);

  const openaiModelLabel = el("label", "provider-label", "Model");
  const openaiModel = document.createElement("input");
  openaiModel.type = "text";
  openaiModel.name = "openai-model";
  openaiModel.placeholder = "gpt-4o-mini";
  openaiModel.value = saved.openaiModel;
  openaiModelLabel.append(openaiModel);
  openaiConnection.append(openaiBaseUrlLabel, openaiApiKeyLabel, openaiModelLabel);

  const privacy = el("p", "llm-screen-note provider-privacy");
  const updatePrivacy = (): void => {
    privacy.textContent = provider.value === "openai"
      ? "The base URL, API key and model are saved unencrypted in this browser on this device. Anyone with access to this browser profile may be able to read the saved key. Use a restricted, project-scoped key with a spending limit."
      : "The gateway URL and secret are saved in this browser on this device for later use. Anyone with access to this browser profile may be able to access the saved secret. Do not enter AWS access keys here.";
  };
  provider.addEventListener("change", updatePrivacy);
  updatePrivacy();
  const status = el("p", "provider-status");
  status.setAttribute("role", "alert");
  const submit = el("button", "llm-button", "Continue");
  submit.type = "submit";
  const cancel = el("button", "llm-button", "Cancel and return to game");
  cancel.type = "button";

  // Ignores answers from a refresh that has since been replaced by a newer one.
  let refreshCount = 0;
  // The last message written by a refresh, so a later success clears only that message.
  let refreshMessage = "";
  const showRefreshMessage = (text: string): void => {
    refreshMessage = text;
    status.textContent = text;
  };
  const loadOllamaModels = async (): Promise<void> => {
    const current = ++refreshCount;
    refresh.disabled = true;
    try {
      const names = await listOllamaModels();
      if (current !== refreshCount) return;
      if (refreshMessage && status.textContent === refreshMessage) showRefreshMessage("");
      const previous = model.value || saved.ollamaModel;
      model.replaceChildren();
      for (const name of names) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        model.append(option);
      }
      const picked = pickOllamaModel(names, previous);
      if (picked) model.value = picked;
      if (names.length === 0) showRefreshMessage("No models are installed in Ollama. Run `ollama pull <model>`.");
    } catch (error) {
      if (current !== refreshCount) return;
      model.replaceChildren();
      showRefreshMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (current === refreshCount) refresh.disabled = false;
    }
  };
  refresh.addEventListener("click", () => { void loadOllamaModels(); });

  const updateProviderFields = (): void => {
    const useBedrock = provider.value === "bedrock";
    const useOpenAI = provider.value === "openai";
    const useOllama = provider.value === "ollama";
    connection.hidden = !useBedrock;
    openaiConnection.hidden = !useOpenAI;
    privacy.hidden = useOllama;
    ollama.hidden = !useOllama;
    endpoint.required = useBedrock;
    token.required = useBedrock;
    openaiBaseUrl.required = useOpenAI;
    openaiApiKey.required = useOpenAI;
    openaiModel.required = useOpenAI;
    status.textContent = "";
    refreshMessage = "";
    if (useOllama) {
      void loadOllamaModels();
    } else {
      // Drop any refresh still in flight so it cannot write into another provider's form.
      refreshCount++;
      refresh.disabled = false;
    }
  };
  provider.addEventListener("change", updateProviderFields);
  updateProviderFields();
  if (initialError) status.textContent = initialError;

  form.append(providerLabel, ollama, connection, openaiConnection, privacy, status, submit);
  if (allowCancel) form.append(cancel);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const chosen: LLMProvider = provider.value === "ollama" ? "ollama" : provider.value === "openai" ? "openai" : "bedrock";
    const settings: LLMProviderSettings = {
      provider: chosen,
      bedrockEndpoint: chosen === "bedrock" ? endpoint.value.trim() : saved.bedrockEndpoint,
      bedrockToken: chosen === "bedrock" ? token.value : saved.bedrockToken,
      ollamaModel: chosen === "ollama" ? model.value : saved.ollamaModel,
      openaiBaseUrl: chosen === "openai" ? normalizeOpenAIBaseUrl(openaiBaseUrl.value) : saved.openaiBaseUrl,
      openaiApiKey: chosen === "openai" ? openaiApiKey.value.trim() : saved.openaiApiKey,
      openaiModel: chosen === "openai" ? openaiModel.value.trim() : saved.openaiModel,
    };
    if (settings.provider === "openai") {
      const urlError = validateOpenAIBaseUrl(settings.openaiBaseUrl);
      if (urlError) {
        status.textContent = urlError;
        openaiBaseUrl.focus();
        return;
      }
      if (!settings.openaiApiKey.trim()) {
        status.textContent = "Enter the API key.";
        openaiApiKey.focus();
        return;
      }
      if (!settings.openaiModel) {
        status.textContent = "Enter the model name.";
        openaiModel.focus();
        return;
      }
    } else if (settings.provider === "bedrock") {
      const endpointError = validateBedrockEndpoint(settings.bedrockEndpoint);
      if (endpointError) {
        status.textContent = endpointError;
        endpoint.focus();
        return;
      }
      if (!settings.bedrockToken.trim()) {
        status.textContent = "Enter the Bedrock gateway authorization secret.";
        token.focus();
        return;
      }
    } else if (!model.value) {
      status.textContent = "Choose an Ollama model first. Start Ollama and select Refresh models.";
      refresh.focus();
      return;
    }
    try {
      saveLLMProviderSettings(settings);
      root.replaceChildren();
      resolveSetup({ settings, modelId: settings.provider === "ollama" ? settings.ollamaModel : settings.provider === "openai" ? settings.openaiModel : "bedrock" });
    } catch (error) {
      status.textContent = `Could not save AI settings: ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  cancel.addEventListener("click", () => {
    root.replaceChildren();
    resolveSetup(undefined);
  });

  screen.append(form);
  root.append(screen);
  activateGamepadFocus(screen);

  let resolveSetup!: (selection: ProviderSetupSelection | undefined) => void;
  const result = new Promise<ProviderSetupSelection | undefined>((resolve) => { resolveSetup = resolve; });
  return result;
}
