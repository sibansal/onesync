#!/usr/bin/env bash
set -euo pipefail

# OneSync Production Release Script for macOS Apple Silicon
# Author: https://sibansal.dev/

echo "==> Starting OneSync macOS Release Pipeline..."

SIGNING_ENV=".env.signing"
NOTARIZE_FLAG="-c.mac.notarize=false"
SIGN_IDENTITY_FLAG=""
DMG_SIGN_IDENTITY="-"

if [ -f "$SIGNING_ENV" ]; then
  echo "==> Loading signing credentials from $SIGNING_ENV..."
  # Export variables from .env.signing
  set -a
  # shellcheck source=/dev/null
  source "$SIGNING_ENV"
  set +a
fi

if [ -n "${CSC_LINK:-}" ] || [ -n "${CSC_NAME:-}" ]; then
  echo "==> Developer ID certificate detected: signing with Apple Developer credentials..."
  if [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
    echo "==> Apple notarization credentials detected: enabling notarization..."
    NOTARIZE_FLAG="-c.mac.notarize=true"
  fi
  if [ -n "${CSC_NAME:-}" ]; then
    SIGN_IDENTITY_FLAG="-c.mac.identity=${CSC_NAME}"
    DMG_SIGN_IDENTITY="${CSC_NAME}"
  fi
else
  echo "==> Notice: No Developer ID certificate specified."
  echo "==> Applying valid ad-hoc code signature (identity: '-') with hardened runtime entitlements..."
  SIGN_IDENTITY_FLAG="-c.mac.identity=-"
  DMG_SIGN_IDENTITY="-"
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
# shellcheck disable=SC2086
npx electron-builder --mac --arm64 \
  -c.mac.artifactName="${ARTIFACT_PATTERN}" \
  -c.artifactName="${ARTIFACT_PATTERN}" \
  ${SIGN_IDENTITY_FLAG} \
  ${NOTARIZE_FLAG}

echo "==> Verifying signature on packaged application..."
if [ -d "dist/mac-arm64/OneSync.app" ]; then
  codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/OneSync.app"
  echo "==> Verification passed: dist/mac-arm64/OneSync.app signature is valid."
fi

# Locate generated DMG file
DMG_PATH=$(ls dist/OneSync-*.dmg 2>/dev/null | head -n 1 || true)
if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
  echo "==> Signing DMG disk image (${DMG_PATH}) with identity '${DMG_SIGN_IDENTITY}'..."
  codesign --force --sign "${DMG_SIGN_IDENTITY}" "$DMG_PATH" 2>/dev/null || true
  codesign --verify --verbose=2 "$DMG_PATH" 2>/dev/null || true
fi

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

if [ "${DMG_SIGN_IDENTITY}" = "-" ]; then
  echo ""
  echo "========================================================================="
  echo "NOTE FOR AD-HOC SIGNED BUILDS (GATEKEEPER):"
  echo "Because this build was signed without an Apple Developer ID certificate,"
  echo "macOS Gatekeeper will quarantine downloaded files from the web."
  echo "To open the app on target machines without warnings, users can:"
  echo "  1) Right-click OneSync.app -> click 'Open' -> click 'Open'"
  echo "  2) Or run in Terminal: xattr -cr /Applications/OneSync.app"
  echo "========================================================================="
fi
