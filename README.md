# SINTESA

**Sistem Informasi Terpadu Akademik Sekolah**

Monorepo full-stack: React (Vite) + Hono API + PostgreSQL + Drizzle ORM.  
Auth: login lokal + Kredensia SSO. UI: Stitch design system, mobile-first, light/dark/system.

## Stack

| Layer | Tech |
| --- | --- |
| Package manager | pnpm workspaces |
| Frontend | React, Vite, Tailwind, Zustand |
| Backend | Hono, Zod, jose (JWT cookie session) |
| Database | PostgreSQL + Drizzle ORM |
| SSO | Kredensia IDP (`client_id` + callback `?token=`) |

## Prerequisites

- Node.js ≥ 20
- pnpm 10+
- PostgreSQL running locally

## Setup

```bash
# 1) Install
pnpm install

# 2) Configure env (do not commit real .env)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
# edit DATABASE_URL, JWT_SECRET, etc.

# 3) Migrate + seed
pnpm db:generate   # if schema changed
pnpm db:migrate
pnpm db:seed

# 4) Dev
pnpm dev
```

- Web: http://localhost:5173  
- API: http://localhost:3001  

## Docker Deploy (Portainer / Dokploy)

**Panduan lengkap + blok env copy-paste:** [`deploy-to-docker.md`](deploy-to-docker.md)

Install cepat di VPS:

```bash
git clone https://github.com/ardianryan/sintesa.git && cd sintesa
./scripts/generate-stack-env.sh https://domain-anda
# isi SSO_* di .env, lalu:
docker compose pull && docker compose up -d
```

Stack: PostgreSQL + API + Nginx (satu port `8080`, `/api` di-proxy otomatis).  
Image GHCR: `ghcr.io/ardianryan/sintesa-api` · `ghcr.io/ardianryan/sintesa-web` (build otomatis via GitHub Actions).

## Roles (ScholarGate-SSO aligned)

Member roles from ScholarGate `members.role`:

| Code | Login | Keterangan |
| --- | --- | --- |
| `siswa` | ya | Peserta didik (+ data ayah/ibu/wali) |
| `guru` | ya | Tenaga pendidik (NIP, gelar di `nama`) |
| `tendik` | ya | Tenaga kependidikan |
| `alumni` | ya | Mantan siswa (`kelas_label` = ALUMNI) |
| `keluar` | **tidak** | Mutasi/keluar — data tetap, login diblok |

System (ScholarGate `admins.role`):

| Code | Keterangan |
| --- | --- |
| `superadmin` | Super Admin |
| `admin` | Admin / TU |

SINTESA app overlays:

| Code | Keterangan |
| --- | --- |
| `walikelas` | Dari `is_homeroom` / multi-role guru |
| `ortu` | Akses orang tua (data dari blok orang tua siswa) |

Detail field mirror ScholarGate `API.md` (NIK, KK, Google, alamat, parent block, dll.).

## Integrasi eksternal (anti tumpang tindih)

| App | Domain | Status |
| --- | --- | --- |
| **Kredensia SSO** | Identitas & login | Live |
| **GDS** | Poin kedisiplinan → `poin_gds` | Coming soon |
| **Kehadiran Siswa** | Absensi → sakit/izin/alpa | Coming soon |

UI: `/admin/integrations` · Docs: [`apps/api/docs/INTEGRATIONS_GDS_KEHADIRAN.md`](apps/api/docs/INTEGRATIONS_GDS_KEHADIRAN.md)

Env (isi saat live): `GDS_BASE_URL`, `GDS_API_KEY`, `KEHADIRAN_BASE_URL`, `KEHADIRAN_API_KEY`

## Tahun pelajaran, alumni & mutasi

Dokumentasi lengkap: [`apps/api/docs/ACADEMIC_LIFECYCLE.md`](apps/api/docs/ACADEMIC_LIFECYCLE.md)

Ringkas (pola ScholarGate):

1. **Tahun pelajaran** — hanya 1 aktif; bulk assign; naik kelas SEM→X→XI→XII  
2. **Alumni** — siswa XII dengan `academic_year_id ≠` tahun aktif → migrasi `alumni` (`kelas_label=ALUMNI`)  
3. **Keluar/mutasi** — `siswa` → `keluar` (login diblok); admin bisa **restore** ke `siswa`  

UI admin: `/admin/academic-years`, `/admin/alumni`, `/admin/keluar`

## Demo accounts (after seed)

| Email | Password | Roles |
| --- | --- | --- |
| admin@sintesa.local | admin123 | superadmin, admin |
| guru@sintesa.local | guru123 | guru, walikelas |
| tendik@sintesa.local | tendik123 | tendik |
| siswa@sintesa.local | siswa123 | siswa |

## Scripts

```bash
pnpm dev           # api + web
pnpm dev:api
pnpm dev:web
pnpm db:migrate
pnpm db:seed
pnpm build
```

## Security notes

- `.env` is gitignored — never push secrets
- Session uses HTTP-Only cookie JWT
- SSO secrets stay on the API only
- Register is admin/SSO provisioning only (no open public register)

## Kredensia SSO (sesuai `api.md`)

Dokumentasi lengkap: [`apps/api/docs/KREDENSIA_SSO.md`](apps/api/docs/KREDENSIA_SSO.md) · spek IdP: [`api.md`](api.md)

1. Superadmin IdP → **Manajemen Aplikasi** daftarkan SINTESA  
   - `login_callback_url` = `http://localhost:3001/api/auth/sso/callback` (host+port harus cocok)  
2. Isi `apps/api/.env`:
   - `SSO_BASE_URL`, `SSO_CLIENT_ID` (UUID app), `SSO_REDIRECT_URI`, `SSO_JWT_SECRET` (= JWT_SECRET IdP)  
   - Opsional sync: `SSO_API_KEY` (Kunci API, format `sso_…`)  
3. Login: tombol **Masuk dengan Kredensia SSO** → `/api/auth/sso/login`  
4. Callback: `?token=` JWT HS256 (TTL 5 menit) → JIT user → cookie session  
5. Logout: `/api/auth/sso/logout` → IdP `/otentikasi/keluar`  

Proxy admin (butuh API key): `/api/admin/sso/test|members|peran|statistik` · `POST /api/admin/sso/sync-members`

Dev simulate (non-production):

```bash
curl -X POST http://localhost:3001/api/auth/sso/dev-simulate \
  -H 'Content-Type: application/json' \
  -d '{"nama":"SSO Dev","roles":["Guru"],"nomor_induk":"19800101"}'
# buka data.callbackUrl di browser
```
