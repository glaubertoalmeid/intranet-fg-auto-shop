import { NextResponse } from "next/server";
import { requirePermission } from "../../../../lib/auth";
import { getLeadDetail, updateLeadClassification, type AttendanceStatus, type CommercialStage, type Priority, type CloseReason } from "../../../../lib/leads";
import { logAudit } from "../../../../lib/audit";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  await requirePermission("atendimentos");
  const { id } = await params;
  const lead = await getLeadDetail(id);
  if (!lead) return NextResponse.json({ error: "Lead não encontrado." }, { status: 404 });
  return NextResponse.json(lead);
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar o lead." }, { status: 500 });
 }
}

type PatchBody = Partial<{
 name: string; origin: string | null; interest: string | null; budgetValue: number | null;
 assignedUserId: number | null; attendanceStatus: AttendanceStatus; commercialStage: CommercialStage;
 priority: Priority | null; priorityReason: string | null; closeReason: CloseReason | null;
}>;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const user = await requirePermission("atendimentos");
  const { id } = await params;
  const body = await req.json() as PatchBody;
  // Transferir pra outra pessoa (diferente de "assumir" um lead sem responsável ou já seu)
  // é restrito ao Master, mesma régua usada em Tarefas.
  if (body.assignedUserId !== undefined) {
   const lead = await getLeadDetail(id);
   const isSelfOrUnassigned = !lead?.assignedUserId || lead.assignedUserId === user.id || body.assignedUserId === user.id || body.assignedUserId === null;
   if (user.role !== "master" && !isSelfOrUnassigned) {
    return NextResponse.json({ error: "Somente o Master pode transferir um atendimento para outra pessoa." }, { status: 403 });
   }
  }
  await updateLeadClassification(id, body, user.name);
  if (body.closeReason) await logAudit({ user: user.name, action: "lead.close", target: id, detail: body.closeReason });
  if (body.assignedUserId !== undefined) await logAudit({ user: user.name, action: "lead.assign", target: id, detail: String(body.assignedUserId ?? "sem responsável") });
  return NextResponse.json({ ok: true });
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar o lead." }, { status: 500 });
 }
}
