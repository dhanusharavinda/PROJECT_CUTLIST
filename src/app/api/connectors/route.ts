import { json, route } from "@/lib/api";
import { requireCtx } from "@/lib/tenancy";
import { listConnectors } from "@/lib/connectors";
import { listMediaProviders } from "@/lib/media/provider";

export const dynamic = "force-dynamic";

/** Capability discovery: what can execute an edit here, and where footage can live. */
export const GET = route(async () => {
  await requireCtx();
  return json({ connectors: listConnectors(), media: listMediaProviders() });
});
