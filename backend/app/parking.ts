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

  if (!input.sign) {
    explanation.push(
      paymentRequiredNow
        ? "Parking appears allowed, but a parking application must be activated."
        : "Parking appears allowed without payment at the current time.",
      "Submit a clear photo of the complete signpost for a street-specific decision.",
    );

    return {
      decision: "allowed",
      canPark: true,
      confidence: {
        level: "medium",
        score: 65,
        reason: "Official zone and payment rules are known, but the street sign was not checked.",
      },
      zone: input.gis.zone,
      paymentRequiredNow,
      paymentAppMustBeActivated: paymentRequiredNow,
      explanation,
      assumptions,
      warnings,
    };
  }

  if (!input.sign.readable || !input.sign.allPanelsVisible) {
    explanation.push("The submitted sign image is unreadable or does not show every sign panel.");
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

  return {
    decision: prohibited ? "prohibited" : "allowed",
    canPark: !prohibited,
    confidence: {
      level: "high",
      score: 90,
      reason: "Official GIS context and a readable, complete signpost agree.",
    },
    zone: input.gis.zone,
    paymentRequiredNow,
    paymentAppMustBeActivated: paymentRequiredNow,
    explanation,
    assumptions,
    warnings,
  };
}