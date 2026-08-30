# Integrasi Kredensia / SSO Sekolah (IdP)

Sumber: [`api.md`](../../../api.md) di root monorepo.

## Konfigurasi env (`apps/api/.env`)

| Variable | Docs | Keterangan |
| --- | --- | --- |
| `SSO_BASE_URL` | Base URL | e.g. `https://sso-sekolah.sch.id` |
| `SSO_CLIENT_ID` | `SSO_CLIENT_ID` | UUID aplikasi di Manajemen Aplikasi (`SSO_APP_ID` = alias) |
| `SSO_REDIRECT_URI` | `login_callback_url` | **Host+port harus cocok** dengan yang terdaftar di IdP |
| `SSO_JWT_SECRET` | `JWT_SECRET` IdP | HS256; fallback docs: `sso_secret_key_default_32_characters` |
| `SSO_API_KEY` | Kunci API | Format `sso_…` — **hanya backend** |

### Daftarkan SINTESA di IdP

Superadmin → Manajemen Aplikasi:

- `portal_url` = `https://akademik…` / `http://localhost:5173`
- `login_callback_url` = `http://localhost:3001/api/auth/sso/callback` (dev)
- `is_global_visibility` / `selected_roles` sesuai kebutuhan
- Salin UUID aplikasi → `SSO_CLIENT_ID`

Kunci API (opsional, untuk sync members): Superadmin → Kunci API → `SSO_API_KEY`.

---

## Alur login (api.md §6)

```
Browser  →  GET /api/auth/sso/login          (SINTESA)
         →  302 GET {SSO}/otentikasi?client_id=&redirect_uri=
         →  user login di IdP
         →  302 {SSO_REDIRECT_URI}?token=JWT
         →  GET /api/auth/sso/callback
         →  verify HS256 + exp (5m) + one-time consume
         →  JIT user by user_id / nomor_induk
         →  set cookie session SINTESA
         →  302 FRONTEND /auth/callback
```

### JWT payload (IdP)

```json
{
  "user_id": "uuid",
  "nomor_induk": "nip_or_nis",
  "nama": "Nama Lengkap",
  "roles": ["Siswa"],
  "exp": 1786852500
}
```

- Alg: **HS256**
- TTL: **300 detik**
- Secret: `SSO_JWT_SECRET`

### Mapping peran IdP → SINTESA

| IdP `nama_role` | SINTESA code |
| --- | --- |
| Super Admin / superadmin | superadmin |
| Admin | admin |
| Siswa | siswa |
| Guru | guru |
| Tendik | tendik |
| Alumni | alumni |
| Keluar | keluar (login ditolak) |
| Wali Kelas | walikelas |

Lihat `src/constants/roles.ts`.

---

## Logout (api.md §6)

```
GET /api/auth/sso/logout
  → clear cookie SINTESA
  → 302 {SSO}/otentikasi/keluar?redirect_uri={FRONTEND}/login
```

UI shell memanggil endpoint ini setelah logout lokal.

---

## REST API Key (api.md §1B, §2, §10)

Hanya dipanggil dari **backend** SINTESA:

| Method | Path | Admin proxy |
| --- | --- | --- |
| GET | `/api/v1/test` | `GET /api/admin/sso/test` |
| GET | `/api/v1/members` | `GET /api/admin/sso/members` |
| GET | `/api/v1/members/{id}` | (via client) |
| GET | `/api/v1/data/peran` | `GET /api/admin/sso/peran` |
| GET | `/api/v1/data/statistik` | `GET /api/admin/sso/statistik` |
| — | sync JIT massal | `POST /api/admin/sso/sync-members` |

Header:

```http
X-API-Key: sso_xxxxxxxx
# atau
Authorization: Bearer sso_xxxxxxxx
```

---

## Endpoint SINTESA auth

| Endpoint | Fungsi |
| --- | --- |
| `GET /api/auth/sso/login` | Mulai SSO |
| `GET /api/auth/sso/callback` | Terima `?token=` |
| `GET /api/auth/sso/logout` | Logout lokal + IdP |
| `GET /api/auth/sso/status` | Status konfigurasi |
| `POST /api/auth/sso/dev-simulate` | Dev only — mint JWT lokal |

---

## Dev tanpa IdP

```bash
# 1) Pastikan SSO_JWT_SECRET sama dengan yang dipakai mint
curl -X POST http://localhost:3001/api/auth/sso/dev-simulate \
  -H 'Content-Type: application/json' \
  -d '{"nama":"Guru Demo","roles":["Guru"],"nomor_induk":"19800101"}'

# 2) Buka callbackUrl di browser
```

---

## Keamanan

- Jangan expose `SSO_JWT_SECRET` / `SSO_API_KEY` ke frontend
- `redirect_uri` host/port harus match registrasi IdP (dicegah open redirect di IdP)
- Token callback one-time (hash token di `sso_token_jti`)
- Session aplikasi = cookie HTTP-Only terpisah dari JWT IdP
