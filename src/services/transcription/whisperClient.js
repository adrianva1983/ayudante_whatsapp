import OpenAI from "openai";
import { env } from "../../config/env.js";

/**
 * Transcription service using Groq's Whisper API (free tier: 28,800 sec/day).
 * The OpenAI SDK is reused since Groq exposes an OpenAI-compatible endpoint.
 *
 * Supported audio formats from WhatsApp: ogg, mp3, mp4, wav, webm, m4a, flac
 */
export class WhisperTranscriber {
  constructor() {
    this._client = new OpenAI({
      apiKey: env.groqApiKey,
      baseURL: "https://api.groq.com/openai/v1"
    });
    this._model = env.groqWhisperModel;
  }

  get isConfigured() {
    return Boolean(env.groqApiKey);
  }

  /**
   * Transcribe an audio buffer to text.
   * @param {Buffer} audioBuffer  Raw audio bytes (ogg, mp3, wav, etc.)
   * @param {string} mimeType     e.g. "audio/ogg"
   * @param {string} [language]   ISO-639-1 language code, e.g. "es". Auto-detect if omitted.
   * @returns {Promise<string>}   Transcribed text
   */
  async transcribe(audioBuffer, mimeType, language = "es") {
    if (!env.groqApiKey) {
      throw new Error("GROQ_API_KEY is missing. Get a free key at https://console.groq.com");
    }

    // Build filename with correct extension so Groq can detect the codec
    const ext = mimeType.split("/")[1]?.split(";")[0]?.trim() || "ogg";
    const file = new File([audioBuffer], `audio.${ext}`, { type: mimeType.split(";")[0].trim() });

    const transcription = await this._client.audio.transcriptions.create({
      file,
      model: this._model,
      language,
      response_format: "text"
    });

    return (typeof transcription === "string" ? transcription : transcription?.text || "").trim();
  }
}
