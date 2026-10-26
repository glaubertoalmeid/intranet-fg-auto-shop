import { NextResponse } from "next/server";
import { requirePermission } from "../../../../../lib/auth";
import { createFollowup } from "../../../../../lib/leads";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const user = await requirePermission("atendimentos");
  const { id } = await params;
  const body = await req.json() as { scheduledDate?: string; suggestedMessage?: string };
  if (!body.scheduledDate) return NextResponse.json({ error: "Informe a data da próxima ação." }, { status: 400 });
  const followupId = await createFollowup(id, { scheduledDate: body.scheduledDate, suggestedMessage: body.suggestedMessage }, user.name);
  return NextResponse.json({ ok: true, id: followupId }, { status: 201 });
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível planejar o follow-up." }, { status: 500 });
 }
}
