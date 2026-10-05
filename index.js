const fs = require('node:fs/promises');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionFlagsBits: P, MessageFlags, REST, Routes,
} = require('discord.js');

/* ------------------------------ CONFIG ------------------------------ */

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('DISCORD_TOKEN environment variable is not set.');
  process.exit(1);
}

const PREFIX = ',';
const CFG = {
  staffRole: '1514960152388829194',
  mainLog: '1514654438403342367',
  strikeLog: '1514656091680669857',
  strikeRoles: ['1533484495817146378', '1533484608916816042', '1533484664113594408'],
  jailRole: '1531759014948634714',
  appealCategory: '1556575900261416991',
  appealMessageChannel: '1556576693492383844',
  appealReview: '1556576985881247764',
  appealAccepted: '1556577326790082570',
  appealDenied: '1556577518096744518',
};

const STRIKE_EXPIRY_MS = 5 * 7 * 24 * 60 * 60 * 1000; // 5 weeks
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord limit
const MAX_JAIL_MS = 365 * 24 * 60 * 60 * 1000;
const SNIPE_LIMIT = 150;
const MAX_ANSWER = 900;
const TICK_MS = 10 * 1000;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');

const QUESTIONS = [
  'Why were you jailed?',
  'Why do you believe your punishment should be removed?',
  'Do you understand what you did wrong?',
  'What will you do differently if released?',
  'If the same situation happened again, would you do it again? Explain.',
];

const COLORS = {
  warn: 0xf1c40f, mute: 0xe67e22, ban: 0xc0392b, kick: 0xd35400, jail: 0x8e44ad,
  strike: 0xe74c3c, good: 0x2ecc71, info: 0x3498db, neutral: 0x95a5a6, error: 0xe74c3c,
};

/* ----------------------------- DATABASE ----------------------------- */

class Database {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'moderation.json');
    this.data = null;
    this.chain = Promise.resolve();
    this.pending = null;
  }

  static defaults() {
    return {
      counters: { case: 0, appeal: 0, strike: 0 },
      cases: {}, warnings: [], strikes: [], afk: {}, jails: {}, mutes: {},
      appeals: {}, locks: {}, config: {},
    };
  }

  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    let raw = null;
    for (const f of [this.file, `${this.file}.bak`]) {
      try {
        raw = JSON.parse(await fs.readFile(f, 'utf8'));
        console.log(`[DB] Loaded ${f}`);
        break;
      } catch (e) {
        if (e.code !== 'ENOENT') {
          console.error(`[DB] Could not read ${f}:`, e.message);
          await fs.copyFile(f, `${f}.corrupt-${Date.now()}`).catch(() => {});
        }
      }
    }
    const def = Database.defaults();
    this.data = { ...def, ...(raw || {}) };
    this.data.counters = { ...def.counters, ...(this.data.counters || {}) };
    for (const k of Object.keys(def)) if (this.data[k] === undefined || this.data[k] === null) this.data[k] = def[k];
    if (!raw) await this.save();
  }

  save() {
    if (this.pending) return this.pending;
    const p = this.chain
      .then(async () => { this.pending = null; await this.write(); })
      .catch((err) => console.error('[DB] Save failed:', err));
    this.pending = p;
    this.chain = p;
    return p;
  }

  async write() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data));
    await fs.copyFile(this.file, `${this.file}.bak`).catch(() => {});
    await fs.rename(tmp, this.file);
  }
}

const db = new Database(DATA_DIR);
let D = null; // db.data, assigned on startup

/* ------------------------------ CLIENT ------------------------------ */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
  allowedMentions: { parse: [], repliedUser: false },
});

let MAIN_GUILD = null;
const sessions = new Map(); // appeal questionnaires in progress (userId -> session)
const snipes = new Map(); // channelId -> [entries newest first]
const ignoreDeleted = new Set();
const CANCEL = Symbol('cancel');

/* ------------------------------ HELPERS ----------------------------- */

class UserError extends Error {}

