import {NextResponse} from "next/server";
import {currentUser} from "../../../lib/auth";
import {getRuntimeDb} from "../../../db/runtime";
import {getSupabase} from "../../../lib/supabase";

const LIMIT=6;

/** Busca global (Ctrl+K) — cada seção só entra no resultado se o usuário tiver a
 *  permissão correspondente, e tarefas seguem a mesma regra de visibilidade da tela de
 *  Tarefas (Master vê tudo, os outros só o que foi atribuído a eles). */
export async function GET(request:Request){
 try{
  const user=await currentUser();
  if(!user)return NextResponse.json({error:"Não autenticado."},{status:401});
  const q=(new URL(request.url).searchParams.get("q")||"").trim();
  if(q.length<2)return NextResponse.json({products:[],tasks:[]});
  const can=(permission:string)=>user.role==="master"||user.permissions.includes(permission);

  const supabase=getSupabase();

  const [products,taskRows]=await Promise.all([
   can("produtos")
    ?supabase.from("products").select("id,sku,name,brand,stock_physical").or(`name.ilike.%${q}%,sku.ilike.%${q}%,gtin.ilike.%${q}%`).limit(LIMIT)
    :Promise.resolve({data:[]}),
   can("tarefas")
    ?(async()=>{
      const db=getRuntimeDb();
      const like=`%${q}%`;
      const statement=user.role==="master"
       ?db.prepare("SELECT id,title,priority,completed FROM tasks WHERE title LIKE ? ORDER BY completed ASC,id DESC LIMIT ?").bind(like,LIMIT)
       :db.prepare("SELECT id,title,priority,completed FROM tasks WHERE title LIKE ? AND assigned_user_id=? ORDER BY completed ASC,id DESC LIMIT ?").bind(like,user.id,LIMIT);
      return (await statement.all<{id:number;title:string;priority:string;completed:number}>().catch(()=>({results:[]}))).results;
    })()
    :Promise.resolve([]),
  ]);

  return NextResponse.json({
   products:products.data||[],
   tasks:taskRows||[],
  });
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível buscar."},{status:500})}
}
