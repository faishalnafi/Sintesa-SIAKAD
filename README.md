# SINTESA — SIMAK

**Sistem Informasi Akademik Terpadu Sekolah (SMAN 3 Mojokerto)**  
Versi Rilis Saat Ini: **`v01.07.01`** (`version_code: 171`)

Monorepo full-stack modern untuk pengelolaan akademik sekolah secara terpadu, real-time, dan terintegrasi penuh dengan **NEBULA AI (Asisten AI Guru)**, **Kredensia SSO**, **GDS (Gerakan Disiplin Sekolah)**, dan **PASTI (Sistem Kehadiran Siswa)**.

---

## 🛠️ Tech Stack

| Layer | Teknologi |
| --- | --- |
| **Package Manager** | `pnpm` workspaces (Monorepo) |
| **Frontend (`apps/web`)** | React 19, TypeScript, Vite 6, Tailwind CSS, Zustand, React Router v7, SheetJS (`xlsx`), SweetAlert2 |
| **Backend (`apps/api`)** | Node.js, Hono, TypeScript, Zod, `jose` (JWT Cookie Session), `pdfkit` (Raport PDF), `adm-zip` (In-App Updater), Server-Sent Events (SSE Realtime) |
| **AI Engine (NEBULA AI)** | 9Router Gateway LLM API (`https://llm.faishalnafi.com/v1`), Gemini 3.5 Flash-lite / 3.1 / 2.0 Flash, Multimodal Streaming |
| **Cloud Storage Proxy** | AWS S3 / Cloudflare R2 / Google Cloud Storage (GCS) / MinIO Generic Object Storage |
| **Database** | PostgreSQL + Drizzle ORM |
| **Integrasi Eksternal** | Kredensia SSO IdP, Aplikasi GDS (Poin Ketertiban), Aplikasi PASTI (Presensi Kehadiran) |

---

## ✨ Fitur Utama

### 1. NEBULA AI — Asisten AI Guru & Akademik (`/guru/ai`)
- **Dual-Sidebar Roomchat Interaktif**: Pengelolaan sesi obrolan mandiri yang terisolasi ketat per akun guru.
- **Multimodal & Drag-Drop Media**: Mendukung unggah gambar, dokumen, serta berkas spreadsheet/PDF yang otomatis di-streaming melalui Cloud Object Storage proxy.
- **AI Tool Calling & Automasi Tugas**:
  - **Ekspor Excel Otomatis**: Perintah pembuatan Rekap Jurnal dan Buku Leger Nilai langsung dari obrolan AI.
  - **Kirim / Submit Draft**: Aksi cerdas pengiriman draft jurnal maupun draft nilai siswa (`SEND_GRADE_DRAFT`, `SEND_JOURNAL_DRAFT`) dengan pemahaman bahasa alami (NLP) termasuk rentang kelas (contoh: *"XII-1 sampai XII-5"*).
  - **Penjadwalan Otomatis (AI Scheduler)**: Penjadwalan eksekusi tugas di masa mendatang yang tersimpan aman pada tabel database `ai_scheduled_jobs`.
- **Integrasi Konteks Data Guru**: AI mengenali jadwal mengajar, daftar siswa, rekap presensi PASTI, dan catatan pelanggaran GDS secara real-time.

### 2. Pusat Unduhan & Pemberkasan (`/admin/monitoring-jurnal?section=unduhan`, `/guru?section=unduhan`)
Modul terintegrasi untuk mencetak dan mengunduh laporan Excel (`.xlsx`) resmi berstandar administrasi sekolah:
- **Modul #1 — Rekap Monitoring Jurnal Mengajar Guru (`.xlsx`)**:
  - Filter rentang waktu instan: *Hari Ini*, *1 Pekan (Senin–Sabtu)*, *1 Bulan Penuh*, *Semua Tanggal*, atau *Rentang Tanggal Kustom*.
  - Filter spesifik per Rombel dan per Guru Pengajar.
  - Opsi menampilkan jam mengajar yang belum terisi jurnal serta format kop surat dan lembar pengesahan resmi.