const now = () => Date.now();
const unix = (ms) => Math.floor(ms / 1000);
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const pad = (n) => String(n).padStart(4, '0');
const NO_PING = { parse: [], repliedUser: false };
const userName = (u) => u?.username ?? u?.tag ?? 'Unknown';

function parseDuration(str) {
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec(str || '');
  if (!m) return null;
  const mult = { s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2].toLowerCase()];
  const ms = Number(m[1]) * mult;
  return ms > 0 ? ms : null;
}

function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec && !d && !h) parts.push(`${sec}s`);
  return parts.join(' ') || '0s';
}

function parseUserId(token) {
  if (!token) return null;
  const m = /^<@!?(\d{15,25})>$/.exec(token) || /^(\d{15,25})$/.exec(token);
  return m ? m[1] : null;
}

function splitFirst(str) {
  const m = /^(\S+)\s*([\s\S]*)$/.exec((str || '').trim());
  return m ? [m[1], m[2].trim()] : ['', ''];
}

const isStaff = (member) => !!member && member.roles.cache.has(CFG.staffRole);

async function getChannel(id) {
  try { return await client.channels.fetch(id); } catch { return null; }
}

async function sendLog(channelId, payload) {
  try {
    const ch = await getChannel(channelId);
    if (!ch || !ch.isTextBased()) { console.warn(`[LOG] Channel ${channelId} unavailable.`); return null; }
    return await ch.send(payload);
  } catch (e) {
    console.error(`[LOG] Failed to send to ${channelId}:`, e.message);
    return null;
  }
}

async function resolveGuild() {
  if (MAIN_GUILD) return MAIN_GUILD;
  if (process.env.GUILD_ID) MAIN_GUILD = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!MAIN_GUILD) {
    const ch = await getChannel(CFG.mainLog);
    if (ch?.guild) MAIN_GUILD = ch.guild;
  }
  if (!MAIN_GUILD) MAIN_GUILD = client.guilds.cache.first() ?? null;
  return MAIN_GUILD;
}

function describeApiError(e) {
  switch (e?.code) {
    case 50013: return 'I am missing permissions for that (check my permissions and role position).';
    case 50001: return 'I do not have access to that.';
    case 10007: return 'That member was not found.';
    case 10013: return 'That user was not found.';
    case 10026: return 'That user is not banned.';
    case 50007: return 'I could not DM that user.';
    case 10008: return 'That message no longer exists.';
    default: return 'An unexpected error occurred. It has been logged.';
  }
}

async function safeDM(user, payload) {
  try { await user.send(payload); return true; } catch { return false; }
}

function dmEmbed(guild, { title, color, reason, duration, caseId, extra = [] }) {
  const e = new EmbedBuilder().setColor(color ?? COLORS.neutral).setTitle(title).setTimestamp();
  const f = [{ name: 'Server', value: guild.name, inline: true }];
  if (reason) f.push({ name: 'Reason', value: trunc(reason, 1024) });
  if (duration) f.push({ name: 'Duration', value: duration, inline: true });
  f.push(...extra);
  if (caseId) f.push({ name: 'Case ID', value: caseId, inline: true });
  return e.addFields(f);
}

/* ------------------------------- CASES ------------------------------ */

async function newCase(o) {
  D.counters.case += 1;
  const id = `CASE-${pad(D.counters.case)}`;
  const c = {
    id, type: o.type, targetId: o.targetId ?? null, modId: o.modId ?? null,
    reason: o.reason ?? null, duration: o.duration ?? null, createdAt: now(), extra: o.extra ?? {},
  };
  D.cases[id] = c;
  await db.save();
  return c;
}

