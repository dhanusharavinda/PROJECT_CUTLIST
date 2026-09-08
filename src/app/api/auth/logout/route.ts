import { cookies } from "next/headers";
import { json, route } from "@/lib/api";
import { destroySession } from "@/lib/auth";
import { WS_COOKIE_NAME } from "@/lib/tenancy";

export const POST = route(async () => {
  await destroySession();
  (await cookies()).delete(WS_COOKIE_NAME);
  return json({ ok: true });
});
