import {NextResponse} from "next/server";
import {requirePermission} from "../../../../lib/auth";
import {blingApi} from "../../../../lib/bling";
import {logAudit} from "../../../../lib/audit";

const text=(v:unknown)=>String(v??"").trim();

/** Cria um depósito no Bling — master-only por escrever no ERP real. */
export async function POST(request:Request){
 try{
  const user=await requirePermission("produtos");
  if(user.role!=="master")return NextResponse.json({error:"Só o usuário Master pode cadastrar depósito no Bling."},{status:403});

  const body=await request.json().catch(()=>({})) as {descricao?:string};
  const descricao=text(body.descricao);
  if(!descricao)return NextResponse.json({error:"Informe o nome do depósito."},{status:400});

  const result=await blingApi("/depositos",{method:"POST",body:JSON.stringify({
   descricao,situacao:"A",padrao:false,desconsiderarSaldo:false,
  })});

  await logAudit({user:user.name,action:"admin.create_bling_deposito",target:descricao});
  return NextResponse.json({ok:true,id:(result.data as {id?:number}|undefined)?.id});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Não foi possível criar o depósito no Bling."},{status:500})}
}
