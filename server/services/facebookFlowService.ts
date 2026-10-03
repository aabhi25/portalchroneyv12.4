import { facebookFlows, facebookFlowSteps, facebookFlowSessions } from "@shared/schema";
import { SocialFlowService, type SocialFlowConfig } from "./social/flowEngine";

/** Facebook Messenger conversation flows (engine: social/flowEngine.ts). */
export class FacebookFlowService extends SocialFlowService {
  constructor() {
    super({
      tag: "[Facebook Flow]",
      conversationDescription: "a Facebook Messenger conversation flow",
      platform: "facebook",
      // Same columns as the Instagram flow tables the engine is typed with.
      tables: {
        flows: facebookFlows,
        steps: facebookFlowSteps,
        sessions: facebookFlowSessions,
      } as unknown as SocialFlowConfig["tables"],
    });
  }
}

export const facebookFlowService = new FacebookFlowService();
