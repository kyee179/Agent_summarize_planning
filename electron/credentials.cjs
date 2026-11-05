const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const KEYS = new Set(['AI_PROVIDER', 'GLM_API_KEY', 'GLM_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'GROQ_API_KEY', 'GROQ_MODEL',
  'GEMINI_API_KEY', 'GEMINI_MODEL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TAVILY_API_KEY', 'WEB_SEARCH_PROVIDER']);

function createCredentials({ file, safeStorage, env = process.env, platform = process.platform }) {
  let saved = {}, loadError = false;
  const available = () => safeStorage.isEncryptionAvailable() && (platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
  const status = () => ({ secureStorage: available(), saved: Object.keys(saved).length > 0, recoveryRequired: loadError,
    configured: Object.fromEntries([...KEYS].filter(k => /KEY$|CLIENT_ID$/.test(k)).map(k => [k, Boolean(saved[k] || env[k])])) });
  return {
    status,
    load() {
      if (!fs.existsSync(file)) return;
      try {
        if (!available()) throw Error('unavailable');
        const value = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
        if (value.version !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values) || Object.entries(value.values).some(([k, v]) => (!KEYS.has(k) && k !== 'INTEGRATION_ENCRYPTION_KEY') || typeof v !== 'string')) throw Error('invalid');
        saved = value.values; Object.assign(env, saved);
      } catch { loadError = true; }
    },
    save(input) {
      if (loadError) throw Error('Saved credentials could not be unlocked. Restore the original OS profile before changing configuration.');
      if (!available()) throw Error('Secure operating-system storage is unavailable. Local rules remain available.');
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !KEYS.has(k) && k !== 'googleDesktopJson')) throw Error('Unsupported setup field');
      const values = { ...saved }, fields = { ...input };
      if (fields.googleDesktopJson) {
        let client;
        try { client = JSON.parse(fields.googleDesktopJson).installed; } catch { /* static error below */ }
        if (!client || client.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' || client.token_uri !== 'https://oauth2.googleapis.com/token' ||
          !Array.isArray(client.redirect_uris) || !client.redirect_uris.some(u => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(u)) || typeof client.client_id !== 'string' || typeof client.client_secret !== 'string')
          throw Error('Choose a valid Google Desktop OAuth client JSON with official Google endpoints and a loopback redirect.');
        fields.GOOGLE_CLIENT_ID = client.client_id; fields.GOOGLE_CLIENT_SECRET = client.client_secret;
      }
      delete fields.googleDesktopJson;
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) { delete values[key]; continue; }
        if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) throw Error('Setup values must be single-line text of up to 4096 characters');
        if (value.trim()) values[key] = value.trim(); // An empty password field preserves the saved key.
      }
      if (values.AI_PROVIDER && !['local', 'glm', 'openai', 'groq', 'gemini'].includes(values.AI_PROVIDER)) throw Error('Choose a supported AI service');
      if (values.WEB_SEARCH_PROVIDER && values.WEB_SEARCH_PROVIDER !== 'tavily') throw Error('Choose Tavily for desktop setup');
      values.INTEGRATION_ENCRYPTION_KEY = saved.INTEGRATION_ENCRYPTION_KEY || env.INTEGRATION_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
      const encrypted = safeStorage.encryptString(JSON.stringify({ version: 1, values }));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try { fs.writeFileSync(temporary, encrypted, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      saved = values;
      return { ...status(), restartRequired: true };
    }
  };
}
module.exports = { createCredentials };
