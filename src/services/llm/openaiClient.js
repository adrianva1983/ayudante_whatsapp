import OpenAI from "openai";
import { env } from "../../config/env.js";
import { LLMProvider } from "./provider.js";

/**
 * Native OpenAI provider for ChatGPT models (gpt-4o, gpt-4o-mini, etc.).
 * Uses the official OpenAI API endpoint.
 */
export class OpenAIProvider extends LLMProvider {
  constructor() {
    super();
    this._model = env.openaiModel;
    this.client = new OpenAI({
      apiKey: env.openaiApiKey
    });
  }

  getModel() {
    return this._model;
  }

  setModel(model) {
    this._model = model;
  }

  async generateReply(messages) {
    if (!env.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is missing.");
    }

    const timeoutMs = env.llmTimeoutMs;
    const abortController = timeoutMs > 0 ? new AbortController() : null;
    const timer =
      abortController && setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this._model,
          messages,
          temperature: env.openaiTemperature,
          max_tokens: env.openaiMaxTokens
        },
        abortController ? { signal: abortController.signal } : undefined
      );

      return (
        completion.choices?.[0]?.message?.content?.trim() ||
        "No pude generar una respuesta en este momento."
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
