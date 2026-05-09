import { LLMProvider } from "./provider.js";

/** Detect quota / rate-limit errors from any provider */
const isQuotaError = (err) => {
  if (err?.status === 429 || err?.statusCode === 429) return true;
  const msg = (err?.message || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("exceeded")
  );
};

/**
 * Manages multiple LLM providers and allows switching between them at runtime.
 * Features:
 *  - Runtime provider/model switching via /proveedor and /modelo commands
 *  - Automatic fallback to next provider on quota/rate-limit errors
 *  - Attachment (image/audio) passthrough to providers that support it
 */
export class ProviderManager extends LLMProvider {
  constructor() {
    super();
    /** @type {Map<string, { provider: LLMProvider, description: string }>} */
    this._providers = new Map();
    this._activeName = null;
    this._lastFallbackName = null;
  }

  /**
   * Register a provider. The first one registered becomes the active default.
   * @param {string} name   Short key (e.g. "nvidia", "chatgpt", "gemini")
   * @param {LLMProvider} provider
   * @param {string} description  Human-readable label
   */
  register(name, provider, description = "") {
    this._providers.set(name, { provider, description });
    if (!this._activeName) this._activeName = name;
  }

  /** Switch active provider by name. Throws if unknown. */
  setActive(name) {
    const lower = name.toLowerCase();
    if (!this._providers.has(lower)) {
      const available = [...this._providers.keys()].join(", ");
      throw new Error(`Proveedor "${name}" no disponible. Disponibles: ${available}`);
    }
    this._activeName = lower;
    this._lastFallbackName = null;
  }

  getActiveName() { return this._activeName; }

  /** @returns {LLMProvider} */
  getActive() {
    const entry = this._providers.get(this._activeName);
    if (!entry) throw new Error("No hay proveedor activo configurado.");
    return entry.provider;
  }

  /** List all registered providers with their status. */
  listProviders() {
    return [...this._providers.entries()].map(([name, { provider, description }]) => ({
      name,
      description,
      active: name === this._activeName,
      model: provider.getModel(),
      supportsVision: provider.supportsVision?.() || false,
      supportsAudio: provider.supportsAudio?.() || false
    }));
  }

  /** Check if a name corresponds to a registered provider. */
  hasProvider(name) {
    return this._providers.has(name.toLowerCase());
  }

  /** Returns the name of the fallback provider used in the last call (or null). */
  getLastFallbackName() {
    return this._lastFallbackName;
  }

  // ── Delegated methods ──────────────────────────────────────────────────────

  /**
   * Generate a reply with automatic fallback on quota/rate-limit errors.
   * Tries the active provider first, then cycles through all others.
   * @param {import("./provider.js").ChatMessage[]} messages
   * @param {import("./provider.js").MediaAttachment|null} attachment
   */
  async generateReply(messages, attachment = null) {
    const names = [...this._providers.keys()];
    const startIdx = names.indexOf(this._activeName);

    let lastErr;
    this._lastFallbackName = null;

    for (let i = 0; i < names.length; i++) {
      const name = names[(startIdx + i) % names.length];
      const { provider } = this._providers.get(name);

      try {
        const reply = await provider.generateReply(messages, attachment);
        if (i > 0) {
          // We used a fallback — record which one
          this._lastFallbackName = name;
        }
        return reply;
      } catch (err) {
        lastErr = err;
        if (isQuotaError(err) && i < names.length - 1) {
          // Quota exhausted — try next provider silently
          continue;
        }
        throw err;
      }
    }

    throw lastErr;
  }

  getModel() { return this.getActive().getModel(); }
  setModel(model) { this.getActive().setModel(model); }
  supportsVision() { return this.getActive().supportsVision?.() || false; }
  supportsAudio() { return this.getActive().supportsAudio?.() || false; }
}
