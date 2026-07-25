# Shopee Scraper API (Taiwan)

API ringan untuk mengambil data detail produk Shopee Taiwan **tanpa layanan
scraping pihak ketiga (misalnya ScraperAPI/Scrapeless/dll)** dan **tanpa
headless browser**. Server hanya melakukan HTTP request langsung (via
`axios`) ke endpoint publik yang sama dengan yang dipanggil browser saat kamu
membuka halaman produk di `shopee.tw`.

## Cara kerja

1. **Strategi 1 - panggil JSON API Shopee langsung**
   `GET https://shopee.tw/api/v4/pdp/get_pc?item_id={dealid}&shop_id={storeid}`
   Ini endpoint publik yang sama yang dipakai frontend `shopee.tw` sendiri.
2. **Strategi 2 - fallback ke HTML** kalau API di atas diblokir/rate-limited:
   ambil `https://shopee.tw/view/{dealid}`, lalu ambil data dari
   `window.__INITIAL_STATE__` (kalau ada) atau dari meta tag `og:title`,
   `og:description`, `og:image` sebagai upaya terakhir.
3. Hasil di-cache in-memory (default 10 menit, atur lewat `CACHE_TTL`) supaya
   item yang sama tidak selalu memicu request baru ke Shopee.

Tidak ada Puppeteer/Playwright/browser sungguhan yang dijalankan — jadi
memory footprint kecil dan cocok untuk instance kecil.

## Keterbatasan yang perlu kamu tahu

- Endpoint `get_pc` **tidak didokumentasikan resmi oleh Shopee** dan bisa
  berubah/diblokir sewaktu-waktu tanpa pemberitahuan. Kalau strategi 1 & 2
  gagal, API akan mengembalikan error (bukan data palsu) - lihat field
  `error.message` di response.
- Shopee bisa menerapkan rate limiting / IP blocking berdasarkan traffic dari
  IP kamu. Atur `SCRAPER_RATE_LIMIT` lebih kecil dan jaga jeda antar request
  kalau ingin scraping dalam volume besar.
- Gunakan sesuai [Ketentuan Layanan Shopee](https://shopee.tw) dan hukum yang
  berlaku di wilayahmu - project ini hanya alat teknis, bukan nasihat hukum.

## Instalasi

### Prasyarat
- Node.js 18+
- npm

### Setup

```bash
npm install
cp .env.example .env   # sudah disediakan file .env default, edit sesuai kebutuhan
npm run build
npm start
```

Untuk mode development (auto reload via ts-node, tanpa build dulu):

```bash
npm run dev
```

## Endpoint

| Method | Path                                      | Keterangan                          |
|--------|-------------------------------------------|--------------------------------------|
| GET    | `/health`                                  | Status server + info proxy           |
| GET    | `/config`                                  | Konfigurasi scraper aktif            |
| GET    | `/info`                                    | Info umum API                        |
| GET    | `/shopee?storeid={STORE_ID}&dealid={PRODUCT_ID}` | Ambil data produk               |

Contoh:

```bash
curl "http://localhost:3000/shopee?storeid=123456&dealid=987654321"
```

`storeid` = shop id, `dealid` = item id. Keduanya bisa dilihat dari URL produk
Shopee, contoh `https://shopee.tw/product-name-i.{storeid}.{dealid}`.

## Konfigurasi (.env)

Lihat `.env.example` untuk daftar lengkap. Yang penting:

- `CACHE_TTL` - berapa lama (detik) hasil di-cache sebelum request ulang.
- `SCRAPER_RATE_LIMIT`, `SCRAPER_RETRIES`, `SCRAPER_RETRY_DELAY` - kontrol
  kecepatan & retry request ke Shopee.
- `PROXY_ENABLED` / `PROXY_URL` / `PROXY_LIST` - opsional, hanya kalau kamu
  sudah punya proxy sendiri (bukan proxy gratis publik yang tidak jelas
  keamanannya).

## Lisensi

MIT - lihat `LICENSE.txt`.
