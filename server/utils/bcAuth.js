/**
 * bcAuth.js — Business Central OAuth 2.0 (client-credentials) token helper.
 *
 * getBCAccessToken() returns a valid access token, using an in-memory cache
 * until ~60s before expiry. No token value is ever logged or persisted.
 */

// In-memory cache (process-local). Reset on server restart.
let _cache = { token: null, expiresAt: 0 }

const TOKEN_URL = tenant => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
const BC_SCOPE  = 'https://api.businesscentral.dynamics.com/.default'
const EXPIRY_BUFFER_MS = 60 * 1000  // refresh 60s before actual expiry

// Build an Error carrying a user-facing `hint` for the route layer.
function bcError(message, hint) {
  const e = new Error(message)
  e.hint = hint
  return e
}

/**
 * @returns {Promise<{ access_token: string, expires_at: string, from_cache: boolean }>}
 * @throws {Error} with a clear message (+ .hint) when config is missing or auth fails.
 */
async function getBCAccessToken() {
  const { BC_TENANT_ID, BC_CLIENT_ID, BC_CLIENT_SECRET } = process.env
  if (!BC_TENANT_ID || !BC_CLIENT_ID || !BC_CLIENT_SECRET) {
    throw bcError(
      'BC credentials not configured in .env',
      'Set BC_TENANT_ID, BC_CLIENT_ID and BC_CLIENT_SECRET in server/.env, then restart.',
    )
  }

  const now = Date.now()
  if (_cache.token && now < _cache.expiresAt) {
    return { access_token: _cache.token, expires_at: new Date(_cache.expiresAt).toISOString(), from_cache: true }
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     BC_CLIENT_ID,
    client_secret: BC_CLIENT_SECRET,
    scope:         BC_SCOPE,
  })

  let res
  try {
    res = await fetch(TOKEN_URL(BC_TENANT_ID), {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  } catch {
    throw bcError(
      'Could not reach login.microsoftonline.com - check internet',
      'Verify the server has outbound internet access and DNS resolves login.microsoftonline.com.',
    )
  }

  let data = {}
  try { data = await res.json() } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const code = data.error
    if (code === 'invalid_client') {
      throw bcError('Client credentials invalid - check Client ID and Secret',
        'Confirm BC_CLIENT_ID and BC_CLIENT_SECRET match the Azure app registration (secret not expired).')
    }
    if (code === 'unauthorized_client') {
      throw bcError('App registration issue - contact BC admin',
        'The Azure app may lack admin consent or the Business Central API permission.')
    }
    throw bcError(
      data.error_description || `Token request failed (HTTP ${res.status})`,
      'Check BC_TENANT_ID is the correct Azure AD tenant and the app registration is configured for this tenant.',
    )
  }

  if (!data.access_token) {
    throw bcError('Token endpoint returned no access_token', 'Unexpected response from Microsoft identity platform.')
  }

  const expiresInSec = Number(data.expires_in) || 3600
  _cache = { token: data.access_token, expiresAt: now + (expiresInSec * 1000) - EXPIRY_BUFFER_MS }
  return { access_token: data.access_token, expires_at: new Date(_cache.expiresAt).toISOString(), from_cache: false }
}

// Exposed for tests/manual cache reset; not used by the route.
function _resetBCTokenCache() { _cache = { token: null, expiresAt: 0 } }

module.exports = { getBCAccessToken, _resetBCTokenCache }
