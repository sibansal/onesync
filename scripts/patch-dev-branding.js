const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const plistPath = path.join(
  rootDir,
  'node_modules/electron/dist/Electron.app/Contents/Info.plist'
);
const icnsTarget = path.join(
  rootDir,
  'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns'
);
const iconSrc = path.join(rootDir, 'build/icon.icns');

try {
  if (fs.existsSync(plistPath)) {
    let content = fs.readFileSync(plistPath, 'utf8');
    content = content.replace(
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]+<\/string>/g,
      '<key>CFBundleDisplayName</key>\n\t<string>OneSync</string>'
    );
    content = content.replace(
      /<key>CFBundleName<\/key>\s*<string>[^<]+<\/string>/g,
      '<key>CFBundleName</key>\n\t<string>OneSync</string>'
    );
    fs.writeFileSync(plistPath, content, 'utf8');
  }

  if (fs.existsSync(iconSrc) && fs.existsSync(path.dirname(icnsTarget))) {
    fs.copyFileSync(iconSrc, icnsTarget);
  }
} catch {
  // Silent ignore if permissions or directories differ
}
