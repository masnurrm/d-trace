import { z } from 'zod';

/** Reused everywhere an id crosses the wire. */
export const idSchema = z.uuid('Invalid identifier');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  /** Hard ceiling keeps a hostile client from asking for the whole table. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().min(1).max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export function buildPaginationMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
