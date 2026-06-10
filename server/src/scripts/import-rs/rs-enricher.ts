import { TransformStream } from 'node:stream/web';

import db from '~/infra/database';
import {
  HousingRecordDBO,
  housingTable
} from '~/repositories/housingRepository';
import {
  SourceRs,
  sourceRsKey
} from '~/scripts/import-rs/source-rs';

const CHUNK_SIZE = 1_000;

export interface EnrichedSourceRs {
  source: SourceRs;
  existing: HousingRecordDBO | null;
}

function getPartition(geoCode: string): string {
  return geoCode.substring(0, 2);
}

function getPartitionRange(partition: string): [string, string] {
  return [`${partition}000`, `${partition}999`];
}

export function createRsEnricher(): TransformStream<SourceRs, EnrichedSourceRs> {
  const buffers = new Map<string, SourceRs[]>();

  async function flush(
    partition: string,
    controller: TransformStreamDefaultController<EnrichedSourceRs>
  ): Promise<void> {
    const buffer = buffers.get(partition);
    if (!buffer || buffer.length === 0) return;
    const chunk = buffer.splice(0);
    const [from, to] = getPartitionRange(partition);
    const values = chunk.map(() => '(?, ?)').join(', ');
    const bindings = chunk.flatMap((source) => [
      source.geo_code,
      source.local_id
    ]);

    const result = await db.raw(
      `
        SELECT ${housingTable}.*
        FROM (VALUES ${values}) AS source(geo_code, local_id)
        JOIN ${housingTable}
          ON ${housingTable}.geo_code = source.geo_code
          AND ${housingTable}.local_id = source.local_id
        WHERE ${housingTable}.geo_code >= ?
          AND ${housingTable}.geo_code < ?
      `,
      [...bindings, from, to]
    );
    const rows = result.rows as HousingRecordDBO[];
    const byKey = new Map(
      rows.map((housing) => [sourceRsKey({
        geo_code: housing.geo_code,
        local_id: housing.local_id
      }), housing])
    );

    chunk.forEach((source) => {
      controller.enqueue({
        source,
        existing: byKey.get(sourceRsKey(source)) ?? null
      });
    });
  }

  return new TransformStream<SourceRs, EnrichedSourceRs>({
    async transform(source, controller) {
      const partition = getPartition(source.geo_code);
      const buffer = buffers.get(partition) ?? [];
      buffers.set(partition, buffer);

      buffer.push(source);
      if (buffer.length >= CHUNK_SIZE) {
        await flush(partition, controller);
      }
    },
    async flush(controller) {
      for (const partition of buffers.keys()) {
        await flush(partition, controller);
      }
    }
  });
}
