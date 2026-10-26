'use client';
import {useEffect,useState} from 'react';
export default function WatidyPilot(){
 const [data,setData]=useState<unknown>(null),[result,setResult]=useState(''),[busy,setBusy]=useState(false);
 async function load(){const r=await fetch('/api/watidy/pilot');setData(await r.json());}
 useEffect(()=>{void load();},[]);
 async function act(action:string,accelerated=false){setBusy(true);try{const r=await fetch('/api/watidy/pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,accelerated})});setResult(JSON.stringify(await r.json()));await load();}catch{setResult('Falha de conexão. Confira o estado antes de tentar novamente.');}finally{setBusy(false);}}
 return <main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'sans-serif'}}><h1>Watidy · piloto FG Auto Shop</h1><p>Somente administrador. O destinatário é fixado no servidor. Nenhum contato do funil é migrado.</p><p>Cadência proposta: 1, 3, 7, 14 e 21 dias. O piloto exige clique para cada envio; não há disparo em segundo plano.</p><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button disabled={busy} onClick={()=>act('enroll')}>Preparar sequência</button><button disabled={busy} onClick={()=>act('enroll',true)}>Preparar teste (2 minutos por etapa)</button><button disabled={busy} onClick={()=>act('tick')}>Processar uma mensagem vencida</button><button disabled={busy} onClick={()=>act('pause')}>Parar e cancelar pendentes</button><button disabled={busy} onClick={()=>load()}>Atualizar eventos</button></div><p role="status">{result}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',background:'#f3f4f6',color:'#111',padding:20}}>{JSON.stringify(data,null,2)}</pre></main>;
}
