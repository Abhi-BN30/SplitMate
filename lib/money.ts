export type ItemInput={name:string;quantity:number;unitPricePaise:number;selectedUserIds:string[]};
export function allocateProportionally(total:number,weights:number[]){
 if(!weights.length)return [] as number[]; const sum=weights.reduce((a,b)=>a+b,0); if(sum<=0)return weights.map(()=>0);
 const exact=weights.map(w=>total*w/sum); const out=exact.map(Math.floor); const left=total-out.reduce((a,b)=>a+b,0);
 const order=exact.map((v,i)=>({i,frac:v-Math.floor(v)})).sort((a,b)=>b.frac-a.frac);
 for(let i=0;i<left;i++)out[order[i%order.length].i]++; return out;
}
export function splitEqually(total:number,userIds:string[]){
 const unique=[...new Set(userIds)]; if(!unique.length)throw new Error('Select at least one member for every item.');
 const base=Math.floor(total/unique.length), remainder=total-base*unique.length;
 return unique.map((userId,index)=>({userId,amountPaise:base+(index<remainder?1:0)}));
}
export function buildItemTotals(items:ItemInput[],taxPaise:number,servicePaise:number,discountPaise:number){
 const bases=items.map(i=>Math.round(i.quantity*i.unitPricePaise));
 const taxes=allocateProportionally(taxPaise,bases),services=allocateProportionally(servicePaise,bases),discounts=allocateProportionally(discountPaise,bases);
 return items.map((item,index)=>({ ...item,baseTotalPaise:bases[index],taxPaise:taxes[index],serviceChargePaise:services[index],discountPaise:discounts[index],totalPaise:bases[index]+taxes[index]+services[index]-discounts[index] }));
}
