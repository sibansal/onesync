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

# Determine branch name and sanitize slashes for filesystem naming safety
BRANCH_NAME="${RELEASE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")}"
SAFE_BRANCH=$(echo "$BRANCH_NAME" | tr '/' '-' | tr ' ' '-')
ARTIFACT_PATTERN="OneSync-${SAFE_BRANCH}-\${arch}.\${ext}"

echo "==> Running full test & lint validation (npm run check)..."
npm run check

echo "==> Building production bundles (npm run build)..."
npm run build

echo "==> Cleaning previous release artifacts in dist/..."
mkdir -p dist
rm -f dist/*.dmg dist/*.zip dist/*.blockmap dist/*checksums*.txt dist/*checksums*.zip

echo "==> Packaging Apple Silicon DMG & ZIP as OneSync-${SAFE_BRANCH}-[arch].[ext]..."
npx electron-builder --mac --arm64 \
  -c.mac.artifactName="${ARTIFACT_PATTERN}" \
  -c.artifactName="${ARTIFACT_PATTERN}"

echo "==> Generating checksums file (dist/onesync-${SAFE_BRANCH}-checksums.txt)..."
(
  cd dist

  # 1. Locate generated DMG and ZIP release files
  DMG_FILE=$(ls OneSync-*.dmg 2>/dev/null | head -n 1 || true)
  ZIP_FILE=$(ls OneSync-*.zip 2>/dev/null | head -n 1 || true)

  BRANCH_CHECKSUMS="onesync-${SAFE_BRANCH}-checksums.txt"

  # 2. Compute SHA-256 for release distribution files
  {
    echo "Algorithm: SHA-256"
    if [ -n "$DMG_FILE" ] && [ -f "$DMG_FILE" ]; then
      DMG_SHA256=$(shasum -a 256 "$DMG_FILE" | awk '{print $1}')
      echo "${DMG_SHA256}  ${DMG_FILE}"
    fi
    if [ -n "$ZIP_FILE" ] && [ -f "$ZIP_FILE" ]; then
      ZIP_SHA256=$(shasum -a 256 "$ZIP_FILE" | awk '{print $1}')
      echo "${ZIP_SHA256}  ${ZIP_FILE}"
    fi
  } > "$BRANCH_CHECKSUMS"

  # Maintain standard checksums.txt pointing to the same contents
  cp "$BRANCH_CHECKSUMS" checksums.txt

  echo "==> Computed release checksums ($BRANCH_CHECKSUMS):"
  cat "$BRANCH_CHECKSUMS"
)

echo "==> Release packaging complete! Artifacts are in dist/:"
ls -lh dist/*.dmg dist/*.zip dist/*checksums*.txt
