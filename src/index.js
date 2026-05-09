import { webcrypto } from "node:crypto";
import { env } from "./config/env.js";
import { createMessageHandler } from "./handlers/messageHandler.js";
import { OpenAICompatibleProvider } from "./services/llm/openaiCompatibleClient.js";
import { OpenAIProvider } from "./services/llm/openaiClient.js";
import { GeminiProvider } from "./services/llm/geminiClient.js";
import { ProviderManager } from "./services/llm/providerManager.js";
import { SessionStore } from "./services/session/sessionStore.js";
import { logger } from "./utils/logger.js";
import { startWhatsappSocket } from "./whatsapp/socket.js";

/**
 * Registers all configured LLM providers.
 * A provider is only registered if its API key is present.
 */
const buildProviderManager = () => {
  const manager = new ProviderManager();

  if (env.openAiCompatApiKey) {
    manager.register("nvidia", new OpenAICompatibleProvider(), "Nvidia NIM (OpenAI-compatible)");
  }
  if (env.openaiApiKey) {
    manager.register("chatgpt", new OpenAIProvider(), "OpenAI ChatGPT");
  }
  if (env.geminiApiKey) {
    manager.register("gemini", new GeminiProvider(), "Google Gemini");
  }

  if (manager.listProviders().length === 0) {
    logger.error(
      "No hay ningun proveedor LLM configurado. Añade al menos una API key en .env"
    );
    process.exit(1);
  }

  // Set the default provider (falls back to whatever was registered first)
  if (manager.hasProvider(env.defaultProvider)) {
    manager.setActive(env.defaultProvider);
  }

  return manager;
};

const bootstrap = async () => {
  // Baileys requiere globalThis.crypto; en Node 16 puede no venir definido.
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }

  const providerManager = buildProviderManager();

  // Log registered providers
  const providers = providerManager.listProviders();
  logger.info(
    { providers: providers.map((p) => `${p.active ? "→ " : "  "}${p.name} (${p.model})`).join(", ") },
    `${providers.length} proveedor(es) LLM registrados`
  );

  // Quick LLM connectivity test (non-blocking – warn only)
  const activeName = providerManager.getActiveName();
  logger.info(
    { provider: activeName, model: providerManager.getModel() },
    "Verificando conexion con el LLM en segundo plano..."
  );
  providerManager.generateReply([{ role: "user", content: "ping" }])
    .then(() => logger.info("Conexion con LLM verificada correctamente."))
    .catch((error) => {
      logger.warn(
        { err: error },
        "No se pudo verificar la conexion con el LLM. El bot intentara funcionar de todas formas."
      );
    });

  const sessionStore = new SessionStore(env.sessionStorePath, env.maxContextMessages);

  const sock = await startWhatsappSocket({
    authDir: env.authDir,
    logger,
    createMessageUpsertHandler: ({ sock }) =>
      createMessageHandler({
        sock,
        llmProvider: providerManager,
        sessionStore,
        logger
      })
  });

  // ── Graceful shutdown ─────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info({ signal }, "Cerrando bot de forma ordenada...");
    try {
      await sessionStore.flush();
      logger.info("Sesiones guardadas en disco.");
    } catch (e) {
      logger.error({ err: e }, "Error guardando sesiones al cerrar");
    }
    try {
      sock?.end?.();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── Error handling to prevent crashes on network errors ───────────
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled Rejection (caught to prevent crash)");
  });

  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "Uncaught Exception (caught to prevent crash)");
    // Optionally: if the error is critical, you might still want to exit, 
    // but for network timeouts it's better to let Baileys reconnect.
  });
};

bootstrap().catch((error) => {
  logger.error({ err: error }, "Fatal startup error");
  process.exit(1);
});
