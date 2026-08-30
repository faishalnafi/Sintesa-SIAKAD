# Penanganan Tahun Pelajaran, Alumni & Mutasi

Diselaraskan dengan **ScholarGate-SSO** (`AcademicYear`, `Member::migrateToAlumni`, `setRole('keluar')`).

## 1. Tahun pelajaran (`academic_years`)

| Aksi | Endpoint | Perilaku |
| --- | --- | --- |
| List | `GET /api/admin/academic-years` | Semua tahun + `active` + `pendingAlumni` |
| Buat | `POST /api/admin/academic-years` `{ name }` | Contoh: `2026/2027` |
| Aktifkan | `POST /api/admin/academic-years/:id/activate` | Hanya 1 aktif; tahun lain di-nonaktifkan |
| Hapus | `DELETE /api/admin/academic-years/:id` | Gagal jika sedang aktif |
| Bulk assign | `POST /api/admin/academic-years/bulk-assign-active` | Set `academic_year_id` siswa/guru/tendik → tahun aktif |
| Naik kelas | `POST /api/admin/academic-years/advance-grades` | SEM→X→XI→XII (by `grade_level` + `jurusan`) |

### Aturan aktif

- Hanya **satu** `is_active = true`.
- Saat aktivasi, hitung **pending alumni**: siswa `member_status=siswa`, kelas tingkat **XII**, `academic_year_id` terisi dan **≠** tahun aktif baru.

### Naik kelas

Urutan jenjang (ScholarGate refresh academic):

```
SEM → X → XI → XII → (Alumni)
```

- Snapshot masuk `academic_histories` sebelum pindah.
- XII **tidak** naik otomatis; menunggu migrasi alumni.
- Target kelas: prefer `grade_level` berikutnya + `jurusan` yang sama.

## 2. Alumni

| Aksi | Endpoint | Perilaku |
| --- | --- | --- |
| List | `GET /api/admin/alumni` | Alumni + pending XII + daftar tahun |
| Pending | `GET /api/admin/alumni/pending` | XII yang harus diluluskan |
| Migrasi bulk | `POST /api/admin/alumni/migrate` | Semua pending → `alumni` |
| Promote 1 | `POST /api/admin/alumni/:studentId/promote` | Satu siswa → alumni |
| Purge by year | `POST /api/admin/alumni/purge` `{ yearId }` | Hapus permanen alumni lulus tahun tsb |

### Saat jadi alumni

- `member_status = alumni`
- `kelas_label = ALUMNI`
- `class_id = null`
- `is_active = false`
- Role user: `siswa` diganti `alumni` (masih bisa login sebagai alumni)
- `academic_year_id` disimpan sebagai **tahun lulus** (snapshot)

## 3. Mutasi / keluar

| Aksi | Endpoint | Perilaku |
| --- | --- | --- |
| List | `GET /api/admin/keluar` | Daftar keluar + opsi siswa aktif |
| Tandai keluar | `POST /api/admin/keluar` `{ studentId, note? }` | Hanya dari status `siswa` |
| Restore | `POST /api/admin/keluar/:studentId/restore` `{ classId?, note? }` | Kembali ke `siswa` |
| Purge all | `POST /api/admin/keluar/purge` | Hapus permanen semua keluar |

### Saat keluar/mutasi

- `member_status = keluar`
- `class_id` dikosongkan
- `is_active = false`
- Role user → `keluar`, `users.is_active = false` → **tidak bisa login**
- Catatan di `status_note` + `status_changed_at`

### Restore

- Hanya dari `keluar` → `siswa`
- Opsional assign `classId`
- Role kembali `siswa`, user diaktifkan lagi
- `academic_year_id` diisi tahun aktif jika ada

## 4. Status machine (siswa track)

```
        ┌─────────────┐
        │    siswa    │◄──────── restore
        └──────┬──────┘
          │    │
   mark   │    │ promote / migrate XII
  keluar  │    ▼
          │  ┌─────────────┐
          │  │   alumni    │── purge by year ──► (deleted)
          │  └─────────────┘
          ▼
        ┌─────────────┐
        │   keluar    │── purge all ──► (deleted)
        └─────────────┘
```

Guru/tendik tidak memakai status alumni/keluar (track terpisah di `teachers.staff_type`).

## 5. Ringkasan UI admin

- **Tahun Pelajaran** — buat, aktifkan, bulk assign, naik kelas
- **Alumni** — pending banner, migrasi, purge per tahun lulus
- **Mutasi/Keluar** — pilih siswa, restore, purge

## 6. Referensi ScholarGate

- `AcademicYear::activate` — single active
- `Member::countPendingAlumni` / `migrateToAlumni`
- `Member::setRole(..., 'keluar')` + restore via `setRole(..., 'siswa')`
- `purgeAlumniByYear` / `purgeKeluar`
- Dashboard refresh academic: SEM→X→XI→XII→Lulus
