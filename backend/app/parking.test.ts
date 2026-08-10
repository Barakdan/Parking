import assert from "node:assert/strict";
import test from "node:test";
import { evaluateParking } from "./parking.js";
import type { ExtractedParkingSign } from "./signAnalysis.js";

const gis = {
  location: { latitude: 32.08, longitude: 34.78, gpsAccuracyMeters: 5 },
  zone: { number: 1, label: "Test zone", tariffArea: "citywide" as const, dataImportedAt: "2026-01-01" },
  standardPaymentHours: {
    weekdayStart: "08:00" as const,
    weekdayEnd: "19:00" as const,
    fridayStart: "08:00" as const,
    fridayEnd: "17:00" as const,
  },
};

function specialSign(overrides: Partial<ExtractedParkingSign>): ExtractedParkingSign {
  return {
    isSignpost: true,
    readable: true,
    allPanelsVisible: true,
    extractionConfidence: 0.95,
    parkingPermitted: true,
    generalParkingAllowed: false,
    loadingOnly: false,
    disabledPermitRequired: false,
    reservedDisabledSpaces: null,
    residentPermitZones: [],
    restrictionStart: null,
    restrictionEnd: null,
    applicableWeekdays: [],
    rawText: "",
    notes: [],
    ...overrides,
  };
}

test("ordinary parking is prohibited in loading-only areas", () => {
  const result = evaluateParking({
    gis,
    driver: { isTelAvivResident: false },
    sign: specialSign({ loadingOnly: true }),
    checkedAt: new Date("2026-08-10T10:00:00Z"),
  });
  assert.equal(result.decision, "prohibited");
  assert.match(result.explanation.at(-1) ?? "", /loading and unloading/);
});

test("ordinary parking is prohibited in disabled-permit spaces", () => {
  const result = evaluateParking({
    gis,
    driver: { isTelAvivResident: false },
    sign: specialSign({ disabledPermitRequired: true, reservedDisabledSpaces: 2 }),
    checkedAt: new Date("2026-08-10T10:00:00Z"),
  });
  assert.equal(result.decision, "prohibited");
  assert.match(result.explanation.at(-1) ?? "", /2 spaces/);
});
