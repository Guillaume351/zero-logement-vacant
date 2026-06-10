import { HousingStatus, Occupancy } from '@zerologementvacant/models';
import { ReadableStream } from 'node:stream/web';

import { Events } from '~/repositories/eventRepository';
import {
  formatHousingRecordApi,
  Housing,
  HousingRecordDBO
} from '~/repositories/housingRepository';
import {
  Establishments,
  formatEstablishmentApi
} from '~/repositories/establishmentRepository';
import { Users, toUserDBO } from '~/repositories/userRepository';
import { createNoopReporter } from '~/scripts/import-lovac/infra/reporters/noop-reporter';
import { createRsLoader } from '~/scripts/import-rs/rs-loader';
import { RsChange, RsHousingRecord } from '~/scripts/import-rs/rs-transform';
import { RS_DATA_FILE_YEAR } from '~/scripts/import-rs/source-rs';
import {
  genEstablishmentApi,
  genEventApi,
  genHousingApi,
  genUserApi
} from '~/test/testFixtures';

function toWritableRecord(housing: HousingRecordDBO): RsHousingRecord {
  return Object.fromEntries(
    Object.entries(housing).filter(
      ([key]) =>
        !['last_mutation_type', 'occupancy_history', 'plot_area'].includes(key)
    )
  ) as RsHousingRecord;
}

describe('createRsLoader', () => {
  const establishment = genEstablishmentApi();
  const user = genUserApi(establishment.id);

  beforeAll(async () => {
    await Establishments().insert(formatEstablishmentApi(establishment));
    await Users().insert(toUserDBO(user));
  });

  it('updates only the RS import fields', async () => {
    const reporter = createNoopReporter();
    const housing = {
      ...genHousingApi(),
      occupancy: Occupancy.VACANT,
      status: HousingStatus.IN_PROGRESS,
      subStatus: 'En accompagnement',
      rentalValue: 1234,
      dataFileYears: ['lovac-2026' as const]
    };
    await Housing().insert(formatHousingRecordApi(housing));
    const existing = (await Housing()
      .where({ id: housing.id, geo_code: housing.geoCode })
      .first())!;
    const updated = toWritableRecord({
      ...existing,
      occupancy: Occupancy.SECONDARY_RESIDENCE,
      status: HousingStatus.COMPLETED,
      data_file_years: ['lovac-2026', RS_DATA_FILE_YEAR]
    });
    const change: RsChange = {
      type: 'housing',
      kind: 'update',
      value: updated
    };

    await ReadableStream.from<RsChange>([change]).pipeTo(
      createRsLoader({ dryRun: false, reporter })
    );

    const actual = await Housing()
      .where({ id: housing.id, geo_code: housing.geoCode })
      .first();
    expect(actual?.occupancy).toBe(Occupancy.SECONDARY_RESIDENCE);
    expect(actual?.status).toBe(HousingStatus.COMPLETED);
    expect(actual?.data_file_years).toStrictEqual([
      'lovac-2026',
      RS_DATA_FILE_YEAR
    ]);
    expect(actual?.sub_status).toBe('En accompagnement');
    expect(actual?.rental_value).toBe(1234);
  });

  it('inserts events idempotently', async () => {
    const reporter = createNoopReporter();
    const housing = genHousingApi();
    await Housing().insert(formatHousingRecordApi(housing));
    const event = {
      ...genEventApi({
        type: 'housing:occupancy-updated',
        creator: user,
        nextOld: { occupancy: 'Vacant' },
        nextNew: { occupancy: 'Résidence secondaire non louée' }
      }),
      housingGeoCode: housing.geoCode,
      housingId: housing.id
    };
    const change: RsChange = {
      type: 'event',
      kind: 'create',
      value: event
    };

    await ReadableStream.from<RsChange>([change, change]).pipeTo(
      createRsLoader({ dryRun: false, reporter })
    );

    const actual = await Events().where({ id: event.id });
    expect(actual).toHaveLength(1);
  });

  it('skips writes when dryRun is true', async () => {
    const reporter = createNoopReporter();
    const housing = {
      ...genHousingApi(),
      occupancy: Occupancy.VACANT,
      status: HousingStatus.IN_PROGRESS
    };
    await Housing().insert(formatHousingRecordApi(housing));
    const existing = (await Housing()
      .where({ id: housing.id, geo_code: housing.geoCode })
      .first())!;
    const change: RsChange = {
      type: 'housing',
      kind: 'update',
      value: toWritableRecord({
        ...existing,
        occupancy: Occupancy.SECONDARY_RESIDENCE,
        status: HousingStatus.COMPLETED,
        data_file_years: [RS_DATA_FILE_YEAR]
      })
    };

    await ReadableStream.from<RsChange>([change]).pipeTo(
      createRsLoader({ dryRun: true, reporter })
    );

    const actual = await Housing()
      .where({ id: housing.id, geo_code: housing.geoCode })
      .first();
    expect(actual?.occupancy).toBe(Occupancy.VACANT);
    expect(actual?.status).toBe(HousingStatus.IN_PROGRESS);
  });
});
