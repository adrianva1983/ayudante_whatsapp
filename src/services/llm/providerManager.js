import { LLMProvider } from "./provider.js";

/**
 * Manages multiple LLM providers and allows switching between them at runtime.
 * Delegates generateReply/getModel/setModel to the currently active provider.
 */
export class ProviderManager extends LLMProvider {
  constructor() {
    super();
    /** @type {Map<string, { provider: LLMProvider, description: string }>} */
    this._providers = new Map();
    this._activeName = null;
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
      throw new Error(
        `Proveedor "${name}" no disponible. Disponibles: ${available}`
      );
    }
    this._activeName = lower;
  }

  getActiveName() {
    return this._activeName;
  }

  /** @returns {LLMProvider} */
  getActive() {
    const entry = this._providers.get(this._activeName);
    if (!entry) throw new Error("No hay proveedor activo configurado.");
    return entry.provider;
  }

  /** List all registered providers with their status. */
  listProviders() {
    return [...this._providers.entries()].map(([name, { description }]) => ({
      name,
      description,
      active: name === this._activeName,
      model: this._providers.get(name).provider.getModel()
    }));
  }

  /** Check if a name corresponds to a registered provider. */
  hasProvider(name) {
    return this._providers.has(name.toLowerCase());
  }

  // ── Delegated methods ──────────────────────────────────────────────

  async generateReply(messages) {
    return this.getActive().generateReply(messages);
  }

  getModel() {
    return this.getActive().getModel();
  }

  setModel(model) {
    this.getActive().setModel(model);
  }
}
