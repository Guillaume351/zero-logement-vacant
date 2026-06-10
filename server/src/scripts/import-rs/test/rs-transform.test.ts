import {
  HOUSING_STATUS_LABELS,
  HousingStatus,
  Occupancy,
  OCCUPANCY_LABELS
} from '@zerologementvacant/models';
import { vi } from 'vitest';

import {
  formatHousingRecordApi,
  HousingRecordDBO
} from '~/repositories/housingRepository';
import { createNoopReporter } from '~/scripts/import-lovac/infra/reporters/noop-reporter';
import { createRsTransform, RsHousingChange } from '~/scripts/import-rs/rs-transform';
import {
  RS_DATA_FILE_YEAR,
  SourceRs
} from '~/scripts/import-rs/source-rs';
import {
  genEstablishmentApi,
  genHousingApi,
  genUserApi
} from '~/test/testFixtures';

function genSourceRs(): SourceRs {
  const housing = genHousingApi();
  return {
    geo_code: housing.geoCode,
    local_id: housing.localId,
    invariant: housing.invariant,
    address: housing.rawAddress[0],
    rs_source: 'taxe-habitation'
  };
}

function toHousingRecord(overrides?: Partial<HousingRecordDBO>): HousingRecordDBO {
  return {
    ...formatHousingRecordApi(genHousingApi()),
    occupancy_history: null,
    plot_area: null,
    last_mutation_type: null,
    ...overrides
  };
}

describe('createRsTransform', () => {
  const establishment = genEstablishmentApi();
  const auth = genUserApi(establishment.id);

  it('rejects a source line when no housing matches its natural key', () => {
    const reporter = createNoopReporter<SourceRs>();
    reporter.failed = vi.fn();
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter
    });
    const source = genSourceRs();

    const actual = transform({ source, existing: null });

    expect(actual).toHaveLength(0);
    expect(reporter.failed).toHaveBeenCalledOnce();
  });

  it('rejects duplicate source keys in the same run', () => {
    const reporter = createNoopReporter<SourceRs>();
    reporter.failed = vi.fn();
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter
    });
    const source = genSourceRs();
    const existing = toHousingRecord({
      geo_code: source.geo_code,
      local_id: source.local_id
    });

    transform({ source, existing });
    const actual = transform({ source, existing });

    expect(actual).toHaveLength(0);
    expect(reporter.failed).toHaveBeenCalledOnce();
  });

  it('updates only occupancy, status, rs_source and data_file_years on the housing change', () => {
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter: createNoopReporter()
    });
    const source = genSourceRs();
    const existing = toHousingRecord({
      geo_code: source.geo_code,
      local_id: source.local_id,
      occupancy: Occupancy.VACANT,
      status: HousingStatus.IN_PROGRESS,
      sub_status: 'En accompagnement',
      rental_value: 1234,
      data_file_years: ['lovac-2026']
    });

    const actual = transform({ source, existing });

    expect(actual).toPartiallyContain<RsHousingChange>({
      type: 'housing',
      kind: 'update',
      value: expect.objectContaining({
        id: existing.id,
        geo_code: existing.geo_code,
        occupancy: Occupancy.SECONDARY_RESIDENCE,
        status: HousingStatus.COMPLETED,
        rs_source: source.rs_source,
        sub_status: existing.sub_status,
        rental_value: existing.rental_value,
        data_file_years: ['lovac-2026', RS_DATA_FILE_YEAR]
      })
    });
  });

  it('creates occupancy and status events when those values change', () => {
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter: createNoopReporter()
    });
    const source = genSourceRs();
    const existing = toHousingRecord({
      geo_code: source.geo_code,
      local_id: source.local_id,
      occupancy: Occupancy.VACANT,
      status: HousingStatus.WAITING,
      data_file_years: []
    });

    const actual = transform({ source, existing });

    expect(actual).toPartiallyContain({
      type: 'event',
      kind: 'create',
      value: expect.objectContaining({
        type: 'housing:occupancy-updated',
        nextOld: { occupancy: OCCUPANCY_LABELS[Occupancy.VACANT] },
        nextNew: {
          occupancy: OCCUPANCY_LABELS[Occupancy.SECONDARY_RESIDENCE]
        },
        housingId: existing.id,
        housingGeoCode: existing.geo_code
      })
    });
    expect(actual).toPartiallyContain({
      type: 'event',
      kind: 'create',
      value: expect.objectContaining({
        type: 'housing:status-updated',
        nextOld: {
          status: HOUSING_STATUS_LABELS[HousingStatus.WAITING],
          subStatus: existing.sub_status
        },
        nextNew: {
          status: HOUSING_STATUS_LABELS[HousingStatus.COMPLETED],
          subStatus: existing.sub_status
        },
        housingId: existing.id,
        housingGeoCode: existing.geo_code
      })
    });
  });

  it('updates rs_source when the housing is already imported as RS 2026 without source', () => {
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter: createNoopReporter()
    });
    const source = genSourceRs();
    const existing = toHousingRecord({
      geo_code: source.geo_code,
      local_id: source.local_id,
      occupancy: Occupancy.SECONDARY_RESIDENCE,
      status: HousingStatus.COMPLETED,
      rs_source: null,
      data_file_years: [RS_DATA_FILE_YEAR]
    });

    const actual = transform({ source, existing });

    expect(actual).toPartiallyContain<RsHousingChange>({
      type: 'housing',
      kind: 'update',
      value: expect.objectContaining({
        rs_source: source.rs_source
      })
    });
  });

  it('does nothing when the housing is already imported as RS 2026 with the same source', () => {
    const reporter = createNoopReporter<SourceRs>();
    reporter.skipped = vi.fn();
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter
    });
    const source = genSourceRs();
    const existing = toHousingRecord({
      geo_code: source.geo_code,
      local_id: source.local_id,
      occupancy: Occupancy.SECONDARY_RESIDENCE,
      status: HousingStatus.COMPLETED,
      rs_source: source.rs_source,
      data_file_years: [RS_DATA_FILE_YEAR]
    });

    const actual = transform({ source, existing });

    expect(actual).toHaveLength(0);
    expect(reporter.skipped).toHaveBeenCalledOnce();
  });

  it('uses deterministic event ids', () => {
    const transform = createRsTransform({
      adminUserId: auth.id,
      reporter: createNoopReporter()
    });
    const source = genSourceRs();
    const existing = toHousingRecord({
      geo_code: source.geo_code,
      local_id: source.local_id,
      occupancy: Occupancy.VACANT,
      status: HousingStatus.COMPLETED,
      data_file_years: []
    });

    const first = transform({ source, existing });
    const second = createRsTransform({
      adminUserId: auth.id,
      reporter: createNoopReporter()
    })({ source, existing });
    const firstEvent = first.find((change) => change.type === 'event')!;
    const secondEvent = second.find((change) => change.type === 'event')!;

    expect(firstEvent.value.id).toBe(secondEvent.value.id);
    expect(firstEvent.value.id).toBeTypeOf('string');
  });
});
