export function getRuntimeDb(): D1Database {
  const db = (globalThis as typeof globalThis & { __FG_DB__?: D1Database }).__FG_DB__;
  if (!db) throw new Error("Banco de dados indisponível neste ambiente.");
  return db;
}
type StoredObject={body:ReadableStream;httpEtag:string;writeHttpMetadata(headers:Headers):void};
type RuntimeBucket={put(key:string,value:ReadableStream,options?:Record<string,unknown>):Promise<unknown>;get(key:string):Promise<StoredObject|null>;delete(key:string):Promise<void>};
export function getRuntimeBucket():RuntimeBucket{const bucket=(globalThis as typeof globalThis&{__FG_BUCKET__?:RuntimeBucket}).__FG_BUCKET__;if(!bucket)throw new Error("Armazenamento de imagens indisponível neste ambiente.");return bucket}
