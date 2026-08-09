export interface ExtractedParkingSign {
  readable: boolean;
  allPanelsVisible: boolean;
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
  for (const match of text.matchAll(/(?:permit|zone|אזור|רשיון)\s*([^\n,.;]+)/gi)) {
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

function detectParkingPermission(text: string): boolean | null {
  const normalized = text.toLowerCase();
  const prohibited = [
    "אין חניה",
    "אין חנייה",
    "no parking",
    "parking prohibited",
    "do not park",
    "no stopping",
  ];
  const allowed = [
    "חניה מותרת",
    "חנייה מותרת",
    "parking allowed",
    "parking permitted",
    "allowed parking",
  ];

  if (prohibited.some((term) => normalized.includes(term))) return false;
  if (allowed.some((term) => normalized.includes(term))) return true;
  return null;
}

function cleanGeminiJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

function extractTextFromGeminiResponse(response: any): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const outputs = Array.isArray(response.output) ? response.output : [];
  for (const output of outputs) {
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

  return "";
}

function buildGeminiNotes(parsedNotes: unknown): string[] {
  if (Array.isArray(parsedNotes)) {
    return parsedNotes.map((note) => String(note));
  }
  if (typeof parsedNotes === "string") {
    return [parsedNotes];
  }
  return ["Parsed using Gemini image understanding."];
}

async function analyzeWithGemini(images: SignImage[]): Promise<ExtractedParkingSign> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    throw new Error("GEMINI_API_KEY and GEMINI_MODEL are required for Gemini analysis.");
  }

  const image = images[0];
  const payload = {
    model,
    temperature: 0,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Extract the full readable parking sign text from the attached image and return only valid JSON with keys: rawText, parkingPermitted, residentPermitZones, restrictionStart, restrictionEnd, applicableWeekdays, notes. Use null when a value cannot be determined.",
          },
          {
            type: "input_image",
            image_url: `data:${image.mimeType};base64,${image.base64}`,
          },
        ],
      },
    ],
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${response.statusText} - ${body}`);
  }

  const parsedResponse = await response.json();
  const rawOutput = extractTextFromGeminiResponse(parsedResponse);
  const jsonText = cleanGeminiJson(rawOutput);

  let parsed: any = null;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    parsed = null;
  }

  const rawText = (parsed?.rawText ? String(parsed.rawText).trim() : rawOutput).trim();
  const notes = buildGeminiNotes(parsed?.notes);

  return {
    readable: rawText.length > 0,
    allPanelsVisible: rawText.length > 20,
    parkingPermitted: parsed?.parkingPermitted ?? detectParkingPermission(rawText),
    residentPermitZones: parsed?.residentPermitZones ?? parseResidentZones(rawText),
    restrictionStart: parsed?.restrictionStart ?? parseTimeRange(rawText).start,
    restrictionEnd: parsed?.restrictionEnd ?? parseTimeRange(rawText).end,
    applicableWeekdays: parsed?.applicableWeekdays ?? parseWeekdays(rawText),
    rawText,
    notes,
  };
}

export async function analyzeParkingSigns(
  images: SignImage[],
): Promise<ExtractedParkingSign | null> {
  if (images.length === 0) return null;

  return analyzeWithGemini(images);
}