async function postLog(c, o) {
  const e = new EmbedBuilder().setColor(o.color ?? COLORS.info).setTitle(o.title).setTimestamp();
  const f = [];
  if (o.target) {
    f.push({ name: 'User', value: `<@${o.target.id}> (${userName(o.target)})`, inline: true });
    f.push({ name: 'User ID', value: String(o.target.id), inline: true });
  }
  if (o.moderator) {
    f.push({ name: 'Moderator', value: `<@${o.moderator.id}>`, inline: true });
    f.push({ name: 'Moderator ID', value: String(o.moderator.id), inline: true });
  }
  f.push({ name: 'Action', value: o.action ?? o.title, inline: true });
  if (o.reason) f.push({ name: 'Reason', value: trunc(o.reason, 1024) });
  if (o.duration) f.push({ name: 'Duration', value: o.duration, inline: true });
  for (const x of o.fields || []) f.push({ name: x.name, value: trunc(x.value || 'N/A', 1024), inline: x.inline ?? true });
  f.push({ name: 'Case ID', value: c.id, inline: true });
  e.addFields(f);
  return sendLog(o.channelId ?? CFG.mainLog, {
    content: o.content, embeds: [e], allowedMentions: o.allowedMentions ?? { parse: [] },
  });
}

async function logAction(o) {
  const c = await newCase({
    type: o.type, targetId: o.target?.id, modId: o.moderator?.id,
    reason: o.reason, duration: o.duration, extra: o.extra,
  });
  await postLog(c, o);
  return c;
}

/* ----------------------------- SECURITY ----------------------------- */

function assertCanActOn(ctx, userId, member) {
  if (userId === ctx.author.id) throw new UserError('You cannot use this command on yourself.');
  if (userId === client.user.id) throw new UserError('I cannot moderate myself.');
  if (userId === ctx.guild.ownerId) throw new UserError('You cannot moderate the server owner.');
  if (member) {
    if (ctx.author.id !== ctx.guild.ownerId && member.roles.highest.position >= ctx.member.roles.highest.position) {
      throw new UserError('You cannot moderate a user with a role equal to or higher than yours.');
    }
    if (member.roles.highest.position >= ctx.me.roles.highest.position) {
      throw new UserError('That user\'s highest role is equal to or higher than my highest role.');
    }
  }
}

function requireBotPerm(ctx, perm, name) {
  if (!ctx.me.permissions.has(perm)) throw new UserError(`I am missing the **${name}** permission.`);
}

async function resolveTarget(ctx, tok, { needMember = true, check = true } = {}) {
  const id = parseUserId(tok);
  if (!id) throw new UserError('Invalid user. Mention a member or provide a valid user ID.');
  const member = await ctx.guild.members.fetch(id).catch(() => null);
  const user = member?.user ?? await client.users.fetch(id).catch(() => null);
  if (!user) throw new UserError('I could not find that user.');
  if (needMember && !member) throw new UserError('That user is not in this server.');
  if (check) assertCanActOn(ctx, user.id, member);
  return { user, member };
}

/* ------------------------------ STRIKES ----------------------------- */

const activeStrikes = (userId) =>
  D.strikes.filter((s) => s.userId === userId && s.active).sort((a, b) => a.createdAt - b.createdAt);

async function syncStrikeRoles(member) {
  const n = activeStrikes(member.id).length;
  const want = n > 0 ? CFG.strikeRoles[Math.min(n, 3) - 1] : null;
  const remove = CFG.strikeRoles.filter((r) => r !== want && member.roles.cache.has(r));
  if (remove.length) await member.roles.remove(remove, 'Strike roles sync');
  if (want && !member.roles.cache.has(want)) await member.roles.add(want, 'Strike roles sync');
}

function assertStrikeRolesUsable(ctx) {
  for (const id of CFG.strikeRoles) {
    const r = ctx.guild.roles.cache.get(id);
    if (!r) throw new UserError(`A configured strike role (${id}) does not exist in this server.`);
    if (r.position >= ctx.me.roles.highest.position) throw new UserError(`I cannot manage the role ${r.name}; move my role above it.`);
  }
  requireBotPerm(ctx, P.ManageRoles, 'Manage Roles');
}

/* ------------------------------- JAIL ------------------------------- */

