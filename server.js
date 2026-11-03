'use strict';
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const zone = 'Asia/Shanghai';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const code = n => crypto.randomBytes(n).toString('hex').slice(0,n).toUpperCase();
const id = () => crypto.randomUUID();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const goodName = x => typeof x === 'string' ? x.trim().replace(/\s+/g,' ').slice(0,24) : '';
const goodPass = x => typeof x === 'string' && x.length >= 8 && x.length <= 72;
const err = (res,status,msg) => res.status(status).json({error:msg});
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
async function hashPass(p){ const salt=crypto.randomBytes(16).toString('hex'); const h=await scrypt(p,salt,64); return salt+':'+h.toString('hex');}
async function checkPass(p,s){if(typeof s!=='string'||typeof p!=='string')return false;const [salt,h]=s.split(':');if(!salt||!/^[a-f0-9]{128}$/.test(h||''))return false;return crypto.timingSafeEqual(await scrypt(p,salt,64),Buffer.from(h,'hex'));}
const dayBefore = (d,n=1) => new Date(new Date(d+'T12:00:00Z').getTime()-n*86400000).toISOString().slice(0,10);
function streak(days){const ss=new Set(days);let d=today();if(!ss.has(d))d=dayBefore(d);let x=0;while(ss.has(d)&&x<10000){x++;d=dayBefore(d);}return x;}
function getCookie(req){const s=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('together_session='));return s&&s.split('=')[1];}
const cookieOptions={httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:2592000000};
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(express.json({limit:'16kb'}));
app.use((req,res,next)=>{
 res.set('X-Content-Type-Options','nosniff');res.set('X-Frame-Options','DENY');res.set('Referrer-Policy','same-origin');
 if(req.path.startsWith('/api/'))res.set('Cache-Control','no-store');
 if(['POST','PUT','PATCH','DELETE'].includes(req.method)){
 const o=req.get('origin');
 if(o){try {if(new URL(o).host!==req.get('host'))return err(res,403,'请求来源无效');}catch{return err(res,403,'请求来源无效');}}
 }
 next();
});
const attempts=new Map();
function limit(req,res,next){const k=req.ip+req.path,n=Date.now();let a=attempts.get(k);if(!a||a.until<n)a={count:0,until:n+900000};a.count++;attempts.set(k,a);if(attempts.size>2000)attempts.clear();if(a.count>30)return err(res,429,'尝试过于频繁，请稍后再试');next();}
async function auth(req,res,next){try {const tok=getCookie(req);if(!tok||!/^[a-f0-9]{64}$/.test(tok))return err(res,401,'请先登录');const r=await pool.query('SELECT m.id,m.room_id,m.display_name,r.room_code,r.invite_code,r.invite_expires_at FROM together_sessions s JOIN together_members m ON m.id=s.member_id JOIN together_rooms r ON r.id=m.room_id WHERE s.token_hash=$1 AND s.expires_at>now()',[sha(tok)]);if(!r.rows.length)return err(res,401,'登录已过期');req.user=r.rows[0];next();}catch(e){next(e);}}
async function giveSession(member,res){const tok=crypto.randomBytes(32).toString('hex');await pool.query("INSERT INTO together_sessions(token_hash,member_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[sha(tok),member]);res.cookie('together_session',tok,cookieOptions);}
const SCHEMA=[
 'CREATE TABLE IF NOT EXISTS together_rooms (id uuid PRIMARY KEY, room_code varchar(16) UNIQUE NOT NULL, invite_code varchar(24) UNIQUE NOT NULL, invite_expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now())',
 'CREATE TABLE IF NOT EXISTS together_members (id uuid PRIMARY KEY,room_id uuid NOT NULL REFERENCES together_rooms(id) ON DELETE CASCADE,display_name varchar(24) NOT NULL,password_hash text NOT NULL,created_at timestamptz DEFAULT now())',
 'CREATE UNIQUE INDEX IF NOT EXISTS together_members_room_name_ci ON together_members(room_id,lower(display_name))',
 'CREATE TABLE IF NOT EXISTS together_sessions (token_hash char(64) PRIMARY KEY,member_id uuid NOT NULL REFERENCES together_members(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL)',
 "CREATE TABLE IF NOT EXISTS together_checkins (member_id uuid NOT NULL REFERENCES together_members(id) ON DELETE CASCADE,day date NOT NULL,move boolean NOT NULL DEFAULT false,meals boolean NOT NULL DEFAULT false,water boolean NOT NULL DEFAULT false,sleep boolean NOT NULL DEFAULT false,private_note varchar(160) NOT NULL DEFAULT '',updated_at timestamptz DEFAULT now(),PRIMARY KEY(member_id,day))",
 'CREATE TABLE IF NOT EXISTS together_messages (id uuid PRIMARY KEY,room_id uuid NOT NULL REFERENCES together_rooms(id) ON DELETE CASCADE,member_id uuid NOT NULL REFERENCES together_members(id) ON DELETE CASCADE,body varchar(180) NOT NULL,created_at timestamptz DEFAULT now())'
];
app.get('/health',wrap(async(req,res)=>{await pool.query('SELECT 1');res.json({ok:true});}));
app.post('/api/rooms',limit,wrap(async(req,res)=>{
 const name=goodName(req.body?.name),pass=req.body?.password;
 if(!name||!goodPass(pass))return err(res,400,'昵称不能为空，密码至少8位');
 const roomId=id(),memberId=id(),roomCode=code(10),inviteCode=code(16),hashed=await hashPass(pass);
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query("INSERT INTO together_rooms(id,room_code,invite_code,invite_expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[roomId,roomCode,inviteCode]);await client.query('INSERT INTO together_members(id,room_id,display_name,password_hash) VALUES($1,$2,$3,$4)',[memberId,roomId,name,hashed]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 await giveSession(memberId,res);res.status(201).json({ok:true});
}));
app.post('/api/join',limit,wrap(async(req,res)=>{
 const invite=String(req.body?.invite||'').trim().toUpperCase(),name=goodName(req.body?.name),pass=req.body?.password;
 if(!/^[A-F0-9]{16}$/.test(invite)||!name||!goodPass(pass))return err(res,400,'邀请码、昵称或密码不正确');
 const memberId=id(),hashed=await hashPass(pass),client=await pool.connect();
 try{await client.query('BEGIN');const q=await client.query('SELECT * FROM together_rooms WHERE invite_code=$1 FOR UPDATE',[invite]);if(!q.rows.length){await client.query('ROLLBACK');return err(res,404,'邀请不存在');}const room=q.rows[0];if(new Date(room.invite_expires_at)<new Date()){await client.query('ROLLBACK');return err(res,410,'邀请已过期');}const n=await client.query('SELECT count(*)::int AS n FROM together_members WHERE room_id=$1',[room.id]);if(n.rows[0].n>=2){await client.query('ROLLBACK');return err(res,409,'空间已经满员');}const used=await client.query('SELECT 1 FROM together_members WHERE room_id=$1 AND lower(display_name)=lower($2)',[room.id,name]);if(used.rows.length){await client.query('ROLLBACK');return err(res,409,'请使用不同昵称');}await client.query('INSERT INTO together_members(id,room_id,display_name,password_hash) VALUES($1,$2,$3,$4)',[memberId,room.id,name,hashed]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 await giveSession(memberId,res);res.status(201).json({ok:true});
}));
app.post('/api/login',limit,wrap(async(req,res)=>{
 const roomCode=String(req.body?.roomCode||'').trim().toUpperCase(),name=goodName(req.body?.name),password=req.body?.password;
 const q=await pool.query('SELECT m.id,m.password_hash FROM together_members m JOIN together_rooms r ON r.id=m.room_id WHERE r.room_code=$1 AND lower(m.display_name)=lower($2)',[roomCode,name]);
 if(!q.rows.length||!(await checkPass(password,q.rows[0].password_hash)))return err(res,401,'空间编号、昵称或密码不正确');
 await giveSession(q.rows[0].id,res);res.json({ok:true});
}));
app.post('/api/logout',auth,wrap(async(req,res)=>{await pool.query('DELETE FROM together_sessions WHERE token_hash=$1',[sha(getCookie(req))]);res.clearCookie('together_session',{...cookieOptions,maxAge:undefined});res.json({ok:true});}));
app.post('/api/invite/refresh',auth,wrap(async(req,res)=>{
 const client=await pool.connect();
 try{await client.query('BEGIN');await client.query('SELECT id FROM together_rooms WHERE id=$1 FOR UPDATE',[req.user.room_id]);const c=await client.query('SELECT count(*)::int AS n FROM together_members WHERE room_id=$1',[req.user.room_id]);if(c.rows[0].n>=2){await client.query('ROLLBACK');return err(res,409,'空间已经满员');}await client.query("UPDATE together_rooms SET invite_code=$1,invite_expires_at=now()+interval '7 days' WHERE id=$2",[code(16),req.user.room_id]);await client.query('COMMIT');res.json({ok:true});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/board',auth,wrap(async(req,res)=>{
 const t=today(),month=typeof req.query.month==='string'?req.query.month:t.slice(0,7);
 if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))return err(res,400,'月份无效');
 const [p,c,m]=await Promise.all([
 pool.query('SELECT id,display_name FROM together_members WHERE room_id=$1 ORDER BY created_at,id',[req.user.room_id]),
 pool.query("SELECT c.member_id,to_char(c.day,'YYYY-MM-DD') AS day,c.move,c.meals,c.water,c.sleep,c.private_note FROM together_checkins c JOIN together_members m ON m.id=c.member_id WHERE m.room_id=$1 AND c.day<=$2::date ORDER BY c.day DESC LIMIT 6000",[req.user.room_id,t]),
 pool.query('SELECT x.id,x.member_id,m.display_name,x.body,x.created_at FROM together_messages x JOIN together_members m ON m.id=x.member_id WHERE x.room_id=$1 ORDER BY x.created_at DESC LIMIT 25',[req.user.room_id])
 ]);
 const self=p.rows.find(x=>x.id===req.user.id),partner=p.rows.find(x=>x.id!==req.user.id)||null;
 const mine=[],theirs=[],calendar={};let todaySelf=null;
 for(const a of c.rows){if(a.member_id===self.id)mine.push(a.day);else if(partner&&a.member_id===partner.id)theirs.push(a.day);
 if(a.day.startsWith(month)){if(!calendar[a.day])calendar[a.day]={};calendar[a.day][a.member_id]={move:a.move,meals:a.meals,water:a.water,sleep:a.sleep};}
 if(a.day===t&&a.member_id===self.id)todaySelf={move:a.move,meals:a.meals,water:a.water,sleep:a.sleep,note:a.private_note};}
 const yours=new Set(theirs);
 res.json({today:t,month,roomCode:req.user.room_code,inviteCode:!partner&&new Date(req.user.invite_expires_at)>new Date()?req.user.invite_code:null,inviteExpired:!partner&&new Date(req.user.invite_expires_at)<=new Date(),self,partner,todaySelf,stats:{self:{streak:streak(mine),total:mine.length,doneToday:mine.includes(t)},partner:partner?{streak:streak(theirs),total:theirs.length,doneToday:theirs.includes(t)}:null,togetherDays:mine.filter(d=>yours.has(d)).length},calendar,messages:m.rows.reverse().map(x=>({id:x.id,memberId:x.member_id,name:x.display_name,body:x.body,time:x.created_at}))});
}));
app.put('/api/checkin',auth,wrap(async(req,res)=>{
 const b=req.body||{},note=typeof b.note==='string'?b.note.trim():'';
 if(note.length>160)return err(res,400,'备注不超过160字');
 for(const k of ['move','meals','water','sleep'])if(typeof b[k]!=='boolean')return err(res,400,'打卡内容无效');
 await pool.query('INSERT INTO together_checkins(member_id,day,move,meals,water,sleep,private_note) VALUES($1,$2::date,$3,$4,$5,$6,$7) ON CONFLICT(member_id,day) DO UPDATE SET move=excluded.move,meals=excluded.meals,water=excluded.water,sleep=excluded.sleep,private_note=excluded.private_note,updated_at=now()',[req.user.id,today(),b.move,b.meals,b.water,b.sleep,note]);res.json({ok:true});
}));
app.delete('/api/checkin',auth,wrap(async(req,res)=>{await pool.query('DELETE FROM together_checkins WHERE member_id=$1 AND day=$2::date',[req.user.id,today()]);res.json({ok:true});}));
app.post('/api/messages',auth,wrap(async(req,res)=>{
 const body=typeof req.body?.body==='string'?req.body.body.trim():'';
 if(!body||body.length>180)return err(res,400,'留言应为1至180字');
 const c=await pool.query("SELECT count(*)::int AS n FROM together_messages WHERE member_id=$1 AND created_at>now()-interval '1 hour'",[req.user.id]);if(c.rows[0].n>=12)return err(res,429,'留言太频繁，请稍后再试');
 await pool.query('INSERT INTO together_messages(id,room_id,member_id,body) VALUES($1,$2,$3,$4)',[id(),req.user.room_id,req.user.id,body]);res.status(201).json({ok:true});
}));
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.use((req,res)=>req.path.startsWith('/api/')?err(res,404,'接口不存在'):res.status(404).send('Not Found'));
app.use((e,req,res,next)=>{console.error('Request error:',e);if(e.code==='23505')return err(res,409,'数据已存在');err(res,500,'服务器暂时不可用');});
async function start(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required');for(const q of SCHEMA)await pool.query(q);const port=Number(process.env.PORT||3000);app.listen(port,'0.0.0.0',()=>console.log('Together listening on '+port));}
start().catch(e=>{console.error('Startup error:',e);process.exit(1);});
