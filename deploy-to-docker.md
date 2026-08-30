# Deploy SINTESA ke Docker

Panduan **copy-paste** untuk Portainer, Dokploy, atau `docker compose` di VPS.  
Tidak perlu build manual — pakai image dari GHCR (`ghcr.io/ardianryan/sintesa-*`).

---

## Checklist 5 menit

| # | Langkah | Status |
| --- | --- | --- |
| 1 | Punya domain + HTTPS (atau IP + port untuk uji) | ☐ |
| 2 | Generate / isi **3 secret wajib** (lihat bawah) | ☐ |
| 3 | Paste `docker-compose.yml` ke stack | ☐ |
| 4 | Paste **Environment variables** ke stack | ☐ |
| 5 | Deploy → buka URL → login | ☐ |
| 6 | Set `RUN_DB_SEED=false` setelah deploy pertama | ☐ |

---

## Generate env otomatis (paling mudah)

Di VPS atau laptop (harus ada `git` + repo):

```bash
git clone https://github.com/ardianryan/sintesa.git
cd sintesa
chmod +x scripts/generate-stack-env.sh
./scripts/generate-stack-env.sh https://sintesa.sekolah.sch.id
```

Script membuat file `.env` dengan `JWT_SECRET` dan `POSTGRES_PASSWORD` random.  
Lalu isi manual `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_JWT_SECRET`.

```bash
docker compose pull
docker compose up -d
```

---

## Variabel environment — referensi cepat

Ganti placeholder `https://sintesa.sekolah.sch.id` dengan domain Anda (**tanpa** slash di akhir).

| Variabel | Wajib? | Isi dengan apa |
| --- | --- | --- |
| `PUBLIC_URL` | **ya** | URL publik aplikasi, mis. `https://sintesa.sekolah.sch.id` |
| `JWT_SECRET` | **ya** | String random ≥ 32 karakter (session cookie) |
| `POSTGRES_PASSWORD` | **ya** | Password kuat untuk database |
| `CORS_ORIGINS` | **ya** | **Sama persis** dengan `PUBLIC_URL` |
| `SSO_REDIRECT_URI` | **ya** (jika pakai SSO) | `{PUBLIC_URL}/api/auth/sso/callback` |
| `SSO_CLIENT_ID` | ya (SSO) | UUID aplikasi dari panel Kredensia |
| `SSO_CLIENT_SECRET` | ya (SSO) | Secret aplikasi Kredensia |
| `SSO_JWT_SECRET` | ya (SSO) | JWT secret IdP (verifikasi token callback) |
| `SSO_BASE_URL` | ya (SSO) | URL IdP, default `https://sso-v2.smage.my.id` |
| `RUN_DB_SEED` | deploy pertama | `true` sekali, lalu `false` |
| `HTTP_PORT` | opsional | Port host, default `8080` (abaikan jika pakai reverse proxy Dokploy) |
| `COOKIE_SECURE` | opsional | `true` jika HTTPS, `false` jika HTTP uji lokal |
| `SINTESA_IMAGE_TAG` | opsional | `latest` atau tag rilis `v1.0.0` |

**Generate secret di terminal:**

```bash
# JWT_SECRET (48 karakter)
openssl rand -base64 36 | tr -d '/+='

# POSTGRES_PASSWORD (32 karakter)
openssl rand -base64 24 | tr -d '/+='
```

---

## Blok ENV — copy paste ke Stack

### A) Production + SSO (disarankan)

Salin blok di bawah ke **Environment variables** di Portainer/Dokploy.  
Ganti nilai yang ada tanda `GANTI_`.

```env
PUBLIC_URL=https://sintesa.sekolah.sch.id
JWT_SECRET=GANTI_RANDOM_MIN_32_KARAKTER
POSTGRES_PASSWORD=GANTI_PASSWORD_KUAT
CORS_ORIGINS=https://sintesa.sekolah.sch.id
POSTGRES_USER=sintesa
POSTGRES_DB=sintesa
HTTP_PORT=8080
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
RUN_DB_SEED=true
SINTESA_IMAGE_TAG=latest
SSO_BASE_URL=https://sso-v2.smage.my.id
SSO_CLIENT_ID=GANTI_UUID_DARI_KREDENSIA
SSO_CLIENT_SECRET=GANTI_SECRET_DARI_KREDENSIA
SSO_JWT_SECRET=GANTI_JWT_SECRET_IDP
SSO_REDIRECT_URI=https://sintesa.sekolah.sch.id/api/auth/sso/callback
SSO_API_KEY=
```

> **Kredensia:** daftarkan `SSO_REDIRECT_URI` di panel IdP → Manajemen Aplikasi → callback URL.

### B) Uji lokal / IP tanpa domain

```env
PUBLIC_URL=http://192.168.1.10:8080
JWT_SECRET=GANTI_RANDOM_MIN_32_KARAKTER
POSTGRES_PASSWORD=GANTI_PASSWORD_KUAT
CORS_ORIGINS=http://192.168.1.10:8080
POSTGRES_USER=sintesa
POSTGRES_DB=sintesa
HTTP_PORT=8080
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
RUN_DB_SEED=true
SINTESA_IMAGE_TAG=latest
SSO_BASE_URL=
SSO_CLIENT_ID=
SSO_CLIENT_SECRET=
SSO_JWT_SECRET=
SSO_REDIRECT_URI=
SSO_API_KEY=
```

