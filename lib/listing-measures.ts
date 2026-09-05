export type MeasureField="weight"|"width"|"length"|"height";

function decimal(value:unknown){
 const raw=String(value??"").trim().replace(/\s/g,"");
 const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw;
 const parsed=Number(normalized);
 return Number.isFinite(parsed)&&parsed>0?parsed:0;
}

export function listingMeasure(field:MeasureField,value:unknown){
 let result=decimal(value);
 if(field==="weight"&&result>=100)result/=1000;
 if(field!=="weight"&&result>200)result/=10;
 return Math.round(result*100)/100;
}
