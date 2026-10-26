import { NextResponse } from "next/server";
import { requirePermission } from "../../../../../../lib/auth";
import { updateFollowup, type FollowupStatus } from "../../../../../../lib/leads";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; followupId: string }> }) {
 try {
  const user = await requirePermission("atendimentos");
  const { followupId } = await params;
  const body = await req.json() as { status?: FollowupStatus; scheduledDate?: string; note?: string };
  await updateFollowup(followupId, body, user.name);
  return NextResponse.json({ ok: true });
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o follow-up." }, { status: 500 });
 }
}
