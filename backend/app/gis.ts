const PARKING_ZONES_URL =
  "https://gisn.tel-aviv.gov.il/arcgis/rest/services/" +
  "IView2/MapServer/544/query";

const CENTRAL_TARIFF_ZONES = new Set([6, 7, 9, 10]);
const CITYWIDE_TARIFF_ZONES = new Set([1, 2, 4, 12, 13]);

export interface LocationInput {
  latitude: number;
  longitude: number;
  gpsAccuracyMeters?: number;
}

export interface GisParkingContext {
  location: {
    latitude: number;
    longitude: number;
    gpsAccuracyMeters: number | null;
  };
  zone: {
    number: number;
    label: string;
    tariffArea: "central" | "citywide";
    dataImportedAt: string;
  };
  standardPaymentHours: {
    weekdayStart: "08:00";
    weekdayEnd: "19:00" | "21:00";
    fridayStart: "08:00";
    fridayEnd: "17:00";
  };
}

interface ArcGisResponse {
  features?: Array<{
    attributes: {
      ms_ezor: number;
      LABEL: string;
      date_import: string;
    };
  }>;
  error?: {
    message?: string;
    details?: string[];
  };
}

function validateLocation(input: LocationInput): void {
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }

  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  if (
    input.gpsAccuracyMeters !== undefined &&
    (!Number.isFinite(input.gpsAccuracyMeters) || input.gpsAccuracyMeters < 0)
  ) {
    throw new Error("GPS accuracy must be a non-negative number.");
  }
}

export async function getGisParkingContext(
  input: LocationInput,
): Promise<GisParkingContext | null> {
  validateLocation(input);

  const params = new URLSearchParams({
    geometry: `${input.longitude},${input.latitude}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "ms_ezor,LABEL,date_import",
    returnGeometry: "false",
    f: "json",
  });

  const response = await fetch(`${PARKING_ZONES_URL}?${params}`);

  if (!response.ok) {
    throw new Error(`Tel Aviv GIS returned HTTP ${response.status}.`);
  }

  const data = (await response.json()) as ArcGisResponse;

  if (data.error) {
    const details = data.error.details?.join(", ");
    throw new Error(
      details
        ? `${data.error.message ?? "GIS query failed"}: ${details}`
        : data.error.message ?? "GIS query failed",
    );
  }

  const attributes = data.features?.[0]?.attributes;
  if (!attributes) return null;

  const zoneNumber = attributes.ms_ezor;
  const isCentral = CENTRAL_TARIFF_ZONES.has(zoneNumber);

  if (!isCentral && !CITYWIDE_TARIFF_ZONES.has(zoneNumber)) {
    throw new Error(`Parking zone ${zoneNumber} has no configured tariff rules.`);
  }

  return {
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      gpsAccuracyMeters: input.gpsAccuracyMeters ?? null,
    },
    zone: {
      number: zoneNumber,
      label: attributes.LABEL,
      tariffArea: isCentral ? "central" : "citywide",
      dataImportedAt: attributes.date_import,
    },
    standardPaymentHours: {
      weekdayStart: "08:00",
      weekdayEnd: isCentral ? "21:00" : "19:00",
      fridayStart: "08:00",
      fridayEnd: "17:00",
    },
  };
}

export interface ParkingCheckInput extends LocationInput {
  isTelAvivResident: boolean;
  residentPermitZone?: number;
}

export async function checkParkingLocation(input: ParkingCheckInput) {
  const gis = await getGisParkingContext(input);

  if (!gis) {
    return {
      ok: false,
      error: "No Tel Aviv parking zone found at this location.",
    };
  }

  return {
    ok: true,
    location: gis.location,
    zone: gis.zone,
    paymentHours: gis.standardPaymentHours,
    isTelAvivResident: input.isTelAvivResident,
    residentPermitZone: input.residentPermitZone,
  };
}