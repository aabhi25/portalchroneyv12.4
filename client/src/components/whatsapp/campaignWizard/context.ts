import type { AudiencePreview, CampaignFormValues, SampleContact, WizardGroup, WizardTemplate } from "./types";

export interface WorkbookSummary {
  id: string;
  name: string;
  status: string;
  latestVersion?: { versionNumber: number } | null;
}

export interface WorkbookSheet {
  id: string;
  name: string;
  columns: { key: string; label: string }[];
  rows?: { values: Record<string, string | number | boolean | null> }[];
}

/** Everything a wizard step needs. Steps never fetch the shared lists themselves. */
export interface WizardCtx {
  v: CampaignFormValues;
  set: (patch: Partial<CampaignFormValues>) => void;
  isAutomation: boolean;
  templates: WizardTemplate[];
  approvedTemplates: WizardTemplate[];
  groups: WizardGroup[];
  /** One-time campaigns: who will get it (from the selected audiences). */
  preview: AudiencePreview | undefined;
  previewLoading: boolean;
  /** Contact used for sample values in previews. */
  sample: SampleContact | null;
  /** Contact details that can fill a template blank. */
  fields: string[];
  scheduleMode: boolean;
  setScheduleMode: (on: boolean) => void;
  // Automation blueprint source
  workbooks: WorkbookSummary[];
  workbookName: string | null;
  workbookSheet: WorkbookSheet | undefined;
}
