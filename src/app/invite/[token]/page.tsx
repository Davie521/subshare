import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { getDb } from '@/db'
import { acceptInvite, getInviteMetadata } from '@/lib/invites'

type Props = {
  params: Promise<{ token: string }>
}

/**
 * Invite landing page.
 *
 * Flow:
 *   1. Validate token format/existence.
 *   2. Not logged in → bounce straight to Google OAuth with the token
 *      stashed in a cookie (handled by /api/auth/google).
 *   3. Logged in → consume the invite server-side, redirect to the sub.
 *   4. Invite broken (expired/revoked/exhausted) → render a small message.
 */
export default async function InviteLandingPage({ params }: Props) {
  const { token } = await params

  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return <InviteError message="Invalid invite link." />
  }

  const db = await getDb()
  const meta = await getInviteMetadata(db, token)
  if (!meta.success || !meta.data) {
    return <InviteError message="This invite does not exist." />
  }

  const m = meta.data
  if (m.revoked) return <InviteError message="This invite has been revoked." />
  if (m.expired) return <InviteError message="This invite has expired." />
  if (m.exhausted) {
    return <InviteError message="This invite has already been used." />
  }

  const session = await getSession()
  if (!session) {
    redirect(`/api/auth/google?invite=${encodeURIComponent(token)}`)
  }

  const result = await acceptInvite(db, session.userId, token)
  if (result.success && result.data) {
    redirect(`/subscriptions/${result.data.subscriptionId}`)
  }

  return (
    <InviteError
      message={result.success === false ? result.error : 'Could not join.'}
    />
  )
}

function InviteError({ message }: { message: string }) {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
        Invite unavailable
      </h1>
      <p className="text-[14px] text-muted-foreground max-w-sm">{message}</p>
      <a
        href="/dashboard"
        className="mt-2 text-[13px] font-medium text-[var(--brand)] hover:underline"
      >
        Go to dashboard
      </a>
    </div>
  )
}
