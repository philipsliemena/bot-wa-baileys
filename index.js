const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const { Boom } = require('@hapi/boom');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const N8N_WEBHOOK_URL = "https://n8n-liemena.onrender.com/webhook/whatsapp-in"; // Ganti sesuai endpoint kamu
let sock;

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('session');

  sock = makeWASocket({
    auth: state
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n Scan QR ini untuk login:\n" + qr);
    }

    if (connection === 'open') {
      console.log(" Bot terkoneksi ke WhatsApp!");
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      switch (reason) {
        case DisconnectReason.loggedOut:
          console.log(" Bot logout. Hapus sesi dan scan ulang QR.");
          const fs = require('fs');
          fs.rmSync('./session', { recursive: true, force: true });
          startSock();
          break;
        case DisconnectReason.connectionReplaced:
          console.log(" Instansi lain login ke akun ini. Bot dihentikan.");
          break;
        case DisconnectReason.connectionClosed:
        case DisconnectReason.connectionLost:
        case DisconnectReason.timedOut:
        case DisconnectReason.restartRequired:
          console.log(" Koneksi terputus. Mencoba reconnect...");
          startSock();
          break;
        default:
          console.log(" Koneksi terputus: ", lastDisconnect?.error);
          startSock();
          break;
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return; // <- INI WAJIB: cegah balas pesan sendiri
  
    const sender = msg.key.remoteJid;
    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
  
    console.log("Pesan diterima:", content);
  
    // Proses kirim ke webhook n8n
    try {
      const res = await axios.post(process.env.N8N_WEBHOOK_URL, {
        from: sender,
        message: content,
        group: sender.includes("@g.us"),
        group_id: sender.includes("@g.us") ? sender : null,
        timestamp: new Date().toISOString(),
      });
  
      const balasan = res.data?.message || "Terima kasih!";
      await sock.sendMessage(sender, { text: balasan });
    } catch (error) {
      console.error("Gagal kirim ke webhook:", error.message);
    }
  });

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Field `to` dan `message` wajib diisi' });
  }

  try {
    await sock.sendMessage(to, { text: message });
    res.status(200).json({ status: 'sent', to, message });
  } catch (err) {
    console.error(" Gagal kirim pesan:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(` Server aktif di port ${PORT}`);
  startSock();
});