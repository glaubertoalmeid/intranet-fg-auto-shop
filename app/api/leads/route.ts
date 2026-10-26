import { NextResponse } from "next/server";
import { requirePermission } from "../../../lib/auth";
import { listLeads, createLead, type AttendanceStatus, type CommercialStage } from "../../../lib/leads";
import { logAudit } from "../../../lib/audit";

export async function GET(req: Request) {
 try {
  await requirePermission("atendimentos");
  const url = new URL(req.url);
  const p = url.searchParams;
  const assignedParam = p.get("assignedUserId");
  const leads = await listLeads({
   assignedUserId: assignedParam === "none" ? "none" : assignedParam ? Number(assignedParam) : undefined,
   status: (p.get("status") as AttendanceStatus) || undefined,
   stage: (p.get("stage") as CommercialStage) || undefined,
   origin: p.get("origin") || undefined,
   nextActionFilter: (p.get("nextAction") as "vencidos" | "hoje" | "proximos7") || undefined,
   query: p.get("q") || undefined,
   from: p.get("from") || undefined,
   to: p.get("to") || undefined,
   includeDemo: p.get("demo") === "all" || p.get("demo") === "only",
   onlyDemo: p.get("demo") === "only",
  });
  return NextResponse.json(leads);
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar os atendimentos." }, { status: 500 });
 }
}

export async function POST(req: Request) {
 try {
  const user = await requirePermission("atendimentos");
  const body = await req.json() as { name?: string; phone?: string; origin?: string; interest?: string; assignedUserId?: number | null };
  if (!body.name?.trim()) return NextResponse.json({ error: "Informe o nome do lead." }, { status: 400 });
  if (!body.phone?.trim()) return NextResponse.json({ error: "Informe o telefone do lead." }, { status: 400 });
  const id = await createLead({ name: body.name, phone: body.phone, origin: body.origin, interest: body.interest, assignedUserId: body.assignedUserId ?? null }, user.name);
  await logAudit({ user: user.name, action: "lead.create", target: body.name, detail: body.phone });
  return NextResponse.json({ ok: true, id }, { status: 201 });
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível cadastrar o lead." }, { status: 500 });
 }
}
