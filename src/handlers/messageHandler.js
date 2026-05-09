import { env } from "../config/env.js";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import {
  buildEditPrompt,
  isSupportedCodeFile,
  saveEditedFile
} from "../services/files/fileProcessor.js";
import {
  parseLocalReviewCommand,
  reviewLocalProject
} from "../services/review/localReviewService.js";

// ── Helpers ─────────────────────────────────────────────────────────

const readTextFromMessage = (message) =>
  message?.conversation ||
  message?.extendedTextMessage?.text ||
  message?.imageMessage?.caption ||
  message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
  "";

const readDocumentMessage = (message) =>
  message?.documentMessage ||
  message?.documentWithCaptionMessage?.message?.documentMessage ||
  null;

const normalizeJidToNumber = (jid = "") => jid.split("@")[0].replace(/\D/g, "");

const isAllowedSender = (senderNumber, allowedNumber) =>
  senderNumber === allowedNumber ||
  senderNumber.endsWith(allowedNumber) ||
  allowedNumber.endsWith(senderNumber);

// ── Rate limiter (per chat, in-memory) ──────────────────────────────

class RateLimiter {
  constructor(maxPerMinute) {
    this.maxPerMinute = maxPerMinute;
    /** @type {Map<string, number[]>} */
    this._hits = new Map();
  }

