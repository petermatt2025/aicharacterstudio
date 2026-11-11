import { route, optionalUser } from "@/server/http";
import { listFeatures, featureAccess } from "@/server/entitlements";

export const GET = route(async (req) => {
  const u = await optionalUser(req);
  const features = await listFeatures();
  return {
    features: await Promise.all(
      features.map(async (f) => ({
        key: f.key, toolNumber: f.tool_number, name: f.name, studio: f.studio, phase: f.phase, releaseState: f.release_state, minTier: f.min_tier, description: f.description,
        access: u ? await featureAccess(u, f) : null,
      })),
    ),
  };
});
