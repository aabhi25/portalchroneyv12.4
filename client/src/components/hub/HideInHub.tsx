import type { ReactNode } from "react";
import { useInHubFrame } from "./hubContext";

/** Renders its children only outside an area frame (for a page's own title bar). */
export function HideInHub({ children }: { children: ReactNode }) {
  return useInHubFrame() ? null : <>{children}</>;
}
