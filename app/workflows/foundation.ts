export const FOUNDATION_STATUS = "not_implemented" as const;

export interface FoundationResult {
  status: typeof FOUNDATION_STATUS;
  detail: "workflow foundation only";
}

export async function foundationWorkflow(): Promise<FoundationResult> {
  "use workflow";
  return foundationStep();
}

async function foundationStep(): Promise<FoundationResult> {
  "use step";
  return {
    status: FOUNDATION_STATUS,
    detail: "workflow foundation only",
  };
}
