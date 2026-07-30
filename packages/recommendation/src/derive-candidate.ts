import type {
  OpeningState,
  PublicReviewStatus
} from "@bread-map/contracts";
import type {
  BusinessHourFact,
  RecommendationCandidateFacts,
  ReviewAggregateFact
} from "./search-types.js";

const KST_WEEKDAYS = new Map([
  ["Sun", 0],
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6]
]);

function kstWeekdayAndMinute(requestTimeMs: number): {
  weekday: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(requestTimeMs));
  const values = new Map(
    parts.map((part) => [part.type, part.value])
  );
  const weekday = KST_WEEKDAYS.get(values.get("weekday") ?? "");
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  if (
    weekday === undefined ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new Error("REQUEST_TIME_INVALID");
  }
  return {
    weekday,
    minute: hour * 60 + minute
  };
}

function overlaps(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

export function validateBusinessHours(
  hours: readonly BusinessHourFact[]
): true {
  const sequenceKeys = new Set<string>();
  const ranges = hours.map((hour) => {
    const valid =
      Number.isInteger(hour.weekday) &&
      hour.weekday >= 0 &&
      hour.weekday <= 6 &&
      Number.isInteger(hour.sequence) &&
      hour.sequence >= 0 &&
      Number.isInteger(hour.opensMinute) &&
      hour.opensMinute >= 0 &&
      hour.opensMinute <= 1439 &&
      Number.isInteger(hour.closesMinute) &&
      hour.closesMinute >= 0 &&
      hour.closesMinute <= 1439 &&
      (hour.closesNextDay
        ? hour.closesMinute <= hour.opensMinute
        : hour.closesMinute > hour.opensMinute);
    if (!valid) {
      throw new Error("BUSINESS_HOURS_INVALID");
    }
    const sequenceKey = `${hour.weekday}:${hour.sequence}`;
    if (sequenceKeys.has(sequenceKey)) {
      throw new Error("BUSINESS_HOURS_INVALID");
    }
    sequenceKeys.add(sequenceKey);
    const start = hour.weekday * 1440 + hour.opensMinute;
    return {
      start,
      end:
        hour.weekday * 1440 +
        hour.closesMinute +
        (hour.closesNextDay ? 1440 : 0)
    };
  });

  const weekMinutes = 7 * 1440;
  for (let left = 0; left < ranges.length; left += 1) {
    for (
      let right = left + 1;
      right < ranges.length;
      right += 1
    ) {
      const leftRange = ranges[left]!;
      const rightRange = ranges[right]!;
      if (
        [-weekMinutes, 0, weekMinutes].some((shift) =>
          overlaps(
            leftRange.start,
            leftRange.end,
            rightRange.start + shift,
            rightRange.end + shift
          )
        )
      ) {
        throw new Error("BUSINESS_HOURS_OVERLAP");
      }
    }
  }
  return true;
}

export function deriveOpeningState(
  hours: readonly BusinessHourFact[],
  requestTimeMs: number
): OpeningState {
  if (hours.length === 0) {
    return "UNKNOWN";
  }
  validateBusinessHours(hours);
  const { weekday, minute } =
    kstWeekdayAndMinute(requestTimeMs);
  const previousWeekday = (weekday + 6) % 7;
  const isOpen = hours.some((hour) => {
    if (hour.weekday === weekday) {
      if (hour.closesNextDay) {
        return minute >= hour.opensMinute;
      }
      return (
        minute >= hour.opensMinute &&
        minute < hour.closesMinute
      );
    }
    return (
      hour.weekday === previousWeekday &&
      hour.closesNextDay &&
      minute < hour.closesMinute
    );
  });
  return isOpen ? "OPEN" : "CLOSED";
}

export function calculateRoundedDistanceM(
  origin: { latitudeE7: number; longitudeE7: number },
  destination: {
    latitudeE7: number;
    longitudeE7: number;
  }
): number {
  const toRadians = (degreesE7: number) =>
    (degreesE7 / 10000000) * (Math.PI / 180);
  const originLatitude = toRadians(origin.latitudeE7);
  const destinationLatitude = toRadians(
    destination.latitudeE7
  );
  const latitudeDelta =
    destinationLatitude - originLatitude;
  const longitudeDelta =
    toRadians(destination.longitudeE7) -
    toRadians(origin.longitudeE7);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  const centralAngle =
    2 *
    Math.atan2(
      Math.sqrt(Math.min(1, Math.max(0, haversine))),
      Math.sqrt(Math.max(0, 1 - haversine))
    );
  return Math.round(6371000 * centralAngle);
}

export function distanceUpperBoundM(
  distanceM: number | null
): number | null {
  if (distanceM === null) {
    return null;
  }
  return Math.max(250, Math.ceil(distanceM / 250) * 250);
}

export function deriveReviewStatus(
  reviewCount: number
): PublicReviewStatus {
  return reviewCount >= 3 ? "AVAILABLE" : "INSUFFICIENT";
}

export function calculateCompleteness(
  candidate: RecommendationCandidateFacts,
  openingState: OpeningState
): number {
  let completeness = 0;
  if (candidate.menus.length > 0) {
    completeness += 3000;
  }
  if (openingState !== "UNKNOWN") {
    completeness += 2500;
  }
  if (candidate.normalizedPhone !== null) {
    completeness += 1500;
  }
  if (candidate.reviewAggregate.count > 0) {
    completeness += 1500;
  }
  if (candidate.reviewAggregate.count >= 3) {
    completeness += 1500;
  }
  return completeness;
}

export function calculateGlobalRatingMean(
  candidates: readonly RecommendationCandidateFacts[]
): number {
  const totals = candidates.reduce(
    (result, candidate) => ({
      count:
        result.count + candidate.reviewAggregate.ratedCount,
      sum:
        result.sum +
        candidate.reviewAggregate.ratingSumBasisPoints
    }),
    { count: 0, sum: 0 }
  );
  return totals.count === 0
    ? 4000
    : Math.round(totals.sum / totals.count);
}

export function calculateAdjustedRating(
  aggregate: ReviewAggregateFact,
  globalMeanBasisPoints: number
): number {
  const priorWeight = 5;
  return Math.round(
    (aggregate.ratingSumBasisPoints +
      globalMeanBasisPoints * priorWeight) /
      (aggregate.ratedCount + priorWeight)
  );
}
