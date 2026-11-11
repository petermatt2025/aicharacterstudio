import { currentUser } from "@/server/http";
import { listCharacters } from "@/server/assets";
import { Onboarding } from "./onboarding";

export const metadata = { title: "Get started" };

export default async function Page() {
  const user = (await currentUser())!;
  const chars = await listCharacters(user);
  return <Onboarding emailVerified={user.emailVerified} hasCharacter={chars.length > 0} />;
}
