const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Berapa lama QR berlaku sebelum wajib refresh (ms) - biar ga bisa dititip pake screenshot
const QR_ROTATE_MS = 20 * 1000;
// Batas waktu dianggap "Hadir" sebelum jadi "Telat" (menit) sejak sesi dibuka
const BATAS_TELAT_MENIT = 15;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'absensi-digital-secret-key-ganti-jika-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 jam
}));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Kamu harus login dulu' });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).json({ error: 'Akses ditolak untuk role ini' });
    }
    next();
  };
}

/* ---------- AUTH ---------- */

app.post('/api/register', (req, res) => {
  const { nama, nim_nip, email, password, role } = req.body;
  if (!nama || !nim_nip || !email || !password || !role) {
    return res.status(400).json({ error: 'Semua field wajib diisi' });
  }
  if (!['mahasiswa', 'dosen'].includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid' });
  }
  const data = db.read();
  if (data.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Email sudah terdaftar' });
  }
  const user = {
    id: nanoid(10),
    nama,
    nim_nip,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    role
  };
  data.users.push(user);
  db.write(data);
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const data = db.read();
  const user = data.users.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(400).json({ error: 'Email atau password salah' });
  }
  req.session.user = { id: user.id, nama: user.nama, role: user.role, nim_nip: user.nim_nip };
  res.json({ ok: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function cascadeDeleteUser(data, userId) {
  const user = data.users.find(u => u.id === userId);
  if (!user) return;
  if (user.role === 'dosen') {
    const ownedClassIds = data.classes.filter(c => c.dosen_id === userId).map(c => c.id);
    const ownedSessionIds = data.sessions.filter(s => ownedClassIds.includes(s.class_id)).map(s => s.id);
    data.classes = data.classes.filter(c => c.dosen_id !== userId);
    data.members = data.members.filter(m => !ownedClassIds.includes(m.class_id));
    data.sessions = data.sessions.filter(s => !ownedClassIds.includes(s.class_id));
    data.attendance = data.attendance.filter(a => !ownedSessionIds.includes(a.session_id));
  } else {
    data.members = data.members.filter(m => m.user_id !== userId);
    data.attendance = data.attendance.filter(a => a.user_id !== userId);
  }
  data.users = data.users.filter(u => u.id !== userId);
}

// Hapus akun sendiri (dosen atau mahasiswa) - butuh konfirmasi password
app.post('/api/account/delete', requireAuth, (req, res) => {
  const { password } = req.body;
  const data = db.read();
  const user = data.users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'Akun tidak ditemukan' });
  if (!bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(400).json({ error: 'Password salah' });
  }
  cascadeDeleteUser(data, user.id);
  db.write(data);
  req.session.destroy(() => res.json({ ok: true }));
});

// Dosen hapus akun mahasiswa yang terdaftar di salah satu kelasnya
app.delete('/api/users/:id', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const target = data.users.find(u => u.id === req.params.id);
  if (!target || target.role !== 'mahasiswa') return res.status(404).json({ error: 'Mahasiswa tidak ditemukan' });
  const dosenClassIds = data.classes.filter(c => c.dosen_id === req.session.user.id).map(c => c.id);
  const isMyStudent = data.members.some(m => m.user_id === target.id && dosenClassIds.includes(m.class_id));
  if (!isMyStudent) return res.status(403).json({ error: 'Mahasiswa ini bukan anggota kelas kamu' });
  cascadeDeleteUser(data, target.id);
  db.write(data);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

/* ---------- KELAS ---------- */

app.post('/api/classes', requireRole('dosen'), (req, res) => {
  const { nama_kelas, hari, jam_mulai, jam_selesai } = req.body;
  if (!nama_kelas) return res.status(400).json({ error: 'Nama kelas wajib diisi' });
  const data = db.read();
  const kelas = {
    id: nanoid(8),
    nama_kelas,
    dosen_id: req.session.user.id,
    dosen_nama: req.session.user.nama,
    kode: nanoid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X'),
    hari: hari || '',
    jam_mulai: jam_mulai || '',
    jam_selesai: jam_selesai || ''
  };
  data.classes.push(kelas);
  db.write(data);
  res.json({ ok: true, kelas });
});

app.get('/api/classes', requireAuth, (req, res) => {
  const data = db.read();
  if (req.session.user.role === 'dosen') {
    res.json({ classes: data.classes.filter(c => c.dosen_id === req.session.user.id) });
  } else {
    const ids = data.members.filter(m => m.user_id === req.session.user.id).map(m => m.class_id);
    res.json({ classes: data.classes.filter(c => ids.includes(c.id)) });
  }
});

app.post('/api/classes/join', requireRole('mahasiswa'), (req, res) => {
  const { kode } = req.body;
  const data = db.read();
  const kelas = data.classes.find(c => c.kode === (kode || '').toUpperCase().trim());
  if (!kelas) return res.status(404).json({ error: 'Kode kelas tidak ditemukan' });
  if (data.members.find(m => m.class_id === kelas.id && m.user_id === req.session.user.id)) {
    return res.status(400).json({ error: 'Kamu sudah terdaftar di kelas ini' });
  }
  data.members.push({ class_id: kelas.id, user_id: req.session.user.id });
  db.write(data);
  res.json({ ok: true, kelas });
});

app.delete('/api/classes/:id', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const kelas = data.classes.find(c => c.id === req.params.id && c.dosen_id === req.session.user.id);
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  const sesiIds = data.sessions.filter(s => s.class_id === kelas.id).map(s => s.id);
  data.classes = data.classes.filter(c => c.id !== kelas.id);
  data.members = data.members.filter(m => m.class_id !== kelas.id);
  data.sessions = data.sessions.filter(s => s.class_id !== kelas.id);
  data.attendance = data.attendance.filter(a => !sesiIds.includes(a.session_id));
  db.write(data);
  res.json({ ok: true });
});

app.get('/api/classes/:id/members', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const kelas = data.classes.find(c => c.id === req.params.id && c.dosen_id === req.session.user.id);
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  const ids = data.members.filter(m => m.class_id === kelas.id).map(m => m.user_id);
  res.json({ members: data.users.filter(u => ids.includes(u.id)).map(u => ({ id: u.id, nama: u.nama, nim_nip: u.nim_nip })) });
});

