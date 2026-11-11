import { runMigrations } from "../src/server/migrate";
import { closePool } from "../src/server/db";

runMigrations()
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "No pending migrations");
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