- **Modul #2 — Buku Leger Nilai Rombel & Rekap Nilai Mapel (`.xlsx`)**:
  - **Buku Leger Kelas (Seluruh Mapel)**: Menghasilkan 3 lembar kerja (*Sheet*) sekaligus — *Leger Nilai Akhir & Rata-rata*, *Rincian Komponen Nilai (UH1, T1, STS, UH2, T2)*, dan *Matriks Status Pengumpulan Nilai*.
  - **Rekap Nilai Spesifik per Mata Pelajaran**.
  - Filter status nilai (*Approved*, *Submitted*, *Draft*) beserta tabel pratinjau data interaktif.
- **Modul Rekap Presensi & GDS**: Cetak data kehadiran siswa bersumber dari aplikasi PASTI dan rekap poin ketertiban GDS.

### 3. Monitoring Jurnal Mengajar (`/admin/monitoring-jurnal`)
- **Mode Filter Ganda (Per Guru & Per Kelas)**: Menampilkan keterisian jurnal kegiatan belajar mengajar harian secara fleksibel berdasarkan rombel maupun guru pengampu.
- **Tampilan Jam Lengkap Tanpa Timpa Data**: Menampilkan seluruh jam pelajaran yang terjadwal. Jika terdapat lebih dari satu jurnal pada jam yang sama (lintas kelas/mapel), seluruh baris tetap tersaji utuh tanpa saling menggantikan.
- **Koreksi Ulang & Manajemen Jurnal**: Fitur pengembalian status jurnal dari *Terkirim* ke *Draft* agar dapat diperbaiki oleh guru, serta opsi edit materi/presensi dan soft-delete oleh administrator.

### 4. Portal Penilaian Guru & Wali Kelas
- **Input Nilai Akademik (`/guru`)**:
  - Pengisian nilai per komponen penilaian aktif dengan fitur **Simpan Draft** (`upsert`) dan **Kirim Nilai** ke Wali Kelas.
  - **Template Nilai Excel Anti-Sharing (`.xlsx`)**:
    - File template unduhan dilengkapi tanda tangan digital (*metadata*) unik yang terikat pada Guru, Rombel, dan Mata Pelajaran.
    - Validasi kepemilikan file saat unggah untuk mencegah kesalahan input antar guru.
- **Jurnal Mengajar Harian (`/guru?section=jurnal`)**: Pencatatan ringkasan materi dan kehadiran siswa per jam pertemuan.
- **Matrix Persetujuan Wali Kelas (`/walikelas`)**: Pemeriksaan kelengkapan nilai seluruh mapel kelas perwalian, persetujuan (*Approve*), atau pembatalan persetujuan nilai.

### 5. Portal Siswa & Orang Tua
- **Beranda Siswa (`/siswa`)**: Informasi kelas aktif, rekapitulasi kehadiran (*Sakit*, *Izin*, *Alpa* terintegrasi dengan PASTI), dan saldo **Poin GDS**.
- **Raport Nilai & Unduh Raport PDF (`/siswa/raport`)**: Tampilan nilai akademik lengkap dan tombol **Unduh Raport (PDF)** format A4 standar resmi.

### 6. Pengaturan Sistem, Keamanan & In-App Updater
- **Pembaruan Aplikasi Satu Klik (`/admin/integrations?section=update`)**:
  - Unggah dan instal paket berkas `update_simak_v{versi}.zip` langsung dari panel Superadmin.
  - Migrasi skema database otomatis dan aman tanpa menghapus data yang ada.
- **Otentikasi & SSO Kredensia**:
  - Login SSO satu klik dengan sinkronisasi pengguna dan *roster* kelas (*JIT Provisioning*).
  - Portal login manual khusus admin (`/office`).
  - Penanganan status sidebar minimize yang rapi dengan tooltip navigasi dan tombol keluar.
- **Pencadangan & Tempat Sampah (`/admin/integrations?section=backup`, `/admin/trash`)**: Ekspor/impor cadangan data JSON serta pemulihan data *soft-delete*.

---

## 👥 Matriks Peran (Roles)

