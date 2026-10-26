import { NextResponse } from "next/server";
import { getRuntimeDb } from "../../../../db/runtime";
import { requirePermission } from "../../../../lib/auth";

// Lista de colegas pra atribuição/transferência — qualquer pessoa com acesso a
// Atendimentos vê a equipe (diferente de /api/team, que é master-only pra Tarefas).
export async function GET() {
 try {
  await requirePermission("atendimentos");
  const result = await getRuntimeDb().prepare("SELECT id,name FROM users WHERE active=1 ORDER BY name ASC").all();
  return NextResponse.json(result.results);
 } catch (error) {
  if (error instanceof Response) return error;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível carregar a equipe." }, { status: 500 });
 }
}