/* ---------- SESI & QR ---------- */

app.post('/api/classes/:id/sessions/open', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const kelas = data.classes.find(c => c.id === req.params.id && c.dosen_id === req.session.user.id);
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  const existing = data.sessions.find(s => s.class_id === kelas.id && s.active);
  if (existing) return res.json({ ok: true, session: existing });
  const now = Date.now();
  const sesi = {
    id: nanoid(10),
    class_id: kelas.id,
    token: nanoid(12),
    token_time: now,
    opened_at: now,
    closed_at: null,
    active: true,
    batas_telat: now + BATAS_TELAT_MENIT * 60 * 1000
  };
  data.sessions.push(sesi);
  db.write(data);
  res.json({ ok: true, session: sesi });
});

app.post('/api/classes/:id/sessions/close', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const kelas = data.classes.find(c => c.id === req.params.id && c.dosen_id === req.session.user.id);
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  const sesi = data.sessions.find(s => s.class_id === kelas.id && s.active);
  if (!sesi) return res.status(404).json({ error: 'Tidak ada sesi aktif' });
  sesi.active = false;
  sesi.closed_at = Date.now();
  db.write(data);
  res.json({ ok: true });
});

app.get('/api/classes/:id/session-active', requireAuth, (req, res) => {
  const data = db.read();
  const sesi = data.sessions.find(s => s.class_id === req.params.id && s.active);
  res.json({ session: sesi || null });
});

// Dosen polling endpoint - QR auto rotate tiap QR_ROTATE_MS
app.get('/api/sessions/:id/qr', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const sesi = data.sessions.find(s => s.id === req.params.id);
  if (!sesi || !sesi.active) return res.status(404).json({ error: 'Sesi tidak aktif' });
  const now = Date.now();
  if (now - sesi.token_time > QR_ROTATE_MS) {
    sesi.token = nanoid(12);
    sesi.token_time = now;
    db.write(data);
  }
  res.json({ sid: sesi.id, tok: sesi.token, class_id: sesi.class_id, expires_in: QR_ROTATE_MS - (now - sesi.token_time) });
});

