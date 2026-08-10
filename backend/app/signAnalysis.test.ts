import assert from "node:assert/strict";
import test from "node:test";
import { detectParkingPermissionFromText } from "./signAnalysis.js";

test("recognizes common Hebrew parking permission phrases", () => {
  assert.equal(detectParkingPermissionFromText("חניה בתשלום בימים א-ה"), true);
  assert.equal(detectParkingPermissionFromText("החנייה מותרת לבעלי תו אזורי"), true);
  assert.equal(detectParkingPermissionFromText("מותר לחנות בין 08:00-19:00"), true);
});

test("recognizes common Hebrew parking prohibitions", () => {
  assert.equal(detectParkingPermissionFromText("אין חניה"), false);
  assert.equal(detectParkingPermissionFromText("אסור לחנות בכל שעות היממה"), false);
  assert.equal(detectParkingPermissionFromText("עצירה וחנייה אסורות"), false);
});