async function releaseJail(guild, userId, reason, { keepAppealId } = {}) {
  const jail = D.jails[userId];
  if (!jail || !jail.active) throw new UserError('That user is not jailed.');
  const member = await guild.members.fetch(userId).catch(() => null);
  let restored = 0, skipped = 0;
  if (member) {
    const me = guild.members.me ?? await guild.members.fetchMe();
    const botTop = me.roles.highest.position;
    const valid = jail.roles.filter((id) => {
      const r = guild.roles.cache.get(id);
      return r && !r.managed && id !== guild.id && id !== CFG.jailRole && r.position < botTop;
    });
    skipped = jail.roles.length - valid.length;
    const current = member.roles.cache.filter((r) => r.id !== guild.id && r.id !== CFG.jailRole).map((r) => r.id);
    await member.roles.set([...new Set([...current, ...valid])], `Jail released: ${trunc(reason, 100)}`);
    restored = valid.length;
  }
  jail.active = false;
  jail.releasedAt = now();
  jail.releaseReason = reason;
  delete jail.releaseFailed;
  await db.save();
  for (const a of Object.values(D.appeals)) {
    if (a.userId === userId && a.status === 'pending' && a.id !== keepAppealId) {
      a.status = 'closed';
      a.closedReason = 'Jail ended';
      await db.save();
      editAppealMessage(a).catch(() => {});
    }
  }
  if (member) await syncStrikeRoles(member).catch(() => {});
  return { restored, skipped, inGuild: !!member };
}

/* ------------------------------ APPEALS ----------------------------- */

function appealEmbed(a) {
  const statusText = {
    pending: 'Pending review',
    accepted: `Accepted by <@${a.reviewedBy}>`,
    denied: `Denied by <@${a.reviewedBy}>`,
    closed: `Closed (${a.closedReason || 'jail ended'})`,
  }[a.status] || a.status;
  const color = { pending: COLORS.info, accepted: COLORS.good, denied: COLORS.error, closed: COLORS.neutral }[a.status];
  const e = new EmbedBuilder().setColor(color).setTitle(`Jail Appeal ${a.id}`).setTimestamp(a.submittedAt);
  e.addFields(
    { name: 'Appeal ID', value: a.id, inline: true },
    { name: 'User', value: `<@${a.userId}> (${a.userName})`, inline: true },
    { name: 'User ID', value: a.userId, inline: true },
    { name: 'Jail Reason', value: trunc(a.jailReason || 'Unknown', 400), inline: false },
    { name: 'Jail Duration', value: a.jailDuration || 'Unknown', inline: true },
    { name: 'Original Moderator', value: a.jailModId ? `<@${a.jailModId}>` : 'Unknown', inline: true },
    { name: 'Submitted', value: `<t:${unix(a.submittedAt)}:F>`, inline: true },
    { name: 'Status', value: statusText, inline: false },
  );
  a.answers.forEach((ans, i) => e.addFields({ name: `${i + 1}. ${QUESTIONS[i]}`, value: trunc(ans, 1024) }));
  if (a.flags?.length) {
    e.addFields({ name: 'Automated Check', value: `Answers ${a.flags.map((f) => f.q).join(', ')} looked low-effort. The user chose to submit anyway.` });
  }
  if (a.reviewedAt) e.addFields({ name: 'Reviewed', value: `<t:${unix(a.reviewedAt)}:F>`, inline: true });
  return e;
}

function appealPayload(a) {
  const dis = a.status !== 'pending';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`appeal:accept:${a.id}`).setLabel('Accept Appeal').setStyle(ButtonStyle.Success).setDisabled(dis),
    new ButtonBuilder().setCustomId(`appeal:deny:${a.id}`).setLabel('Deny Appeal').setStyle(ButtonStyle.Danger).setDisabled(dis),
  );
  return { embeds: [appealEmbed(a)], components: [row] };
}

async function editAppealMessage(a) {
  if (!a.reviewChannelId || !a.reviewMessageId) return;
  const ch = await getChannel(a.reviewChannelId);
  const msg = await ch?.messages?.fetch(a.reviewMessageId).catch(() => null);
  if (msg) await msg.edit(appealPayload(a));
}

