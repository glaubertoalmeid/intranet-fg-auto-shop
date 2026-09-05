import { NextResponse } from "next/server";
import { requirePermission } from "../../../../lib/auth";

export async function GET(_request:Request,{params}:{params:Promise<{cnpj:string}>}){
  try{
    await requirePermission("cnpj");
    const {cnpj}=await params;
    const clean=cnpj.replace(/\D/g,"");
    if(clean.length!==14)return NextResponse.json({error:"Informe um CNPJ válido com 14 dígitos."},{status:400});
    const response=await fetch(`https://publica.cnpj.ws/cnpj/${clean}`,{headers:{accept:"application/json","user-agent":"FG-Auto-Intranet/1.0"}});
    const text=await response.text();
    let payload:unknown;try{payload=JSON.parse(text)}catch{payload={error:"O serviço de consulta retornou uma resposta inválida."}}
    if(!response.ok){
      const upstream=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
      const message=response.status===404?"CNPJ não encontrado.":response.status===429?"Limite de consultas atingido. Aguarde um minuto e tente novamente.":String(upstream.detalhes||upstream.message||upstream.error||"O serviço de consulta está indisponível.");
      return NextResponse.json({error:message},{status:response.status});
    }
    return NextResponse.json(payload);
  }catch(error){
    if(error instanceof Response)return NextResponse.json({error:await error.text()},{status:error.status});
    return NextResponse.json({error:"Não foi possível concluir a consulta agora."},{status:500});
  }
}
