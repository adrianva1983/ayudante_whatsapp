import OpenAI from "openai";
import { env } from "../../config/env.js";
import { LLMProvider } from "./provider.js";

export class OpenAICompatibleProvider extends LLMProvider {
  constructor() {
    super();
    this.client = new OpenAI({
      apiKey: env.openAiCompatApiKey,
      baseURL: env.openAiCompatBaseUrl
    });
    this._model = env.openAiCompatModel;
  }

  getModel() {
    return this._model;
  }

  setModel(model) {
    this._model = model;
  }

  async generateReply(messages) {
    if (!env.openAiCompatApiKey) {
      throw new Error("OPENAI_COMPAT_API_KEY is missing.");
    }

    const timeoutMs = env.llmTimeoutMs;
    const abortController = timeoutMs > 0 ? new AbortController() : null;
    const timer =
      abortController &&
      setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this._model,
          messages,
          temperature: env.openAiCompatTemperature,
          top_p: env.openAiCompatTopP,
          max_tokens: env.openAiCompatMaxTokens
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

export const createLlmProvider = () => {
  switch (env.llmProvider) {
    case "openai-compatible":
      return new OpenAICompatibleProvider();
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${env.llmProvider}`);
  }
};
