import { z } from 'zod'

const CURRENCIES = ['CNY', 'USD', 'HKD', 'CAD', 'EUR', 'GBP', 'JPY'] as const
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  preferredCurrency: z.enum(CURRENCIES).optional(),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const createSubscriptionSchema = z.object({
  name: z.string().min(1).max(100),
  price: z.number().int().positive().max(100_000_000),
  currency: z.enum(CURRENCIES),
  nextPayment: z.string().regex(DATE_REGEX, 'Must be YYYY-MM-DD'),
  groupId: z.number().int().positive().optional(),
  members: z.array(z.number().int().positive()).max(50).optional(),
  payerId: z.number().int().positive().optional(),
  logo: z
    .string()
    .max(500)
    .regex(/^(https?:\/\/|\/icons\/)/, 'Logo must be an http(s) URL or /icons/ path')
    .optional(),
  url: z.string().url().max(500).optional().or(z.literal('')),
  notes: z.string().max(1000).optional(),
  categoryId: z.number().int().positive().optional(),
})

export const updateSubscriptionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  price: z.number().int().positive().max(100_000_000).optional(),
  nextPayment: z.string().regex(DATE_REGEX).optional(),
  inactive: z.number().int().min(0).max(1).optional(),
})

export const exchangeRateSchema = z.object({
  from: z.enum(CURRENCIES),
  to: z.enum(CURRENCIES),
})

export const frankfurterResponseSchema = z.object({
  rates: z.record(z.string(), z.number().positive().finite()),
})
