export interface ExtractedParkingSign {
  isSignpost: boolean;
  readable: boolean;
  allPanelsVisible: boolean;
  extractionConfidence: number;
  parkingPermitted: boolean | null;
  residentPermitZones: number[];
  restrictionStart: string | null;
  restrictionEnd: string | null;
  applicableWeekdays: number[];
  rawText: string;
  notes: string[];
}

export interface SignImage {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}

function parseResidentZones(text: string): number[] {
  const zones = new Set<number>();
  for (const match of text.matchAll(/(?:permit|zone|אזור|רשיון|רישיון|תו\s*אזורי)\s*([^\n,.;]+)/gi)) {
    const chunk = match[1];
    for (const numMatch of chunk.matchAll(/\d+/g)) {
      zones.add(Number(numMatch[0]));
    }
  }
  return Array.from(zones).sort((a, b) => a - b);
}

function parseTimeRange(text: string): { start: string | null; end: string | null } {
  const match = text.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
  return match ? { start: match[1], end: match[2] } : { start: null, end: null };
}

function parseWeekdays(text: string): number[] {
  const words = text.toLowerCase();
  const days = new Set<number>();

  if (/(sun|ראשון)/.test(words)) days.add(0);
  if (/(mon|שני)/.test(words)) days.add(1);
  if (/(tue|שלישי)/.test(words)) days.add(2);
  if (/(wed|רביעי)/.test(words)) days.add(3);
  if (/(thu|חמישי)/.test(words)) days.add(4);
  if (/(fri|שישי)/.test(words)) days.add(5);
  if (/(sat|שבת)/.test(words)) days.add(6);

  if (days.size === 0) {
    if (/(weekdays|business days|ימי חול|ימים א-ה)/.test(words)) return [1, 2, 3, 4, 5];
    if (/(friday|שישי)/.test(words)) return [5];
    return [1, 2, 3, 4, 5];
  }

  return Array.from(days).sort((a, b) => a - b);
}

export function detectParkingPermissionFromText(text: string): boolean | null {
  const normalized = text.toLowerCase();
  const prohibited = [
    "אין חניה",
    "אין חנייה",
    "no parking",
    "parking prohibited",
    "do not park",
    "no stopping",
    "אסור לחנות",
    "אסורה החניה",
    "אסורה החנייה",
    "החניה אסורה",
    "החנייה אסורה",
    "עצירה וחניה אסורות",
    "עצירה וחנייה אסורות",
    "ללא חניה",
    "ללא חנייה",
  ];
  const allowed = [
    "חניה מותרת",
    "חנייה מותרת",
    "parking allowed",
    "parking permitted",
    "allowed parking",
    "מותר לחנות",
    "החניה מותרת",
    "החנייה מותרת",
    "חניה בתשלום",
    "חנייה בתשלום",
    "חניה מוסדרת",
    "חנייה מוסדרת",
  ];

  if (prohibited.some((term) => normalized.includes(term))) return false;
  if (allowed.some((term) => normalized.includes(term))) return true;
  return null;
}

function cleanGoogleJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

function extractTextFromGoogleResponse(response: any): string {
  if (Array.isArray(response.candidates)) {
    for (const candidate of response.candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
      }
    }
  }

  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  if (Array.isArray(response.predictions)) {
    for (const prediction of response.predictions) {
      if (Array.isArray(prediction.content)) {
        for (const item of prediction.content) {
          if (item?.type === "output_text" && typeof item.text === "string") {
            return item.text.trim();
          }
          if (typeof item?.text === "string") {
            return item.text.trim();
          }
        }
      }
    }
  }

  if (Array.isArray(response.output)) {
    for (const output of response.output) {
      const content = Array.isArray(output.content) ? output.content : [];
      for (const item of content) {
        if (item?.type === "output_text" && typeof item.text === "string") {
          return item.text.trim();
        }
        if (typeof item?.text === "string") {
          return item.text.trim();
        }
      }
    }
  }

  return "";
}

function buildGoogleNotes(parsedNotes: unknown): string[] {
  if (Array.isArray(parsedNotes)) {
    return parsedNotes.map((note) => String(note));
  }
  if (typeof parsedNotes === "string") {
    return [parsedNotes];
  }
  return ["Parsed using Google AI Studio image analysis."];
}

