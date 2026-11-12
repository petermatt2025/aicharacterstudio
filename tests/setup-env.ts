import os from "node:os";
import path from "node:path";

// Applied before every test file (and before server modules read env()).
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/acs_test",
  IMAGE_PROVIDER: "fake",
  MODERATION_PROVIDER: "baseline",
  EMAIL_TRANSPORT: "console",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: path.join(os.tmpdir(), `acs-test-storage-${process.pid}`),
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  APP_URL: "http://localhost:3000",
  OPENAI_API_KEY: "",
  TRIAL_CREDITS: "15", // tests were written against a 15-credit trial
});
