// Generation worker: run with `npm run worker`. Runs separately from the web app (never inside a request).
import os from "node:os";
import { claimJob, processJob, reapExhaustedJobs } from "../server/jobs";
import { sweepAllExpired } from "../server/credits";
import { allocateAnnualCredits, billingConfigured } from "../server/billing";
import { pruneRateLimits } from "../server/rate-limit";
import { closePool } from "../server/db";
import { env } from "../server/env";
import { log } from "../server/audit";

const workerId = `${os.hostname()}:${process.pid}`;
let stopping = false;

async function loop(slot: number) {
  while (!stopping) {
    try {
      const job = await claimJob(`${workerId}:${slot}`);
      if (!job) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      log("info", "job.claimed", { jobId: job.id, feature: job.feature_key, attempt: job.attempts });
      await processJob(job, `${workerId}:${slot}`);
    } catch (e) {
      log("error", "worker.loop_error", { error: (e as Error).message });
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function maintenance() {
  while (!stopping) {
    try {
      await reapExhaustedJobs(`${workerId}:maint`);
      const expired = await sweepAllExpired();
      const annual = billingConfigured() ? await allocateAnnualCredits() : 0;
      await pruneRateLimits();
      if (expired || annual) log("info", "worker.maintenance", { expiredWorkspaces: expired, annualGrants: annual });
    } catch (e) {
      log("error", "worker.maintenance_error", { error: (e as Error).message });
    }
    for (let i = 0; i < 60 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const e = env();
  log("info", "worker.start", { workerId, concurrency: e.WORKER_CONCURRENCY, provider: e.IMAGE_PROVIDER });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log("info", "worker.stopping", { workerId });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await Promise.all([...Array.from({ length: e.WORKER_CONCURRENCY }, (_, i) => loop(i)), maintenance()]);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
