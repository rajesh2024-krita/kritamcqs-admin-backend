#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This helper supports Debian/Ubuntu servers with apt-get." >&2
  echo "Install Chrome runtime libraries for your Linux distribution, then restart the backend." >&2
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

$SUDO apt-get update
$SUDO apt-get install -y \
  ca-certificates \
  fonts-liberation \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libexpat1 \
  libfontconfig1 \
  libgcc-s1 \
  libglib2.0-0 \
  libgtk-3-0 \
  libxkbcommon0 \
  libnspr4 \
  libnss3 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  libgbm1 \
  libasound2 \
  lsb-release \
  wget \
  xdg-utils

if command -v npx >/dev/null 2>&1; then
  npx puppeteer browsers install chrome
else
  echo "npx was not found. Run 'npm install' and then 'npx puppeteer browsers install chrome' before starting the backend." >&2
fi