  isAllowed(key) {
    if (this.maxPerMinute <= 0) return true;
    const now = Date.now();
    const windowMs = 60_000;
    const timestamps = (this._hits.get(key) || []).filter(
      (t) => now - t < windowMs
    );
    if (timestamps.length >= this.maxPerMinute) {
      this._hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this._hits.set(key, timestamps);
    return true;
  }
}

// ── Help text ───────────────────────────────────────────────────────

const HELP_TEXT = `🤖 *Ayudante Bot*
━━━━━━━━━━━━━━━━
📄 *Envía un archivo* → Lo edito según tu instrucción
📁 *revisa local <ruta>* → Reviso un proyecto local
💬 *Texto libre* → Chat con IA
━━━━━━━━━━━━━━━━
⚙️ *Comandos:*
/help → Este menú
/reset → Limpiar historial
/proveedor → Ver proveedores LLM disponibles
/proveedor <nombre> → Cambiar proveedor (nvidia, chatgpt, gemini)
/modelo → Ver modelo actual
/modelo <nombre> → Cambiar modelo del proveedor activo
━━━━━━━━━━━━━━━━`;

// ── Handler factory ─────────────────────────────────────────────────

export const createMessageHandler = ({ sock, llmProvider, sessionStore, logger }) => {
  const rateLimiter = new RateLimiter(env.rateLimitPerMinute);

  /** Check if the socket is currently connected and open. */
  const isSocketOpen = () => sock.ws?.isOpen === true;

  /** Keep "composing" presence while work() runs. */
  const withTypingPresence = async (jid, work) => {
    let timer = null;
    try {
      if (isSocketOpen()) {
        await sock.sendPresenceUpdate("composing", jid);
        timer = setInterval(() => {
          if (isSocketOpen()) {
            sock.sendPresenceUpdate("composing", jid).catch(() => {});
          }
        }, 4000);
      }
      return await work();
    } finally {
      if (timer) clearInterval(timer);
      if (isSocketOpen()) {
        await sock.sendPresenceUpdate("paused", jid).catch(() => {});
      }
    }
  };

  /**
   * Handle slash-commands. Returns true if the message was consumed.
   */
  const handleCommand = async (remoteJid, text) => {
    if (!isSocketOpen()) return false;
    const lower = text.toLowerCase().trim();

    // /help
    if (lower === "/help") {
      await sock.sendMessage(remoteJid, { text: HELP_TEXT });
      return true;
    }

    // /reset
    if (lower === "/reset") {
      await sessionStore.clearSession(remoteJid);
      await sock.sendMessage(remoteJid, {
        text: "🗑️ Historial limpiado. Empezamos de cero."
      });
      return true;
    }

    // /proveedor (list providers)
    if (lower === "/proveedor" || lower === "/proveedores") {
      const list = llmProvider.listProviders();
      const lines = list.map(
        (p) => `${p.active ? "▶️" : "⬚"} *${p.name}* — ${p.description}\n    modelo: _${p.model}_`
      );
      await sock.sendMessage(remoteJid, {
        text: `🔌 *Proveedores LLM*\n━━━━━━━━━━━━━━━━\n${lines.join("\n\n")}\n━━━━━━━━━━━━━━━━\nUsa /proveedor <nombre> para cambiar.`
      });
      return true;
    }

    // /proveedor <name> (switch provider)
    const providerMatch = text.match(/^\/proveedor\s+(.+)$/i);
    if (providerMatch) {
      const name = providerMatch[1].trim().toLowerCase();
      try {
        const previousName = llmProvider.getActiveName();
        llmProvider.setActive(name);
        const newModel = llmProvider.getModel();
        await sock.sendMessage(remoteJid, {
          text: `🔌 Proveedor cambiado:\n*${previousName}* → *${name}*\nModelo activo: _${newModel}_`
        });
      } catch (err) {
        await sock.sendMessage(remoteJid, { text: `❌ ${err.message}` });
      }
      return true;
    }

    // /modelo (show current provider + model)
    if (lower === "/modelo") {
      const providerName = llmProvider.getActiveName();
      const model = llmProvider.getModel();
      await sock.sendMessage(remoteJid, {
        text: `🧠 *Proveedor:* ${providerName}\n*Modelo:* ${model}`
      });
      return true;
    }

    // /modelo <name> (switch model within active provider)
    const modelMatch = text.match(/^\/modelo\s+(.+)$/i);
    if (modelMatch) {
      const newModel = modelMatch[1].trim();
      const previousModel = llmProvider.getModel();
      const providerName = llmProvider.getActiveName();
      llmProvider.setModel(newModel);
      await sock.sendMessage(remoteJid, {
        text: `🧠 Modelo cambiado en *${providerName}*:\n*${previousModel}* → *${newModel}*`
      });
      return true;
    }

    return false;
  };

  // ── Main upsert handler ───────────────────────────────────────────

  return async (event) => {
    const upsert = event?.messages?.[0];
    if (!upsert || upsert.key.fromMe || event.type !== "notify") return;

    const remoteJid = upsert.key.remoteJid;
    const senderJid = upsert.key.participant || remoteJid;
    const normalizedSenderJid = (senderJid || "").toLowerCase();
    const senderNumber = normalizeJidToNumber(senderJid);
    logger.info(
      {
        remoteJid,
        senderJid,
        normalizedSenderJid,
        senderNumber,
        allowedSender: env.allowedSender || null,
        allowedSenderJid: env.allowedSenderJid || null
      },
      "Mensaje entrante detectado"
    );

    // ── Auth check ──────────────────────────────────────────────────
    const numberAllowed =
      !env.allowedSender || isAllowedSender(senderNumber, env.allowedSender);
    const jidAllowed =
      !env.allowedSenderJid || normalizedSenderJid === env.allowedSenderJid;

    if (!numberAllowed && !jidAllowed) {
      logger.info({ senderNumber }, "Mensaje ignorado por filtro de remitente");
      return;
    }

    // ── Rate limit check ────────────────────────────────────────────
    if (!rateLimiter.isAllowed(remoteJid)) {
      await sock.sendMessage(remoteJid, {
        text: "⏳ Demasiados mensajes. Espera un momento antes de enviar otro."
      });
      logger.info({ senderNumber }, "Mensaje limitado por rate limiter");
      return;
    }

    const text = readTextFromMessage(upsert.message).trim();
    const documentMessage = readDocumentMessage(upsert.message);

    if (!remoteJid) return;

    try {
      // ── Slash commands ────────────────────────────────────────────
      if (text.startsWith("/")) {
        const handled = await handleCommand(remoteJid, text);
        if (handled) {
          logger.info({ senderNumber, command: text }, "Comando ejecutado");
          return;
        }
      }

      // ── Document / file editing ───────────────────────────────────
      if (documentMessage) {
        const fileName = documentMessage.fileName || "archivo.txt";
        if (!isSupportedCodeFile(fileName)) {
          await sock.sendMessage(remoteJid, {
            text: `❌ Tipo de archivo no soportado: ${fileName}`
          });
          logger.info({ senderNumber, fileName }, "Respuesta enviada: archivo no soportado");
          return;
        }

        const mediaBuffer = await downloadMediaMessage(
          upsert,
          "buffer",
          {},
          {
            logger,
            reuploadRequest: sock.updateMediaMessage
          }
        );
        if (!mediaBuffer || mediaBuffer.length > env.maxFileSizeBytes) {
          await sock.sendMessage(remoteJid, {
            text: "❌ El archivo no se pudo leer o supera el límite permitido."
          });
          logger.info(
            { senderNumber, fileName, size: mediaBuffer?.length || 0 },
            "Respuesta enviada: archivo invalido o demasiado grande"
          );
          return;
        }

        const originalCode = mediaBuffer.toString("utf8");
        const instruction =
          text ||
          "Refactoriza el codigo para mejorarlo y manten la funcionalidad.";
        const editMessages = buildEditPrompt({ instruction, originalCode, filename: fileName });
        const editedCode = await withTypingPresence(remoteJid, () =>
          llmProvider.generateReply(editMessages)
        );
        const savedPath = await saveEditedFile(env.outputDir, fileName, editedCode);

        // Send the edited file back as a downloadable document
        if (isSocketOpen()) {
          await sock.sendMessage(remoteJid, {
            document: Buffer.from(editedCode, "utf8"),
            mimetype: "text/plain",
            fileName: fileName,
            caption: `✅ Archivo procesado: ${fileName}\nGuardado en: ${savedPath}`
          });
        }
        logger.info({ senderNumber, fileName, savedPath }, "Respuesta enviada: archivo procesado");
        return;
      }

      // ── No text and no document ───────────────────────────────────
      if (!text) {
        logger.info({ senderNumber }, "Mensaje ignorado: sin texto y sin archivo");
        return;
      }

      // ── "revisa local <path>" command ─────────────────────────────
      const localReviewPath = parseLocalReviewCommand(text);
      if (localReviewPath) {
        logger.info({ senderNumber, localReviewPath }, "Comando de revision local detectado");
        if (isSocketOpen()) {
          await sock.sendMessage(remoteJid, {
            text: `📁 Perfecto, reviso el proyecto en:\n${localReviewPath}\nTe paso hallazgos en un momento.`
          });
        }

        const reviewResult = await withTypingPresence(remoteJid, () =>
          reviewLocalProject({
            commandPath: localReviewPath,
            llmProvider,
            maxFiles: env.maxReviewFiles,
            maxCharsPerFile: env.maxReviewCharsPerFile,
            logger
          })
        );

        const responseText =
          `✅ Review completado.\nRuta: ${reviewResult.resolvedPath}\n` +
          `Archivos analizados: ${reviewResult.reviewedFiles}\n\n` +
          `${reviewResult.summary}`;
        
        if (isSocketOpen()) {
          await sock.sendMessage(remoteJid, { text: responseText.slice(0, 3500) });
        }
        logger.info(
          { senderNumber, path: reviewResult.resolvedPath, files: reviewResult.reviewedFiles },
          "Respuesta enviada: review local"
        );
        return;
      }

      // ── Free-form chat with LLM ──────────────────────────────────
      const session = await sessionStore.getSession(remoteJid);
      const messages = [
        {
          role: "system",
          content:
            "Eres un asistente personal por WhatsApp. Cuando la conversacion no sea tecnica, responde breve, natural y amigable, evitando sonar robotico. Cuando sea tecnica, mantente claro y accionable, pero sin alargarte innecesariamente."
        },
        ...session,
        { role: "user", content: text }
      ];

      const reply = await withTypingPresence(remoteJid, () =>
        llmProvider.generateReply(messages)
      );

      // Batch-append both messages in a single atomic operation (fixes race condition)
      await sessionStore.appendMessages(remoteJid, [
        { role: "user", content: text },
        { role: "assistant", content: reply }
      ]);

      if (isSocketOpen()) {
        try {
          await sock.sendMessage(remoteJid, { text: reply });
          logger.info({ senderNumber, remoteJid }, "Respuesta enviada: chat");
        } catch (sendErr) {
          logger.error({ err: sendErr, senderNumber, remoteJid }, "Error al enviar mensaje de respuesta");
        }
      } else {
        logger.warn({ senderNumber, remoteJid, readyState: sock.ws?.readyState }, "Socket cerrado, respuesta NO enviada");
      }
    } catch (error) {
      logger.error({ err: error }, "Message handling failed");
      if (isSocketOpen()) {
        await sock.sendMessage(remoteJid, {
          text: "❌ Ocurrió un error al procesar tu mensaje."
        }).catch((sendErr) => {
          logger.error({ err: sendErr, senderNumber, remoteJid }, "Error al enviar mensaje de error");
        });
        logger.info({ senderNumber }, "Respuesta enviada: error");
      } else {
        logger.warn({ senderNumber, remoteJid, readyState: sock.ws?.readyState }, "Socket cerrado, error NO enviado al usuario");
      }
    }
  };
};
