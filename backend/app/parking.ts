import type { GisParkingContext } from "./gis.ts";
import type { ExtractedParkingSign } from "./signAnalysis.ts";

export type ParkingDecision = "allowed" | "prohibited" | "uncertain";
export type ConfidenceLevel = "low" | "medium" | "high";

export interface DriverContext {
  isTelAvivResident: boolean;
  residentPermitZone?: number;
}

export interface ParkingEvaluationInput {
  gis: GisParkingContext;
  driver: DriverContext;
  sign: ExtractedParkingSign | null;
  checkedAt?: Date;
  validationFailure?: string;
}

export interface ParkingEvaluation {
  decision: ParkingDecision;
  canPark: boolean | null;
  confidence: {
    level: ConfidenceLevel;
    score: number;
    reason: string;
  };
  zone: GisParkingContext["zone"];
  paymentRequiredNow: boolean;
  paymentAppMustBeActivated: boolean;
  explanation: string[];
  assumptions: string[];
  warnings: string[];
}

interface JerusalemTime {
  weekday: string;
  weekdayNumber: number;
  minutesSinceMidnight: number;
}

const WEEKDAY_NUMBERS: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function getJerusalemTime(date: Date): JerusalemTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);

  if (!weekday || !(weekday in WEEKDAY_NUMBERS) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error("Could not calculate Jerusalem time.");
  }

  return {
    weekday,
    weekdayNumber: WEEKDAY_NUMBERS[weekday],
    minutesSinceMidnight: hour * 60 + minute,
  };
}

function parseTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function isInsideRange(now: number, start: number, end: number): boolean {
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

function standardPaymentIsActive(gis: GisParkingContext, time: JerusalemTime): boolean {
  if (time.weekday === "Saturday") return false;

  const start = parseTime(
    time.weekday === "Friday"
      ? gis.standardPaymentHours.fridayStart
      : gis.standardPaymentHours.weekdayStart,
  );
  const end = parseTime(
    time.weekday === "Friday"
      ? gis.standardPaymentHours.fridayEnd
      : gis.standardPaymentHours.weekdayEnd,
  );

  return isInsideRange(time.minutesSinceMidnight, start, end);
}

function signRestrictionIsActive(
  sign: ExtractedParkingSign,
  time: JerusalemTime,
): boolean {
  if (!sign.applicableWeekdays.includes(time.weekdayNumber)) return false;
  if (!sign.restrictionStart || !sign.restrictionEnd) return true;

  return isInsideRange(
    time.minutesSinceMidnight,
    parseTime(sign.restrictionStart),
    parseTime(sign.restrictionEnd),
  );
}

export function evaluateParking(input: ParkingEvaluationInput): ParkingEvaluation {
  const checkedAt = input.checkedAt ?? new Date();
  const time = getJerusalemTime(checkedAt);
  const permitMatches =
    input.driver.isTelAvivResident &&
    input.driver.residentPermitZone === input.gis.zone.number;
  const paymentHoursActive = standardPaymentIsActive(input.gis, time);
  const paymentRequiredNow = paymentHoursActive && !permitMatches;

  const explanation = [`The location is inside ${input.gis.zone.label}.`];
  const assumptions = [
    "The selected space is ordinary regulated parking unless the submitted sign says otherwise.",
    "No temporary restriction applies.",
  ];
  const warnings = ["Signs and curb markings at the location take precedence."];

  if (!input.sign || input.validationFailure) {
    explanation.push(input.validationFailure ?? "A verified signpost photo is required for a parking verdict.");

    return {
      decision: "uncertain",
      canPark: null,
      confidence: {
        level: "low",
        score: 0,
        reason: "The sign evidence did not pass validation, so no parking verdict was produced.",
      },
      zone: input.gis.zone,
      paymentRequiredNow,
      paymentAppMustBeActivated: paymentRequiredNow,
      explanation,
      assumptions,
      warnings,
    };
  }

  if (input.sign.parkingPermitted === null) {
    explanation.push("The sign was detected, but its parking rule could not be determined.");
    return {
      decision: "uncertain",
      canPark: null,
      confidence: {
        level: "low",
        score: Math.round(input.sign.extractionConfidence * 50),
        reason: "The extracted sign did not contain a conclusive parking permission rule.",
      },
      zone: input.gis.zone,
      paymentRequiredNow,
      paymentAppMustBeActivated: paymentRequiredNow,
      explanation,
      assumptions,
      warnings,
    };
  }

  if (!input.sign.readable) {
    explanation.push("The submitted sign image is unreadable.");
    return {
      decision: "uncertain",
      canPark: null,
      confidence: {
        level: "low",
        score: 30,
        reason: "The complete signpost could not be read reliably.",
      },
      zone: input.gis.zone,
      paymentRequiredNow,
      paymentAppMustBeActivated: paymentRequiredNow,
      explanation,
      assumptions,
      warnings,
    };
  }

  if (!input.sign.allPanelsVisible) {
    warnings.push("The complete signpost may not be visible; an unseen panel could change this result.");
    assumptions.push("The visible sign contains the rule that applies to this parking space.");
  }

  const restrictionActive = signRestrictionIsActive(input.sign, time);
  const permitAllowed =
    input.sign.residentPermitZones.length === 0 ||
    (input.driver.residentPermitZone !== undefined &&
      input.sign.residentPermitZones.includes(input.driver.residentPermitZone));

  const prohibited =
    restrictionActive &&
    (input.sign.parkingPermitted === false || !permitAllowed);

  explanation.push(`Sign text: ${input.sign.rawText}`);

  if (prohibited) {
    explanation.push(
      permitAllowed
        ? "The photographed sign prohibits parking at the current time."
        : "The photographed sign requires a resident permit that does not match this vehicle.",
    );
  } else {
    explanation.push("The photographed sign does not prohibit this vehicle at the current time.");
  }

  const completeSignpost = input.sign.allPanelsVisible;

  return {
    decision: prohibited ? "prohibited" : "allowed",
    canPark: !prohibited,
    confidence: {
      level: completeSignpost ? "high" : "medium",
      score: completeSignpost
        ? Math.round(70 + input.sign.extractionConfidence * 20)
        : Math.round(45 + input.sign.extractionConfidence * 20),
      reason: completeSignpost
        ? "Official GIS context and a readable, complete signpost agree."
        : "The visible parking rule is readable, but the complete signpost may not be shown.",
    },
    zone: input.gis.zone,
    paymentRequiredNow,
    paymentAppMustBeActivated: paymentRequiredNow,
    explanation,
    assumptions,
    warnings,
  };
}
