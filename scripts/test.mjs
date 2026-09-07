import { spawnSync } from 'node:child_process';
import { status } from './local.mjs';
const s=status();
const p=spawnSync('node_modules/.bin/vitest',['run'],{stdio:'inherit',env:{...process.env,SUPABASE_URL:s.API_URL,SUPABASE_ANON_KEY:s.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:s.SERVICE_ROLE_KEY,DATABASE_URL:s.DB_URL}});
process.exit(p.status??1);
