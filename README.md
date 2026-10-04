# SINTESA — SIAKAD

**Sistem Informasi Akademik Terpadu Sekolah (SMAN 3 Mojokerto)**  
Versi Rilis Saat Ini: **`v01.06.00`** (`version_code: 10600`)

Monorepo full-stack modern untuk pengelolaan akademik sekolah secara terpadu, real-time, dan terintegrasi penuh dengan ekosistem **Kredensia SSO**, **GDS (Gerakan Disiplin Sekolah)**, dan **PASTI (Sistem Kehadiran Siswa)**.

---

## 🛠️ Tech Stack

| Layer | Teknologi |
| --- | --- |
| **Package Manager** | `pnpm` workspaces (Monorepo) |
| **Frontend (`apps/web`)** | React 19, TypeScript, Vite 6, Tailwind CSS, Zustand, React Router v7, SheetJS (`xlsx`), SweetAlert2 |
| **Backend (`apps/api`)** | Node.js, Hono, TypeScript, Zod, `jose` (JWT Cookie Session), `pdfkit` (Raport PDF), `adm-zip` (In-App Updater), Server-Sent Events (SSE Realtime) |
| **Database** | PostgreSQL + Drizzle ORM |
| **Integrasi Eksternal** | Kredensia SSO IdP, Aplikasi GDS (Poin Ketertiban), Aplikasi PASTI (Presensi Kehadiran) |

---

## ✨ Fitur Utama

### 1. Otentikasi & Keamanan Login
- **Halaman Login Split-Screen Responsif (`/login`)**: Tampilan modern bergaya *glassmorphism* yang adaptif di perangkat Mobile, Tablet, dan Desktop.
- **Single Sign-On (SSO) Kredensia**: Login satu klik dengan sinkronisasi otomatis profil pengguna, peran (*roles*), dan *roster* kelas secara *Just-In-Time (JIT)*.
- **Portal Login Khusus Admin (`/office`)**: Halaman login manual email/password terpisah untuk administrator sistem.
- **Profil Publik & Kartu Profil (`/profil`, `/u/:uuid`)**: Pengelolaan biodata lengkap dan tautan profil publik.

### 2. Manajemen Akademik (Admin & Superadmin)
- **Dashboard Analitik Real-Time (`/admin`)**: Statistik pengguna, kelas, mata pelajaran, serta pantauan aktivitas akademik secara langsung via *Server-Sent Events (SSE)*.
- **Siswa & Pengguna (`/admin/students`)**: Manajemen data peserta didik, guru, dan tenaga kependidikan, lengkap dengan sinkronisasi massal dari Kredensia SSO.
- **Tahun Pelajaran & Siklus Akademik (`/admin/academic-years`, `/admin/alumni`, `/admin/keluar`)**: Pengaturan tahun ajaran aktif, kenaikan kelas, kelulusan alumni, serta mutasi siswa keluar/masuk kembali.
- **Data Rombel (`/admin/classes`)**: Pengelolaan kelas/rombel beserta penugasan Wali Kelas.
- **Mata Pelajaran & Penugasan (`/admin/subjects`)**: Pengaturan mata pelajaran, pembagian tugas mengajar guru mapel, pengaturan jam pelajaran harian (`Jam ke-X`), serta konfigurasi aktif/nonaktif komponen penilaian (`UH1`, `T1`, `STS`, `UH2`, `T2`).
- **Monitoring Jurnal Mengajar (`/admin/monitoring-jurnal`)**: Pemantauan keterisian jurnal KBM harian per kelas secara real-time, dilengkapi fitur **Kembalikan ke Draft (Koreksi Ulang)** dan edit jurnal oleh Superadmin.

### 3. Pusat Unduhan & Pemberkasan (`/admin/downloads` & `/guru/downloads`)
Menu mandiri di sidebar untuk mencetak dan mengunduh laporan Excel (`.xlsx`) resmi siap cetak:
- **Modul #1 — Rekap Monitoring Jurnal Mengajar Guru / Pribadi (`.xlsx`)**:
  - Pilihan rentang waktu cepat: *Hari Ini*, *1 Pekan (Senin–Sabtu)*, *1 Bulan Penuh*, *Semua Tanggal (Seluruh Riwayat)*, atau *Rentang Tanggal Kustom*.
  - Filter spesifik per Rombel dan per Guru Pengajar.
  - Opsi menyertakan slot jam pelajaran yang belum diisi jurnal serta blok tanda tangan kepala sekolah/wakasek kurikulum.
