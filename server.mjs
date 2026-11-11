#!/usr/bin/env node
// dsh-plugin-role-auditor — auditoría de permisos y webhooks de Discord (solo lectura).
// Tools: status, audit, webhooks.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'role-auditor', 'config.json');
const API_BASE = (process.env.DSH_ROLES_API_BASE || 'https://discord.com/api/v10').replace(/\/+$/, '');
const log = (m) => process.stderr.write(`[roles] ${m}\n`);

const PERMS = [
  ['Administrator', 8n, 'control total del servidor'],
  ['ManageGuild', 32n, 'cambiar configuración del servidor'],
  ['ManageRoles', 268435456n, 'crear/editar roles por debajo del suyo'],
  ['ManageChannels', 16n, 'crear/editar canales'],
  ['ManageWebhooks', 536870912n, 'crear/editar webhooks'],
  ['ManageMessages', 8192n, 'borrar mensajes de otros'],
  ['KickMembers', 2n, 'expulsar miembros'],
  ['BanMembers', 4n, 'banear miembros'],
  ['MentionEveryone', 131072n, 'mencionar @everyone'],
];

function loadConfig() {
  const defaults = { token: '', guildId: '' };
  try { if (existsSync(CONFIG_FILE)) return { ...defaults, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch (e) { log(`config: ${e.message}`); }
  return defaults;
}
const tokenOf = (config) => (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN.trim()) || String(config.token || '').trim();
function requireToken(config) { if (!tokenOf(config)) throw new Error(`falta el token del bot: DISCORD_BOT_TOKEN o "token" en ${CONFIG_FILE}`); }

async function discord(config, pathname) {
  requireToken(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, { headers: { authorization: `Bot ${tokenOf(config)}`, 'user-agent': 'dsh-plugin-role-auditor/0.1' }, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Discord ${response.status}${data?.message ? `: ${data.message}` : ''}`);
    return data;
  } catch (error) { throw error.name === 'AbortError' ? new Error('Discord timeout') : error; }
  finally { clearTimeout(timer); }
}

async function guildIdOf(config) {
  if (String(config.guildId || '').trim()) return String(config.guildId).trim();
  const guilds = await discord(config, '/users/@me/guilds');
  if (!Array.isArray(guilds) || guilds.length === 0) throw new Error('el bot no está en ningún servidor');
  return guilds[0].id;
}

function riskOf(role, guildId) {
  let bits = 0n;
  try { bits = BigInt(role.permissions || '0'); } catch { bits = 0n; }
  const found = PERMS.filter(([, bit]) => (bits & bit) === bit).map(([name, , description]) => ({ name, description }));
  const isEveryone = role.id === guildId;
  let score = found.reduce((sum, p) => sum + (p.name === 'Administrator' ? 50 : 10), 0);
  if (isEveryone && found.length > 0) score += 20;
  return { ...role, isEveryone, dangerous: found, score };
}

function textResult(t) { return { content: [{ type: 'text', text: t }] }; }

function buildInstructions() {
  return [
    'Role Auditor: audita permisos y webhooks de Discord para WENDIGO (solo lectura).',
    '',
    'Herramientas: status, audit, webhooks.',
    '',
    'Reglas:',
    '- audit revisa roles y marca permisos peligrosos (Administrator, ManageGuild, ManageRoles, webhooks, bans, etc.).',
    '- webhooks lista webhooks del servidor SIN mostrar sus tokens.',
    '- Nunca modifiques roles, permisos ni webhooks; reporta y sugiere cambios para que un humano los aplique.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-role-auditor', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Token, guild y fuentes de la auditoría.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      return textResult([`Token: ${tokenOf(config) ? 'configurado' : 'NO configurado'}`, `Config: ${CONFIG_FILE}`, `Guild: ${config.guildId || '(primero disponible)'}`].join('\n'));
    },
  );

  server.registerTool(
    'audit',
    { title: 'Auditar roles', description: 'Lista roles con permisos peligrosos y su nivel de riesgo.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      const guildId = await guildIdOf(config);
      const roles = await discord(config, `/guilds/${guildId}/roles`);
      const inspected = (Array.isArray(roles) ? roles : []).map((role) => riskOf(role, guildId));
      const risky = inspected.filter((role) => role.score > 0).sort((a, b) => b.score - a.score);
      const lines = [`Roles totales: ${inspected.length} · con permisos peligrosos: ${risky.length}`, ''];
      if (risky.length === 0) lines.push('No se detectaron permisos peligrosos.');
      for (const role of risky) {
        lines.push(`⚠️ ${role.isEveryone ? '@everyone' : role.name} (id ${role.id}) · riesgo ${role.score}`);
        lines.push(`   ${role.dangerous.map((p) => `${p.name} (${p.description})`).join(' · ')}`);
        if (role.isEveryone) lines.push('   ¡El rol @everyone tiene permisos peligrosos!');
      }
      lines.push('', 'Revisión sugerida: Administrator solo para dueño; ManageRoles/Webhooks en pocos roles; @everyone sin permisos de gestión.');
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'webhooks',
    { title: 'Auditar webhooks', description: 'Lista webhooks del servidor (sin tokens) y marca los que pueden filtrar contenido.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      const guildId = await guildIdOf(config);
      const hooks = await discord(config, `/guilds/${guildId}/webhooks`);
      const list = Array.isArray(hooks) ? hooks : [];
      const lines = [`Webhooks: ${list.length}`, ''];
      if (list.length === 0) lines.push('No hay webhooks.');
      for (const hook of list) lines.push(`#${hook.name || hook.id} · id ${hook.id} · canal ${hook.channel_id || '(desconocido)'} · tipo ${hook.type}`);
      if (list.length > 0) lines.push('', 'Revisión sugerida: elimina webhooks sin uso; los tokens de webhook son credenciales: no los compartas.');
      return textResult(lines.join('\n'));
    },
  );

  return server;
}

try {
  if (!existsSync(CONFIG_FILE)) { mkdirSync(path.dirname(CONFIG_FILE), { recursive: true }); writeFileSync(CONFIG_FILE, JSON.stringify({ token: '', guildId: '' }, null, 2) + '\n', 'utf8'); }
} catch (e) { log(`init: ${e.message}`); }
log(`config: ${CONFIG_FILE}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
