import dotenv from "dotenv";

dotenv.config();

const asNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeNumber = (value = "") => value.replace(/\D/g, "");
const normalizeJid = (value = "") => value.trim().toLowerCase();

export const env = {
  // ── Proveedor por defecto ─────────────────────────────────────────
  /** Proveedor activo al arrancar: "nvidia", "chatgpt" o "gemini" */
  defaultProvider: (process.env.DEFAULT_PROVIDER || "nvidia").toLowerCase(),

  // ── Nvidia / OpenAI-compatible ────────────────────────────────────
  openAiCompatBaseUrl:
    process.env.OPENAI_COMPAT_BASE_URL || "https://integrate.api.nvidia.com/v1",
  openAiCompatApiKey: process.env.OPENAI_COMPAT_API_KEY || "",
  openAiCompatModel:
    process.env.OPENAI_COMPAT_MODEL || "qwen/qwen2.5-coder-32b-instruct",
  openAiCompatTemperature: asNumber(process.env.OPENAI_COMPAT_TEMPERATURE, 0.7),
  openAiCompatTopP: asNumber(process.env.OPENAI_COMPAT_TOP_P, 0.8),
  openAiCompatMaxTokens: asNumber(process.env.OPENAI_COMPAT_MAX_TOKENS, 4096),

  // ── ChatGPT (OpenAI nativo) ───────────────────────────────────────
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openaiTemperature: asNumber(process.env.OPENAI_TEMPERATURE, 0.7),
  openaiMaxTokens: asNumber(process.env.OPENAI_MAX_TOKENS, 4096),

  // ── Gemini ────────────────────────────────────────────────────────
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  geminiTemperature: asNumber(process.env.GEMINI_TEMPERATURE, 0.7),
  geminiTopP: asNumber(process.env.GEMINI_TOP_P, 0.8),
  geminiMaxTokens: asNumber(process.env.GEMINI_MAX_TOKENS, 4096),

  // ── Autorización ──────────────────────────────────────────────────
  allowedSender: normalizeNumber(process.env.ALLOWED_SENDER || ""),
  allowedSenderJid: normalizeJid(process.env.ALLOWED_SENDER_JID || ""),

  // ── Almacenamiento ────────────────────────────────────────────────
  sessionStorePath: process.env.SESSION_STORE_PATH || "./data/sessions.json",
  outputDir: process.env.OUTPUT_DIR || "./data/outputs",
  authDir: process.env.AUTH_DIR || "./auth_info_multi",

  // ── Límites ───────────────────────────────────────────────────────
  maxContextMessages: asNumber(process.env.MAX_CONTEXT_MESSAGES, 20),
  maxFileSizeBytes: asNumber(process.env.MAX_FILE_SIZE_BYTES, 524288),
  maxReviewFiles: asNumber(process.env.MAX_REVIEW_FILES, 15),
  maxReviewCharsPerFile: asNumber(process.env.MAX_REVIEW_CHARS_PER_FILE, 4000),

  // ── Seguridad ─────────────────────────────────────────────────────
  allowedReviewBasePath: process.env.ALLOWED_REVIEW_BASE_PATH || "",

  // ── Reconexión ────────────────────────────────────────────────────
  maxReconnectAttempts: asNumber(process.env.MAX_RECONNECT_ATTEMPTS, 10),

  // ── LLM ───────────────────────────────────────────────────────────
  llmTimeoutMs: asNumber(process.env.LLM_TIMEOUT_MS, 120000),
  rateLimitPerMinute: asNumber(process.env.RATE_LIMIT_PER_MINUTE, 0),

  // ── Logging ───────────────────────────────────────────────────────
  logLevel: process.env.LOG_LEVEL || "info"
};