- **Modul #2 — Buku Leger Nilai Rombel & Rekap Nilai Mapel (`.xlsx`)**:
  - Mode **Buku Leger Kelas (Semua Mapel)** menghasilkan 3 lembar kerja (*Sheet*) sekaligus: *Leger Rata-rata Nilai*, *Rincian Seluruh Komponen (UH1, T1, STS, UH2, T2)*, dan *Matriks Status Pengumpulan Nilai*.
  - Mode **Rekap Nilai Spesifik per Mata Pelajaran**.
  - Filter berdasarkan status nilai (*Semua Status*, *Approved*, *Submitted*, *Draft*) beserta tabel pratinjau langsung.
- **Modul Pemberkasan Lainnya (*Segera Hadir*)**:
  - Rekap Matrix Persetujuan Nilai, Buku Induk Siswa/Alumni/Mutasi, SK Penugasan Guru & Wali Kelas, serta Rekap Kedisiplinan (GDS) & Presensi.

### 4. Portal Guru & Wali Kelas
- **Input Nilai Akademik (`/guru`)**:
  - Pengisian nilai per komponen penilaian aktif dengan penyimpanan **Simpan Draft** (`upsert`) dan pengiriman ke Wali Kelas (**Kirim Nilai**).
  - **Unduh & Unggah Template Nilai Excel (`.xlsx`)**:
    - File template diunduh dengan *timestamp* unik dan tanda tangan digital (*sheet metadata*) yang terikat pada Guru Pengampu, Kelas, dan Mata Pelajaran.
    - Validasi anti-*sharing* saat unggah untuk mencegah tertukarnya file antar guru/kelas.
    - Animasi loading saat proses impor Excel disertai jendela konfirmasi jumlah siswa yang berhasil diimpor dan pengingat **Simpan Draft**.
- **Jurnal Mengajar Harian (`/guru/jurnal`)**: Pencatatan materi pembelajaran dan ketidakhadiran siswa per jam mengajar.
- **Matrix Persetujuan Wali Kelas (`/walikelas`)**: Pemeriksaan kelengkapan nilai seluruh mata pelajaran di kelas perwalian, persetujuan (*Approve*), atau pembatalan persetujuan nilai.

### 5. Portal Siswa & Orang Tua
- **Beranda Siswa (`/siswa`)**: Informasi kelas aktif, rekapitulasi ketidakhadiran (*Sakit*, *Izin*, *Alpa* beserta catatan kehadiran dari aplikasi PASTI), dan total **Poin GDS** beserta catatan kedisiplinan.
- **Raport Nilai & Unduh PDF (`/siswa/raport`)**: Tampilan nilai akademik per mata pelajaran dan tombol **Unduh Raport (PDF)** ukuran A4 (*Times New Roman*) dengan format nama file `{uuid-siswa}-{tahun-ajaran}.pdf`.

### 6. Pengaturan Sistem, Integrasi & In-App Updater (Superadmin)
- **Update & Backup (`/admin/app-update`, `/admin/backup-restore`)**:
  - Pembaruan aplikasi satu klik dengan mengunggah paket `update_siakad_v{versi}.zip` langsung dari antarmuka web.
  - Eksekusi migrasi skema database non-destruktif secara otomatis saat update.
  - Deteksi versi otomatis di sisi klien (*auto-reload* saat ada pembaruan server).
- **Integrasi Eksternal (`/admin/integrations`)**: Konfigurasi dan sinkronisasi langsung dengan **Kredensia SSO**, **GDS**, dan **PASTI (Kehadiran Siswa)**.
- **Tempat Sampah (`/admin/trash`)**: Pemulihan (*Restore*) atau penghapusan permanen data yang telah dihapus (*soft-delete*).

---

## 👥 Matriks Peran (Roles)

