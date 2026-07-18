import { redirect } from "next/navigation";

import { currentUser, hasOwner } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await hasOwner())) redirect("/setup");
  redirect((await currentUser()) ? "/board" : "/login");
}
