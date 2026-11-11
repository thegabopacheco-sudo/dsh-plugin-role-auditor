// Test end-to-end de role-auditor contra mock local de Discord.
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'role-auditor'), { recursive: true });
writeFileSync(path.join(tmpDir, 'dsh-home', 'role-auditor', 'config.json'), JSON.stringify({ token: 'test-token', guildId: 'g1' }, null, 2), 'utf8');

const roles = [
  { id: 'g1', name: '@everyone', permissions: '0', position: 0, managed: false },
  { id: 'r-admin', name: 'Admin', permissions: '8', position: 10, managed: false },
  { id: 'r-webhook', name: 'Integraciones', permissions: '536870912', position: 5, managed: true },
  { id: 'r-mod', name: 'Moderador', permissions: '8192', position: 3, managed: false },
  { id: 'r-safe', name: 'Miembro', permissions: '1024', position: 1, managed: false },
];
const webhooks = [
  { id: 'w1', name: 'Anuncios bot', channel_id: 'c1', type: 1, token: 'SECRETO-NO-MOSTRAR' },
  { id: 'w2', name: 'Logs', channel_id: 'c2', type: 1, token: 'OTRO-SECRETO' },
];

const mock = http.createServer((req, res) => {
  const route = `${req.method} ${new URL(req.url, 'http://127.0.0.1').pathname}`;
  const json = (s, v) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (route === 'GET /api/v10/users/@me/guilds') return json(200, [{ id: 'g1', name: 'WENDIGO' }]);
  if (route === 'GET /api/v10/guilds/g1/roles') return json(200, roles);
  if (route === 'GET /api/v10/guilds/g1/webhooks') return json(200, webhooks);
  json(404, { message: 'mock no soporta ' + route });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${mock.address().port}/api/v10`;

function makeClient(extraEnv = {}) {
  const entry = process.env.ROLES_SERVER ? path.resolve(process.env.ROLES_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), DSH_ROLES_API_BASE: apiBase, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'roles-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const audit = await client.callTool({ name: 'audit', arguments: {} });
console.log('--- audit ---'); console.log(textOf(audit).slice(0, 900));
console.log('menciona Admin:', textOf(audit).includes('Admin'), '| menciona Integraciones:', textOf(audit).includes('Integraciones'), '| detecta ManageRoles?', textOf(audit).includes('ManageRoles'));
const hooks = await client.callTool({ name: 'webhooks', arguments: {} });
console.log('--- webhooks ---'); console.log(textOf(hooks));
console.log('no filtra tokens:', !textOf(hooks).includes('SECRETO'));
await client.close(); try { await transport.close?.(); } catch {}
mock.close();
console.log('OK');
