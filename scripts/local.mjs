import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
export function localEnv() {
 const env={...process.env};
 const socket='/private/tmp/flek-lima-state/flek/sock/docker.sock';
 if (!env.DOCKER_HOST && existsSync(socket)) env.DOCKER_HOST=`unix://${socket}`;
 if (existsSync('/private/tmp/flek-runtime/docker/docker')) env.PATH=`/private/tmp/flek-runtime/docker:${env.PATH}`;
 return env;
}
export function status() {
 const p=spawnSync(resolve('node_modules/.bin/supabase'),['status','-o','json'],{env:localEnv(),encoding:'utf8'});
 if(p.status!==0) throw new Error('Local Supabase is not running. Run npm run db:start.');
 return JSON.parse(p.stdout);
}
export function writeEnv() {
 const s=status();
 writeFileSync('.env.local',`VITE_SUPABASE_URL=${s.API_URL}\nVITE_SUPABASE_ANON_KEY=${s.ANON_KEY}\n`);
 console.log('Public local Supabase configuration written to .env.local.');
 return s;
}
if(process.argv[1]===resolve('scripts/local.mjs')){
 const action=process.argv[2];
 const args=action==='start'?['start','-x','realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor']:action==='reset'?['db','reset','--local']:action==='types'?['gen','types','typescript','--local','--schema','public']:null;
 if(!args) throw Error('Expected start, reset or types');
 const p=spawnSync(resolve('node_modules/.bin/supabase'),args,{env:localEnv(),stdio:action==='types'?['ignore','pipe','inherit']:'inherit',encoding:'utf8'});
 if(p.status!==0)process.exit(p.status??1);
 if(action==='types'){writeFileSync('src/types/database.ts',p.stdout);console.log('Database types generated from live Postgres.');}
 else writeEnv();
}
