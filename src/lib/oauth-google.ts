import { Google, generateState, generateCodeVerifier } from 'arctic'

function getEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing env: ${key}`)
  return val
}

let _google: Google | null = null

export function getGoogleProvider(): Google {
  if (!_google) {
    _google = new Google(
      getEnv('GOOGLE_CLIENT_ID'),
      getEnv('GOOGLE_CLIENT_SECRET'),
      getEnv('OAUTH_REDIRECT_URI')
    )
  }
  return _google
}

export { generateState, generateCodeVerifier }

export interface GoogleUserInfo {
  sub: string
  email: string
  email_verified: boolean
  name: string
  picture?: string
}

export async function fetchGoogleUserInfo(
  accessToken: string
): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(`Google userinfo failed: ${res.status}`)
  }
  return res.json() as Promise<GoogleUserInfo>
}
