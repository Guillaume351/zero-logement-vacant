import { RS_SOURCE_VALUES } from '@zerologementvacant/models';
import z from 'zod';

export const RS_DATA_FILE_YEAR = 'rs-2026' as const;

export const sourceRsSchema = z.object({
  geo_code: z.string().length(5, 'geo_code is required'),
  local_id: z.string().min(1, 'local_id is required'),
  rs_source: z.enum(RS_SOURCE_VALUES).optional(),
  invariant: z.string().optional(),
  address: z.string().optional()
});

export type SourceRs = z.infer<typeof sourceRsSchema>;

export function sourceRsKey(source: Pick<SourceRs, 'geo_code' | 'local_id'>) {
  return `${source.geo_code}:${source.local_id}`;
}