| Kode Role | Akses Login | Deskripsi & Hak Akses |
| --- | --- | --- |
| `superadmin` | Ya | Akses penuh seluruh modul akademik, pengaturan sistem, integrasi, tempat sampah, dan *In-App Updater* |
| `admin` | Ya | Manajemen akademik, siswa, rombel, mapel, monitoring jurnal, dan Pusat Unduhan |
| `walikelas` | Ya | Matrix persetujuan nilai kelas perwalian, input nilai, jurnal mengajar, dan Pusat Unduhan |
| `guru` | Ya | Input nilai (termasuk ekspor/impor template Excel), jurnal mengajar, dan Pusat Unduhan pribadi |
| `tendik` | Ya | Tenaga kependidikan |
| `siswa` / `ortu` | Ya | Dashboard kehadiran & poin GDS, lihat raport, dan unduh PDF raport nilai |
| `alumni` | Ya | Akses arsip alumni (`kelas_label = ALUMNI`) |
| `keluar` | **Diblokir** | Siswa mutasi/keluar — riwayat data tetap tersimpan, akses login dinonaktifkan |

---

## 🚀 Panduan Instalasi & Pengembangan Lokal

### Prasyarat
- **Node.js** >= 20
- **pnpm** >= 10
- **PostgreSQL** >= 15

### Langkah Setup

```bash
# 1. Clone repositori
git clone https://github.com/faishalnafi/Sintesa-SIAKAD.git
cd Sintesa-SIAKAD

# 2. Instal seluruh dependencies
pnpm install

# 3. Salin dan konfigurasi file environment (.env jangan pernah di-commit)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# Sesuaikan DATABASE_URL, JWT_SECRET, dan kredensial SSO_* pada apps/api/.env

# 4. Jalankan migrasi dan seed awal database
pnpm db:migrate
pnpm db:seed

# 5. Jalankan server pengembangan (API + Web secara paralel)
pnpm dev
```

- **Frontend Web**: `http://localhost:5173`
- **Backend API**: `http://localhost:3001`

---

## 📦 Membangun Paket Update (`.ZIP`)

Untuk membangun berkas kompilasi produksi (`apps/web/dist` dan `apps/api/dist`) sekaligus membuat paket `.zip` yang siap diunggah melalui menu **Admin > Update & Backup**:

```powershell
# 1. Build frontend & backend
pnpm --filter @sintesa/web build
pnpm --filter @sintesa/api build

# 2. Buat paket ZIP (otomatis membaca versi dari version.json)
.\make-deploy-zip.ps1
```

Script di atas akan menghasilkan berkas **`update_siakad_v{versi}.zip`** (contoh: `update_siakad_v01.06.00.zip`) dengan struktur path *forward-slash* (`/`) yang kompatibel baik di lingkungan Windows maupun container Linux/Docker.

---

## 🐳 Docker Deployment (Portainer / Dokploy / VPS)

Panduan lengkap konfigurasi container tersedia di [`deploy-to-docker.md`](deploy-to-docker.md).

```bash
git clone https://github.com/faishalnafi/Sintesa-SIAKAD.git && cd Sintesa-SIAKAD
./scripts/generate-stack-env.sh https://domain-siakad-anda
# Lengkapi variabel SSO_* pada file .env, kemudian jalankan:
docker compose pull && docker compose up -d
```

---

## 📋 Riwayat Rilis Terbaru

- **`v01.06.00` (2026-10-02)**:
  - Penambahan menu mandiri **Pusat Unduhan** (`/admin/downloads` & `/guru/downloads`) untuk ekspor Excel (`.xlsx`) Rekap Monitoring Jurnal Mengajar Guru serta Buku Leger & Rekap Nilai Mapel.
  - Standarisasi penomoran versi 2 digit (`xx.yy.zz`) dan penyertaan nomor versi otomatis pada nama berkas `update_siakad_v{versi}.zip`.
- **`v1.5.3` (2026-09-30)**:
  - Fitur Unduh & Unggah Template Nilai Excel (`.xlsx`) untuk Guru dengan validasi pengampu & tanda tangan digital sheet.
  - Animasi loading unggah Excel serta modal konfirmasi jumlah siswa berhasil diimpor dengan pengingat Simpan Draft.
  - Perbaikan penyimpanan nilai kosong (`null`) pada tombol Simpan Draft dan perapian tampilan tombol Keluar saat sidebar diminimize.
- **`v1.5.2` (2026-08-29)**:
  - Fitur **Unduh Raport (PDF)** ukuran A4 pada halaman Raport Nilai siswa serta mekanisme *auto-reload* klien saat versi server diperbarui.