"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";

type Json = null | boolean | number | string | Json[] | { [key:string]:Json };

const digits=(value:string)=>value.replace(/\D/g,"").slice(0,14);
const maskCnpj=(value:string)=>digits(value).replace(/^(\d{2})(\d)/,"$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/,"$1.$2.$3").replace(/\.(\d{3})(\d)/,".$1/$2").replace(/(\d{4})(\d)/,"$1-$2");
const label=(key:string)=>key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
const filled=(value:Json):number=>value===null||value===""?0:Array.isArray(value)?value.reduce((n,v)=>n+filled(v),0):typeof value==="object"?Object.values(value).reduce((n,v)=>n+filled(v),0):1;
const money=(value:unknown)=>Number(value||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const date=(value:unknown)=>{if(!value)return "Não informado";const raw=String(value);const parsed=/^\d{4}-\d{2}-\d{2}/.test(raw)?new Date(`${raw.slice(0,10)}T12:00:00`):null;return parsed&&!Number.isNaN(parsed.getTime())?parsed.toLocaleDateString("pt-BR"):raw};
const valueText=(key:string,value:Json)=>{
  if(value===null||value==="")return "Não informado";
  if(typeof value==="boolean")return value?"Sim":"Não";
  if(key.toLowerCase().includes("capital_social"))return money(value);
  if(key.toLowerCase().includes("data"))return date(value);
  if(key.toLowerCase().includes("cep"))return String(value).replace(/(\d{5})(\d{3})/,"$1-$2");
  return String(value);
};
const registrationText=(item:Json)=>{
  if(!item||typeof item!=="object"||Array.isArray(item))return String(item||"");
  const stateValue=item.estado;
  const uf=stateValue&&typeof stateValue==="object"&&!Array.isArray(stateValue)?stateValue.sigla:"";
  return `${String(item.inscricao_estadual||"")}${uf?` (${String(uf)})`:""}`;
};

function RecursiveData({value,name="Dados completos"}:{value:Json;name?:string}):ReactNode{
  if(Array.isArray(value))return <section className="cnpj-json-group"><h4>{name} <span>{value.length} item(ns)</span></h4>{value.length?value.map((item,index)=><div className="cnpj-array-item" key={index}><strong>Item {index+1}</strong><RecursiveData value={item} name=""/></div>):<p>Lista vazia</p>}</section>;
  if(value&&typeof value==="object")return <section className="cnpj-json-group">{name&&<h4>{name}</h4>}<div className="cnpj-data-grid">{Object.entries(value).map(([key,item])=><div className={item&&typeof item==="object"?"cnpj-data-wide":"cnpj-data-field"} key={key}>{item&&typeof item==="object"?<RecursiveData value={item} name={label(key)}/>:<><span>{label(key)}</span><strong>{valueText(key,item)}</strong></>}</div>)}</div></section>;
  return <span>{valueText("",value)}</span>;
}

export default function CnpjLookupView(){
  const [cnpj,setCnpj]=useState("");
  const [data,setData]=useState<Record<string,Json>|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [raw,setRaw]=useState(false);
  const establishment=(data?.estabelecimento&&typeof data.estabelecimento==="object"&&!Array.isArray(data.estabelecimento)?data.estabelecimento:{}) as Record<string,Json>;
  const city=(establishment.cidade&&typeof establishment.cidade==="object"&&!Array.isArray(establishment.cidade)?establishment.cidade:{}) as Record<string,Json>;
  const state=(establishment.estado&&typeof establishment.estado==="object"&&!Array.isArray(establishment.estado)?establishment.estado:{}) as Record<string,Json>;
  const activity=(establishment.atividade_principal&&typeof establishment.atividade_principal==="object"&&!Array.isArray(establishment.atividade_principal)?establishment.atividade_principal:{}) as Record<string,Json>;
  const address=useMemo(()=>[establishment.tipo_logradouro,establishment.logradouro,establishment.numero,establishment.complemento,establishment.bairro].filter(Boolean).join(" "),[establishment]);
  async function consult(e:FormEvent){
    e.preventDefault();setError("");setData(null);
    const clean=digits(cnpj);if(clean.length!==14){setError("Informe um CNPJ com 14 dígitos.");return}
    setBusy(true);
    try{
      const response=await fetch(`/api/cnpj/${clean}`);
      const result=await response.json().catch(()=>({error:"A consulta não retornou dados válidos."}));
      if(!response.ok)throw new Error(result.error||"Não foi possível consultar este CNPJ.");
      setData(result);
    }catch(err){setError(err instanceof Error?err.message:"Não foi possível consultar este CNPJ.")}
    finally{setBusy(false)}
  }
  async function copy(){if(data)await navigator.clipboard.writeText(JSON.stringify(data,null,2))}
  const registrations=Array.isArray(establishment.inscricoes_estaduais)?establishment.inscricoes_estaduais:[];
  const phone=[establishment.ddd1,establishment.telefone1].filter(Boolean).join(" ")||[establishment.ddd2,establishment.telefone2].filter(Boolean).join(" ");
  return <div className="cnpj-area">
    <section className="cnpj-search-card">
      <div><p className="eyebrow">CONSULTA EMPRESARIAL</p><h2>Consultar CNPJ</h2><p>Consulte dados cadastrais públicos e confira as informações da empresa em um só lugar.</p></div>
      <form onSubmit={consult}><label>CNPJ<input inputMode="numeric" value={cnpj} onChange={e=>setCnpj(maskCnpj(e.target.value))} placeholder="00.000.000/0000-00" aria-label="CNPJ"/></label><button className="primary" disabled={busy}>{busy?"Consultando…":"Consultar CNPJ"}</button></form>
      {error&&<div className="form-error">{error}</div>}
    </section>
    {data&&<>
      <section className="cnpj-result-head"><div><span className={String(establishment.situacao_cadastral||"").toLowerCase().includes("ativa")?"cnpj-status active":"cnpj-status"}>{String(establishment.situacao_cadastral||"Situação não informada")}</span><h2>{String(data.razao_social||establishment.nome_fantasia||"Empresa consultada")}</h2><p>{String(establishment.nome_fantasia||data.nome_fantasia||"Nome fantasia não informado")}</p></div><div className="cnpj-result-actions"><span>{filled(data)} campos preenchidos</span><button className="secondary" onClick={copy}>Copiar JSON</button><button className="secondary" onClick={()=>setRaw(v=>!v)}>{raw?"Ocultar JSON":"Ver JSON bruto"}</button></div></section>
      <section className="cnpj-summary-grid">
        <article><span>CNPJ</span><strong>{maskCnpj(String(establishment.cnpj||cnpj))}</strong></article>
        <article><span>Capital social</span><strong>{money(data.capital_social)}</strong></article>
        <article><span>Abertura</span><strong>{date(establishment.data_inicio_atividade)}</strong></article>
        <article><span>Cidade / UF</span><strong>{[city.nome,state.sigla].filter(Boolean).join(" / ")||"Não informado"}</strong></article>
        <article className="wide"><span>Endereço</span><strong>{address||"Não informado"}{establishment.cep?` · CEP ${valueText("cep",establishment.cep)}`:""}</strong></article>
        <article className="wide"><span>Atividade principal (CNAE)</span><strong>{[activity.id,activity.descricao].filter(Boolean).join(" — ")||"Não informado"}</strong></article>
        <article><span>Telefone</span><strong>{phone||"Não informado"}</strong></article>
        <article><span>E-mail</span><strong>{String(establishment.email||"Não informado")}</strong></article>
        <article className="wide"><span>Inscrições estaduais</span><strong>{registrations.length?registrations.map(registrationText).join(" · "):"Não informado"}</strong></article>
      </section>
      {raw&&<section className="cnpj-raw"><pre>{JSON.stringify(data,null,2)}</pre></section>}
      <RecursiveData value={data}/>
    </>}
  </div>
}
