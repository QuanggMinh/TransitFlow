import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { NextFunction, Request, Response } from 'express'

const SESSION_COOKIE = 'transitflow_admin'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const MAX_SESSIONS = 100

interface AdminSession {
  username: string
  expiresAt: number
}

const sessions = new Map<string, AdminSession>()

function configuredCredentials() {
  return {
    username: process.env.ADMIN_USERNAME?.trim() ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest()
  const rightHash = createHash('sha256').update(right).digest()
  return timingSafeEqual(leftHash, rightHash)
}

function cookieValue(req: Request): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [name, ...valueParts] = part.trim().split('=')
    if (name === SESSION_COOKIE) return decodeURIComponent(valueParts.join('='))
  }
  return null
}

function removeExpiredSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(token)
  }
}

export function adminAuthConfigured(): boolean {
  const credentials = configuredCredentials()
  return credentials.username.length > 0 && credentials.password.length >= 8
}

export function createAdminSession(username: string, password: string): string | null {
  const credentials = configuredCredentials()
  if (!adminAuthConfigured()) return null
  if (!secureEqual(username, credentials.username) || !secureEqual(password, credentials.password)) {
    return null
  }

  removeExpiredSessions()
  if (sessions.size >= MAX_SESSIONS) {
    const oldestToken = sessions.keys().next().value
    if (oldestToken) sessions.delete(oldestToken)
  }

  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { username: credentials.username, expiresAt: Date.now() + SESSION_TTL_MS })
  return token
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
}

export function clearSession(req: Request): string {
  const token = cookieValue(req)
  if (token) sessions.delete(token)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${secure}`
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  removeExpiredSessions()
  const token = cookieValue(req)
  const session = token ? sessions.get(token) : undefined
  if (!session) {
    res.status(401).json({ success: false, message: 'Administrator authentication required' })
    return
  }
  res.locals.adminUsername = session.username
  next()
}
