// The app uses its production gateway and actual Supabase SDK; only HTTPS transport is synthetic.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { hostedFixture } = require('./fixtures/hosted-auth.cjs');
app.setPath('userData', process.env.CALENDAR_SMOKE_DIRECTORY);
app.setPath('sessionData', process.env.CALENDAR_SMOKE_DIRECTORY);
app.disableHardwareAcceleration();
const backend = require('../server/index.cjs'), originalStart = backend.startServer, hosted = hostedFixture();
backend.startServer = options => originalStart({ ...options, env: { SUPABASE_URL: 'https://synthetic-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_' + 'x'.repeat(32) }, authOptions: { fetchImpl: hosted.fetch } });
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    window.webContents.setBackgroundThrottling(false);
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const until = async (condition, label) => { for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error(label); };
        const heading = text => until(() => document.querySelector('h1,h2')?.textContent === text || Array.from(document.querySelectorAll('h1,h2')).some(element => element.textContent === text), text);
        const click = text => { const button = Array.from(document.querySelectorAll('button')).find(element => element.textContent === text); if (!button) throw new Error('Missing ' + text); button.click(); };
        const change = (label, value) => { const input = Array.from(document.querySelectorAll('label')).find(element => element.firstChild.textContent === label)?.querySelector('input'); if (!input) throw new Error('Missing input ' + label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
        const call = window.studyCalendar.request;
        await heading('Welcome back');
        if ((await call('/api/journals')).status !== 401) throw new Error('Unlocked initial account');
        click('Create account'); await heading('Create your account'); change('Your name', 'Reader'); change('Email', 'new@example.test'); change('Password', 'correct-password-123'); change('Confirm password', 'correct-password-123');
        document.querySelector('form').requestSubmit(); await heading('Confirm your email'); change('Email verification code', '12345678'); document.querySelector('form').requestSubmit(); await heading('Welcome back');
        click('Forgot password?'); await heading('Reset your password'); document.querySelector('form').requestSubmit(); await heading('Choose a new password'); change('Email verification code', '12345678'); change('New password', 'new-password-123456'); change('Confirm password', 'new-password-123456'); document.querySelector('form').requestSubmit(); await heading('Welcome back');
        const login = async (email, firstTime) => {
          await until(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Sign in' && !button.disabled), 'Sign-in ready');
          change('Email', email); change('Password', 'correct-password-123');
          const remember = document.querySelector('input[type="checkbox"]'); if (remember && !remember.disabled && !remember.checked) remember.click();
          await new Promise(resolve => setTimeout(resolve, 0)); document.querySelector('form').requestSubmit();
          if (firstTime) {
            await heading('Make room for your day'); document.querySelector('form').requestSubmit(); await heading('Choose how to prepare plans'); document.querySelector('form').requestSubmit(); await heading('A workspace that belongs to you');
            const copy = document.querySelector('input[type="checkbox"]'); if (copy?.checked) throw new Error('Local copy implicitly selected'); document.querySelector('form').requestSubmit();
          }
          await until(() => document.querySelector('.primary-nav') && !document.querySelector('.workspace-loading'), 'Workspace load');
        };
        const logout = async () => {
          document.querySelector('.account-button').click(); await until(() => document.querySelector('dialog'), 'Account dialog'); click('Sign out / switch account'); await heading('Welcome back');
          if (document.querySelector('.primary-nav')) throw new Error('Old UI survived sign-out');
        };
        await login('a@example.test', true);
        const a = (await call('/api/auth/status')).body.session.id;
        const journal = await call('/api/journals', { method: 'POST', body: JSON.stringify({ title: 'Account A private', type: 'daily', journalDate: '2030-01-07', content: '我需要检查合成测试报告。' }) });
        if (journal.status !== 201) throw new Error('Account A save');
        const setup = await window.studyCalendar.setupStatus();
        if (setup.secureStorage) { await window.studyCalendar.saveSetup({ AI_PROVIDER: 'local', GLM_API_KEY: 'synthetic-account-a-private-key' }); window.dispatchEvent(new Event('calendar:auth-changed')); await new Promise(resolve => setTimeout(resolve, 50)); await until(() => document.querySelector('.primary-nav') && !document.querySelector('.workspace-loading'), 'Service setup reload'); }
        await logout();
        await login('b@example.test', true);
        if ((await call('/api/journals')).body.length !== 0) throw new Error('A journal leaked to B');
        if ((await window.studyCalendar.setupStatus()).configured.GLM_API_KEY) throw new Error('A service key leaked to B');
        if (JSON.stringify((await call('/api/account/export')).body).includes('Account A private')) throw new Error('A export leaked to B');
        if ((await call('/api/journals/' + journal.body.id + '/apply-drafts', { method: 'POST', body: JSON.stringify({ analysisId: 'analysis-from-a' }) })).status !== 404) throw new Error('Account B ownership check failed');
        await logout(); await login('a@example.test', false);
        if ((await call('/api/journals')).body[0]?.id !== journal.body.id) throw new Error('A workspace not restored');
        if (setup.secureStorage && !(await window.studyCalendar.setupStatus()).configured.GLM_API_KEY) throw new Error('A service configuration not restored');
        if ((await call('/api/auth/status')).body.session.id !== a) throw new Error('Identity mapping changed');
        if ('accessToken' in window.studyCalendar || 'refreshToken' in window.studyCalendar || 'sessionToken' in window.studyCalendar) throw new Error('Credential exposed by preload');
        return { a, secureStorage: setup.secureStorage };
      })()`);
      if (result.secureStorage) {
        const credentials = path.join(process.env.CALENDAR_SMOKE_DIRECTORY, 'profiles', result.a, 'credentials.encrypted');
        if (fs.readFileSync(credentials).includes('synthetic-account-a-private-key')) throw new Error('Profile credential plaintext');
        const remembered = path.join(process.env.CALENDAR_SMOKE_DIRECTORY, 'session.encrypted');
        if (!fs.existsSync(remembered) || fs.readFileSync(remembered).includes('synthetic-refresh-')) throw new Error('Remembered session plaintext');
      }
      if (!hosted.calls.some(call => call.path.endsWith('/verify')) || !hosted.calls.some(call => call.path.endsWith('/user') && call.method === 'PUT')) throw new Error('Hosted confirmation/recovery was not exercised');
      console.log('Hosted desktop smoke passed: actual SDK, signup, confirmation, recovery, account A/B isolation, onboarding, per-profile credentials, sign-out and return sign-in. Synthetic transport only.'); app.quit();
    } catch (error) { const state = await window.webContents.executeJavaScript(`JSON.stringify({ headings: Array.from(document.querySelectorAll('h1,h2')).map(element => element.textContent), errors: Array.from(document.querySelectorAll('[role="alert"]')).map(element => element.textContent), buttons: Array.from(document.querySelectorAll('button')).map(element => [element.textContent, element.disabled]) })`); console.error('Hosted desktop smoke failed: ' + error.message + ' ' + state); app.exit(1); }
  });
});
require(path.join(__dirname, '..', 'electron', 'main.cjs'));
