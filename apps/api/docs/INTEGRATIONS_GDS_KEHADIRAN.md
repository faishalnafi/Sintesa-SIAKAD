# Integrasi GDS & Kehadiran Siswa

Dua aplikasi **terpisah** dari Kredensia dan dari SINTESA.  
SINTESA hanya **konsumen agregat** untuk keperluan akademik (matrix raport, dashboard).

## Peta domain (anti tumpang tindih)

```
┌─────────────┐     identitas / login      ┌──────────┐
│  Kredensia  │ ─────────────────────────► │ SINTESA  │
│    (IdP)    │                            │ akademik │
└─────────────┘                            │  nilai   │
                                           │  tahun   │
┌─────────────┐     poin_gds (agregat)     │  matrix  │
│     GDS     │ ─────────────────────────► │          │
│  (coming)   │                            │          │
└─────────────┘                            │          │
                                           │          │
┌─────────────┐  sakit / izin / alpa       │          │
│  Kehadiran  │ ─────────────────────────► │          │
│  Siswa      │                            └──────────┘
│  (coming)   │
└─────────────┘
```

| App | Bukan tanggung jawab | Mirror di SINTESA |
| --- | --- | --- |
| **GDS** | Login user, nilai UH/T/PSAJ | `students.poin_gds` |
| **Kehadiran** | Login user, detail jam ke- | `students.sakit`, `izin`, `alpa` |
| **Kredensia** | Poin GDS, absensi, nilai | `users.sso_id`, peran |
| **SINTESA** | Master pelanggaran harian, presensi per jam | Raport, approve, tahun ajar |

## Status

| Kode | Nama | Status |
| --- | --- | --- |
| `gds` | GDS — Poin Kedisiplinan | **coming_soon** |
| `kehadiran` | Kehadiran Siswa | **coming_soon** |

## Env (isi saat app live)

```env
# GDS
GDS_BASE_URL=
GDS_API_KEY=

# Kehadiran Siswa
KEHADIRAN_BASE_URL=
KEHADIRAN_API_KEY=
```

Kosong = tombol sync mengembalikan `coming_soon` (tidak error keras).

## Kontrak API target (draft, final saat app ready)

### GDS

```http
GET {GDS_BASE_URL}/api/v1/points
X-API-Key: ...
```

```json
{
  "success": true,
  "data": [
    { "nisn": "00492813", "nis": "23100412", "poin": 95, "updated_at": "..." }
  ]
}
```

Match siswa: `nisn` dulu, fallback `nis`.

### Kehadiran

```http
GET {KEHADIRAN_BASE_URL}/api/v1/rekap
X-API-Key: ...
```

```json
{
  "success": true,
  "data": [
    {
      "nisn": "00492813",
      "sakit": 0,
      "izin": 1,
      "alpa": 0,
      "academic_year": "2025/2026"
    }
  ]
}
```

## Endpoint SINTESA

| Method | Path | Fungsi |
| --- | --- | --- |
| GET | `/api/admin/integrations` | Status ketiga app (SSO, GDS, Kehadiran) |
| POST | `/api/admin/integrations/gds/sync` | Pull poin GDS |
| POST | `/api/admin/integrations/kehadiran/sync` | Pull rekap absensi |
| POST | `/api/admin/sync/gds` | Alias legacy |
| POST | `/api/admin/sync/kehadiran` | Alias (ganti `bk`) |
| POST | `/api/admin/sync/bk` | Alias kehadiran (kompat lama) |

Log: tabel `external_sync_logs` (`source` = `gds` \| `kehadiran`).

## Dipakai di mana

- **Walikelas matrix** — kolom GDS Points + BK Attendance  
- **Dashboard siswa** — kartu poin & absensi  
- **Admin Integrasi** — panel sync + badge Coming soon  

## Roadmap

1. ~~Stub + UI coming soon~~  
2. Finalisasi OpenAPI GDS & Kehadiran  
3. Isi env + uji sync staging  
4. (Opsional) webhook push dari GDS/Kehadiran → SINTESA  
5. Jangan pernah pindahkan login/identitas ke GDS/Kehadiran — tetap Kredensia  
