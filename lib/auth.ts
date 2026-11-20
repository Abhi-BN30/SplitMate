import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { sql } from './db';
const COOKIE = 'splitmate_session';
const secretValue = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === 'production' && (!secretValue || secretValue.length < 32)) {
 throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}
const secret = new TextEncoder().encode(secretValue || 'development-only-change-this-secret-please');
export async function hashPin(pin:string){ return bcrypt.hash(pin, 12); }
export async function verifyPin(pin:string, hash:string){ return bcrypt.compare(pin, hash); }
export async function createSession(userId:string){
 const token = randomBytes(32).toString('hex');
 const tokenHash = createHash('sha256').update(token).digest('hex');
 const expires = new Date(Date.now()+30*24*60*60*1000);
 await sql`INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(${userId},${tokenHash},${expires})`;
 const jwt = await new SignJWT({ sub:userId, tokenHash }).setProtectedHeader({alg:'HS256'}).setExpirationTime('30d').sign(secret);
 const jar = await cookies(); jar.set(COOKIE,jwt,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',expires});
}
export async function currentUser(){
 const jar=await cookies(); const token=jar.get(COOKIE)?.value; if(!token) return null;
 let userId='',tokenHash='';
 try {
  const {payload}=await jwtVerify(token,secret);
  userId=String(payload.sub||''); tokenHash=String(payload.tokenHash||'');
 } catch {
  return null;
 }
 if(!userId||!tokenHash) return null;
 const rows=await sql`SELECT u.id,u.full_name,u.email,u.phone,u.avatar_url FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=${userId} AND s.token_hash=${tokenHash} AND s.expires_at>now() LIMIT 1`;
 return rows[0]||null;
}
export async function destroySession(){
 const jar=await cookies(); const token=jar.get(COOKIE)?.value;
 if(token){let tokenHash='';try{const {payload}=await jwtVerify(token,secret);tokenHash=String(payload.tokenHash||'')}catch{}if(tokenHash)await sql`DELETE FROM sessions WHERE token_hash=${tokenHash}`}
 jar.delete(COOKIE);
}
export function validPin(pin:string){return /^\d{4}$/.test(pin)}
