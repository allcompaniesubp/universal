/**
 * Request validation schemas.
 *
 * Every mutating route validates its body with one of these before touching the
 * database. Validation happens on the server; the browser forms are a
 * convenience, not a security boundary.
 */

import { z } from 'zod';
import { MIN_PASSWORD_LENGTH } from '../crypto/password.ts';

/** Trims, then rejects empty strings, so " " is not accepted as a name. */
const trimmed = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, { message: `Must be at least ${min} characters.` })
    .refine((value) => value.length <= max, { message: `Must be at most ${max} characters.` });

const optionalTrimmed = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length <= max, { message: `Must be at most ${max} characters.` })
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** Deliberately permissive: over-strict email rules reject valid addresses. */
const emailSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .refine((value) => value.length <= 254, { message: 'Email address is too long.' })
  .refine((value) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value), {
    message: 'Enter a valid email address.',
  });

const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
  .max(200, { message: 'Password must be at most 200 characters.' });

/** Only http(s) is accepted, to prevent javascript: and data: URLs in links. */
const httpUrlSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length === 0 || value.length <= 500, { message: 'URL is too long.' })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional()
  .refine((value) => value === null || value === undefined || /^https?:\/\//i.test(value), {
    message: 'URL must begin with http:// or https://',
  })
  .refine(
    (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Enter a valid URL.' },
  );

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: trimmed(2, 120),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { message: 'Enter your password.' }).max(200),
});

export const createBusinessSchema = z.object({
  displayName: trimmed(2, 120),
  slug: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .refine((value) => value.length >= 3 && value.length <= 64, {
      message: 'Slug must be between 3 and 64 characters.',
    }),
  tagline: optionalTrimmed(160),
  description: optionalTrimmed(4000),
  category: optionalTrimmed(80),
  countryCode: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => value.length === 0 || /^[A-Z]{2}$/.test(value), {
      message: 'Country must be a two-letter ISO code.',
    })
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional(),
  region: optionalTrimmed(120),
  city: optionalTrimmed(120),
  websiteUrl: httpUrlSchema,
  contactEmail: z
    .union([z.literal(''), emailSchema])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  contactPhone: optionalTrimmed(40),
  languages: z
    .array(
      z
        .string()
        .transform((value) => value.trim())
        .refine((value) => value.length >= 2 && value.length <= 60, {
          message: 'Each language must be between 2 and 60 characters.',
        }),
    )
    .max(20)
    .optional(),
  showEmailPublicly: z.boolean().optional(),
  showPhonePublicly: z.boolean().optional(),
});

/** Partial update; at least one field must be present (checked in the service). */
export const updateBusinessSchema = createBusinessSchema.partial().extend({
  status: z.enum(['draft', 'published', 'unpublished']).optional(),
});

export const businessIdParamSchema = z.object({
  id: z.string().uuid({ message: 'Business id must be a UUID.' }),
});

export const slugParamSchema = z.object({
  slug: z.string().min(3).max(64),
});

export const ubpIdParamSchema = z.object({
  ubpId: z.string().regex(/^UBP-[0-9A-Z]{8}$/, { message: 'Not a valid UBP identifier.' }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