Login pakai akun demo setelah seed (lihat [README.md](README.md#demo-accounts-after-seed)).

### C) Setelah deploy pertama (wajib diubah)

Ubah hanya satu baris di stack env, lalu **Update/Redeploy**:

```env
RUN_DB_SEED=false
```

---

## Portainer — langkah demi langkah

### 1. Registry GHCR (hanya jika image private)

**Registries** → **Add registry**

| Field | Nilai |
| --- | --- |
| Provider | Custom |
| Name | `ghcr` |
| Registry URL | `ghcr.io` |
| Username | username GitHub Anda |
| Password | GitHub PAT dengan scope `read:packages` |

Repo publik: langkah ini bisa dilewati.

### 2. Buat Stack

1. **Stacks** → **Add stack**
2. Name: `sintesa`
3. **Web editor** → paste seluruh isi file [`docker-compose.yml`](docker-compose.yml)
4. Scroll ke **Environment variables** → pilih **Advanced mode**
5. Paste blok **ENV A** dari atas (sudah diganti nilainya)
6. **Deploy the stack**

### 3. Verifikasi

```text
Containers → sintesa-web-1    → Running
Containers → sintesa-api-1    → Running (healthy)
Containers → sintesa-postgres-1 → Running (healthy)
```

Buka `https://domain-anda` atau `http://IP:8080`.

**Logs API:** Containers → `sintesa-api-1` → Logs → cari `Running migrations...` lalu `Starting server`.

### 4. Update image

1. Pastikan workflow GitHub **Docker GHCR** sudah selesai
2. Stack → **Editor** → **Pull and redeploy** (atau Update stack)
3. Opsional: set `SINTESA_IMAGE_TAG=v1.0.0` untuk pin versi

---

## Dokploy — langkah demi langkah

### 1. Project baru

1. **Create Project** → nama `sintesa`
2. **Add Service** → **Compose**
3. Source:
   - **Git**: `https://github.com/ardianryan/sintesa` branch `main`, compose path `docker-compose.yml`
   - atau upload `docker-compose.yml` manual

### 2. Environment

Tab **Environment** → tambahkan variabel satu per satu, atau paste dari blok **ENV A**.

| Tip Dokploy | Nilai |
| --- | --- |
| `PUBLIC_URL` | `https://sintesa.sekolah.sch.id` (domain yang akan dipasang) |
| `COOKIE_SECURE` | `true` |
| `CORS_ORIGINS` | sama dengan `PUBLIC_URL` |

### 3. Domain & HTTPS

1. Tab **Domains** pada service **web**
2. Host: `sintesa.sekolah.sch.id`
3. Container port: `80` (bukan 8080 — Dokploy proxy ke dalam container)
4. Aktifkan HTTPS / Let's Encrypt

> Jika pakai domain Dokploy, `HTTP_PORT` di env tidak dipublikasikan ke internet — reverse proxy Dokploy yang handle. Biarkan `HTTP_PORT=8080` atau hapus mapping port di compose jika bentrok (opsional).

### 4. Registry (repo private)

**Settings** → **Registry** → tambah `ghcr.io` + GitHub PAT `read:packages`.

### 5. Deploy

Klik **Deploy**. Cek logs service `api` untuk migrasi DB.

---

## Docker Compose di VPS (tanpa panel)

```bash
git clone https://github.com/ardianryan/sintesa.git
cd sintesa
./scripts/generate-stack-env.sh https://sintesa.sekolah.sch.id
# edit .env → isi SSO_*
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f api
```

Stop:

```bash
docker compose down          # keep data
docker compose down -v       # HAPUS database (hati-hati)
```

---

## Setelah deploy

### Akun demo (jika `RUN_DB_SEED=true`)

| Email | Password |
| --- | --- |
| admin@sintesa.local | admin123 |
| guru@sintesa.local | guru123 |
| siswa@sintesa.local | siswa123 |

### SSO Kredensia

1. Panel IdP → daftar aplikasi SINTESA
2. Callback: `{PUBLIC_URL}/api/auth/sso/callback`
3. Isi `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_JWT_SECRET` di env stack
4. Redeploy stack

### Backup database

```bash
docker compose exec postgres pg_dump -U sintesa sintesa > backup.sql
```

---

## Troubleshooting

| Masalah | Penyebab | Solusi |
| --- | --- | --- |
| Stack gagal deploy, error `POSTGRES_PASSWORD` | Env belum diisi | Paste blok ENV lengkap |
| Stack gagal, error `CORS_ORIGINS` | Variabel kosong | Set `CORS_ORIGINS` = `PUBLIC_URL` |
| `api` restart terus | DB belum siap / password salah | Cek logs `api`; samakan password di env |
| Login OK tapi SSO gagal | Callback URL salah | Samakan `SSO_REDIRECT_URI` dengan IdP |
| Cookie tidak tersimpan | HTTP + `COOKIE_SECURE=true` | Set `COOKIE_SECURE=false` atau pakai HTTPS |
| Image pull failed | GHCR private / belum build | Publickan package atau login registry |
| Halaman putih | `web` belum healthy | `docker compose logs web` |

---

## File terkait

| File | Fungsi |
| --- | --- |
| [`docker-compose.yml`](docker-compose.yml) | Definisi stack (paste ke Portainer/Dokploy) |
| [`docker/.env.example`](docker/.env.example) | Template env manual |
| [`scripts/generate-stack-env.sh`](scripts/generate-stack-env.sh) | Generate `.env` + secret otomatis |
| [`.github/workflows/docker-ghcr.yml`](.github/workflows/docker-ghcr.yml) | Build image otomatis ke GHCR |
| [`scripts/docker-build.sh`](scripts/docker-build.sh) | Build/push manual ke GHCR |

Image yang dipakai:

```text
ghcr.io/ardianryan/sintesa-api:latest
ghcr.io/ardianryan/sintesa-web:latest
```