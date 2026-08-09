import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getGisParkingContext, type LocationInput } from "./gis.js";
import { evaluateParking, type DriverContext } from "./parking.js";
import { analyzeParkingSigns, type ExtractedParkingSign, type SignImage } from "./signAnalysis.js";

interface ParkingCheckRequest extends LocationInput, DriverContext {
  checkedAt?: string;
  signImages?: SignImage[];
  locationOnly?: boolean;
}

interface CachedSign {
  latitude: number;
  longitude: number;
  accuracy: number;
  cachedAt: string;
  sign: ExtractedParkingSign;
}

const cachedSigns: CachedSign[] = [];

function distanceInMeters(a: LocationInput, b: { latitude: number; longitude: number }): number {
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

function findCachedSign(input: LocationInput): CachedSign | undefined {
  return cachedSigns.find((cached) => distanceInMeters(input, cached) <= 20);
}

async function readJsonBody(request: IncomingMessage): Promise<ParkingCheckRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));

  if (chunks.length === 0) throw new Error("Request body is required.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ParkingCheckRequest;
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((origin) => origin.trim()).filter(Boolean);

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-credentials", "true");
  }

  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function sendJson(request: IncomingMessage, response: ServerResponse, status: number, value: unknown): void {
  setCorsHeaders(request, response);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    setCorsHeaders(request, response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(request, response, 200, { status: "ok" });
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/parking/check") {
    sendJson(request, response, 404, { error: "Not found" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const checkedAt = body.checkedAt ? new Date(body.checkedAt) : new Date();

    if (Number.isNaN(checkedAt.getTime())) throw new Error("checkedAt must be a valid ISO date.");

    const gis = await getGisParkingContext({
      latitude: body.latitude,
      longitude: body.longitude,
      gpsAccuracyMeters: body.gpsAccuracyMeters,
    });

    if (!gis) {
      sendJson(request, response, 404, { error: "No Tel Aviv parking zone found at this location." });
      return;
    }

    if (body.locationOnly) {
      const cached = findCachedSign(body);
      if (cached) {
        const result = evaluateParking({
          gis,
          sign: cached.sign,
          checkedAt,
          driver: {
            isTelAvivResident: body.isTelAvivResident,
            residentPermitZone: body.residentPermitZone,
          },
        });

        sendJson(request, response, 200, { ...result, cacheHit: true });
        return;
      }

      sendJson(request, response, 200, { needsPhoto: true });
      return;
    }

    const sign = await analyzeParkingSigns(body.signImages ?? []);
    if (sign) {
      cachedSigns.push({
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.gpsAccuracyMeters ?? 0,
        cachedAt: new Date().toISOString(),
        sign,
      });
    }

    const result = evaluateParking({
      gis,
      sign,
      checkedAt,
      driver: {
        isTelAvivResident: body.isTelAvivResident,
        residentPermitZone: body.residentPermitZone,
      },
    });

    sendJson(request, response, 200, { ...result, cacheHit: false });
  } catch (error) {
    sendJson(request, response, 400, {
      error: error instanceof Error ? error.message : "Parking check failed.",
    });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Can I Park Here API listening on http://localhost:${port}`);
});