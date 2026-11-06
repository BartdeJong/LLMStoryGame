export interface SupportReport {
  supported: boolean;
  reason?: string;
  warnings: string[];
  info: {
    shaderF16: boolean;
    maxBufferSizeMB?: number;
    deviceMemoryGB?: number;
    storageFreeMB?: number;
  };
}

// Minimal WebGPU typings so we do not need @webgpu/types.
interface GPUAdapterLike {
  features: Set<string>;
  limits: { maxBufferSize?: number };
}
interface NavigatorWithGPU extends Navigator {
  gpu?: { requestAdapter(): Promise<GPUAdapterLike | null> };
  deviceMemory?: number;
}

const MB = 1024 * 1024;

export async function checkSupport(requiredFreeMB = 2500): Promise<SupportReport> {
  const info: SupportReport["info"] = { shaderF16: false };
  const warnings: string[] = [];
  const unsupported = (reason: string): SupportReport => ({ supported: false, reason, warnings, info });
  const nav = navigator as NavigatorWithGPU;

  if (typeof Worker === "undefined") return unsupported("This browser does not support Web Workers.");
  if (!nav.gpu) {
    if (typeof isSecureContext === "boolean" && !isSecureContext) {
      return unsupported("WebGPU requires a secure connection. Open this site over HTTPS; a local development server accessed by its IP address over HTTP does not qualify.");
    }
    return unsupported("This browser does not expose WebGPU. On iPhone and iPad, Safari requires iOS/iPadOS 26 or newer.");
  }

  let adapter: GPUAdapterLike | null = null;
  try {
    adapter = await nav.gpu.requestAdapter();
  } catch {
    adapter = null;
  }
  if (!adapter) return unsupported("WebGPU is present, but no graphics adapter is available on this device.");

  info.shaderF16 = adapter.features.has("shader-f16");
  if (adapter.limits.maxBufferSize) info.maxBufferSizeMB = Math.round(adapter.limits.maxBufferSize / MB);
  if (nav.deviceMemory) info.deviceMemoryGB = nav.deviceMemory;

  try {
    const estimate = await nav.storage?.estimate?.();
    if (estimate?.quota !== undefined && estimate.usage !== undefined) {
      info.storageFreeMB = Math.round((estimate.quota - estimate.usage) / MB);
      if (info.storageFreeMB < requiredFreeMB) {
        warnings.push(`Only about ${info.storageFreeMB} MB of browser storage looks free; the model needs 1-2 GB.`);
      }
    }
  } catch {
    // Storage estimates are optional.
  }
  if (info.deviceMemoryGB !== undefined && info.deviceMemoryGB < 4) warnings.push(`This device reports ${info.deviceMemoryGB} GB of memory; the model may not fit.`);
  if (!info.shaderF16) warnings.push("No 16-bit shader support: use a q4f32 model variant.");

  return { supported: true, warnings, info };
}
