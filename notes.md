# Blueprint Pengembangan SIMAK (SINTESA AI Assistant)

Dokumen ini merangkum kebutuhan spesifik, arsitektur teknis, dan strategi implementasi helper asisten AI di aplikasi **SIMAK (5174-simak)** yang berjalan berdampingan dengan SIAKAD utama.

---

## 1. Latar Belakang & Kebutuhan Pengguna (User Stories)

### A. Role Guru & Rutinitas Harian
* **Target Pengguna**: < 100 Guru aktif (penggunaan rutin 5 hari kerja).
* **Aktivitas 1 - Jurnal & Kegiatan Pembelajaran**:
  * Input kegiatan harian kelas (tanggal, jam ke-, kelas, mapel, materi pembelajaran, kehadiran siswa).
  * Status alur kerja: `draft` (tersimpan sementara) hingga `sent`/`submit` (dikirim resmi).
* **Aktivitas 2 - Pengelolaan Nilai Siswa**:
  * Komponen nilai: `t1` (Tugas 1), `t2` (Tugas 2), `uh1` (Ulangan Harian 1), `uh2` (Ulangan Harian 2), `sts` (Sumatif Tengah Semester), dan `pas` (Penilaian Akhir Semester).
  * Kendala saat ini: Meskipun ada template resmi, banyak guru memiliki format file Excel sendiri dengan nama kolom dan susunan berbeda.

---

## 2. Fitur Helper Asisten AI yang Dibangun

### A. Room Chat Interaktif (AI Assistant Drawer)
* Widget obrolan mengambang (*floating drawer/widget*) yang dapat diakses guru dari mana saja di dalam dashboard.
* AI secara otomatis mengetahui profil guru yang sedang login (Nama, NIP/Username, dan daftar Mapel yang diampu) tanpa perlu ditanya ulang.

### B. Otomasi Penjadwalan & Jurnal Mengajar via Prompt
1. **Deteksi Bahasa Alami**:
   * Guru cukup mengetik instruksi bebas, contoh:  
     > *"Tolong jadwalkan kegiatan hari ini di kelas 10-A jam 1 sampai 3 materi Eksponen dan Logaritma, semua siswa hadir."*
2. **Pendeteksian Bentrokan Jadwal (Collision Detection)**:
   * AI/Sistem memvalidasi ke database 3-dimensi: `[tanggal, kelas, jam mengajar]`.
   * Jika pada jam tersebut kelas sudah diisi guru lain, AI otomatis memberi peringatan ramah:  
     > *"Mohon maaf Pak/Bu, jam ke-1 di kelas X-1 pada tanggal tersebut sudah terisi oleh Bu Siti (Fisika). Apakah ingin dipindahkan ke jam lain?"*
3. **Eksekusi Otomatis (Draft / Submit)**:
   * Jika jadwal valid dan disetujui guru, AI langsung membuat entri jurnal mengajar (`status: draft` atau langsung `sent`) ke database.

### C. Smart Import Nilai via Unggah Excel di Room Chat
1. **Penerimaan Format Fleksibel**:
   * Guru mengunggah file Excel (`.xlsx` / `.xls`) ragam format langsung ke room chat.
2. **Deteksi Otomatis & Pemetaan Kolom Pintar**:
   * Sistem membaca struktur header kolom (misal: "Ulangan 1", "Tugas Mandiri", "UTS", "Nilai Akhir").
   * AI memetakan kolom tersebut ke standar database: `[uh1, t1, sts, uh2, t2, pas]`.
   * AI mengenali kelas dan mapel yang cocok berdasarkan konteks guru yang login dan daftar nama siswa di dalam file.
3. **Laporan & Konfirmasi Hasil Deteksi**:
   * AI menyajikan laporan di obrolan:  
     > *"File berhasil dipindai! Terdeteksi 32 nilai siswa kelas **X-1** untuk Mapel **Matematika**. Pemetaan: 'Tugas-1' -> **T1**, 'UH-1' -> **UH1**, 'MID' -> **STS**. Nilai rata-rata kelas: 82.5."*
   * Dilengkapi tombol aksi konfirmasi: **[Simpan sebagai Draft]** atau **[Kirim Nilai]**.

