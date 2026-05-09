import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { env } from "../config/env.js";

const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts (or restarts) the WhatsApp socket with exponential backoff on
 * disconnection. Reconnect attempts reset automatically when a connection
 * is successfully established.
 *
 * @param {object} opts
 * @param {string} opts.authDir
 * @param {import("pino").Logger} opts.logger
 * @param {Function} opts.createMessageUpsertHandler
 * @param {{ attempts: number }} [opts._reconnectState] internal – do not set manually
 */
export const startWhatsappSocket = async ({
  authDir,
  logger,
  createMessageUpsertHandler,
  _reconnectState = { attempts: 0 }
}) => {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: logger.child({ level: "warn" }),
    printQRInTerminal: true
  });

  const onMessagesUpsert = createMessageUpsertHandler({ sock });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", onMessagesUpsert);
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) logger.info("Nuevo QR generado. Escanealo desde WhatsApp.");
    if (connection === "connecting") logger.info("Conectando a WhatsApp...");

    if (connection === "open") {
      logger.info("Conexion de WhatsApp abierta.");
      _reconnectState.attempts = 0; // reset on success
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn({ statusCode, shouldReconnect }, "Conexion cerrada");

      if (!shouldReconnect) {
        logger.error("Sesion cerrada. Debes volver a escanear el QR.");
        return;
      }

      _reconnectState.attempts += 1;
      const maxAttempts = env.maxReconnectAttempts;

      if (_reconnectState.attempts > maxAttempts) {
        logger.error(
          { attempts: _reconnectState.attempts },
          "Maximo de intentos de reconexion alcanzado. Reinicia el bot manualmente."
        );
        return;
      }

      const delay = Math.min(
        BASE_DELAY_MS * Math.pow(2, _reconnectState.attempts - 1),
        MAX_DELAY_MS
      );
      logger.info(
        { attempt: _reconnectState.attempts, maxAttempts, delayMs: delay },
        "Reconectando con backoff exponencial..."
      );
      await sleep(delay);

      await startWhatsappSocket({
        authDir,
        logger,
        createMessageUpsertHandler,
        _reconnectState
      });
    }
  });

  return sock;
};
