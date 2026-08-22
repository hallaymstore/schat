const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const publicVendorDir = path.join(rootDir, 'public', 'vendor');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      copyFile(sourcePath, targetPath);
    }
  }
}

function main() {
  ensureDir(publicVendorDir);

  const fontAwesomeRoot = path.join(rootDir, 'node_modules', '@fortawesome', 'fontawesome-free');
  copyFile(
    path.join(fontAwesomeRoot, 'css', 'all.min.css'),
    path.join(publicVendorDir, 'fontawesome', 'css', 'all.min.css')
  );
  copyDirectory(
    path.join(fontAwesomeRoot, 'webfonts'),
    path.join(publicVendorDir, 'fontawesome', 'webfonts')
  );

  copyFile(
    path.join(rootDir, 'node_modules', 'webrtc-adapter', 'out', 'adapter.js'),
    path.join(publicVendorDir, 'adapter-latest.js')
  );

  console.log('Realtime vendor assets copied to public/vendor');
}

main();
