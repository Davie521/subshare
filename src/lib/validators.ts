import { z } from 'zod'

export const CURRENCIES = ['CNY', 'USD', 'HKD', 'CAD', 'EUR', 'GBP', 'JPY'] as const
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const tagSchema = z.object({
  // trim first so whitespace-only labels fail min(1) at the API boundary
  // instead of silently being dropped by normalizeTags later.
  label: z.string().trim().min(1).max(10),
  visibility: z.enum(['public', 'private']),
})

export const tagArraySchema = z.array(tagSchema).max(5)

// A manifest key ("Netflix") from the build-time icon bundle, or null.
// `findBrandIcon` resolves manifest keys; unknown values render as a
// generated first-letter SVG, so any stray value remains visually safe.
// Empty / whitespace-only strings are rejected here — callers should
// pass `null` for "no logo" instead of "".
export const logoSchema = z
  .string()
  .max(100)
  .refine((s) => s.trim().length > 0, 'Logo must not be empty')
  .nullable()
  .optional()

export const createCircleSchema = z.object({
  name: z.string().min(1).max(60),
  memberIds: z.array(z.number().int().positive()).max(50).optional(),
  defaultPayerId: z.number().int().positive().nullable().optional(),
})

export const updateCircleSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  memberIds: z.array(z.number().int().positive()).max(50).optional(),
  defaultPayerId: z.number().int().positive().nullable().optional(),
})

export const createSubscriptionSchema = z.object({
  name: z.string().min(1).max(100),
  price: z.number().int().positive().max(100_000_000),
  currency: z.enum(CURRENCIES),
  nextPayment: z.string().regex(DATE_REGEX, 'Must be YYYY-MM-DD'),
  members: z.array(z.number().int().positive()).max(50).optional(),
  payerId: z.number().int().positive().optional(),
  refundPolicy: z.enum(['payer_absorbs', 'redistribute']).optional(),
  logo: logoSchema,
  url: z.string().url().max(500).optional().or(z.literal('')),
  notes: z.string().max(1000).optional(),
  categoryId: z.number().int().positive().optional(),
  tags: tagArraySchema.optional(),
})

export const updateSubscriptionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  price: z.number().int().positive().max(100_000_000).optional(),
  nextPayment: z.string().regex(DATE_REGEX).optional(),
  inactive: z
    .union([z.boolean(), z.number().int().min(0).max(1)])
    .transform((v) => (typeof v === 'number' ? v === 1 : v))
    .optional(),
  refundPolicy: z.enum(['payer_absorbs', 'redistribute']).optional(),
  tags: tagArraySchema.optional(),
  logo: logoSchema,
  /**
   * Caller's own personal-tags bucket. Authorization checked by the
   * handler; any active member of the sub can set this, and the write
   * is scoped to their own `subscription_members` row.
   */
  personalTags: tagArraySchema.optional(),
})

export const exchangeRateSchema = z.object({
  from: z.enum(CURRENCIES),
  to: z.enum(CURRENCIES),
})

export const frankfurterResponseSchema = z.object({
  rates: z.record(z.string(), z.number().positive().finite()),
})
