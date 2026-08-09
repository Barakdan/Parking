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

/**
 * Vision-provider boundary. The model must extract structured facts only;
 * parking.ts remains responsible for the final parking decision.
 */
export async function analyzeParkingSigns(
  images: SignImage[],
): Promise<ExtractedParkingSign | null> {
  if (images.length === 0) return null;

  throw new Error(
    "Parking-sign image analysis is not configured yet. Connect a vision provider here.",
  );
}