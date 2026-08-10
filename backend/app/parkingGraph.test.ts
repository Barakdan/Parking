import assert from "node:assert/strict";
import test from "node:test";
import { getSignValidationFailure } from "./parkingGraph.js";
import type { ExtractedParkingSign } from "./signAnalysis.js";

function sign(overrides: Partial<ExtractedParkingSign> = {}): ExtractedParkingSign {
  return {
    isSignpost: true,
    readable: true,
    allPanelsVisible: true,
    extractionConfidence: 0.95,
    parkingPermitted: true,
    residentPermitZones: [],
    restrictionStart: null,
    restrictionEnd: null,
    applicableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    rawText: "Parking permitted",
    notes: [],
    ...overrides,
  };
}

test("rejects missing and non-sign images", () => {
  assert.match(getSignValidationFailure(null) ?? "", /No signpost/);
  assert.match(getSignValidationFailure(sign({
    isSignpost: false,
    readable: false,
    extractionConfidence: 0,
    parkingPermitted: null,
    rawText: "",
  })) ?? "", /enough parking-sign evidence/);
});

test("rejects unreadable, incomplete, and low-confidence signs", () => {
  assert.match(getSignValidationFailure(sign({ readable: false })) ?? "", /could not be read/);
  assert.match(getSignValidationFailure(sign({ allPanelsVisible: false })) ?? "", /complete signpost/);
  assert.match(getSignValidationFailure(sign({ extractionConfidence: 0.54 })) ?? "", /too low/);
});

test("accepts strong parking evidence when the classifier flag is wrong", () => {
  assert.equal(getSignValidationFailure(sign({
    isSignpost: false,
    extractionConfidence: 0.6,
  })), null);
});

test("rejects inconclusive rules and accepts validated signs", () => {
  assert.match(getSignValidationFailure(sign({ parkingPermitted: null })) ?? "", /could not be determined/);
  assert.equal(getSignValidationFailure(sign()), null);
});
