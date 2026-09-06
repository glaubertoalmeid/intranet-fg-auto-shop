// purchase_orders / purchase_order_items vivem no Supabase (Etapa 3 — Compras), ver lib/supabase.ts.

export const PURCHASE_STATUSES=["elaboracao","enviado","confirmado","em_transporte","recebido_parcial","recebido_completo","cancelado"] as const;
export type PurchaseStatus=typeof PURCHASE_STATUSES[number];

/** Regra do documento (seção 7): estoque atual, venda média diária, prazo de entrega do
 *  fornecedor e estoque de segurança (o próprio mínimo cadastrado) definem a quantidade sugerida.
 *  suggested = ceil(avgDaily × leadTimeDays) + minStock − estoqueAtual, nunca negativo. */
export function suggestPurchaseQuantity(input:{stockPhysical:number;avgDailySales:number;leadTimeDays:number;minStock:number}){
 const coverageNeeded=input.avgDailySales*Math.max(0,input.leadTimeDays);
 const target=coverageNeeded+input.minStock;
 return Math.max(0,Math.ceil(target-input.stockPhysical));
}
