import express from "express";
import qrcode from "qrcode";
import { logger } from "../utils/logger.js";

export const startWebServer = (eventEmitter, port = 3000) => {
  const app = express();
  let currentStatus = "connecting";
  let currentQr = null;

  eventEmitter.on("status", (status) => {
    currentStatus = status;
    if (status !== "qr") {
      currentQr = null;
    }
  });

  eventEmitter.on("qr", async (qrString) => {
    currentStatus = "qr";
    try {
      currentQr = await qrcode.toDataURL(qrString);
    } catch (err) {
      logger.error("Error generating QR code data URL", err);
    }
  });

  app.get("/", (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ayudante WhatsApp Bot</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
    body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      color: #fff;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      overflow: hidden;
    }
    .container {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 40px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      max-width: 400px;
      width: 90%;
      transition: all 0.3s ease;
    }
    h1 {
      margin-top: 0;
      font-size: 24px;
      font-weight: 800;
      background: -webkit-linear-gradient(45deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .status-badge {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 9999px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 24px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-connecting { background: rgba(234, 179, 8, 0.2); color: #fde047; border: 1px solid rgba(234, 179, 8, 0.5); }
    .status-qr { background: rgba(56, 189, 248, 0.2); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.5); }
    .status-open { background: rgba(34, 197, 94, 0.2); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.5); }
    .status-close { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.5); }
    
    .qr-container {
      background: white;
      padding: 16px;
      border-radius: 16px;
      display: inline-block;
      margin: 0 auto 24px auto;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    }
    .qr-container img {
      display: block;
      max-width: 250px;
      height: auto;
    }
    .hidden { display: none !important; }
    p.instruction {
      color: #94a3b8;
      font-size: 14px;
      line-height: 1.5;
      margin: 0;
    }
    .loader {
      border: 4px solid rgba(255,255,255,0.1);
      border-top: 4px solid #38bdf8;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 24px auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Ayudante WhatsApp</h1>
    <div id="statusBadge" class="status-badge status-connecting">Conectando...</div>
    
    <div id="loader" class="loader"></div>
    
    <div id="qrContainer" class="qr-container hidden">
      <img id="qrImage" src="" alt="QR Code" />
    </div>
    
    <p id="instruction" class="instruction">Iniciando el servidor de WhatsApp, por favor espera...</p>
  </div>

  <script>
    const statusBadge = document.getElementById('statusBadge');
    const loader = document.getElementById('loader');
    const qrContainer = document.getElementById('qrContainer');
    const qrImage = document.getElementById('qrImage');
    const instruction = document.getElementById('instruction');

    const updateUI = (status, qrData) => {
      statusBadge.className = 'status-badge status-' + status;
      
      if (status === 'connecting') {
        statusBadge.textContent = 'CONECTANDO';
        loader.classList.remove('hidden');
        qrContainer.classList.add('hidden');
        instruction.textContent = 'Iniciando el servidor de WhatsApp, por favor espera...';
      } else if (status === 'qr') {
        statusBadge.textContent = 'ESPERANDO ESCANEO';
        loader.classList.add('hidden');
        qrContainer.classList.remove('hidden');
        if (qrData) qrImage.src = qrData;
        instruction.textContent = 'Abre WhatsApp en tu teléfono, ve a Dispositivos vinculados y escanea este código.';
      } else if (status === 'open') {
        statusBadge.textContent = 'CONECTADO';
        loader.classList.add('hidden');
        qrContainer.classList.add('hidden');
        instruction.textContent = '¡El bot está en línea y listo para recibir mensajes!';
      } else if (status === 'close') {
        statusBadge.textContent = 'DESCONECTADO';
        loader.classList.add('hidden');
        qrContainer.classList.add('hidden');
        instruction.textContent = 'La conexión se cerró. Intentando reconectar...';
      }
    };

    const evtSource = new EventSource("/stream");
    evtSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateUI(data.status, data.qr);
    };
  </script>
</body>
</html>
    `);
  });

  app.get("/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendUpdate = (status, qr) => {
      res.write(`data: ${JSON.stringify({ status, qr })}\n\n`);
    };

    sendUpdate(currentStatus, currentQr);

    const onStatus = (status) => sendUpdate(status, currentQr);
    const onQr = async (qrString) => {
      try {
        const qrUrl = await qrcode.toDataURL(qrString);
        sendUpdate("qr", qrUrl);
      } catch (err) {}
    };

    eventEmitter.on("status", onStatus);
    eventEmitter.on("qr", onQr);

    req.on("close", () => {
      eventEmitter.removeListener("status", onStatus);
      eventEmitter.removeListener("qr", onQr);
    });
  });

  app.listen(port, "0.0.0.0", () => {
    logger.info(`Servidor web escuchando en http://0.0.0.0:${port}`);
  });
};
