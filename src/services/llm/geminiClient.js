import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "../../config/env.js";
import { LLMProvider } from "./provider.js";

/**
 * Converts OpenAI-style messages to Gemini format.
 * Supports multi-modal content (images/audio) in the last user message.
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
        parts: [{ text: typeof msg.content === "string" ? msg.content : msg.content.map(p => p.text || "").join(" ") }]
      });
    }
  }

  const lastMsg = history.pop();
  return { systemInstruction, history, lastUserText: lastMsg?.parts?.[0]?.text || "" };
};

export class GeminiProvider extends LLMProvider {
  constructor() {
    super();
    this._model = env.geminiModel;
    this._client = new GoogleGenerativeAI(env.geminiApiKey);
  }

  getModel() { return this._model; }
  setModel(model) { this._model = model; }
  supportsVision() { return true; }
  supportsAudio() { return true; }

  async generateReply(messages, attachment = null) {
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

    // Build the parts for the last user message
    const parts = [];
    if (lastUserText) {
      parts.push({ text: lastUserText });
    }

    if (attachment?.buffer) {
      const base64Data = attachment.buffer.toString("base64");
      if (attachment.type === "image") {
        if (!lastUserText) parts.push({ text: "Describe esta imagen detalladamente." });
        parts.push({ inlineData: { mimeType: attachment.mimeType || "image/jpeg", data: base64Data } });
      } else if (attachment.type === "audio") {
        if (!lastUserText) parts.push({ text: "Transcribe y responde a este audio." });
        parts.push({ inlineData: { mimeType: attachment.mimeType || "audio/ogg; codecs=opus", data: base64Data } });
      }
    }

    const result = await chat.sendMessage(parts.length > 0 ? parts : lastUserText);
    const text = result.response.text();

    return text?.trim() || "No pude generar una respuesta en este momento.";
  }
}
