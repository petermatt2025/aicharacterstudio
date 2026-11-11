import { seedCatalog } from "../src/server/seed";
import { closePool } from "../src/server/db";

seedCatalog()
  .then(() => console.log("Catalog seeded (missing rows only)"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
