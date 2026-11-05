function hostedFixture() {
  const calls = [], users = new Map(); let tokenNumber = 0, pause = null, revoked = false;
  function user(address) { if (!users.has(address)) users.set(address, { id: 'verified-' + address.split('@')[0], aud: 'authenticated', email: address, email_confirmed_at: new Date().toISOString(), user_metadata: { name: address.split('@')[0] } }); return users.get(address); }
  const sessions = new Map();
  function session(address) { const owner = user(address), access_token = 'synthetic-access-' + (++tokenNumber), refresh_token = 'synthetic-refresh-' + tokenNumber; const value = { access_token, refresh_token, expires_in: tokenNumber > 1 ? 14400 : 7200, token_type: 'bearer', user: owner }; sessions.set(access_token, owner); sessions.set(refresh_token, owner); return value; }
  return { calls, revoke: () => { revoked = true; }, pauseLogin: gate => { pause = gate; },
    fetch: async (target, options) => {
      const url = new URL(target), body = options.body ? JSON.parse(options.body) : {}, headers = new Headers(options.headers);
      calls.push({ path: url.pathname, method: options.method, grant: url.searchParams.get('grant_type') });
      let result = {}, status = 200;
      if (url.pathname.endsWith('/token')) {
        if (url.searchParams.get('grant_type') === 'password') {
          if (pause) { const gate = pause; pause = null; await gate.promise; }
          if (body.password !== 'correct-password-123') { status = 400; result = { code: 'invalid_credentials', msg: 'Invalid credentials' }; }
          else result = session(body.email);
        } else { const owner = sessions.get(body.refresh_token); if (!owner || revoked) { status = 400; result = { code: 'refresh_token_not_found', msg: 'Invalid refresh' }; } else result = session(owner.email); }
      } else if (url.pathname.endsWith('/user')) {
        const owner = sessions.get((headers.get('authorization') || '').replace(/^Bearer /i, ''));
        if (!owner || revoked) { status = 401; result = { msg: 'Unknown user' }; } else result = options.method === 'PUT' ? { user: owner } : owner;
      } else if (url.pathname.endsWith('/signup')) result = { ...user(body.email), email_confirmed_at: null };
      else if (url.pathname.endsWith('/verify')) result = session(body.email);
      return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
    }
  };
}

module.exports = { hostedFixture };
