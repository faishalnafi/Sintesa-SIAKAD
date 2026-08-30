# Batas Domain: Kredensia (IdP) vs SINTESA

Tujuan: **tidak tumpang tindih**. Satu sumber kebenaran per domain.

## Kredensia SSO (IdP) — sumber identitas

| Tanggung jawab | Detail |
| --- | --- |
| Autentikasi | Login email/password, Google, klaim akun |
| Master user | `nama_lengkap`, email, NIK, NIP/NIS, peran portal |
| RBAC portal | Siapa boleh buka aplikasi terdaftar |
| JWT SSO | Token 5 menit ke aplikasi klien |
| API members | `GET /api/v1/members` (read-only via API key) |
| Logout global | `/otentikasi/keluar` |

**SINTESA tidak mengelola password master user IdP**, tidak jadi user directory pengganti Kredensia.

## SINTESA — sumber akademik

| Tanggung jawab | Detail |
| --- | --- |
| Session lokal | Cookie HTTP-Only setelah SSO/local login |
| Tahun pelajaran | Aktif, naik kelas, history |
| Kelas / mapel / enroll | Struktur akademik sekolah |
| Nilai | UH, T, PSAJ, draft → submit → approve |
| Walikelas matrix | Approve raport |
| GDS / BK | Poin & absensi (integrasi eksternal) |
| Status akademik | `siswa` aktif kelas · `alumni` · `keluar` (mirror + aksi admin) |

## Mirror lokal (cache, bukan master)

| Tabel SINTESA | Isi | Sumber kebenaran |
| --- | --- | --- |
| `users.sso_id` | Link ke IdP user UUID | Kredensia |
| `users.name/email` | Snapshot setelah login/sync | Kredensia (boleh stale) |
| `user_roles` | Mapping peran IdP → kode SINTESA | Mapping dari JWT/API |
| `students` / `teachers` | Profil akademik + snapshot identitas | SINTESA (akademik) + cache IdP |

### Yang tidak diduplikasi

- ❌ Form “manajemen user global” setara Superadmin Kredensia  
- ❌ Klaim akun / reCAPTCHA IdP di dalam SINTESA  
- ❌ Menyimpan `client_secret` di frontend  
- ❌ Academic year master di Kredensia (itu domain SINTESA / sekolah)

### Alur data

```
Kredensia ──SSO JWT / API members──► SINTESA users (mirror)
                                      │
GDS ─────── poin_gds (coming soon) ───┤
                                      │
Kehadiran ─ sakit/izin/alpa (soon) ───┤
                                      ▼
                         students / teachers / grades / years
                         (domain akademik SINTESA)
```

- Sync members Kredensia = **import/cache** identitas, bukan CRUD master user di SINTESA.
- GDS & Kehadiran = **app terpisah** (lihat `INTEGRATIONS_GDS_KEHADIRAN.md`); jangan digabung ke SSO.
