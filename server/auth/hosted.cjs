const { createClient } = require('@supabase/supabase-js');
const invalid = message => Object.assign(new Error(message), { status: 400 });
const unavailable = () => Object.assign(new Error('Account service unavailable. Check your connection and try again.'), { status: 503 });

function validateConfig(input) {
  let url;
  try { url = new URL(input.url); } catch { throw invalid('Enter your Supabase project URL.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) || url.port || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash) throw invalid('Use an HTTPS Supabase project URL ending in .supabase.co.');
  if (typeof input.publishableKey !== 'string' || !/^sb_publishable_[a-zA-Z0-9_-]{16,512}$/.test(input.publishableKey)) throw invalid('Use a publishable app key, never a secret or service-role key.');
  return { url: url.origin, publishableKey: input.publishableKey };
}
function email(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.trim())) throw invalid('Enter a valid email address.');
  return value.trim().toLowerCase();
}
function password(value, creating = false) {
  if (typeof value !== 'string' || value.length > 1024 || value.length < (creating ? 12 : 1)) throw invalid(creating ? 'Use a password of at least 12 characters.' : 'Enter your password.');
  return value;
}
function code(value) {
  if (typeof value !== 'string' || !/^\d{6,10}$/.test(value.trim())) throw invalid('Enter the verification code from your email.');
  return value.trim();
}

// SDK clients and tokens stay server-side. Passwords are used only for the current HTTPS request.
function createHostedAuth(config, { fetchImpl = fetch, clock = Date.now } = {}) {
  const settings = validateConfig(config);
  function client() {
    return createClient(settings.url, settings.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (target, options = {}) => {
        const url = new URL(typeof target === 'string' ? target : target.url || target.href);
        if (url.origin !== settings.url || !url.pathname.startsWith('/auth/v1/')) throw unavailable();
        const timeout = AbortSignal.timeout(10000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        return fetchImpl(url.href, { ...options, redirect: 'error', signal });
      } }
    });
  }
  function checked(result, authentication = false) {
    if (!result.error) return result.data;
    if (result.error.status === 429) throw Object.assign(new Error('Too many account requests. Wait before trying again.'), { status: 429 });
    if (result.error.status >= 500 || result.error.name === 'AuthRetryableFetchError') throw unavailable();
    throw Object.assign(new Error(authentication ? 'Sign-in failed. Check your email, password and email confirmation.' : 'The account request could not be completed. Check the details and try again.'), { status: authentication ? 401 : 400 });
  }
  async function verified(sdk, data) {
    const session = data.session;
    if (!session?.access_token || !session.refresh_token || !Number.isFinite(session.expires_at) || session.expires_at * 1000 <= clock()) throw unavailable();
    const { user } = checked(await sdk.auth.getUser(session.access_token), true);
    if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 128 || user.is_anonymous || !user.email_confirmed_at || user.aud !== 'authenticated') throw Object.assign(new Error('Confirm your email before signing in.'), { status: 401 });
    return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at * 1000,
      identity: { issuer: settings.url + '/auth/v1', subject: user.id, email: user.email || '', name: String(user.user_metadata?.name || user.email?.split('@')[0] || 'Your account').slice(0, 100) } };
  }
  return {
    issuer: settings.url + '/auth/v1',
    async signIn(input) {
      const sdk = client();
      return verified(sdk, checked(await sdk.auth.signInWithPassword({ email: email(input.email), password: password(input.password) }), true));
    },
    async signUp(input) {
      const sdk = client();
      const data = checked(await sdk.auth.signUp({ email: email(input.email), password: password(input.password, true), options: { data: { name: String(input.name || '').trim().slice(0, 100) } } }));
      return data.session ? { tokens: await verified(sdk, data) } : { confirmationRequired: true };
    },
    async confirmEmail(input) {
      const sdk = client();
      checked(await sdk.auth.verifyOtp({ email: email(input.email), token: code(input.code), type: 'email' }));
      await sdk.auth.signOut({ scope: 'local' }).catch(() => {});
    },
    async resendEmail(input) { checked(await client().auth.resend({ type: 'signup', email: email(input.email) })); },
    async requestReset(input) { checked(await client().auth.resetPasswordForEmail(email(input.email))); },
    async recoverPassword(input) {
      const sdk = client(), address = email(input.email), nextPassword = password(input.password, true);
      const data = checked(await sdk.auth.verifyOtp({ email: address, token: code(input.code), type: 'recovery' }));
      const tokens = await verified(sdk, data);
      if (tokens.identity.email.toLowerCase() !== address) throw unavailable();
      checked(await sdk.auth.updateUser({ password: nextPassword }));
      await sdk.auth.signOut({ scope: 'global' }).catch(() => {});
      return tokens.identity;
    },
    async refresh(refreshToken) { const sdk = client(); return verified(sdk, checked(await sdk.auth.refreshSession({ refresh_token: refreshToken }), true)); },
    async verify(tokens) {
      const { user } = checked(await client().auth.getUser(tokens.accessToken), true);
      if (!user || user.id !== tokens.identity.subject || user.aud !== 'authenticated' || !user.email_confirmed_at || user.is_anonymous) throw Object.assign(new Error('Your session ended. Sign in again.'), { status: 401 });
    },
    async revoke(tokens) { await client().auth.admin.signOut(tokens.accessToken, 'local').catch(() => {}); }
  };
}
module.exports = { createHostedAuth, validateConfig, email, password };
