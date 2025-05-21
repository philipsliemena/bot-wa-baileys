// Load environment variables from .env file
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

const nomor = process.env.PHONE || '6281234567890';
const SESSION_FOLDER = `auth_${nomor}`;
const WEBHOOK_URL = "https://n8n-liemena.onrender.com/webhook/whatsapp-in";

let sock;
const lastMessageIds = new Set();

const aliasMap = {
  '628164851879@s.whatsapp.net': 'ICONNESIA 1',
  '6287833574761@s.whatsapp.net': 'ADMIN ICONNESIA'
};

app.get("/", (req, res) => {
  res.status(200).send("Bot WhatsApp aktif");
});

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

  sock = makeWASocket({
    auth: state,
    browser: ['Ubuntu', 'Chrome', '22.04'],
    connectTimeoutMs: 60_000,
    markOnlineOnConnect: true
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("QR Code String (copy-paste untuk convert):", qr);
      const qrcode = require('qrcode-terminal');
      qrcode.generate(qr, { small: true });
      console.log("Silakan scan QR di atas untuk login.");
    }

    if (connection === 'open') {
      console.log("Bot terkoneksi ke WhatsApp");
    }

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      switch (reason) {
        case DisconnectReason.loggedOut:
          console.log("Bot logout. Sesi dihapus. Harus scan QR ulang.");
          fs.rmSync(SESSION_FOLDER, { recursive: true, force: true });
          break;
        case DisconnectReason.connectionReplaced:
          console.log("Sesi digantikan oleh perangkat lain.");
          break;
        default:
          console.log("Koneksi terputus. Mencoba reconnect...");
          startSock();
          break;
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  setInterval(() => {
    sock.sendPresenceUpdate('available');
  }, 1000 * 60 * 5);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    const msgId = msg.key?.id;

    if (!msg.message || msg.key.fromMe || lastMessageIds.has(msgId)) return;
    lastMessageIds.add(msgId);
    if (lastMessageIds.size > 100) {
      const oldest = Array.from(lastMessageIds).slice(0, 50);
      oldest.forEach((id) => lastMessageIds.delete(id));
    }

    const pengirim = msg.key.participant || msg.key.remoteJid;
    const isGroup = msg.key.remoteJid.endsWith('@g.us');
    const isiPesan = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     'Pesan tidak dikenali';

    const alias = aliasMap[pengirim] || pengirim;
    console.log(`Pesan dari: ${alias} | Isi: ${isiPesan}`);

    try {
      await axios.post(WEBHOOK_URL, {
        from: pengirim,
        alias: alias,
        message: isiPesan,
        group: isGroup,
        group_id: isGroup ? msg.key.remoteJid : null,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("Gagal kirim ke webhook n8n:", err.message);
    }
  });
};

app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Field `to` dan `message` wajib diisi' });
  }

  try {
    await sock.sendMessage(to, { text: message });
    res.status(200).json({ status: 'sent', to, message });
  } catch (err) {
    console.error("Gagal kirim pesan:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server aktif di port ${PORT}`);
  startSock();
});
