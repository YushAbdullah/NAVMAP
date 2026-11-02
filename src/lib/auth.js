// Community member accounts through Supabase Auth: Google, or email + password with
// "forgot password" emails. Loaded only when someone opens Community, so the map stays fast.
// Settings come from /api/pins?config=1 (Vercel env SUPABASE_URL + SUPABASE_ANON_KEY);
// when they are missing, Community works anonymously and the sign-in buttons are hidden.
let client = null;
let ready = null;
let current = null;                  // Supabase user or null
const listeners = new Set();
const CHOICE_KEY = 'navmap.commChoice'; // 'member' | 'anon': asked once before entering Community

export const available = () => !!client;
export const user = () => current;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (evt) => listeners.forEach((fn) => { try { fn(current, evt); } catch { /* ignore */ } });

export function choice() { try { return localStorage.getItem(CHOICE_KEY); } catch { return 'anon'; } }
export function setChoice(v) { try { localStorage.setItem(CHOICE_KEY, v); } catch { /* ignore */ } }

/** Public display name for a signed-in member (what other people see on posts). */
export function displayName(u = current) {
  const md = u?.user_metadata || {};
  return md.display_name || String(md.full_name || md.name || '').split(' ')[0] || '';
}

/** Start Supabase (once). Resolves true when sign-in is available. */
export function init() {
  if (ready) return ready;
  ready = (async () => {
    try {
      const cfg = await fetch('/api/pins?config=1').then((r) => r.json());
      if (!cfg?.auth?.url) return false;
      const { createClient } = await import('@supabase/supabase-js');
      client = createClient(cfg.auth.url, cfg.auth.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'navmap.auth' },
      });
      // subscribe straight away so a Google return or a reset-password link (PASSWORD_RECOVERY) is not missed
      client.auth.onAuthStateChange((evt, session) => { current = session?.user || null; setTimeout(() => emit(evt), 0); });
      const { data } = await client.auth.getSession();
      current = data.session?.user || null;
      return true;
    } catch { client = null; return false; }
  })();
  return ready;
}

// Coming back from a Google sign-in or a reset-password email: start right away.
if (/[?&#](code|access_token|error_description)=/.test(location.href)) init();

/** Bearer header for /api/pins while signed in. */
export async function authHeader() {
  if (!client || !current) return {};
  const { data } = await client.auth.getSession();
  return data.session?.access_token ? { authorization: `Bearer ${data.session.access_token}` } : {};
}

const back = () => `${location.origin}/`;
const fail = (error) => { if (error) throw new Error(error.message || 'failed'); };

export async function google() {
  const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: back() } });
  fail(error);
}
/** Returns 'signed-in' or 'confirm-email' (Supabase sends a confirmation link first). */
export async function register(email, password, name) {
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: back() } });
  fail(error);
  return data.session ? 'signed-in' : 'confirm-email';
}
export async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  fail(error);
}
export async function forgot(email) {
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: back() });
  fail(error);
}
export async function newPassword(password) {
  const { error } = await client.auth.updateUser({ password });
  fail(error);
}
export async function rename(name) {
  const { data, error } = await client.auth.updateUser({ data: { display_name: name } });
  fail(error);
  current = data.user || current;
  emit('USER_UPDATED');
}
export async function signOut() {
  await client.auth.signOut();
  current = null;
  emit('SIGNED_OUT');
}
