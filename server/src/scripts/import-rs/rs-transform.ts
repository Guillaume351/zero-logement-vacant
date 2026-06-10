import {
  HOUSING_STATUS_LABELS,
  HousingStatus,
  Occupancy,
  OCCUPANCY_LABELS
} from '@zerologementvacant/models';
import { v5 as uuidv5 } from 'uuid';

import { HousingEventApi } from '~/models/EventApi';
import { normalizeDataFileYears } from '~/models/HousingApi';
import { HousingRecordDBO } from '~/repositories/housingRepository';
import {
  ReporterError,
  ReporterOptions
} from '~/scripts/import-lovac/infra';
import { EnrichedSourceRs } from '~/scripts/import-rs/rs-enricher';
import {
  RS_DATA_FILE_YEAR,
  SourceRs,
  sourceRsKey
} from '~/scripts/import-rs/source-rs';

const RS_NAMESPACE = uuidv5('rs-import', uuidv5.DNS);
type ReadOnlyFields = 'last_mutation_type' | 'occupancy_history' | 'plot_area';
export type RsHousingRecord = Omit<HousingRecordDBO, ReadOnlyFields>;
const READ_ONLY_FIELD_KEYS: ReadonlyArray<ReadOnlyFields> = [
  'last_mutation_type',
  'occupancy_history',
  'plot_area'
];

interface Change<Value, Type extends string> {
  type: Type;
  kind: 'create' | 'update';
  value: Value;
}

export type RsHousingChange = Change<RsHousingRecord, 'housing'> & {
  kind: 'update';
};
export type RsHousingEventChange = Change<HousingEventApi, 'event'> & {
  kind: 'create';
};
export type RsChange = RsHousingChange | RsHousingEventChange;

interface TransformOptions extends ReporterOptions<SourceRs> {
  adminUserId: string;
}

export function createRsTransform(opts: TransformOptions) {
  const seen = new Set<string>();
  const { abortEarly, adminUserId, reporter } = opts;

  return function transform(enriched: EnrichedSourceRs): RsChange[] {
    const key = sourceRsKey(enriched.source);
    try {
      if (seen.has(key)) {
        reporter.failed(
          enriched.source,
          new ReporterError(`Duplicate source housing: ${key}`, enriched.source)
        );
        return [];
      }
      seen.add(key);

      if (!enriched.existing) {
        reporter.failed(
          enriched.source,
          new ReporterError(`Housing not found: ${key}`, enriched.source)
        );
        return [];
      }

      const changes = toChanges(enriched.existing, { adminUserId });
      if (changes.length === 0) {
        reporter.skipped(enriched.source);
      } else {
        reporter.passed(enriched.source);
      }
      return changes;
    } catch (error) {
      reporter.failed(
        enriched.source,
        new ReporterError((error as Error).message, enriched.source)
      );
      if (abortEarly) throw error;
      return [];
    }
  };
}

function toChanges(
  existing: HousingRecordDBO,
  opts: { adminUserId: string }
): RsChange[] {
  const dataFileYears = normalizeDataFileYears([
    ...(existing.data_file_years ?? []),
    RS_DATA_FILE_YEAR
  ]);
  const housing: RsHousingRecord = {
    ...toWritableRecord(existing),
    occupancy: Occupancy.SECONDARY_RESIDENCE,
    status: HousingStatus.COMPLETED,
    data_file_years: dataFileYears
  };

  const changed =
    existing.occupancy !== housing.occupancy ||
    existing.status !== housing.status ||
    !existing.data_file_years?.includes(RS_DATA_FILE_YEAR);
  if (!changed) {
    return [];
  }

  const changes: RsChange[] = [
    { type: 'housing', kind: 'update', value: housing }
  ];

  if (existing.occupancy !== housing.occupancy) {
    changes.push({
      type: 'event',
      kind: 'create',
      value: {
        id: uuidv5(
          `${existing.id}:housing:occupancy-updated:${RS_DATA_FILE_YEAR}`,
          RS_NAMESPACE
        ),
        type: 'housing:occupancy-updated',
        nextOld: { occupancy: OCCUPANCY_LABELS[existing.occupancy] },
        nextNew: { occupancy: OCCUPANCY_LABELS[housing.occupancy] },
        createdBy: opts.adminUserId,
        createdAt: new Date().toISOString(),
        housingGeoCode: existing.geo_code,
        housingId: existing.id
      }
    });
  }

  if (existing.status !== housing.status) {
    changes.push({
      type: 'event',
      kind: 'create',
      value: {
        id: uuidv5(
          `${existing.id}:housing:status-updated:${RS_DATA_FILE_YEAR}`,
          RS_NAMESPACE
        ),
        type: 'housing:status-updated',
        nextOld: {
          status: HOUSING_STATUS_LABELS[existing.status],
          subStatus: existing.sub_status
        },
        nextNew: {
          status: HOUSING_STATUS_LABELS[housing.status],
          subStatus: existing.sub_status
        },
        createdBy: opts.adminUserId,
        createdAt: new Date().toISOString(),
        housingGeoCode: existing.geo_code,
        housingId: existing.id
      }
    });
  }

  return changes;
}

function toWritableRecord(housing: HousingRecordDBO): RsHousingRecord {
  return Object.fromEntries(
    Object.entries(housing).filter(
      ([key]) => !READ_ONLY_FIELD_KEYS.includes(key as ReadOnlyFields)
    )
  ) as RsHousingRecord;
}
