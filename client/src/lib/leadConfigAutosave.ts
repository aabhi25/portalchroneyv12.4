/**
 * Auto-save bookkeeping for the Smart Lead Training screen, as a pure reducer
 * so it can be unit-tested.
 *
 * Every local edit bumps `version`. A save captures the version it sends; when
 * it succeeds only that version is marked saved. If the admin kept editing
 * while the request was in flight, `version > savedVersion` stays true, so:
 *   - the screen does NOT replace local state with the server copy
 *     (shouldAdoptServerData is false), and
 *   - the next debounce saves the newer edits.
 * This replaces the old "dirty=false on success" flag, which wiped edits made
 * during a save and cancelled their pending save.
 */
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface AutosaveState {
  /** Bumped on every local edit. */
  version: number;
  /** Highest version the server confirmed. */
  savedVersion: number;
  /** Version currently being saved, or null. */
  inFlightVersion: number | null;
  status: AutosaveStatus;
  /** Last save error (cleared by the next edit or a successful save). */
  error: string | null;
}

export type AutosaveEvent =
  | { type: "edit" }
  | { type: "saveStarted"; version: number }
  | { type: "saveSucceeded"; version: number }
  | { type: "saveFailed"; version: number; error: string }
  /** Start over (e.g. the business account changed). */
  | { type: "reset" };

export const initialAutosaveState: AutosaveState = {
  version: 0,
  savedVersion: 0,
  inFlightVersion: null,
  status: "idle",
  error: null,
};

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event.type) {
    case "edit":
      return {
        ...state,
        version: state.version + 1,
        status: state.inFlightVersion !== null ? "saving" : "pending",
        error: null,
      };
    case "saveStarted":
      return { ...state, inFlightVersion: event.version, status: "saving", error: null };
    case "saveSucceeded": {
      const savedVersion = Math.max(state.savedVersion, event.version);
      const stillDirty = state.version > savedVersion;
      return {
        ...state,
        savedVersion,
        inFlightVersion: state.inFlightVersion === event.version ? null : state.inFlightVersion,
        status: stillDirty ? "pending" : "saved",
        error: null,
      };
    }
    case "saveFailed":
      return {
        ...state,
        inFlightVersion: state.inFlightVersion === event.version ? null : state.inFlightVersion,
        status: "error",
        error: event.error,
      };
    case "reset":
      return initialAutosaveState;
    default:
      return state;
  }
}

/** Local edits not yet confirmed by the server. */
export function hasUnsavedChanges(state: AutosaveState): boolean {
  return state.version > state.savedVersion;
}

/** Safe to replace local state with what the server returned. */
export function shouldAdoptServerData(state: AutosaveState): boolean {
  return !hasUnsavedChanges(state) && state.inFlightVersion === null;
}

/**
 * Should the debounce timer fire a save now? Not while one is in flight (the
 * in-flight completion re-triggers), not after a failure until the admin
 * edits again or presses Retry, and never while something blocks saving.
 */
export function shouldScheduleSave(state: AutosaveState, blocked: boolean): boolean {
  return hasUnsavedChanges(state) && state.inFlightVersion === null && state.status !== "error" && !blocked;
}

/** Text for the small status line next to the settings. */
export function autosaveLabel(state: AutosaveState, blockedReason?: string | null): string {
  if (state.inFlightVersion !== null) return "Saving…";
  if (hasUnsavedChanges(state)) {
    if (blockedReason) return `Not saved — ${blockedReason}`;
    if (state.status === "error") return "Not saved — retry";
    return "Saving…";
  }
  if (state.status === "saved") return "Saved";
  return "";
}
