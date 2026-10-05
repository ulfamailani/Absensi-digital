# Absensi Digital

Web absensi mahasiswa berbasis QR code. Dosen buka sesi kelas → QR muncul di layar (auto-refresh tiap 20 detik biar ga bisa dititip absen pakai screenshot) → mahasiswa scan pakai kamera HP → status "Hadir"/"Telat" otomatis tercatat.

## Cara menjalankan

1. Pastikan sudah install **Node.js** (versi 18 ke atas).
2. Buka terminal di folder ini, lalu jalankan:
   ```
   npm install
   node server.js
   ```
3. Buka `http://localhost:3000` di browser.

Kalau `node_modules` sudah ikut ter-include di folder ini, kamu bisa lewati langkah `npm install` dan langsung `node server.js`.

## Deploy supaya bisa diakses dari HP mahasiswa

Kamera HP butuh koneksi **HTTPS** (atau `localhost`) untuk bisa diakses lewat browser — ini pembatasan standar browser, bukan dari aplikasi ini. Jadi kalau mau demo pakai HP asli:

- **Paling gampang untuk demo/tugas:** pakai [ngrok](https://ngrok.com) — jalankan `ngrok http 3000`, lalu buka link HTTPS yang diberikan dari HP.
- **Untuk pemakaian jangka panjang:** deploy ke layanan seperti Railway, Render, atau VPS dengan domain + SSL.

## Alur pemakaian

**Dosen:**
1. Daftar akun dengan role "Dosen".
2. Klik "Buat kelas" → catat kode kelas yang muncul (6 karakter).
3. Bagikan kode itu ke mahasiswa (lewat grup WA, misalnya).
4. Saat jam kelas, klik "Buka sesi absen" → tampilkan QR ini di layar/proyektor kelas.
5. Mahasiswa yang datang tinggal scan QR pakai HP masing-masing.
6. Klik "Tutup sesi" setelah selesai. Status kehadiran bisa diubah manual di tabel rekap (misal jadi "Izin"/"Sakit").

**Mahasiswa:**
1. Daftar akun dengan role "Mahasiswa".
2. Klik "Gabung kelas" → masukkan kode dari dosen.
3. Saat kelas ada sesi aktif, tombol "Scan absen" akan muncul di kartu kelas.
4. Klik tombol itu, izinkan akses kamera, arahkan ke QR di layar kelas.

## Struktur project

```
server.js       -> semua route API (auth, kelas, sesi, absensi)
db.js           -> penyimpanan data sederhana (file data.json, otomatis dibuat)
public/         -> semua halaman frontend (HTML/CSS/JS polos, tanpa framework)
```

## Catatan teknis

- Data disimpan di `data.json` (dibuat otomatis saat pertama kali jalan). Untuk skala lebih besar / production, ganti `db.js` dengan koneksi ke database sungguhan (MySQL/PostgreSQL).
- QR encode `{sid, tok}` (ID sesi + token acak) dan token berubah tiap 20 detik selama sesi aktif — ini mencegah orang titip absen pakai screenshot QR lama.
- Status "Telat" otomatis diberikan kalau mahasiswa scan lebih dari 15 menit setelah sesi dibuka (bisa diubah di `BATAS_TELAT_MENIT` pada `server.js`).
