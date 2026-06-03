import {
  DO_NOT_CONTACT_OWNER_RANK,
  HousingOwnerDTO,
  isActiveOwnerRank,
  OwnerRank,
  type BaseHousingOwnerDTO
} from '@zerologementvacant/models';
import { Equivalence } from 'effect';

import { HousingRecordApi } from './HousingApi';
import { OwnerApi, toOwnerDTO } from './OwnerApi';

export const MAX_OWNERS = 6;

export type HousingOwnerNextApi = HousingOwnerDTO;

export type HousingOwnerApi = Pick<
  HousingOwnerDTO,
  | 'rank'
  | 'idprocpte'
  | 'idprodroit'
  | 'locprop'
  | 'relativeLocation'
  | 'absoluteDistance'
  | 'propertyRight'
> &
  OwnerApi & {
    ownerId: string;
    housingId: string;
    housingGeoCode: string;
    startDate: Date | null;
    endDate: Date | null;
    origin: string | null;
    /**
     * @deprecated Hard to maintain because it is computed from the housings
     */
    housingCount?: number;
  };

export type OwnerHousingApi = BaseHousingOwnerDTO & {
  housing: HousingRecordApi;
};

/**
 * Consider two housing owners equivalent
 * if they refer to the same housing and owner.
 */
export const HOUSING_OWNER_EQUIVALENCE: Equivalence.Equivalence<HousingOwnerApi> =
  Equivalence.struct({
    housingGeoCode: Equivalence.string,
    housingId: Equivalence.string,
    ownerId: Equivalence.string
  });

/**
 * Consider two housing owners equivalent
 * if they refer to the same housing, owner and rank.
 */
export const HOUSING_OWNER_RANK_EQUIVALENCE: Equivalence.Equivalence<HousingOwnerApi> =
  Equivalence.struct({
    housingGeoCode: Equivalence.string,
    housingId: Equivalence.string,
    ownerId: Equivalence.string,
    rank: Equivalence.number
  });

/**
 * @deprecated
 * @param housing
 * @param owners
 */
export function toHousingOwnersApi(
  housing: HousingRecordApi,
  owners: OwnerApi[]
): HousingOwnerApi[] {
  return owners.map((owner, i) => ({
    ...owner,
    ownerId: owner.id,
    housingId: housing.id,
    housingGeoCode: housing.geoCode,
    idprocpte: null,
    idprodroit: null,
    origin: null,
    rank: (i + 1) as OwnerRank,
    startDate: new Date(),
    endDate: null,
    locprop: null,
    relativeLocation: null,
    absoluteDistance: null,
    propertyRight: null
  }));
}

/**
 * Re-rank an owner within a single housing's owner list while keeping the rest
 * consistent: the remaining active owners are re-ranked contiguously from 1
 * (which promotes the next owner to primary when the target was primary), and
 * the target is placed at the rank returned by `rankFor`. Inactive owners and
 * other do-not-contact owners keep their rank.
 */
function rerankOwner(
  owners: ReadonlyArray<HousingOwnerApi>,
  ownerId: string,
  rankFor: (activeOthersCount: number) => OwnerRank
): HousingOwnerApi[] {
  const target = owners.find((owner) => owner.ownerId === ownerId);
  if (!target) {
    return [...owners];
  }

  const others = owners.filter((owner) => owner.ownerId !== ownerId);
  const activeOthers = others
    .filter((owner) => isActiveOwnerRank(owner.rank))
    .sort((a, b) => a.rank - b.rank)
    .map((owner, index) => ({ ...owner, rank: (index + 1) as OwnerRank }));
  const rest = others.filter((owner) => !isActiveOwnerRank(owner.rank));

  return [
    ...activeOthers,
    { ...target, rank: rankFor(activeOthers.length) },
    ...rest
  ];
}

/**
 * Mark an owner as "do not contact" within a single housing's owner list.
 * The next active owner is promoted to primary when the marked owner was the
 * primary recipient.
 */
export function markOwnerDoNotContact(
  owners: ReadonlyArray<HousingOwnerApi>,
  ownerId: string
): HousingOwnerApi[] {
  return rerankOwner(owners, ownerId, () => DO_NOT_CONTACT_OWNER_RANK);
}

/**
 * Remove the "do not contact" status of an owner within a single housing's
 * owner list. The owner rejoins as the next secondary recipient (or becomes
 * primary when there is no other active owner).
 */
export function unmarkOwnerDoNotContact(
  owners: ReadonlyArray<HousingOwnerApi>,
  ownerId: string
): HousingOwnerApi[] {
  return rerankOwner(
    owners,
    ownerId,
    (activeOthersCount) => (activeOthersCount + 1) as OwnerRank
  );
}

export function toHousingOwnerDTO(
  housingOwner: HousingOwnerApi
): HousingOwnerDTO {
  return {
    ...toOwnerDTO(housingOwner),
    id: housingOwner.ownerId,
    rank: housingOwner.rank,
    idprocpte: housingOwner.idprocpte ?? null,
    idprodroit: housingOwner.idprodroit ?? null,
    locprop: housingOwner.locprop ?? null,
    relativeLocation: housingOwner.relativeLocation ?? null,
    absoluteDistance: housingOwner.absoluteDistance ?? null,
    propertyRight: housingOwner.propertyRight
  };
}

