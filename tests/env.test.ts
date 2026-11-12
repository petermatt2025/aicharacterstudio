import { describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/server/env";

describe("env", () => {
  it("strips whitespace, line breaks and zero-width characters pasted into secrets", () => {
    const before = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "​ sk-test-abc123 \r\n";
    resetEnvCache();
    try {
      expect(env().OPENAI_API_KEY).toBe("sk-test-abc123");
    } finally {
      if (before === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = before;
      resetEnvCache();
    }
  });
});