async function analyzeWithGoogle(images: SignImage[]): Promise<ExtractedParkingSign> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const model = process.env.GEMINI_MODEL ?? process.env.GOOGLE_MODEL;
  if (!apiKey || !model) {
    throw new Error("GEMINI_API_KEY and GEMINI_MODEL are required for Gemini analysis.");
  }

  const image = images[0];
  if (!image || !image.base64) throw new Error("A sign image is required.");
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) {
    throw new Error("The sign image must be JPEG, PNG, or WebP.");
  }
  if (image.base64.length > 8_000_000) {
    throw new Error("The sign image is too large. Please upload a smaller photo.");
  }

  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: "Inspect the image for any visible parking or curb-regulation sign. Signs are commonly in Hebrew and may use standard Israeli road-sign symbols, so interpret both the symbol and Hebrew supplemental panels. A close-up of one valid sign panel counts even when the pole, curb, or complete signpost is outside the frame. Always transcribe all readable sign text exactly into rawText. Set parkingPermitted to false for a no-parking/no-stopping symbol or prohibitive wording such as אין חניה, אסור לחנות, or החניה אסורה. Set it to true when parking is allowed conditionally, including paid parking, specified hours, resident permits, or wording such as חניה בתשלום, מותר לחנות, or החניה מותרת. Apply restrictions, hours, weekdays, and permit zones separately. Use null only when neither the visible symbol nor text establishes a parking meaning; do not use null merely because the rule has conditions. Return only valid JSON with keys: isSignpost, readable, allPanelsVisible, extractionConfidence, rawText, parkingPermitted, residentPermitZones, restrictionStart, restrictionEnd, applicableWeekdays, notes. extractionConfidence must be from 0 to 1. For an unrelated image, keep rawText as any actually visible text but set parking rule fields to null or empty arrays." },
          { inlineData: { mimeType: image.mimeType, data: image.base64 } },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google AI request failed: ${response.status} ${response.statusText} - ${body}`);
  }

  const parsedResponse = await response.json();
  const rawOutput = extractTextFromGoogleResponse(parsedResponse);
  const jsonText = cleanGoogleJson(rawOutput);

  let parsed: any = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = null;
  }

  const rawText = (parsed?.rawText ? String(parsed.rawText).trim() : rawOutput).trim();
  const notes = buildGoogleNotes(parsed?.notes);
  const residentPermitZones = parsed?.residentPermitZones ?? parseResidentZones(rawText);
  const timeRange = parseTimeRange(rawText);
  const restrictionStart = parsed?.restrictionStart ?? timeRange.start;
  const restrictionEnd = parsed?.restrictionEnd ?? timeRange.end;
  const detectedPermission = detectParkingPermissionFromText(rawText);
  const hasConditionalParkingRule =
    residentPermitZones.length > 0 ||
    (restrictionStart !== null && restrictionEnd !== null);
  const parkingPermitted =
    parsed?.parkingPermitted ??
    detectedPermission ??
    (hasConditionalParkingRule ? true : null);
  const hasStructuredParkingEvidence =
    rawText.length >= 5 &&
    (typeof parkingPermitted === "boolean" ||
      residentPermitZones.length > 0 ||
      (restrictionStart !== null && restrictionEnd !== null));
  const hasReadableText = rawText.length >= 4;
  const isSignpost = parsed?.isSignpost === true || hasStructuredParkingEvidence;
  const reportedConfidence = Math.max(0, Math.min(1, Number(parsed?.extractionConfidence) || 0));
  const extractionConfidence = hasStructuredParkingEvidence || hasReadableText
    ? Math.max(0.55, reportedConfidence)
    : reportedConfidence;

  return {
    isSignpost,
    readable: parsed?.readable === true || hasStructuredParkingEvidence || hasReadableText,
    allPanelsVisible:
      isSignpost &&
      (parsed?.allPanelsVisible === true ||
        (parsed?.isSignpost === false && hasStructuredParkingEvidence)),
    extractionConfidence,
    parkingPermitted,
    residentPermitZones,
    restrictionStart,
    restrictionEnd,
    applicableWeekdays: parsed?.applicableWeekdays ?? parseWeekdays(rawText),
    rawText,
    notes,
  };
}

export async function analyzeParkingSigns(
  images: SignImage[],
): Promise<ExtractedParkingSign | null> {
  if (images.length === 0) return null;

  return analyzeWithGoogle(images);
}
