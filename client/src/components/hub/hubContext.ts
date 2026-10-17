import { createContext, useContext } from "react";

/**
 * True for pages shown inside an area frame (the area name and tab bar above the page, see
 * HubFrame). Pages and old per-area tab bars use it to skip their own title bar, so the
 * frame's is the only one.
 */
export const HubFrameContext = createContext(false);

export function useInHubFrame(): boolean {
  return useContext(HubFrameContext);
}
