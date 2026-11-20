import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { sql } from './db';
const COOKIE = 'splitmate_session';
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || 'development-only-change-this-secret-please');
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
 try {
  const jar=await cookies(); const token=jar.get(COOKIE)?.value; if(!token) return null;
  const {payload}=await jwtVerify(token,secret); const userId=String(payload.sub||''); const tokenHash=String(payload.tokenHash||'');
  if(!userId||!tokenHash) return null;
  const rows=await sql`SELECT u.id,u.full_name,u.email,u.phone,u.avatar_url FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=${userId} AND s.token_hash=${tokenHash} AND s.expires_at>now() LIMIT 1`;
  return rows[0]||null;
 } catch { return null; }
}
export async function destroySession(){
 const jar=await cookies(); const token=jar.get(COOKIE)?.value;
 if(token){try{const {payload}=await jwtVerify(token,secret);if(payload.tokenHash) await sql`DELETE FROM sessions WHERE token_hash=${String(payload.tokenHash)}`;}catch{}}
 jar.delete(COOKIE);
}
export function validPin(pin:string){return /^\d{4}$/.test(pin)}
