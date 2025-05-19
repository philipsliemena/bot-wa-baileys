const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const { Boom } = require('@hapi/boom');
const { DisconnectReason } = require('@whiskeysockets/baileys');

const N8N_WEBHOOK_URL = "https://n8n-liemena.onrender.com/webhook/whatsapp-in"; // Ganti dengan webhook kamu
const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.json()); // penting agar bisa menerima JSON body dari n8n

let sock;

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('session');

  sock = makeWASocket({
    auth: state
  });

  // Listener QR code (print ke terminal manual)
  
  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) {
      console.log("\nScan QR ini dengan WhatsApp kamu:\n");
      console.log(qr);
    }

    if (connection === 'open') {
      console.log("Bot berhasil login ke WhatsApp!");
    }

    //if (connection === 'close') {
    //  console.log("Koneksi terputus. Mencoba ulang...");
    //  startSock(); // reconnect otomatis
    //}

    if (connection === 'close') {
    //  const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const reason = new Boom(update.lastDisconnect?.error)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("Koneksi terputus. Reconnecting...");
        startSock();
      } else {
        console.log("Bot logged out permanen. Harus scan QR ulang.");
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const pengirim = msg.key.participant || msg.key.remoteJid;
    const isGroup = msg.key.remoteJid.endsWith("@g.us");
    const isiPesan = msg.message?.conversation ||
                     msg.message?.extendedTextMessage?.text ||
                     "Pesan tidak dikenali";

    // Kirim ke webhook n8n
    
    await axios.post(N8N_WEBHOOK_URL, {
      from: pengirim,
      message: isiPesan,
      group: isGroup,
      group_id: isGroup ? msg.key.remoteJid : null,
      timestamp: new Date().toISOString()
    });

    // Auto-reply
    const balasan = `Auto-reply dari bot: "${isiPesan}" diterima.`;
    await sock.sendMessage(msg.key.remoteJid, { text: balasan });
  });
};

// Endpoint untuk menerima balasan dari n8n
app.post('/send', async (req, res) => {
  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: 'Field `to` dan `message` wajib diisi' });
  }

  try {
    await sock.sendMessage(to, { text: message });
    res.status(200).json({ status: 'sent', to, message });
  } catch (err) {
    console.error("Gagal kirim balasan:", err.message);
    res.status(500).json({ error: err.message });
  }
});

startSock();

app.get("/", (req, res) => {
  res.send("Bot WhatsApp aktif!");
});
app.listen(PORT, () => console.log(`Server aktif di port ${PORT}`));