---

## 3. Arsitektur Teknis & Efisiensi Sumber Daya

### A. Spesifikasi Lingkungan Produksi (VPS)
* **OS / Control Panel**: AlmaLinux + aaPanel
* **Spesifikasi Server**: RAM 4 GB, 2 vCPU, Disk 30 GB, Database PostgreSQL
* **Keputusan Kunci**: **TIDAK MENGGUNAKAN LOCAL LLM (Ollama)** di server ini karena RAM 4GB/2 Core rawan *Out of Memory* (OOM) dan membebani server utama.

### B. Penyedia AI & Manajemen Kuota (Hemat Token)
* **Model AI Utama**: **Google Gemini 1.5 Flash / 2.0 Flash** via Google AI Studio API.
  * **Free Tier Allowance**: 15 RPM (Request/Menit), 1.500 RPD (Request/Hari). Kuota ini sangat memadai untuk < 100 guru.
  * Biaya: **Rp 0 / Gratis** di tier gratis tanpa risiko tagihan mendadak.
* **Strategi Efisiensi Token**:
  1. **Parsing Excel Lokal**: File Excel diproses menggunakan library `xlsx` di backend/frontend. Hanya header dan sampel data kecil (~3 baris) yang dikirim ke LLM untuk mencocokkan kolom. Menghindari pengiriman raw file biner.
  2. **Sliding Window Chat**: Riwayat pesan yang dikirim ke LLM dibatasi 3–5 pesan terakhir saja.
  3. **Penanganan Overuse (429 Rate Limit)**:
     * Retry otomatis dengan jeda (*exponential backoff*).
     * Opsi fallback ke provider alternatif gratis (**Groq Cloud Llama-3.3**).
     * Pesan error ramah pengguna jika antrean penuh.

---

## 4. Konfigurasi Paralel Lokal (5173 vs 5174)

Kedua aplikasi berjalan berdampingan pada satu mesin lokal dengan **1 Database PostgreSQL yang sama (`sintesa`)**:

| Parameter | App Eksisting (`5173-siakad`) | App Baru (`5174-simak`) |
| :--- | :--- | :--- |
| **Path Direktori** | `D:\server\webapp\5173-siakad` | `D:\server\webapp\5174-simak` |
| **Frontend Web** | Port `5173` | Port `5174` |
| **Backend API** | Port `3001` | Port `3002` |
| **Database** | `postgresql://...:5432/sintesa` | `postgresql://...:5432/sintesa` *(Shared)* |
| **Git Remote** | `origin` (Sintesa-SiAkad) | `upstream` (Sintesa-SiAkad) + `origin` (Fork/Repo Baru) |

---

## 5. Rencana Tahapan Eksekusi (Roadmap)

1. **Persiapan Environtment (Port & Env)**:
   - Duplikasi konfigurasi `.env` dari `5173-siakad` ke `5174-simak`.
   - Update port backend API ke `3002` dan frontend Vite ke `5174`.
   - Jalankan `pnpm install` di `5174-simak`.
2. **Backend Engine (API & AI Service)**:
   - Tambahkan SDK `@google/genai` di `apps/api`.
   - Buat modul `/teacher/assistant` dengan fungsi tool calling:
     - `checkScheduleCollision()`
     - `createJournalEntry()`
     - `mapAndImportExcelGrades()`
3. **Frontend UI (Chat Room & File Dropper)**:
   - Implementasi komponen Floating Chat Assistant dengan dukungan file upload `.xlsx`.
   - Integrasi streaming text & action cards (tombol konfirmasi draft/submit di dalam bubble chat).
4. **Testing & Sinkronisasi Dua Arah**:
   - Uji coba penjadwalan & import nilai di `5174-simak`.
   - Verifikasi data langsung muncul secara realtime di dashboard `5173-siakad`.
