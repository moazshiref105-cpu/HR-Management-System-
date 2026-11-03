import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const authConfigured = Boolean(url && key)
export const supabase = authConfigured ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

// Local visual-development only. This is compiled out of production builds and
// is paired with the backend's loopback-only HMS_LOCAL_AUTH_BYPASS guard.
export const localDevAuthBypass = Boolean(
  import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
)
export const LOCAL_DEV_ACCESS_TOKEN = 'hms-local-visual-development'
