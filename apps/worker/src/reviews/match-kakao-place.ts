export interface KakaoMatchObservation {
  normalizedName: string;
  normalizedAddress: string;
  normalizedPhone: string | null;
  latitudeE7: number;
  longitudeE7: number;
}

export interface KakaoMatchStore {
  storeId: string;
  normalizedName: string;
  normalizedAddress: string;
  normalizedPhone: string | null;
  latitudeE7: number | null;
  longitudeE7: number | null;
  catalogStatus: string;
}

export type KakaoPlaceMatch =
  | {
      status: "MATCHED_ELIGIBLE" | "MATCHED_EXCLUDED";
      storeId: string;
      signals: {
        addressExact: true;
        nameExact: true;
        phoneExact: boolean;
        coordinateDistanceMeters: number;
      };
    }
  | {
      status: "AMBIGUOUS" | "UNMATCHED";
      storeId: null;
      signals: {
        candidateCount: number;
        reasonCode:
          | "MULTIPLE_STRONG_MATCHES"
          | "PHONE_CONFLICT"
          | "INSUFFICIENT_SIGNALS";
      };
    };

export function distanceMetersE7(
  left: { latitudeE7: number; longitudeE7: number },
  right: { latitudeE7: number; longitudeE7: number }
): number {
  const toRadians = (degrees: number) =>
    (degrees * Math.PI) / 180;
  const leftLat = left.latitudeE7 / 10_000_000;
  const rightLat = right.latitudeE7 / 10_000_000;
  const deltaLat = toRadians(rightLat - leftLat);
  const deltaLon = toRadians(
    right.longitudeE7 / 10_000_000 -
      left.longitudeE7 / 10_000_000
  );
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(leftLat)) *
      Math.cos(toRadians(rightLat)) *
      Math.sin(deltaLon / 2) ** 2;
  return (
    6_371_000 *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

interface EvaluatedCandidate {
  store: KakaoMatchStore;
  addressExact: boolean;
  nameExact: boolean;
  phoneExact: boolean;
  phoneConflict: boolean;
  coordinateDistanceMeters: number;
  coordinateClose: boolean;
}

function evaluateCandidate(
  observation: KakaoMatchObservation,
  store: KakaoMatchStore
): EvaluatedCandidate {
  const addressExact =
    observation.normalizedAddress === store.normalizedAddress;
  const nameExact =
    observation.normalizedName === store.normalizedName;
  const phoneExact =
    observation.normalizedPhone !== null &&
    observation.normalizedPhone === store.normalizedPhone;
  const phoneConflict =
    observation.normalizedPhone !== null &&
    store.normalizedPhone !== null &&
    observation.normalizedPhone !== store.normalizedPhone;
  const coordinateDistanceMeters =
    store.latitudeE7 === null || store.longitudeE7 === null
      ? Number.POSITIVE_INFINITY
      : distanceMetersE7(observation, {
          latitudeE7: store.latitudeE7,
          longitudeE7: store.longitudeE7
        });

  return {
    store,
    addressExact,
    nameExact,
    phoneExact,
    phoneConflict,
    coordinateDistanceMeters,
    coordinateClose: coordinateDistanceMeters <= 75
  };
}

export function matchKakaoObservation(
  observation: KakaoMatchObservation,
  stores: readonly KakaoMatchStore[]
): KakaoPlaceMatch {
  const evaluated = stores.map((store) =>
    evaluateCandidate(observation, store)
  );
  const strongMatches = evaluated.filter(
    (candidate) =>
      candidate.addressExact &&
      candidate.nameExact &&
      (candidate.phoneExact || candidate.coordinateClose) &&
      !candidate.phoneConflict
  );
  const phoneConflicts = evaluated.filter(
    (candidate) =>
      candidate.addressExact &&
      candidate.nameExact &&
      candidate.coordinateClose &&
      candidate.phoneConflict
  );

  if (strongMatches.length > 1) {
    return {
      status: "AMBIGUOUS",
      storeId: null,
      signals: {
        candidateCount: strongMatches.length,
        reasonCode: "MULTIPLE_STRONG_MATCHES"
      }
    };
  }
  if (phoneConflicts.length > 0) {
    return {
      status: "AMBIGUOUS",
      storeId: null,
      signals: {
        candidateCount:
          strongMatches.length + phoneConflicts.length,
        reasonCode: "PHONE_CONFLICT"
      }
    };
  }

  const match = strongMatches[0];
  if (match !== undefined) {
    return {
      status:
        match.store.catalogStatus === "published"
          ? "MATCHED_ELIGIBLE"
          : "MATCHED_EXCLUDED",
      storeId: match.store.storeId,
      signals: {
        addressExact: true,
        nameExact: true,
        phoneExact: match.phoneExact,
        coordinateDistanceMeters: match.coordinateDistanceMeters
      }
    };
  }

  const candidateCount = evaluated.filter(
    (candidate) =>
      candidate.addressExact ||
      candidate.nameExact ||
      candidate.phoneExact ||
      candidate.coordinateClose
  ).length;
  return {
    status: "UNMATCHED",
    storeId: null,
    signals: {
      candidateCount,
      reasonCode: "INSUFFICIENT_SIGNALS"
    }
  };
}
