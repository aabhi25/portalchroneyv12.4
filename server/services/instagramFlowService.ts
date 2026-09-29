import { instagramFlows, instagramFlowSteps, instagramFlowSessions } from "@shared/schema";
import { SocialFlowService } from "./social/flowEngine";

/** Instagram DM conversation flows (engine: social/flowEngine.ts). */
export class InstagramFlowService extends SocialFlowService {
  constructor() {
    super({
      tag: "[Instagram Flow]",
      conversationDescription: "an Instagram conversation flow",
      tables: { flows: instagramFlows, steps: instagramFlowSteps, sessions: instagramFlowSessions },
    });
  }
}

export const instagramFlowService = new InstagramFlowService();
