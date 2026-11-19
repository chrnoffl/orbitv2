'use strict';
const Cloud=(()=>{
const CFG='orbit-cloud-cfg',SKIP='orbit-cloud-skip',META='orbit-sync-meta',TABLE='student_planner_data';
let sb=null,user=null,cfg=null,dirty=false,lastSync=null,applying=false,timer;
const SQL=`create table if not exists public.student_planner_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.student_planner_data enable row level security;
create or replace function public.orbit_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists orbit_touch on public.student_planner_data;
create trigger orbit_touch before update on public.student_planner_data
for each row execute function public.orbit_touch();
drop policy if exists "Users can read their own planner data" on public.student_planner_data;
drop policy if exists "Users can insert their own planner data" on public.student_planner_data;
drop policy if exists "Users can update their own planner data" on public.student_planner_data;
create policy "Users can read their own planner data" on public.student_planner_data
  for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own planner data" on public.student_planner_data
  for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own planner data" on public.student_planner_data
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);`;
const ls=(k,v)=>{try{return v===undefined?localStorage.getItem(k):v===null?localStorage.removeItem(k):localStorage.setItem(k,v)}catch{}};
const meta=()=>ls(META,JSON.stringify({dirty,lastSync}));
const status=t=>{$('#syncText').textContent=t};
const idle=()=>status(user?(dirty?'Waiting to sync':'Synced'):'Saved on this device');
const urlCheck=u=>/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(u.trim())?'':'The URL should look like https://abcd.supabase.co';
function keyCheck(k){k=k.trim();if(/^sb_secret_/.test(k))return'That is a secret key. Use the publishable (anon) key.';if(/^sb_publishable_/.test(k))return'';const p=k.split('.');if(p.length!==3)return'That does not look like a Supabase key.';try{const r=JSON.parse(atob(p[1].replace(/-/g,'+').replace(/_/g,'/'))).role;if(r==='service_role')return'That is the service_role key. It must never be used in a website. Use the anon key.';if(r!=='anon')return'Use the anon (public) key.'}catch{return'That does not look like a Supabase key.'}return''}
const client=c=>supabase.createClient(c.url.trim().replace(/\/$/,''),c.key.trim(),{auth:{persistSession:true,autoRefreshToken:true}});
const empty=s=>!s.subjects.length&&!s.classes.length&&!s.assignments.length&&!Object.keys(s.attendance).length;
const by=(a,b)=>[...new Map([...b,...a].map(x=>[x.id,x])).values()];
const merge=(w,l)=>({...l,...w,studentName:w.studentName||l.studentName,subjects:by(w.subjects,l.subjects),classes:by(w.classes,l.classes),assignments:by(w.assignments,l.assignments),attendance:{...l.attendance,...w.attendance}});
function apply(s){applying=true;state=s;save();applying=false}
async function push(){if(!sb||!user)return;status('Syncing…');const{data,error}=await sb.from(TABLE).upsert({user_id:user.id,payload:state},{onConflict:'user_id'}).select('updated_at').single();if(error)throw error;lastSync=data.updated_at;dirty=false;meta();status('Synced at '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))}
async function pull(){const{data,error}=await sb.from(TABLE).select('payload,updated_at').eq('user_id',user.id).maybeSingle();if(error)throw error;
 if(!data)return push();
 const cloud=clean(data.payload),first=!lastSync;
 if(first||data.updated_at>lastSync){if(dirty||(first&&!empty(state))){apply(merge(state,cloud));lastSync=data.updated_at;return push()}apply(cloud);lastSync=data.updated_at;dirty=false;meta();idle()}
 else if(dirty)return push();else idle()}
async function run(){try{await push()}catch{status('Offline. Will sync when connected')}}
function changed(){if(applying)return;if(!user){idle();return}dirty=true;meta();status('Saving…');clearTimeout(timer);timer=setTimeout(run,1500)}
async function sync(){if(!user)return;try{await pull()}catch{status('Offline. Saved on this device')}render()}
async function test(c){const e=urlCheck(c.url)||keyCheck(c.key);if(e)return e;
 try{const{error}=await client(c).from(TABLE).select('user_id').limit(1);if(!error)return'';const m=(error.message||'')+' '+(error.code||'');
 if(/PGRST205|42P01|schema cache|does not exist/.test(m))return'Connected, but the table is missing. Run the SQL from step 2, then test again.';
 if(/api key|jwt/i.test(m))return'Supabase rejected that key. Copy the anon key again.';return'Connection failed: '+error.message}catch{return'Could not reach that project. Check the URL and your internet.'}}
const open=(prefill)=>{$('#sqlText').textContent=SQL;$('#siteUrl').textContent=location.origin+location.pathname;$('#wUrl').value=prefill?.url||'';$('#wKey').value=prefill?.key||'';$('#wCode').value='';$('#wErr').textContent='';$('#wizard').showModal()};
function render(){const c=$('#cloudCard');if(!c)return;let h='<div class="head"><h2>Cloud sync</h2></div><div class="cloudrow">';
 if(!cfg)h+='<p class="muted">Sync your data across all your devices with your own free Supabase project.</p><div class="actions"><button class="btn primary" data-act="w-open">Set up cloud sync</button></div>';
 else{h+=`<p class="muted">Project: ${esc(cfg.url.replace('https://',''))}</p>`;
  if(!user)h+='<label class="fld">Email<input id="cEmail" type="email" autocomplete="email"></label><label class="fld">Password (8+ characters)<input id="cPass" type="password" autocomplete="current-password" minlength="8"></label><div class="actions"><button class="btn primary" data-act="c-in">Sign in</button><button class="btn" data-act="c-up">Create account</button></div>';
  else h+=`<p>Signed in as <b>${esc(user.email)}</b></p><div class="actions"><button class="btn primary" data-act="c-sync">Sync now</button><button class="btn" data-act="c-code">Copy setup code</button><button class="btn" data-act="c-out">Sign out</button></div>`;
  h+='<div class="actions"><button class="btn" data-act="c-change">Change connection</button></div>'}
 c.innerHTML=h+'</div>'}
async function auth(up){const email=$('#cEmail').value.trim(),password=$('#cPass').value;if(!email||password.length<8)return toast('Enter your email and a password of 8+ characters');
 try{const r=up?await sb.auth.signUp({email,password}):await sb.auth.signInWithPassword({email,password});if(r.error)return toast(r.error.message);
  if(!r.data.session)return toast('Check your email to confirm, then sign in');user=r.data.user;await pull();render();toast('Signed in')}catch{toast('Could not reach Supabase')}}
Object.assign(ACT,{
 'w-open':()=>open(),'w-close':()=>$('#wizard').close(),
 'w-skip':()=>{ls(SKIP,'1');$('#wizard').close()},
 'w-copy':()=>navigator.clipboard?.writeText(SQL).then(()=>toast('SQL copied'),()=>toast('Select the SQL and copy it manually')),
 'w-test':async()=>{const c={url:$('#wUrl').value,key:$('#wKey').value},e=$('#wErr');e.textContent='Testing…';const m=await test(c);e.textContent=m;if(m)return;
  if(sb&&user)await sb.auth.signOut();user=null;cfg={url:c.url.trim().replace(/\/$/,''),key:c.key.trim()};ls(CFG,JSON.stringify(cfg));sb=client(cfg);lastSync=null;$('#wizard').close();toast('Connected. Now sign in or create an account');idle();location.hash==='#settings'?render():location.hash='settings'},
 'c-in':()=>auth(false),'c-up':()=>auth(true),'c-sync':sync,
 'c-code':()=>navigator.clipboard?.writeText(btoa(JSON.stringify(cfg))).then(()=>toast('Setup code copied. Paste it in the wizard on your other device'),()=>toast('Could not copy')),
 'c-change':()=>{if(confirm('Changing the connection signs you out of this project. Your data stays in the cloud. Continue?'))open(cfg)},
 'c-out':async()=>{if(!confirm('Sign out? Your data stays in the cloud, and this device\'s copy will be cleared.'))return;try{if(dirty)await push()}catch{if(!confirm('Some changes could not be synced and will be lost. Sign out anyway?'))return}
  await sb.auth.signOut();user=null;lastSync=null;dirty=false;meta();apply(blank());idle();render();toast('Signed out')}});
document.addEventListener('input',e=>{if(e.target.id!=='wCode')return;try{const c=JSON.parse(atob(e.target.value.trim()));$('#wUrl').value=c.url;$('#wKey').value=c.key;$('#wErr').textContent=''}catch{$('#wErr').textContent=e.target.value?'That setup code is not valid.':''}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});
window.addEventListener('online',()=>{if(dirty)run()});
async function init(){try{cfg=JSON.parse(ls(CFG))}catch{cfg=null}try{const m=JSON.parse(ls(META)||'{}');dirty=!!m.dirty;lastSync=m.lastSync||null}catch{}
 if(!cfg){if(!ls(SKIP))open();idle();render();return}
 try{sb=client(cfg);user=(await sb.auth.getSession()).data.session?.user||null;if(user)await pull();else idle()}catch{status('Offline. Saved on this device')}render()}
init();
return{changed,render}})();
window.Cloud=Cloud;
Cloud.render();
