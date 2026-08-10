import { type z } from 'zod';

/**
 * Validate an API response against its current contract. A malformed payload is
 * always a failed refresh: callers preserve prior data as stale or surface an
 * explicit cold-load error.
 */
export function validateResponse<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: unknown,
  label: string,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  console.warn(`[seorak] API response validation warning (${label}):`, detail);

  const error = new Error(`Invalid API response (${label})`);
  error.name = 'SchemaValidationError';
  (error as Error & { details: string }).details = detail;
  throw error;
}
