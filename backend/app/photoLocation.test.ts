import assert from "node:assert/strict";
import test from "node:test";
import { assessPhotoLocation } from "./photoLocation.js";

const image = {
  mimeType: "image/jpeg" as const,
  base64: "test",
  photoLocation: { latitude: 32.07501, longitude: 34.77751 },
};

test("accepts a photo taken near the submitted location", () => {
  const result = assessPhotoLocation(image, {
    latitude: 32.0751,
    longitude: 34.7776,
  });
  assert.ok(result.distanceMeters < result.maxDistanceMeters);
  assert.equal(result.verified, true);
});

test("marks missing photo GPS metadata as unverified", () => {
  const result = assessPhotoLocation(
    { mimeType: "image/jpeg", base64: "test" },
    image.photoLocation,
  );
  assert.equal(result.status, "missing");
  assert.equal(result.verified, false);
});

test("marks a distant photo as unverified", () => {
  const result = assessPhotoLocation(image, { latitude: 32.09, longitude: 34.79 });
  assert.equal(result.status, "mismatch");
  assert.equal(result.verified, false);
});
