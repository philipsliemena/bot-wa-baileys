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

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    if (msg.key.fromMe) return; // Mencegah loop balasan dari bot sendiri

    const pengirim = msg.key.participant || msg.key.remoteJid;
    const isGroup = msg.key.remoteJid.endsWith('@g.us');
    const isiPesan = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     'Pesan tidak dikenali';

    try {
      await axios.post(N8N_WEBHOOK_URL, {
        from: pengirim,
        message: isiPesan,
        group: isGroup,
        group_id: isGroup ? msg.key.remoteJid : null,
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error(" Gagal kirim ke webhook n8n:", err.message);
    }

    const balasan = `Pesan diterima: "${isiPesan}"`;
    await sock.sendMessage(msg.key.remoteJid, { text: balasan });
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
    console.error(" Gagal kirim pesan:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(` Server aktif di port ${PORT}`);
  startSock();
});