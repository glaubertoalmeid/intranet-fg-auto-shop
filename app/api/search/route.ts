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
  if(q.length<2)return NextResponse.json({products:[],suppliers:[],purchaseOrders:[],tasks:[]});
  const can=(permission:string)=>user.role==="master"||user.permissions.includes(permission);

  const supabase=getSupabase();
  const numericId=/^\d+$/.test(q)?Number(q):null;

  const [products,suppliers,purchaseOrders,taskRows]=await Promise.all([
   can("produtos")
    ?supabase.from("products").select("id,sku,name,brand,stock_physical").or(`name.ilike.%${q}%,sku.ilike.%${q}%,gtin.ilike.%${q}%`).limit(LIMIT)
    :Promise.resolve({data:[]}),
   can("compras")
    ?supabase.from("suppliers").select("id,name,contact").ilike("name",`%${q}%`).limit(LIMIT)
    :Promise.resolve({data:[]}),
   can("compras")
    ?(async()=>{
      const bySupplier=await supabase.from("suppliers").select("id").ilike("name",`%${q}%`);
      const supplierIds=(bySupplier.data||[]).map(s=>s.id);
      let query=supabase.from("purchase_orders").select("id,status,supplier_id").limit(LIMIT);
      query=numericId!=null&&supplierIds.length
       ?query.or(`id.eq.${numericId},supplier_id.in.(${supplierIds.join(",")})`)
       :numericId!=null?query.eq("id",numericId)
       :supplierIds.length?query.in("supplier_id",supplierIds)
       :query.eq("id",-1);
      return query;
    })()
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

  // purchase_orders acima não carrega o nome do fornecedor (evita mais uma query) — a
  // lista de fornecedores já buscada cobre a exibição na maioria dos casos de uso real.
  const supplierNameById=new Map((suppliers.data||[]).map((s:{id:number;name:string})=>[s.id,s.name]));
  const orders=(purchaseOrders.data||[]).map((o:{id:number;status:string;supplier_id:number})=>({...o,supplier_name:supplierNameById.get(o.supplier_id)||""}));

  return NextResponse.json({
   products:products.data||[],
   suppliers:suppliers.data||[],
   purchaseOrders:orders,
   tasks:taskRows||[],
  });
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível buscar."},{status:500})}
}
