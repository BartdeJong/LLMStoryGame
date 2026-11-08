import { activateGamepadFocus } from "../input/focus";
import { getLLMProviderSettings, saveLLMProviderSettings, validateBedrockEndpoint } from "../llm/providerSettings";
import type { LLMProviderSettings } from "../llm/providerSettings";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function mountProviderSetup(root: HTMLElement): Promise<LLMProviderSettings> {
  const saved = getLLMProviderSettings();
  root.replaceChildren();
  const screen = el("section", "llm-screen provider-screen");
  screen.append(
    el("h1", "llm-screen-title", "Choose your storyteller"),
    el("p", "llm-screen-note", "Use the on-device model, or connect to an authorized Bedrock gateway."),
  );

  const form = document.createElement("form");
  form.className = "provider-form";
  const providerLabel = el("label", "provider-label", "AI provider");
  const provider = document.createElement("select");
  provider.name = "provider";
  provider.setAttribute("aria-label", "AI provider");
  for (const [value, label] of [["local", "On-device model"], ["bedrock", "AWS Bedrock gateway"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    provider.append(option);
  }
  provider.value = saved.provider;
  providerLabel.append(provider);

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

  const privacy = el(
    "p",
    "llm-screen-note provider-privacy",
    "The gateway URL and secret are saved in this browser on this device for later use. Anyone with access to this browser profile may be able to access the saved secret. Do not enter AWS access keys here.",
  );
  const status = el("p", "provider-status");
  status.setAttribute("role", "alert");
  const submit = el("button", "llm-button", "Continue");
  submit.type = "submit";

  const updateProviderFields = (): void => {
    const useBedrock = provider.value === "bedrock";
    connection.hidden = !useBedrock;
    privacy.hidden = !useBedrock;
    endpoint.required = useBedrock;
    token.required = useBedrock;
  };
  provider.addEventListener("change", updateProviderFields);
  updateProviderFields();

  form.append(providerLabel, connection, privacy, status, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings: LLMProviderSettings = {
      provider: provider.value === "bedrock" ? "bedrock" : "local",
      bedrockEndpoint: endpoint.value.trim(),
      bedrockToken: token.value,
    };
    if (settings.provider === "bedrock") {
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
    }
    try {
      saveLLMProviderSettings(settings);
      root.replaceChildren();
      resolveSetup(settings);
    } catch (error) {
      status.textContent = `Could not save AI settings: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  screen.append(form);
  root.append(screen);
  activateGamepadFocus(screen);

  let resolveSetup!: (settings: LLMProviderSettings) => void;
  const result = new Promise<LLMProviderSettings>((resolve) => { resolveSetup = resolve; });
  return result;
}
