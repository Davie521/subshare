/**
 * Shared tag type — canonical source for both the DB layer
 * (`src/db/schema.ts`) and the client bundle (`src/lib/api-client.ts`).
 * Keep this file free of server-only imports (Drizzle, postgres-js) so it
 * can be safely bundled into client JS.
 */
export type SubscriptionTag = {
  label: string
  visibility: 'public' | 'private'
}
