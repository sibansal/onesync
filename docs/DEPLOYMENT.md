Author: https://sibansal.dev/

# OneSync — Deployment & Operations Guide

## 1. Prerequisites
- Apple Silicon Mac (M1/M2/M3/M4) running macOS Monterey 12.0 or newer.
- Xcode Command Line Tools installed (`xcode-select --install`).
- Node.js ≥ 20 (install and use via `nvm use`).
- Active Microsoft Azure / Entra ID account (personal or work).

---

## 2. Azure App Registration (Step-by-Step)

Follow these exact steps to obtain a valid Client ID for OneSync:

1. Sign in to the **[Azure Portal](https://portal.azure.com/)**.
2. Navigate to **Microsoft Entra ID** > **App registrations** > **New registration**.
3. Fill in registration details:
   - **Name:** `OneSync`
   - **Supported account types:** Select *Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)*.
   - **Redirect URI:** Platform dropdown: **Mobile and desktop applications**. Enter: `http://localhost:53682` and `http://localhost`.
4. Click **Register**.
5. On the **Overview** page, copy the **Application (client) ID**. This is your `MAIN_VITE_MS_CLIENT_ID`.
6. Under **Manage** in the sidebar:
   - Click **Authentication**:
     - Under **Platform configurations**, ensure **Mobile and desktop applications** has `http://localhost:53682` and `http://localhost`.
     - Under *Advanced settings* > *Allow public client flows*, set **Enable the following mobile and desktop flows** to **Yes**.
     - Click **Save**.
   - Click **API permissions**:
     - Verify or add Microsoft Graph **Delegated permissions**:
       - `Files.Read` (Read user files)
       - `User.Read` (Sign in and read user profile)
       - `offline_access` (Maintain access to data you have given it access to)
     - Click **Add permissions**.
   - *Note:* No client secret or certificate is needed because MSAL Node uses PKCE for public desktop clients.

---

## 3. Running Locally

### Development with Real OneDrive & External Drive
```bash
cp .env.example .env.development
```
Edit `.env.development`:
```ini
MAIN_VITE_MS_CLIENT_ID=your-azure-client-id
```
Start the desktop application:
```bash
npm run dev
```

### Offline Development (No Azure & No External Drive)
You can develop and test the entire UI and sync lifecycle using the built-in `MockDrive` on an internal directory:
```ini
MAIN_VITE_USE_MOCK_DRIVE=true
MAIN_VITE_ALLOW_INTERNAL_DESTINATION=true
```
Run `npm run dev`. OneSync will simulate OneDrive items and accept folders anywhere on your filesystem.

---

## 4. Building the Application

Build the production binaries (DMG installer and ZIP archive for Apple Silicon):
```bash
cp .env.example .env.production
# Ensure your valid Client ID is populated in .env.production
npm run dist:mac
```
Output artifacts are generated in `dist/`:
- `dist/OneSync-1.0.0-arm64.dmg`
- `dist/OneSync-1.0.0-arm64.zip`

---

## 5. Installing Locally (Unsigned Build)

If installing an unsigned build generated on your machine:
1. Double-click the `.dmg` in `dist/` and drag `OneSync.app` to `/Applications`.
2. On initial launch, if Gatekeeper warns that the app cannot be opened:
   - Right-click `OneSync.app` in `/Applications` and select **Open**, then confirm **Open**.
   - Alternatively, remove the quarantine bit in Terminal:
     ```bash
     xattr -cr /Applications/OneSync.app
     ```

---

## 6. Code Signing & Notarization (for Distribution)

To distribute OneSync to other Mac users without Gatekeeper warnings, sign with your Apple Developer ID:

1. Obtain a **Developer ID Application** certificate from developer.apple.com.
2. Export the certificate and private key as a `.p12` file.
3. Generate an App-Specific Password at appleid.apple.com.
4. Create `.env.signing` (never commit this file):
   ```ini
   CSC_LINK=/path/to/DeveloperID.p12
   CSC_KEY_PASSWORD=your-p12-password
   APPLE_ID=your-apple-id@example.com
   APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop
   APPLE_TEAM_ID=XXXXXXXXXX
   ```
5. Run the release script:
   ```bash
   npm run release:mac
   ```
6. Verify notarization and stapling:
   ```bash
   codesign --verify --deep --strict --verbose=2 /Applications/OneSync.app
   spctl -a -vv /Applications/OneSync.app
   xcrun stapler validate dist/OneSync-1.0.0-arm64.dmg
   ```

---

## 7. Export and Distribution

1. Compute SHA-256 checksums of the release artifacts:
   ```bash
   shasum -a 256 dist/*.dmg dist/*.zip > dist/SHA256SUMS.txt
   ```
2. Create a GitHub Release (via `gh` CLI):
   ```bash
   gh release create v1.0.0 dist/*.dmg dist/*.zip dist/SHA256SUMS.txt --title "OneSync v1.0.0" --notes "Release v1.0.0 for macOS Apple Silicon"
   ```

---

## 8. Continuous Integration & Delivery

- **CI (`.github/workflows/ci.yml`):** Runs on every Pull Request to `main`. Executes on `macos-14` (Apple Silicon runner), runs `npm ci`, executes `npm run check` (typecheck, lint, unit tests), and validates `npm run build`.
- **Release (`.github/workflows/release.yml`):** Triggers on pushed semantic tags (`v*`). Decrypts signing certificates from GitHub Secrets, builds signed arm64 DMG/ZIP bundles, notarizes through Apple Notary service, and creates the GitHub Release with checksums.

---

## 9. Versioning

Update versioning adhering to SemVer:
```bash
npm version patch # or minor | major
git push origin main --tags
```

---

## 10. Operational Troubleshooting

| Issue | Resolution |
|---|---|
| **`better-sqlite3` ABI Error** | Occurs if compiled against Node rather than Electron. Run `npm run postinstall` to rebuild native modules via `electron-builder install-app-deps`. |
| **"OneSync is damaged and cannot be opened"** | Gatekeeper quarantine flag active. Run `xattr -cr /Applications/OneSync.app`. |
| **Permission prompt for Removable Volumes** | macOS requires permission to access external disks. Navigate to **System Settings > Privacy & Security > Files and Folders > OneSync** and toggle **Removable Volumes** to On. |
| **`AADSTS50011`: The reply URL specified in the request does not match** | Ensure the Azure App Registration has a redirect URI configured under **Mobile and desktop applications** set to `http://localhost`. |
| **`AADSTS700016`: Application with identifier was not found** | Verify `MAIN_VITE_MS_CLIENT_ID` matches your Azure Application (client) ID. |
| **NTFS volume read-only** | macOS does not natively write to NTFS formatted partitions. Format the external drive as **APFS** (optimal for Mac) or **exFAT** (cross-platform). |
| **Resetting Local App State** | Delete `~/Library/Application Support/onesync/settings.json` and `~/Library/Application Support/onesync/token-cache.bin`. The external drive's `<Folder>/.onesync` can remain intact. |
