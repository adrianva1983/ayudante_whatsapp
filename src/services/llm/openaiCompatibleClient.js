import OpenAI from "openai";
import { env } from "../../config/env.js";
import { LLMProvider } from "./provider.js";

/**
 * OpenAI-compatible provider (Nvidia NIM, Together AI, Groq, etc.)
 * Most endpoints don't support vision — attachments are handled gracefully.
 */
export class OpenAICompatibleProvider extends LLMProvider {
  constructor() {
    super();
    this.client = new OpenAI({
      apiKey: env.openAiCompatApiKey,
      baseURL: env.openAiCompatBaseUrl
    });
    this._model = env.openAiCompatModel;
  }

  getModel() { return this._model; }
  setModel(model) { this._model = model; }

  async generateReply(messages, attachment = null) {
    if (!env.openAiCompatApiKey) {
      throw new Error("OPENAI_COMPAT_API_KEY is missing.");
    }

    // Inject attachment notice into the last user message (most APIs don't support vision)
    let finalMessages = messages;
    if (attachment) {
      const notice = attachment.type === "image"
        ? "[El usuario envió una imagen — este proveedor no soporta visión]"
        : "[El usuario envió un mensaje de voz — este proveedor no soporta audio]";
      finalMessages = messages.map((msg, i) => {
        if (i === messages.length - 1 && msg.role === "user") {
          const textContent = typeof msg.content === "string" ? msg.content : "";
          return { ...msg, content: `${notice} ${textContent}`.trim() };
        }
        return msg;
      });
    }

    const timeoutMs = env.llmTimeoutMs;
    const abortController = timeoutMs > 0 ? new AbortController() : null;
    const timer = abortController && setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this._model,
          messages: finalMessages,
          temperature: env.openAiCompatTemperature,
          top_p: env.openAiCompatTopP,
          max_tokens: env.openAiCompatMaxTokens
        },
        abortController ? { signal: abortController.signal } : undefined
      );
      return completion.choices?.[0]?.message?.content?.trim() || "No pude generar una respuesta en este momento.";
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
