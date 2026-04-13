/**
 * Name-visibility policy.
 *
 * Friends see each other's real `displayName`. Non-friends co-members of a
 * subscription see a stable pseudonym derived from the user id. Self view
 * always shows the real name.
 */

const ALIAS_PREFIX = '用户 #'

export function aliasFor(userId: number): string {
  const n = ((userId % 1000) + 1000) % 1000
  return `${ALIAS_PREFIX}${String(n).padStart(3, '0')}`
}

export interface NamedUser {
  id: number
  displayName: string
  email: string
  showEmail: boolean
}

export function resolveDisplayName(
  viewerId: number,
  target: NamedUser,
  isFriend: boolean
): string {
  const self = viewerId === target.id
  const trueName = target.displayName?.trim()

  if (self) return trueName || aliasFor(target.id)

  if (!isFriend) return aliasFor(target.id)

  if (!trueName) return aliasFor(target.id)

  return target.showEmail ? `${trueName} (${target.email})` : trueName
}