/* ---------- ABSENSI ---------- */

app.post('/api/attendance/scan', requireRole('mahasiswa'), (req, res) => {
  const { sid, tok } = req.body;
  const data = db.read();
  const sesi = data.sessions.find(s => s.id === sid);
  if (!sesi || !sesi.active) return res.status(400).json({ error: 'Sesi sudah ditutup atau QR tidak valid' });
  if (sesi.token !== tok) return res.status(400).json({ error: 'QR sudah kedaluwarsa, coba scan ulang layar' });
  const isMember = data.members.find(m => m.class_id === sesi.class_id && m.user_id === req.session.user.id);
  if (!isMember) return res.status(403).json({ error: 'Kamu tidak terdaftar di kelas ini' });
  const already = data.attendance.find(a => a.session_id === sesi.id && a.user_id === req.session.user.id);
  if (already) return res.status(400).json({ error: 'Kamu sudah absen di sesi ini', status: already.status });
  const now = Date.now();
  const status = now <= sesi.batas_telat ? 'Hadir' : 'Telat';
  const kelas = data.classes.find(c => c.id === sesi.class_id);
  data.attendance.push({ id: nanoid(10), session_id: sesi.id, class_id: sesi.class_id, user_id: req.session.user.id, waktu: now, status });
  db.write(data);
  res.json({ ok: true, status, nama_kelas: kelas ? kelas.nama_kelas : '' });
});

app.get('/api/classes/:id/attendance', requireRole('dosen'), (req, res) => {
  const data = db.read();
  const kelas = data.classes.find(c => c.id === req.params.id && c.dosen_id === req.session.user.id);
  if (!kelas) return res.status(404).json({ error: 'Kelas tidak ditemukan' });
  const sesiList = data.sessions.filter(s => s.class_id === kelas.id).sort((a, b) => b.opened_at - a.opened_at);
  const memberIds = data.members.filter(m => m.class_id === kelas.id).map(m => m.user_id);
  const members = data.users.filter(u => memberIds.includes(u.id));
  const result = sesiList.map(s => {
    const records = data.attendance.filter(a => a.session_id === s.id);
    const detail = members.map(u => {
      const rec = records.find(r => r.user_id === u.id);
      return { user_id: u.id, nama: u.nama, nim_nip: u.nim_nip, status: rec ? rec.status : 'Alpa', waktu: rec ? rec.waktu : null };
    });
    return { session_id: s.id, opened_at: s.opened_at, closed_at: s.closed_at, active: s.active, detail };
  });
  res.json({ nama_kelas: kelas.nama_kelas, sessions: result });
});

// Dosen ubah status manual (izin/sakit/dll)
app.post('/api/attendance/override', requireRole('dosen'), (req, res) => {
  const { session_id, user_id, status } = req.body;
  if (!['Hadir', 'Telat', 'Izin', 'Sakit', 'Alpa'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }
  const data = db.read();
  const sesi = data.sessions.find(s => s.id === session_id);
  if (!sesi) return res.status(404).json({ error: 'Sesi tidak ditemukan' });
  const kelas = data.classes.find(c => c.id === sesi.class_id && c.dosen_id === req.session.user.id);
  if (!kelas) return res.status(403).json({ error: 'Akses ditolak' });
  let rec = data.attendance.find(a => a.session_id === session_id && a.user_id === user_id);
  if (rec) {
    rec.status = status;
  } else {
    data.attendance.push({ id: nanoid(10), session_id, class_id: sesi.class_id, user_id, waktu: Date.now(), status });
  }
  db.write(data);
  res.json({ ok: true });
});

app.get('/api/mahasiswa/attendance', requireRole('mahasiswa'), (req, res) => {
  const data = db.read();
  const records = data.attendance
    .filter(a => a.user_id === req.session.user.id)
    .map(a => {
      const kelas = data.classes.find(c => c.id === a.class_id);
      return { kelas: kelas ? kelas.nama_kelas : '-', waktu: a.waktu, status: a.status };
    })
    .sort((a, b) => b.waktu - a.waktu);
  res.json({ records });
});

app.listen(PORT, () => console.log(`Absensi Digital jalan di http://localhost:${PORT}`));
