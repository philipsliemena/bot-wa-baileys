// Load environment variables from .env file
require('dotenv').config();

// Import required modules from Baileys and supporting packages
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const axios = require('axios');
const { Boom } = require('@hapi/boom');
const fs = require('fs');

// Inisialisasi express app
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// Ambil nomor dari environment variable PHONE, default fallback jika tidak ada
const nomor = process.env.PHONE || '6281234567890';

// Tentukan folder penyimpanan sesi berdasarkan nomor
const SESSION_FOLDER = `auth_${nomor}`;

// URL webhook tujuan (n8n listener)
const WEBHOOK_URL = "https://n8n-liemena.onrender.com/webhook/whatsapp-in";

let sock;
const lastMessageIds = new Set(); // Untuk mencegah balasan ganda

// Alias Map - untuk menghubungkan nomor WA dengan nama alias
const aliasMap = {
  '628164851879@s.whatsapp.net': 'OWNER ERA',
  '6285678901234@s.whatsapp.net': 'ADMIN BACKUP'
};

// Endpoint untuk UptimeRobot atau cek status bot
app.get("/", (req, res) => {
  res.status(200).send("Bot WhatsApp aktif");
});

// Fungsi utama untuk memulai koneksi WhatsApp
const startSock = async () => {
  // Load sesi autentikasi
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);

  // Buat koneksi WhatsApp dengan konfigurasi
  sock = makeWASocket({
    auth: state,
    browser: ['Ubuntu', 'Chrome', '22.04'], // Info user-agent yang digunakan
    connectTimeoutMs: 60_000,
    markOnlineOnConnect: true,
    printQRInTerminal: true // Cetak QR ke terminal saat belum login
  });

  // Event handler koneksi
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan QR ini untuk login:\n" + qr);
    }

    if (connection === 'open') {
      console.log("Bot terkoneksi ke WhatsApp");
    }

    if (connection === 'close') {
      // Tangani penyebab koneksi tertutup
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

  // Simpan sesi ke folder saat diperbarui
  sock.ev.on('creds.update', saveCreds);

  // Kirim presence update tiap 5 menit agar sesi tidak dianggap idle
  setInterval(() => {
    sock.sendPresenceUpdate('available');
  }, 1000 * 60 * 5);

  // Tangani pesan masuk
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    const msgId = msg.key?.id;

    // Skip pesan dari bot sendiri atau duplikat
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

    // Cari alias dari nomor pengirim
    const alias = aliasMap[pengirim] || pengirim;
    console.log(`Pesan dari: ${alias} | Isi: ${isiPesan}`);

    // Kirim data pesan ke webhook n8n
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

// Endpoint manual untuk mengirim pesan ke nomor WA dari API eksternal
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

// Mulai server dan koneksi WhatsApp
app.listen(PORT, () => {
  console.log(`Server aktif di port ${PORT}`);
  startSock();
});
