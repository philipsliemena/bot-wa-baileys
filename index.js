const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const P = require("pino");
const express = require("express");
const axios = require("axios");
const app = express();
const port = process.env.PORT || 10000;
app.use(express.json());

const { state, saveState } = useSingleFileAuthState("./session/auth_info.json");

async function startSock() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: P({ level: "silent" }),
    generateHighQualityLinkPreview: true
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Koneksi terputus. Reconnecting?", shouldReconnect);
      if (shouldReconnect) startSock();
    } else if (connection === "open") {
      console.log("✅ Bot terhubung ke WhatsApp");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || !messages[0]?.message) return;

    const msg = messages[0];
    const from = msg.key.remoteJid;
    const isGroup = msg.key.participant !== undefined;
    const sender = isGroup ? msg.key.participant : from;
    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

    if (!content) return;

    // Log untuk debug
    console.log("Pesan diterima:", content);

    // Jangan balas jika pesan dari bot sendiri
    if (msg.key.fromMe) return;

    try {
      const response = await axios.post("https://n8n-liemena.onrender.com/webhook/whatsapp-in", {
        from,
        message: content,
        group: isGroup,
        group_id: isGroup ? from : null,
        timestamp: new Date().toISOString()
      });

      const { message: reply } = response.data;
      if (reply) {
        await sock.sendMessage(from, { text: reply });
      }
    } catch (err) {
      console.error("Gagal memproses pesan:", err.message);
    }
  });

  sock.ev.on("creds.update", saveState);
}

// Jalankan bot
startSock();

// Endpoint untuk menerima balasan dari n8n
app.post("/send", async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "Field `to` dan `message` wajib diisi" });
  }

  try {
    const result = await sendMessageToWhatsApp(to, message);
    res.json({ status: "sent", result });
  } catch (err) {
    console.error("Gagal kirim pesan:", err.message);
    res.status(500).json({ error: "Gagal kirim pesan" });
  }
});

async function sendMessageToWhatsApp(to, message) {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" })
  });
  return await sock.sendMessage(to, { text: message });
}

// Jalankan server
app.listen(port, () => {
  console.log(`Server aktif di port ${port}`);
});
