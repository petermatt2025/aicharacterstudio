import { closePool, q } from "../src/server/db";

const email = process.argv[2];
if (!email) {
  console.error("Usage: npm run admin:grant -- user@example.com");
  process.exit(1);
}
q(`UPDATE users SET is_admin=true, beta_allowlisted=true WHERE lower(email)=lower($1) AND status='active' RETURNING id`, [email])
  .then((rows) => console.log(rows.length ? `Granted admin to ${email}` : `No active user ${email}`))
  .finally(() => closePool());
