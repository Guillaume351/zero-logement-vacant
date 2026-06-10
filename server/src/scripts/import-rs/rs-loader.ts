import { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WritableStream } from 'node:stream/web';
import { match } from 'ts-pattern';

import db from '~/infra/database';
import { createLogger } from '~/infra/logger';
import { HousingEventApi } from '~/models/EventApi';
import eventRepository from '~/repositories/eventRepository';
import {
  Housing,
  housingTable
} from '~/repositories/housingRepository';
import { Reporter } from '~/scripts/import-lovac/infra/reporters/reporter';
import { createUpdater } from '~/scripts/import-lovac/infra/updater';
import { RsChange, RsHousingRecord } from '~/scripts/import-rs/rs-transform';
import { SourceRs } from '~/scripts/import-rs/source-rs';

const logger = createLogger('rsLoader');
const EVENT_CHUNK_SIZE = 1_000;

export interface RsLoaderOptions {
  dryRun?: boolean;
  reporter: Reporter<SourceRs>;
}

export function createRsLoader(options: RsLoaderOptions): WritableStream<RsChange> {
  const eventBuffer: HousingEventApi[] = [];
  const temporaryTable = `rs_housing_updates_tmp_${randomUUID().replace(/-/g, '')}`;

  const updateWriter = options.dryRun
    ? createUpdater<RsHousingRecord>({
        destination: 'file',
        file: path.join(import.meta.dirname, 'rs-housing-updates.jsonl')
      })
    : createUpdater<RsHousingRecord>({
        destination: 'database',
        temporaryTable,
        likeTable: housingTable,
        async update(housings): Promise<void> {
          await updateHousings(housings, {
            temporaryTable
          });
          options.reporter.updated(housings.length);
        }
      });
  const updateWriterStream = updateWriter.getWriter();

  async function flushEvents(): Promise<void> {
    if (eventBuffer.length === 0) return;
    const batch = eventBuffer.splice(0);
    if (options.dryRun) return;
    logger.debug(`Inserting ${batch.length} housing events...`);
    await eventRepository.insertManyHousingEvents(batch);
  }

  return new WritableStream<RsChange>({
    async write(change) {
      await match(change)
        .with({ type: 'housing', kind: 'update' }, async (c) => {
          await updateWriterStream.write(c.value);
        })
        .with({ type: 'event', kind: 'create' }, async (c) => {
          eventBuffer.push(c.value);
          if (eventBuffer.length >= EVENT_CHUNK_SIZE) await flushEvents();
        })
        .exhaustive();
    },
    async close() {
      await Promise.all([flushEvents(), updateWriterStream.close()]);
    }
  });
}

interface UpdateHousingsOptions {
  temporaryTable: string;
}

async function updateHousings(
  housings: ReadonlyArray<RsHousingRecord>,
  opts: UpdateHousingsOptions
): Promise<void> {
  const keys: ReadonlyArray<keyof RsHousingRecord> = [
    'occupancy',
    'status',
    'data_file_years'
  ];
  const updates: Record<string, Knex.Ref<string, any>> = Object.fromEntries(
    keys.map((key) => [key, db.ref(`${opts.temporaryTable}.${key}`)])
  );

  await Housing()
    .update(updates)
    .updateFrom(opts.temporaryTable)
    .where(`${housingTable}.geo_code`, db.ref(`${opts.temporaryTable}.geo_code`))
    .where(`${housingTable}.id`, db.ref(`${opts.temporaryTable}.id`))
    .whereIn(
      [`${opts.temporaryTable}.geo_code`, `${opts.temporaryTable}.id`],
      housings.map((housing) => [housing.geo_code, housing.id])
    );
}
