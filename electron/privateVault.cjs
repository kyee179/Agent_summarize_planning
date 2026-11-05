const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// A small OS-backed vault for remembered account refresh tokens; never renderer storage.
function createPrivateVault({ file, safeStorage, platform = process.platform }) {
  const available = () => Boolean(safeStorage?.isEncryptionAvailable()) && (platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  return {
    available,
    read() {
      if (!fs.existsSync(file)) return null;
      if (!available()) throw new Error('Secure OS storage is unavailable. Sign in without remember-me.');
      try { const result = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); if (result.version !== 1) throw Error(); return result.value; }
      catch { throw new Error('Saved sign-in could not be unlocked. Sign in again.'); }
    },
    write(value) {
      if (!available()) throw new Error('Secure OS storage is unavailable. Sign in without remember-me.');
      const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, value }));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    },
    clear() { if (fs.existsSync(file)) fs.unlinkSync(file); }
  };
}
module.exports = { createPrivateVault };
