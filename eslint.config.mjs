import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  // Private images are served by an authorized route; next/image's optimizer can't forward the user's session.
  { rules: { "@next/next/no-img-element": "off" } },
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".data/**", "scripts/e2e.mjs"] },
];
export default config;