async function ensureAppealMessage() {
  const ch = await getChannel(CFG.appealMessageChannel);
  if (!ch || !ch.isTextBased()) { console.warn('[APPEAL] Appeal message channel unavailable.'); return; }
  if (D.config.appealMessageId) {
    const m = await ch.messages.fetch(D.config.appealMessageId).catch(() => null);
    if (m) return;
  }
  const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('Jail Appeals')
    .setDescription('If you want to appeal click on the link below and submit a forum the staff team will view your appeals as soon as possible');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('appeal:start').setLabel('Start Appeal').setStyle(ButtonStyle.Primary),
  );
  const msg = await ch.send({ embeds: [embed], components: [row] });
  D.config.appealMessageId = msg.id;
  await db.save();
}

const TRASH = new Set([
  'lol', 'lmao', 'lmfao', 'idk', 'idc', 'nothing', 'none', 'asdf', 'test', 'bruh', 'xd', 'haha', 'hahaha',
  'jk', 'because', 'cuz', 'just because', 'who cares', 'dont care', "don't care", 'banana', 'pizza', 'potato',
]);
const INSULT = /\b(fuck\s*(you|u|off)|f\s?u|stfu|kys|shut\s*up|screw\s*you|you\s*suck|mods?\s*suck|bitch|cunt|retard(ed)?|faggot|nigg\w+)\b/i;

function detectSuspicious(answers) {
  const flags = new Map();
  const norm = answers.map((a) => a.toLowerCase().replace(/\s+/g, ' ').trim());
  answers.forEach((a, i) => {
    const n = norm[i];
    const core = n.replace(/[^\p{L}\p{N}' ]/gu, '').trim();
    const compact = n.replace(/\s/g, '');
    let why = null;
    if (core === '') why = 'no readable text';
    else if (TRASH.has(core)) why = 'joke or meaningless answer';
    else if (/(.)\1{5,}/u.test(a)) why = 'repeated characters';
    else if (INSULT.test(a)) why = 'insulting language';
    else if (compact.length >= 8 && new Set(compact).size / compact.length < 0.25) why = 'low character variety';
    else if (/asdf|qwer|zxcv|hjkl|sdfg|dfgh/i.test(compact) || a.split(/\s+/).some((w) => /[bcdfghjklmnpqrstvwxz]{6,}/i.test(w))) why = 'keyboard mashing';
    else if (n.length < 3 && !([2, 4].includes(i) && /^(yes|no|y|n)$/.test(n))) why = 'extremely short';
    if (why) flags.set(i + 1, why);
  });
  const counts = {};
  norm.forEach((n) => { counts[n] = (counts[n] || 0) + 1; });
  norm.forEach((n, i) => { if (counts[n] >= 3 && !flags.has(i + 1)) flags.set(i + 1, 'repeated identical answers'); });
  return [...flags.entries()].map(([q, why]) => ({ q, why }));
}

async function askAnswer(dm, user) {
  for (;;) {
    const col = await dm.awaitMessages({ filter: (m) => m.author.id === user.id, max: 1, time: 15 * 60 * 1000 });
    const m = col.first();
    if (!m) return null;
    const text = m.content.trim();
    if (text.toLowerCase() === 'cancel') return CANCEL;
    if (!text) { await dm.send('Please reply with a text answer.'); continue; }
    if (text.length > MAX_ANSWER) { await dm.send(`Your answer is too long (${text.length}/${MAX_ANSWER} characters). Please shorten it and send it again.`); continue; }
    return text;
  }
}

async function runQuestionnaire(user, dm) {
  const session = { answers: [], state: 'asking', flags: [] };
  sessions.set(user.id, session);
  try {
    for (let q = 0; q < QUESTIONS.length; q++) {
      await dm.send({
        embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle(`Question ${q + 1} of ${QUESTIONS.length}`)
          .setDescription(QUESTIONS[q]).setFooter({ text: 'Reply with your answer in this chat. Type "cancel" to stop.' })],
      });
      const a = await 
