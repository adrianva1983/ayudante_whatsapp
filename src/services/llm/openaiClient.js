import OpenAI from "openai";
import { env } from "../../config/env.js";
import { LLMProvider } from "./provider.js";

/**
 * Native OpenAI provider (gpt-4o, gpt-4o-mini…).
 * Supports vision when the model accepts image_url content parts.
 */
export class OpenAIProvider extends LLMProvider {
  constructor() {
    super();
    this._model = env.openaiModel;
    this.client = new OpenAI({ apiKey: env.openaiApiKey });
  }

  getModel() { return this._model; }
  setModel(model) { this._model = model; }
  supportsVision() { return true; } // gpt-4o and gpt-4o-mini support vision

  async generateReply(messages, attachment = null) {
    if (!env.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is missing.");
    }

    // If there's an image attachment, inject it into the last user message
    let finalMessages = messages;
    if (attachment?.type === "image" && attachment.buffer) {
      const base64 = attachment.buffer.toString("base64");
      const dataUrl = `data:${attachment.mimeType || "image/jpeg"};base64,${base64}`;

      finalMessages = messages.map((msg, i) => {
        if (i === messages.length - 1 && msg.role === "user") {
          const textContent = typeof msg.content === "string" ? msg.content : "";
          return {
            role: "user",
            content: [
              { type: "text", text: textContent || "Describe esta imagen." },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          };
        }
        return msg;
      });
    } else if (attachment?.type === "audio") {
      // OpenAI Chat API doesn't support audio inline — add note
      finalMessages = messages.map((msg, i) => {
        if (i === messages.length - 1 && msg.role === "user") {
          const textContent = typeof msg.content === "string" ? msg.content : "";
          return { ...msg, content: `[Mensaje de voz recibido] ${textContent}`.trim() };
        }
        return msg;
      });
    }

    const timeoutMs = env.llmTimeoutMs;
    const abortController = timeoutMs > 0 ? new AbortController() : null;
    const timer = abortController && setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const completion = await this.client.chat.completions.create(
        { model: this._model, messages: finalMessages, temperature: env.openaiTemperature, max_tokens: env.openaiMaxTokens },
        abortController ? { signal: abortController.signal } : undefined
      );
      return completion.choices?.[0]?.message?.content?.trim() || "No pude generar una respuesta en este momento.";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
