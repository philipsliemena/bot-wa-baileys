const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const axios = require("axios");
const express = require("express");
const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());

const webhookUrl = "https://n8n-liemena.onrender.com/webhook/whatsapp-in";

const { state, saveState } = useSingleFileAuthState("./auth_info.json");
let lastMessageIds = new Set();

async function startSock() {
  const sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    logger: pino({ level: "silent" }),
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("Scan QR ini untuk login:\n" + qr);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        console.log("Bot logout. Hapus sesi dan scan ulang QR.");
        const fs = require("fs");
        if (fs.existsSync("./auth_info.json")) fs.unlinkSync("./auth_info.json");
      }

      console.log("Koneksi terputus. Mencoba reconnect...");
      startSock();
    } else if (connection === "open") {
      console.log("Bot terkoneksi ke WhatsApp!");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const messageId = msg.key.id;
    if (lastMessageIds.has(messageId)) return;
    lastMessageIds.add(messageId);
    if (lastMessageIds.size > 100) {
      const oldest = Array.from(lastMessageIds).slice(0, 50);
      oldest.forEach((id) => lastMessageIds.delete(id));
    }

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith("@g.us");
    const sender = isGroup ? msg.key.participant : from;
    const pesan = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "Pesan tidak dikenali";

    try {
      await axios.post(webhookUrl, {
        from: sender,
        message: pesan,
        group: isGroup,
        group_id: isGroup ? from : null,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error("Gagal kirim ke webhook:", err.message);
    }
  });

  sock.ev.on("creds.update", saveState);
}

startSock();

app.post("/send", async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "Field `to` dan `message` wajib diisi" });
  }

  try {
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });
    await sock.sendMessage(to, { text: message });
    res.json({ success: true });
  } catch (err) {
    console.error("Gagal mengirim:", err.message);
    res.status(500).json({ error: "Gagal mengirim pesan" });
  }
});

app.listen(port, () => {
  console.log("Server aktif di port", port);
});
