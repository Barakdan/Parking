import type { LocationInput } from "./gis.js";
import type { SignImage } from "./signAnalysis.js";

const DEFAULT_MAX_DISTANCE_METERS = 150;

export function distanceInMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const earthRadius = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const firstLatitude = radians(a.latitude);
  const secondLatitude = radians(b.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadius * Math.asin(Math.sqrt(haversine));
}

export interface PhotoLocationAssessment {
  verified: boolean;
  status: "verified" | "missing" | "invalid" | "mismatch";
  distanceMeters: number | null;
  maxDistanceMeters: number;
  note: string;
}

export function assessPhotoLocation(
  image: SignImage | undefined,
  submittedLocation: LocationInput,
): PhotoLocationAssessment {
  const configuredDistance = Number(process.env.PHOTO_LOCATION_MAX_DISTANCE_METERS);
  const maxDistanceMeters = Number.isFinite(configuredDistance) && configuredDistance > 0
    ? configuredDistance
    : DEFAULT_MAX_DISTANCE_METERS;
  const photoLocation = image?.photoLocation;
  if (!photoLocation) {
    return {
      verified: false,
      status: "missing",
      distanceMeters: null,
      maxDistanceMeters,
      note: "Photo location could not be verified because GPS metadata is missing; confidence was reduced and this sign was not cached.",
    };
  }

  if (
    !Number.isFinite(photoLocation.latitude) ||
    !Number.isFinite(photoLocation.longitude) ||
    Math.abs(photoLocation.latitude) > 90 ||
    Math.abs(photoLocation.longitude) > 180
  ) {
    return {
      verified: false,
      status: "invalid",
      distanceMeters: null,
      maxDistanceMeters,
      note: "The photo contains invalid GPS coordinates; confidence was reduced and this sign was not cached.",
    };
  }

  const distanceMeters = distanceInMeters(photoLocation, submittedLocation);

  if (distanceMeters > maxDistanceMeters) {
    return {
      verified: false,
      status: "mismatch",
      distanceMeters,
      maxDistanceMeters,
      note: `The photo GPS is ${Math.round(distanceMeters)}m from the selected location; confidence was reduced and this sign was not cached.`,
    };
  }

  return {
    verified: true,
    status: "verified",
    distanceMeters,
    maxDistanceMeters,
    note: `Photo location verified within ${Math.round(distanceMeters)}m.`,
  };
}
