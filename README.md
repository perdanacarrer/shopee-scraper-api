# Shopee Scraper API

An undetectable, scalable API for scraping Shopee Taiwan product data with anti-detection mechanisms.

## Features

- **Undetectable Scraping**: Advanced anti-detection techniques including:
  - Random user agent rotation
  - Request timing randomization
  - Browser-like headers
  - API fallback (get_pc → get_rw)
  - Request retry with exponential backoff
  - Cache layer to reduce requests

- **Scalable Architecture**:
  - In-memory caching with TTL
  - Rate limiting
  - Batch processing support
  - Error handling and recovery

- **Robust API**:
  - RESTful endpoints
  - Input validation
  - Health check endpoint
  - Detailed logging

## Installation

### Prerequisites
- Node.js 16+
- npm or yarn

### Important Note
- Switch to a paid residential proxy that is genuinely from Taiwan, change value PROXY_URL and PROXY_LIST in .env.example before you do cp .env.example .env
- If you encounter error 90309999, it is likely because your current IP address has been flagged as "suspicious." Try using a new or clean IP address or proxy.  

### Setup

```bash
# Clone the repository
git clone https://github.com/perdanacarrer/shopee-scraper-api.git
cd shopee-scraper-api

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Build the project
npm run build

# Start the server
npm start