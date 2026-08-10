import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { GisParkingContext } from "./gis.js";
import {
  evaluateParking,
  type DriverContext,
  type ParkingEvaluation,
} from "./parking.js";
import {
  analyzeParkingSigns,
  type ExtractedParkingSign,
  type SignImage,
} from "./signAnalysis.js";

const ParkingState = Annotation.Root({
  gis: Annotation<GisParkingContext>,
  driver: Annotation<DriverContext>,
  checkedAt: Annotation<Date>,
  images: Annotation<SignImage[]>,
  sign: Annotation<ExtractedParkingSign | null>,
  validationFailure: Annotation<string | null>,
  result: Annotation<ParkingEvaluation | null>,
});

export function getSignValidationFailure(sign: ExtractedParkingSign | null): string | null {
  if (!sign) return "No signpost image was provided.";
  if (!sign.isSignpost) return "The submitted image was not recognized as a parking signpost.";
  if (!sign.readable) return "The parking sign text could not be read reliably.";
  if (!sign.allPanelsVisible) return "The complete signpost is not visible in the submitted image.";
  if (sign.extractionConfidence < 0.7) return "The sign extraction confidence is too low for a parking verdict.";
  if (sign.parkingPermitted === null) return "The sign's parking permission could not be determined.";
  return null;
}

const workflow = new StateGraph(ParkingState)
  .addNode("analyze_sign", async (state) => ({
    sign: state.sign ?? await analyzeParkingSigns(state.images),
  }))
  .addNode("validate_sign", (state) => ({
    validationFailure: getSignValidationFailure(state.sign),
  }))
  .addNode("produce_verdict", (state) => ({
    result: evaluateParking({
      gis: state.gis,
      driver: state.driver,
      sign: state.sign,
      checkedAt: state.checkedAt,
      validationFailure: state.validationFailure ?? undefined,
    }),
  }))
  .addEdge(START, "analyze_sign")
  .addEdge("analyze_sign", "validate_sign")
  .addEdge("validate_sign", "produce_verdict")
  .addEdge("produce_verdict", END)
  .compile();

export async function runParkingWorkflow(input: {
  gis: GisParkingContext;
  driver: DriverContext;
  checkedAt: Date;
  images?: SignImage[];
  sign?: ExtractedParkingSign | null;
}): Promise<{
  sign: ExtractedParkingSign | null;
  result: ParkingEvaluation;
  validationFailure: string | null;
}> {
  const state = await workflow.invoke({
    ...input,
    images: input.images ?? [],
    sign: input.sign ?? null,
    validationFailure: null,
    result: null,
  });

  if (!state.result) throw new Error("The parking workflow did not produce a result.");
  return {
    sign: state.sign,
    result: state.result,
    validationFailure: state.validationFailure,
  };
}
