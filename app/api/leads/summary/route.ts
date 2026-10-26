import { NextResponse } from "next/server";
import { requirePermission } from "../../../../lib/auth";
import { getSummary, getIntegrationHealth } from "../../../../lib/leads";

export async function GET(req: Request) {
 try {
  await requirePermission("atendimentos");
  const url = new URL(req.url);
  const p = url.searchParams;
  const summary = await getSummary({ from: p.get("from") || undefined, to: p.get("to") || undefined, includeDemo: p.get("demo") === "all" || p.get("demo") === "only" });
  const health = await getIntegrationHealth();
  return NextResponse.json({ ...summary, health });
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os indicadores." }, { status: 500 });
 }
}
