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
import { WhisperTranscriber } from "../services/transcription/whisperClient.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const readTextFromMessage = (message) =>
  message?.conversation ||
  message?.extendedTextMessage?.text ||
  message?.imageMessage?.caption ||
  message?.videoMessage?.caption ||
  message?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
  "";

const readDocumentMessage = (message) =>
  message?.documentMessage ||
  message?.documentWithCaptionMessage?.message?.documentMessage ||
  null;

const readImageMessage = (message) => message?.imageMessage || null;
const readAudioMessage = (message) => message?.audioMessage || message?.pttMessage || null;

const normalizeJidToNumber = (jid = "") => jid.split("@")[0].replace(/\D/g, "");

/**
 * Check if the sender is authorized.
 * Supports multiple senders via ALLOWED_SENDERS (comma-separated) and ALLOWED_SENDER_JIDS.
 */
const isAllowedSender = (senderNumber, normalizedSenderJid) => {
  // If no restrictions configured → allow all
  if (env.allowedSenders.length === 0 && env.allowedSenderJids.length === 0) return true;

  // Check JIDs first (most reliable in newer WA protocol)
  if (env.allowedSenderJids.length > 0) {
    if (env.allowedSenderJids.includes(normalizedSenderJid)) return true;
  }

  // Check phone numbers (with endsWith for prefix flexibility)
  if (env.allowedSenders.length > 0) {
    for (const allowed of env.allowedSenders) {
      if (senderNumber === allowed || senderNumber.endsWith(allowed) || allowed.endsWith(senderNumber)) {
        return true;
      }
    }
  }

  return false;
};

const formatUptime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

// ── Rate limiter (per chat, in-memory) ──────────────────────────────────────

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
    const timestamps = (this._hits.get(key) || []).filter((t) => now - t < windowMs);
    if (timestamps.length >= this.maxPerMinute) {
      this._hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this._hits.set(key, timestamps);
    return true;
  }
}

// ── Help text ────────────────────────────────────────────────────────────────

const HELP_TEXT = `🤖 *Ayudante Bot*
━━━━━━━━━━━━━━━━
📄 *Envía un archivo* → Lo edito según tu instrucción
🖼️ *Envía una imagen* → La analizo (Gemini)
🎤 *Envía un audio/voz* → Lo proceso (Gemini)
📁 *revisa local <ruta>* → Reviso un proyecto local
💬 *Texto libre* → Chat con IA
━━━━━━━━━━━━━━━━
⚙️ *Comandos:*
/help → Este menú
/reset → Limpiar historial
/estado → Estado del bot y proveedores
/proveedor → Ver proveedores LLM disponibles
/proveedor <nombre> → Cambiar proveedor (nvidia, chatgpt, gemini)
/modelo → Ver modelo actual
/modelo <nombre> → Cambiar modelo del proveedor activo
━━━━━━━━━━━━━━━━`;

// ── Handler factory ──────────────────────────────────────────────────────────

