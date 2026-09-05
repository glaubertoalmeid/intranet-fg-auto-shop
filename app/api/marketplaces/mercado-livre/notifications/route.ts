export async function POST(){
  // O processamento será habilitado junto com a publicação. Por enquanto,
  // confirmamos rapidamente o recebimento para o Mercado Livre não repetir.
  return new Response(null,{status:200});
}

export async function GET(){
  return Response.json({ok:true,service:"Mercado Livre notifications"});
}