| Kode Role | Akses Login | Deskripsi & Hak Akses |
| --- | --- | --- |
| `superadmin` | Ya | Akses menyeluruh seluruh modul sistem, integrasi AI & Cloud Storage, tempat sampah, dan *In-App Updater* |
| `admin` | Ya | Manajemen pengguna, rombel, mapel, monitoring jurnal, dan Pusat Unduhan |
| `walikelas` | Ya | Matrix persetujuan nilai kelas binaan, input nilai, jurnal guru, dan Pusat Unduhan |
| `guru` | Ya | Asisten NEBULA AI, input nilai (ekspor/impor Excel), jurnal mengajar, dan Pusat Unduhan pribadi |
| `tendik` | Ya | Tenaga kependidikan |
| `siswa` / `ortu` | Ya | Pemantauan kehadiran, poin kedisiplinan GDS, dan unduh raport PDF |
| `alumni` | Ya | Akses arsip kelulusan (`kelas_label = ALUMNI`) |
| `keluar` | **Diblokir** | Siswa mutasi keluar — riwayat arsip tersimpan, hak login dinonaktifkan |

---

## 🚀 Panduan Instalasi & Pengembangan Lokal

### Prasyarat
- **Node.js** >= 20
- **pnpm** >= 10
- **PostgreSQL** >= 15

### Langkah Setup

```bash
# 1. Clone repositori
git clone https://github.com/faishalnafi/Sintesa-SiAkad.git
cd Sintesa-SiAkad
git checkout simak-ai

# 2. Instal seluruh dependencies monorepo
pnpm install

# 3. Konfigurasi Environment (.env)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Isi variabel DATABASE_URL, JWT_SECRET, SSO_*, GEMINI_*, dan S3_* pada apps/api/.env

# 4. Migrasi & Seed Database
pnpm db:migrate
pnpm db:seed

# 5. Jalankan Aplikasi (API & Web Dev Server)
pnpm dev
```

- **Frontend Web**: `http://localhost:5174` (atau `http://localhost:5173`)
- **Backend API**: `http://localhost:3001`

---

## 📦 Membangun Paket Update Produksi (`.ZIP`)

Untuk membuat paket rilis pembaruan produksi yang siap diunggah melalui menu **Admin > Update & Integrasi**:

```powershell
# 1. Kompilasi frontend & backend
npm --prefix apps/api run build
npm --prefix apps/web run build

# 2. Buat paket ZIP otomatis
.\make-deploy-zip.ps1
```

Script akan menghasilkan berkas **`update_simak_v{versi}.zip`** (contoh: `update_simak_v01.07.01.zip`) dan **`deploy.zip`** dengan hierarki file yang siap diekstrak oleh sistem pembaruan otomatis.

---

## 📋 Riwayat Rilis Terbaru

- **`v01.07.01` (2026-10-08)**:
  - Integrasi 9Router Gateway LLM API (`https://llm.faishalnafi.com/v1`, Gemini 3.5 Flash-lite / 3.1) dan DNS IPv4 first.
  - Peningkatan Monitoring Jurnal Mengajar: Filter mode Per Kelas / Per Guru dan penampilan seluruh jam mengajar tanpa tertimpa data ganda.
  - Penambahan eksekusi action AI untuk pengiriman draft nilai (`SEND_GRADE_DRAFT`) dan deteksi rentang rombel.
  - Optimasi fleksibilitas ekstraksi klaim SSO Kredensia dan perbaikan tata letak tombol keluar saat sidebar diminimalkan.
- **`v01.07.00` (2026-10-02)**:
  - Rilis modul **Pusat Unduhan & Pemberkasan** terpadu untuk Rekap Jurnal Mengajar dan Buku Leger Nilai Akademik (.xlsx).
  - Penjadwal Otomatis AI (AI Scheduler) terintegrasi pada tabel `ai_scheduled_jobs`.
  - Penyatuan menu Update & Backup ke dalam menu terpadu **Update & Integrasi**.
- **`v01.06.00` (2026-10-02)**:
  - Standarisasi penomoran versi 2 digit (`xx.yy.zz`) dan optimasi impor/ekspor nilai Excel guru.

---

## 📄 Lisensi
Hak Cipta © 2026 SMAN 3 Mojokerto. Seluruh hak cipta dilindungi undang-undang.
