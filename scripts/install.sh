#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# OneSync Automated Installer for macOS (Apple Silicon)
# Author: https://sibansal.dev/
# Repository: https://github.com/sibansal/onesync
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sibansal/onesync/main/scripts/install.sh | bash
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[32m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

echo -e "${BOLD}${BLUE}"
cat << 'EOF'
   ____             _____                 
  / __ \____  ___  / ___/__  ______  _____
 / / / / __ \/ _ \ \__ \/ / / / __ \/ ___/
/ /_/ / / / /  __/ ___/ / /_/ / / / / /__  
\____/_/ /_/\___/ /____/\__, /_/ /_/\___/  
                       /____/              
EOF
echo -e "${RESET}"
echo -e "${BOLD}OneSync — macOS Apple Silicon OneDrive Mirror Installer${RESET}"
echo "---------------------------------------------------------"

# 1. Verify operating system
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Darwin" ]; then
  echo -e "${RED}Error: OneSync is only supported on macOS (Darwin). Detected: ${OS}${RESET}" >&2
  exit 1
fi

if [ "$ARCH" != "arm64" ]; then
  echo -e "${YELLOW}Warning: OneSync is natively compiled for Apple Silicon (arm64: M1/M2/M3/M4).${RESET}"
  echo -e "${YELLOW}Detected architecture: ${ARCH}. The application may require Rosetta 2.${RESET}"
fi

# 2. Determine target version and download URL
REPO="sibansal/onesync"
TEMP_DIR="$(mktemp -d /tmp/onesync-install.XXXXXX)"

cleanup() {
  if [ -d "${MOUNT_DIR:-}" ]; then
    diskutil eject "$MOUNT_DIR" >/dev/null 2>&1 || hdiutil detach "$MOUNT_DIR" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

echo -e "==> ${BLUE}Locating latest release from GitHub (${REPO})...${RESET}"

RELEASE_JSON=""
if command -v curl >/dev/null 2>&1; then
  RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)"
fi

DMG_URL=""
VERSION=""

if [ -n "$RELEASE_JSON" ]; then
  VERSION="$(echo "$RELEASE_JSON" | grep -m1 '"tag_name":' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/' || true)"
  DMG_URL="$(echo "$RELEASE_JSON" | grep -m1 '"browser_download_url":.*\.dmg"' | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/' || true)"
fi

# Fallback if API rate-limited or no releases marked latest
if [ -z "$DMG_URL" ]; then
  VERSION="${ONESYNC_VERSION:-v1.0.0-beta.1}"
  # Ensure version starts with 'v' for tag URL
  if [[ "$VERSION" != v* ]]; then
    TAG="v${VERSION}"
  else
    TAG="${VERSION}"
  fi
  CLEAN_VER="${TAG#v}"
  DMG_URL="https://github.com/${REPO}/releases/download/${TAG}/OneSync-release-${TAG}-arm64.dmg"
fi

echo -e "==> Target Version: ${GREEN}${VERSION:-latest}${RESET}"
echo -e "==> Download URL:   ${BLUE}${DMG_URL}${RESET}"

# 3. Download the DMG
DMG_PATH="${TEMP_DIR}/OneSync.dmg"

if [ -n "${ONESYNC_LOCAL_DMG:-}" ] && [ -f "${ONESYNC_LOCAL_DMG}" ]; then
  echo -e "==> ${GREEN}Using local DMG: ${ONESYNC_LOCAL_DMG}${RESET}"
  cp "${ONESYNC_LOCAL_DMG}" "$DMG_PATH"
else
  echo -e "==> Downloading OneSync disk image..."
  if ! curl -fL --progress-bar "$DMG_URL" -o "$DMG_PATH"; then
    # Try alternative naming scheme fallback
    ALT_DMG_URL="https://github.com/${REPO}/releases/download/${TAG:-v1.0.0-beta.1}/OneSync-${CLEAN_VER:-1.0.0-beta.1}-arm64.dmg"
    echo -e "==> Retrying with alternate artifact path: ${ALT_DMG_URL}..."
    curl -fL --progress-bar "$ALT_DMG_URL" -o "$DMG_PATH"
  fi
fi

if [ ! -s "$DMG_PATH" ]; then
  echo -e "${RED}Error: Failed to download OneSync DMG file.${RESET}" >&2
  exit 1
fi

# 4. Mount the DMG image
MOUNT_DIR="${TEMP_DIR}/mount"
mkdir -p "$MOUNT_DIR"
echo -e "==> Mounting DMG image..."
hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet

APP_SOURCE="${MOUNT_DIR}/OneSync.app"
if [ ! -d "$APP_SOURCE" ]; then
  echo -e "${RED}Error: OneSync.app not found inside DMG image.${RESET}" >&2
  exit 1
fi

# 5. Terminate existing instance if currently running
if pgrep -x "OneSync" >/dev/null 2>&1; then
  echo -e "==> ${YELLOW}Stopping currently running OneSync instance...${RESET}"
  killall "OneSync" >/dev/null 2>&1 || true
  sleep 1
fi

# 6. Install to /Applications
TARGET_APP="/Applications/OneSync.app"
echo -e "==> Installing OneSync to ${GREEN}${TARGET_APP}${RESET}..."
if [ -d "$TARGET_APP" ]; then
  rm -rf "$TARGET_APP"
fi

ditto "$APP_SOURCE" "$TARGET_APP"

# 7. Unmount the DMG
echo -e "==> Unmounting DMG..."
diskutil eject "$MOUNT_DIR" >/dev/null 2>&1 || hdiutil detach "$MOUNT_DIR" -force >/dev/null 2>&1 || true

# 8. Clear Gatekeeper quarantine attributes to prevent malware warnings
echo -e "==> ${GREEN}Clearing Gatekeeper quarantine attribute (bypassing malware warning)...${RESET}"
xattr -cr "$TARGET_APP" 2>/dev/null || true

# 9. Verify code signature
if command -v codesign >/dev/null 2>&1; then
  if codesign --verify --deep --strict "$TARGET_APP" >/dev/null 2>&1; then
    echo -e "==> ${GREEN}Code signature verified successfully.${RESET}"
  fi
fi

echo ""
echo -e "${BOLD}${GREEN}✔ OneSync has been successfully installed to /Applications!${RESET}"
echo ""
echo "You can launch OneSync from Launchpad, Spotlight (Cmd+Space -> OneSync),"
echo "or by running:"
echo "    open /Applications/OneSync.app"
echo ""

# Launch if in interactive terminal
if [ -t 0 ] && [ "${CI:-}" != "true" ]; then
  read -r -p "Would you like to open OneSync now? [Y/n] " RESP
  case "$RESP" in
    [nN][oO]|[nN])
      echo "Enjoy using OneSync!"
      ;;
    *)
      open "$TARGET_APP"
      ;;
  esac
else
  # Non-interactive shell: automatically open app
  open "$TARGET_APP" || true
fi
