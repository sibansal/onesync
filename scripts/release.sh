#!/usr/bin/env bash
set -euo pipefail

# OneSync Production Release Script for macOS Apple Silicon
# Author: https://sibansal.dev/

echo "==> Starting OneSync macOS Release Pipeline..."

SIGNING_ENV=".env.signing"

if [ -f "$SIGNING_ENV" ]; then
  echo "==> Loading signing credentials from $SIGNING_ENV..."
  # Export variables from .env.signing
  set -a
  # shellcheck source=/dev/null
  source "$SIGNING_ENV"
  set +a
else
  echo "==> Warning: $SIGNING_ENV not found. Build will proceed unsigned."
fi

echo "==> Running full test & lint validation (npm run check)..."
npm run check

echo "==> Building production bundles (npm run build)..."
npm run build

echo "==> Packaging Apple Silicon DMG & ZIP..."
npx electron-builder --mac --arm64

echo "==> Computing SHA-256 checksums of release artifacts..."
mkdir -p dist
shasum -a 256 dist/*.dmg dist/*.zip || true

echo "==> Release packaging complete! Artifacts are in dist/"
