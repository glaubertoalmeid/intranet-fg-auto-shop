import { NextResponse } from "next/server";
import { requirePermission } from "../../../../../lib/auth";
import { appendTimeline } from "../../../../../lib/leads";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
 try {
  const user = await requirePermission("atendimentos");
  const { id } = await params;
  const body = await req.json() as { text?: string; manualContact?: boolean };
  if (!body.text?.trim()) return NextResponse.json({ error: "Escreva o texto da nota." }, { status: 400 });
  // "Registrar manualmente que o vendedor realizou um contato pelo WhatsApp" é uma nota
  // diferenciada na timeline (kind message_sent, fonte manual) — nunca aciona a API de envio.
  await appendTimeline(id, {
   kind: body.manualContact ? "message_sent" : "note",
   body: body.text.trim(),
   isAutomated: false,
   source: "manual",
   createdBy: user.name,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível registrar a nota." }, { status: 500 });
 }
}