export const createMessageHandler = ({ sock, llmProvider, sessionStore, logger }) => {
  const rateLimiter = new RateLimiter(env.rateLimitPerMinute);
  const botStartTime = Date.now();
  const transcriber = new WhisperTranscriber();

  if (transcriber.isConfigured) {
    logger.info({ model: env.groqWhisperModel }, "Transcripcion de audio activa (Groq Whisper)");
  } else {
    logger.warn("GROQ_API_KEY no configurado — mensajes de voz no seran transcritos");
  }

  /** Check if the socket is currently connected and open. */
  const isSocketOpen = () => sock.ws?.isOpen === true;

  /** Keep "composing" presence while work() runs. */
  const withTypingPresence = async (jid, work) => {
    let timer = null;
    try {
      if (isSocketOpen()) {
        await sock.sendPresenceUpdate("composing", jid);
        timer = setInterval(() => {
          if (isSocketOpen()) sock.sendPresenceUpdate("composing", jid).catch(() => {});
        }, 4000);
      }
      return await work();
    } finally {
      if (timer) clearInterval(timer);
      if (isSocketOpen()) await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    }
  };

  /** Send a text message safely. */
  const safeSend = async (jid, text, logContext) => {
    if (isSocketOpen()) {
      try {
        await sock.sendMessage(jid, { text });
        logger.info(logContext, "Respuesta enviada");
      } catch (err) {
        logger.error({ err, jid }, "Error al enviar mensaje");
      }
    } else {
      logger.warn({ jid, readyState: sock.ws?.readyState }, "Socket cerrado — respuesta NO enviada");
    }
  };

  /**
   * Download media from a WhatsApp message, returning a Buffer.
   * Returns null if download fails or exceeds size limit.
   */
  const downloadMedia = async (upsert) => {
    try {
      const buf = await downloadMediaMessage(upsert, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      if (!buf || buf.length > env.maxFileSizeBytes) return null;
      return buf;
    } catch {
      return null;
    }
  };

  /** Handle slash-commands. Returns true if the message was consumed. */
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
      await sock.sendMessage(remoteJid, { text: "🗑️ Historial limpiado. Empezamos de cero." });
      return true;
    }

    // /estado
    if (lower === "/estado") {
      const uptimeStr = formatUptime(Math.floor((Date.now() - botStartTime) / 1000));
      const session = await sessionStore.getSession(remoteJid);
      const sessionMsgs = Math.floor(session.length / 2); // pairs of user/assistant
      const fallback = llmProvider.getLastFallbackName?.();

      const providerLines = llmProvider.listProviders().map((p) => {
        const icons = [p.active ? "▶️" : "⬚", p.supportsVision ? "🖼️" : "", p.supportsAudio ? "🎤" : ""].filter(Boolean).join("");
        return `${icons} *${p.name}* — _${p.model}_`;
      });

      const text =
        `🤖 *Estado del Bot*\n━━━━━━━━━━━━━\n` +
        `⏱️ *Uptime:* ${uptimeStr}\n` +
        `🔌 *Proveedor activo:* ${llmProvider.getActiveName()}${fallback ? ` (fallback: ${fallback})` : ""}\n` +
        `🧠 *Modelo:* ${llmProvider.getModel()}\n` +
        `💬 *Mensajes en sesión:* ${sessionMsgs}\n` +
        `🖼️ *Vision:* ${llmProvider.supportsVision?.() ? "Sí" : "No"}\n` +
        `🎤 *Audio:* ${llmProvider.supportsAudio?.() ? "Sí" : "No"}\n\n` +
        `📋 *Proveedores:*\n${providerLines.join("\n")}`;

      await sock.sendMessage(remoteJid, { text });
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

    // /proveedor <name>
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

    // /modelo (show current)
    if (lower === "/modelo") {
      await sock.sendMessage(remoteJid, {
        text: `🧠 *Proveedor:* ${llmProvider.getActiveName()}\n*Modelo:* ${llmProvider.getModel()}`
      });
      return true;
    }

    // /modelo <name>
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

  // ── Main upsert handler ────────────────────────────────────────────────────

  return async (event) => {
    const upsert = event?.messages?.[0];
    if (!upsert || upsert.key.fromMe || event.type !== "notify") return;

    const remoteJid = upsert.key.remoteJid;
    const senderJid = upsert.key.participant || remoteJid;
    const normalizedSenderJid = (senderJid || "").toLowerCase();
    const senderNumber = normalizeJidToNumber(senderJid);

    logger.info(
      { remoteJid, senderJid, normalizedSenderJid, senderNumber,
        allowedSenders: env.allowedSenders, allowedSenderJids: env.allowedSenderJids },
      "Mensaje entrante detectado"
    );

    // ── Auth check ─────────────────────────────────────────────────────────
    if (!isAllowedSender(senderNumber, normalizedSenderJid)) {
      logger.info({ senderNumber, normalizedSenderJid }, "Mensaje ignorado por filtro de remitente");
      return;
    }

    // ── Rate limit ─────────────────────────────────────────────────────────
    if (!rateLimiter.isAllowed(remoteJid)) {
      await safeSend(remoteJid, "⏳ Demasiados mensajes. Espera un momento antes de enviar otro.", { senderNumber });
      logger.info({ senderNumber }, "Mensaje limitado por rate limiter");
      return;
    }

    const text = readTextFromMessage(upsert.message).trim();
    const documentMessage = readDocumentMessage(upsert.message);
    const imageMessage = readImageMessage(upsert.message);
    const audioMessage = readAudioMessage(upsert.message);

    if (!remoteJid) return;

    try {
      // ── Slash commands ───────────────────────────────────────────────────
      if (text.startsWith("/")) {
        const handled = await handleCommand(remoteJid, text);
        if (handled) {
          logger.info({ senderNumber, command: text }, "Comando ejecutado");
          return;
        }
      }

      // ── Document / file editing ──────────────────────────────────────────
      if (documentMessage) {
        const fileName = documentMessage.fileName || "archivo.txt";
        if (!isSupportedCodeFile(fileName)) {
          await safeSend(remoteJid, `❌ Tipo de archivo no soportado: ${fileName}`, { senderNumber });
          return;
        }

        const mediaBuffer = await downloadMedia(upsert);
        if (!mediaBuffer) {
          await safeSend(remoteJid, "❌ El archivo no se pudo leer o supera el límite permitido.", { senderNumber });
          return;
        }

        const originalCode = mediaBuffer.toString("utf8");
        const instruction = text || "Refactoriza el codigo para mejorarlo y mantén la funcionalidad.";
        const editMessages = buildEditPrompt({ instruction, originalCode, filename: fileName });
        const editedCode = await withTypingPresence(remoteJid, () => llmProvider.generateReply(editMessages));
        const savedPath = await saveEditedFile(env.outputDir, fileName, editedCode);

        if (isSocketOpen()) {
          await sock.sendMessage(remoteJid, {
            document: Buffer.from(editedCode, "utf8"),
            mimetype: "text/plain",
            fileName,
            caption: `✅ Archivo procesado: ${fileName}\nGuardado en: ${savedPath}`
          });
          logger.info({ senderNumber, fileName, savedPath }, "Respuesta enviada: archivo procesado");
        }
        return;
      }

      // ── Image handling ───────────────────────────────────────────────────
      if (imageMessage) {
        const imageBuffer = await downloadMedia(upsert);
        if (!imageBuffer) {
          await safeSend(remoteJid, "❌ No pude descargar la imagen.", { senderNumber });
          return;
        }

        const mimeType = imageMessage.mimetype || "image/jpeg";
        const attachment = { type: "image", mimeType, buffer: imageBuffer };
        const session = await sessionStore.getSession(remoteJid);
        const userContent = text || "Describe esta imagen detalladamente.";

        const messages = [
          { role: "system", content: "Eres un asistente personal por WhatsApp. Analiza imágenes con detalle cuando te las envíen." },
          ...session,
          { role: "user", content: userContent }
        ];

        const reply = await withTypingPresence(remoteJid, () => llmProvider.generateReply(messages, attachment));

        // Check if fallback was used
        const usedFallback = llmProvider.getLastFallbackName?.();
        const replyWithNote = usedFallback
          ? `_(via ${usedFallback})_\n\n${reply}`
          : reply;

        await sessionStore.appendMessages(remoteJid, [
          { role: "user", content: `[Imagen] ${userContent}` },
          { role: "assistant", content: reply }
        ]);

        await safeSend(remoteJid, replyWithNote, { senderNumber, type: "image" });
        return;
      }

      // ── Audio / voice message handling ───────────────────────────────────
      if (audioMessage) {
        if (!transcriber.isConfigured) {
          await safeSend(remoteJid, "❌ No hay servicio de transcripción configurado.\nAñade GROQ_API_KEY en el .env para usar mensajes de voz.", { senderNumber });
          return;
        }

        const audioBuffer = await downloadMedia(upsert);
        if (!audioBuffer) {
          await safeSend(remoteJid, "❌ No pude descargar el audio.", { senderNumber });
          return;
        }

        // Step 1: Transcribe audio → text via Groq Whisper
        let transcribedText;
        try {
          const mimeType = audioMessage.mimetype || "audio/ogg";
          transcribedText = await transcriber.transcribe(audioBuffer, mimeType, env.whisperLanguage);
          logger.info({ senderNumber, chars: transcribedText.length }, "Audio transcrito correctamente");
        } catch (transcribeErr) {
          logger.error({ err: transcribeErr }, "Error al transcribir audio");
          await safeSend(remoteJid, "❌ No pude transcribir el audio. Intenta enviarlo como texto.", { senderNumber });
          return;
        }

        if (!transcribedText) {
          await safeSend(remoteJid, "⚠️ No detecté voz en el audio. ¿Puedes repetirlo?", { senderNumber });
          return;
        }

        // Step 2: Send transcription to LLM (no attachment needed — works with any provider)
        const session = await sessionStore.getSession(remoteJid);
        const messages = [
          { role: "system", content: "Eres un asistente personal por WhatsApp. Cuando la conversacion no sea tecnica, responde breve, natural y amigable. El usuario ha enviado un mensaje de voz que ha sido transcrito automaticamente." },
          ...session,
          { role: "user", content: transcribedText }
        ];

        const reply = await withTypingPresence(remoteJid, () => llmProvider.generateReply(messages));
        const usedFallback = llmProvider.getLastFallbackName?.();

        await sessionStore.appendMessages(remoteJid, [
          { role: "user", content: `[🎤 Voz] ${transcribedText}` },
          { role: "assistant", content: reply }
        ]);

        const responseText = `🎤 _"${transcribedText}"_\n\n${reply}`;
        const finalReply = usedFallback ? `_(via ${usedFallback})_\n\n${responseText}` : responseText;
        await safeSend(remoteJid, finalReply, { senderNumber, type: "audio" });
        return;
      }

      // ── No text and no media ─────────────────────────────────────────────
      if (!text) {
        logger.info({ senderNumber }, "Mensaje ignorado: sin texto ni media conocido");
        return;
      }

      // ── "revisa local <path>" command ────────────────────────────────────
      const localReviewPath = parseLocalReviewCommand(text);
      if (localReviewPath) {
        logger.info({ senderNumber, localReviewPath }, "Comando de revision local detectado");
        await safeSend(remoteJid, `📁 Perfecto, reviso el proyecto en:\n${localReviewPath}\nTe paso hallazgos en un momento.`, { senderNumber });

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

        await safeSend(remoteJid, responseText.slice(0, 3500), { senderNumber, type: "review" });
        return;
      }

      // ── Free-form chat with LLM ──────────────────────────────────────────
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

      const reply = await withTypingPresence(remoteJid, () => llmProvider.generateReply(messages));

      // Notify if a fallback provider was used
      const usedFallback = llmProvider.getLastFallbackName?.();
      const finalReply = usedFallback
        ? `_(Respuesta via ${usedFallback} — proveedor principal sin cuota)_\n\n${reply}`
        : reply;

      await sessionStore.appendMessages(remoteJid, [
        { role: "user", content: text },
        { role: "assistant", content: reply }
      ]);

      await safeSend(remoteJid, finalReply, { senderNumber, type: "chat" });

    } catch (error) {
      logger.error({ err: error }, "Message handling failed");
      await safeSend(remoteJid, "❌ Ocurrió un error al procesar tu mensaje.", { senderNumber, type: "error" });
    }
  };
};
