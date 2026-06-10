import { toArray } from '@zerologementvacant/utils/node';
import { ReadableStream } from 'node:stream/web';

import {
  formatHousingRecordApi,
  Housing
} from '~/repositories/housingRepository';
import {
  createRsEnricher,
  EnrichedSourceRs
} from '~/scripts/import-rs/rs-enricher';
import { SourceRs } from '~/scripts/import-rs/source-rs';
import { genHousingApi } from '~/test/testFixtures';

function toSourceRs(housing: ReturnType<typeof genHousingApi>): SourceRs {
  return {
    geo_code: housing.geoCode,
    local_id: housing.localId,
    invariant: housing.invariant,
    address: housing.rawAddress[0],
    rs_source: 'taxe-habitation'
  };
}

describe('createRsEnricher', () => {
  it('populates existing housing for sources spread across partitions', async () => {
    const parisHousing = genHousingApi('75056');
    const lyonHousing = genHousingApi('69123');
    const missingHousing = genHousingApi('33063');
    await Housing().insert(
      [parisHousing, lyonHousing].map(formatHousingRecordApi)
    );

    const results = (await toArray(
      ReadableStream.from([
        toSourceRs(parisHousing),
        toSourceRs(lyonHousing),
        toSourceRs(missingHousing)
      ]).pipeThrough(createRsEnricher())
    )) as EnrichedSourceRs[];

    expect(results).toHaveLength(3);
    expect(results).toContainEqual(
      expect.objectContaining({
        source: expect.objectContaining({ geo_code: parisHousing.geoCode }),
        existing: expect.objectContaining({ id: parisHousing.id })
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        source: expect.objectContaining({ geo_code: lyonHousing.geoCode }),
        existing: expect.objectContaining({ id: lyonHousing.id })
      })
    );
    expect(results).toContainEqual(
      expect.objectContaining({
        source: expect.objectContaining({ geo_code: missingHousing.geoCode }),
        existing: null
      })
    );
  });
});
