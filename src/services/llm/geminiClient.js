import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../config/env.js";
import { LLMProvider } from "./provider.js";

/**
 * Converts OpenAI-style messages to Gemini format.
 * Gemini uses "model" instead of "assistant" and separates system instructions.
 */
const toGeminiFormat = (messages) => {
  let systemInstruction = "";
  const history = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemInstruction += (systemInstruction ? "\n" : "") + msg.content;
    } else {
      history.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }]
      });
    }
  }

  // Gemini requires the last message to be from "user" and history to alternate
  // We separate the last user message to send via sendMessage()
  const lastMsg = history.pop();
  return { systemInstruction, history, lastUserText: lastMsg?.parts?.[0]?.text || "" };
};

export class GeminiProvider extends LLMProvider {
  constructor() {
    super();
    this._model = env.geminiModel;
    this._client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  getModel() {
    return this._model;
  }

  setModel(model) {
    this._model = model;
  }

  async generateReply(messages) {
    if (!env.geminiApiKey) {
      throw new Error("GEMINI_API_KEY is missing.");
    }

    const { systemInstruction, history, lastUserText } = toGeminiFormat(messages);

    const model = this._client.getGenerativeModel({
      model: this._model,
      systemInstruction: systemInstruction || undefined,
      generationConfig: {
        temperature: env.geminiTemperature,
        maxOutputTokens: env.geminiMaxTokens,
        topP: env.geminiTopP
      }
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(lastUserText);
    const text = result.response.text();

    return text?.trim() || "No pude generar una respuesta en este momento.";
  }
}
