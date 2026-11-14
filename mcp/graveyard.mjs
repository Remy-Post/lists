// graveyard.mjs — operator tool for /data/graveyard.bin, the 30-day copy of what delete_forever and
// empty_trash erased through the connector (MCP-PLAN §10). Run inside the container:
//   docker exec lists-mcp node graveyard.mjs list           when, audit id, how many records (no text)
//   docker exec lists-mcp node graveyard.mjs export 3 > b.json   entry 3 as a Lists backup file
// Then in the app: Settings → Restore from backup… with that file. Restore re-stamps every field, so the
// records win over their erased versions; they come back in Trash, where they were.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as P from './persist.mjs';
import { decodeKey } from '../src/js/sync.js';

const dir = process.env.LISTS_MCP_DATA || '/data';
const [cmd, which] = process.argv.slice(2);
let key;
try { key = P.localKey(decodeKey(JSON.parse(readFileSync(join(dir, P.FILES.key), 'utf8')).code)); } catch {
  console.error('No connected vault key in ' + dir + ' (the graveyard is wiped on disconnect).');
  process.exit(1);
}
const entries = P.graveRead(join(dir, P.FILES.graveyard), key);
if (cmd === 'list') {
  entries.forEach((e, i) => console.log(`${i}\t${new Date(e.t).toISOString()}\taudit ${e.audit}\t${e.records.length} records`));
} else if (cmd === 'export' && entries[+which]) {
  console.log(JSON.stringify({ app: 'lists', v: 1, records: entries[+which].records }));
} else {
  console.error('usage: node graveyard.mjs list | export <n>');
  process.exit(2);
}
