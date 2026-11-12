import { describe, expect, it } from "vitest";
import { buildDirection, groupsForTool, surprise, TOOL_IDEAS } from "@/lib/prompt-builder";
import { TOOLS } from "@/lib/tools";

describe("prompt builder", () => {
  it("has ideas and option groups for every implemented tool", () => {
    for (const key of Object.keys(TOOLS)) {
      expect(TOOL_IDEAS[key]?.length, key).toBeGreaterThan(0);
      expect(groupsForTool(key).length, key).toBeGreaterThan(0);
    }
  });

  it("writes a prompt from an idea and chosen options, and nothing from nothing", () => {
    expect(buildDirection("environment_switch", "", {})).toBe("");
    const p = buildDirection("environment_switch", "working in a café", { style: "cinematic", lighting: "golden", mood: "happy" });
    expect(p).toMatch(/^working in a café\./);
    expect(p).toContain("Style: cinematic film still");
    expect(p).toContain("Lighting: warm golden-hour");
    expect(p).toContain("no random text");
  });

  it("text tools keep quoted text and ask for exact spelling; options outside the tool are ignored", () => {
    const p = buildDirection("thumbnails", 'video about AI, headline "5 AI TOOLS"', { style: "bold", wardrobe: "casual" });
    expect(p).toContain('"5 AI TOOLS"');
    expect(p).toContain("spelled exactly");
    expect(p).not.toContain("Outfit:"); // wardrobe isn't offered on thumbnails
  });

  it("surprise me picks a valid idea and an option for every group", () => {
    let i = 0;
    const r = surprise("headshots", () => ((i++ * 0.37) % 1));
    expect(TOOL_IDEAS.headshots!.map((x) => x.text)).toContain(r.idea);
    for (const g of groupsForTool("headshots")) expect(g.options.map((o) => o.key)).toContain(r.choices[g.key]);
    expect(buildDirection("headshots", r.idea, r.choices).length).toBeGreaterThan(50);
  });
});
