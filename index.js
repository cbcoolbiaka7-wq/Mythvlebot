'use strict';

/* =====================================================================
 *  Discord Moderation Bot  (discord.js v14)
 *  - Prefix commands (,)  - Persistent JSON storage  - Jail appeals
 *  Required env:  DISCORD_TOKEN, CLIENT_ID (application ID), GUILD_ID
 *  Optional env:  DATA_DIR (use a Railway Volume mount path)
 * ===================================================================== */

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, PermissionFlagsBits: P, MessageFlags, REST, Routes, StringSelectMenuBuilder,
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

// Fun: the bot replies to every message from this user with the emoji below, 5 times.
// Set REPLY_EMOJI_USER to '' to turn it off.
const REPLY_EMOJI_USER = '1232671987386552464';
const REPLY_EMOJI = '🥷🫄';

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

/* --------------------- PING ROLES & APPLICATIONS CONFIG -------------------- */
// Everything below is easy to change later: channel IDs, role IDs, questions, cooldowns.

const PING_CFG = {
  channel: '1514570946696974436', // channel where the ping-role panel is posted
  roles: [
    { id: '1521576410010095616', label: 'QOTD', emoji: '⁉️', description: 'Question of the Day' },
    { id: '1557749403614449674', label: 'Announcements & Information', emoji: '⚒️', description: 'Server announcements and important information' },
    { id: '1557749621319798835', label: 'Giveaways', emoji: '🎉', description: 'Giveaway notifications' },
    { id: '1557749787523158219', label: 'Dead Chat', emoji: '💀', description: 'Chat revival pings' },
  ],
};

const APP_CFG = {
  panelChannel: '1514544401156804648', // channel where the application panel is posted
  pendingChannel: '1516117756196425889', // pending applications (staff review with Accept / Deny buttons)
  acceptedLog: '1516117830872076388', // log channel for accepted applications
  deniedLog: '1516117867098275930', // log channel for denied applications
  // Roles allowed to click Accept / Deny. Put your high-rank role ID(s) here.
  // Channel visibility is also controlled by the pending channel's permissions.
  reviewerRoles: [CFG.staffRole],
  defaultOpen: false, // used only until staff run /open applications or /close applications
  cooldownMs: 24 * 60 * 60 * 1000, // minimum time between two submissions of the same application type
  minAnswer: 10, // minimum answer length (characters)
  confirmTimeoutMs: 10 * 60 * 1000, // time allowed to confirm the final submission
  types: {
    staff: {
      label: 'Staff Application',
      buttonLabel: 'Staff Application',
      description: 'Help moderate the server and keep the community safe.',
      color: 0x3498db,
      roleId: '1514952787971145859', // role given when a Staff application is accepted
      acceptedSteps: [
        'Read the staff rules and guidelines carefully before you do anything else.',
        'Contact a high-ranking staff member to begin your onboarding and training.',
        'Do not use moderation tools or punish anyone until your training is complete.',
        'Stay active and ask questions whenever you are unsure.',
      ],
      deniedSteps: [
        'Review your answers and think about how you could give more detail next time.',
        'Stay active and follow the rules to build trust with the community.',
        'You are welcome to apply again whenever applications are open.',
      ],
      questions: [
        'How old are you, and what is your time zone?',
        'How long have you been a member of this server, and what is your impression of the community?',
        'Why do you want to become a staff member?',
        'Do you have any previous moderation or staff experience? Describe it in detail.',
        'How many hours per week can you realistically be active, and at what times of day?',
        'A member keeps breaking the rules and argues with you when warned. How do you handle the situation?',
        'Two staff members disagree about the correct punishment for a member. What do you do?',
        'You notice a close friend breaking the rules. How do you respond?',
        'What are your greatest strengths and weaknesses as a potential staff member?',
        'Why should we choose you over other applicants? Add anything else we should know.',
      ],
    },
    event: {
      label: 'Event Conductor Application',
      buttonLabel: 'Event Conductor Application',
      description: 'Plan, host and run events for the community.',
      color: 0x9b59b6,
      roleId: '1522544958819794954', // role given when an Event Conductor application is accepted
      acceptedSteps: [
        'Read the event rules and guidelines before hosting anything.',
        'Contact a high-ranking staff member to learn how events are approved and scheduled.',
        'Plan your first event and get it approved before announcing it.',
        'Ask for help or feedback after your first event so you can improve.',
      ],
      deniedSteps: [
        'Review your answers and think about how you could give more detail next time.',
        'Gain experience by taking part in and organizing small activities.',
        'You are welcome to apply again whenever applications are open.',
      ],
      questions: [
        'How old are you, and what is your time zone?',
        'Why do you want to become an Event Conductor?',
        'Do you have any previous experience hosting or organizing events? Describe it in detail.',
        'List at least three event ideas you would host and explain why members would enjoy them.',
        'Describe how you would run one of your events from start to finish, including preparation.',
        'How would you handle cheating, rule-breaking or disputes between participants during an event?',
        'How would you keep an event engaging when participation is low?',
        'How many hours per week can you be active, and how often could you host events?',
        'A technical problem or a mistake of yours disrupts a live event. What do you do?',
        'Why should we choose you as an Event Conductor? Add anything else we should know.',
      ],
    },
  },
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

async function findPanels(ch) {
  const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
  if (!msgs) return [];
  return [...msgs.values()].filter((m) => m.author.id === client.user.id
    && m.components.some((r) => r.components.some((c) => c.customId === 'appeal:start')));
}

async function postAppealPanel(replaceExisting) {
  const ch = await getChannel(CFG.appealMessageChannel);
  if (!ch || !ch.isTextBased()) throw new UserError('I cannot find or access the appeal channel.');
  if (replaceExisting) for (const old of await findPanels(ch)) await old.delete().catch(() => {});
  const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('Jail Appeals')
    .setDescription('If you want to appeal click on the link below and submit a forum the staff team will view your appeals as soon as possible');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('appeal:start').setLabel('Start Appeal').setStyle(ButtonStyle.Primary),
  );
  let msg;
  try { msg = await ch.send({ embeds: [embed], components: [row] }); } catch (e) {
    if (e.code === 50013 || e.code === 50001) throw new UserError(`I need View Channel, Send Messages and Embed Links in <#${ch.id}>.`);
    throw e;
  }
  D.config.appealMessageId = msg.id;
  await db.save();
  return ch;
}

async function ensureAppealMessage() {
  const ch = await getChannel(CFG.appealMessageChannel);
  if (!ch || !ch.isTextBased()) { console.warn('[APPEAL] Appeal message channel unavailable.'); return; }
  if ((await findPanels(ch)).length) return; // already posted
  await postAppealPanel(false);
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
      const a = await askAnswer(dm, user);
      if (a === null) { sessions.delete(user.id); await dm.send('Your appeal session timed out. Click the appeal button again to restart.'); return; }
      if (a === CANCEL) { sessions.delete(user.id); await dm.send('Your appeal has been cancelled.'); return; }
      session.answers.push(a);
    }
    const flags = detectSuspicious(session.answers);
    if (flags.length) {
      session.state = 'confirm';
      session.flags = flags;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('appealconfirm:review').setLabel('Review Answers').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('appealconfirm:submit').setLabel('Submit Anyway').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('appealconfirm:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
      );
      await dm.send({
        embeds: [new EmbedBuilder().setColor(COLORS.warn).setDescription('Are you sure you wanna submit your application like this?')],
        components: [row],
      });
    } else {
      await finalizeSubmit(user, session);
    }
  } catch (e) {
    sessions.delete(user.id);
    console.error('[APPEAL] Questionnaire error:', e);
    await safeDM(user, 'An error occurred while processing your appeal. Please try again later.');
  }
}

async function finalizeSubmit(user, session) {
  const jail = D.jails[user.id];
  if (!jail?.active) {
    sessions.delete(user.id);
    await safeDM(user, 'You are no longer jailed, so there is nothing to appeal.');
    return;
  }
  const ch = await getChannel(CFG.appealReview);
  if (!ch || !ch.isTextBased()) throw new Error('Appeal review channel unavailable.');
  D.counters.appeal += 1;
  const id = `APPEAL-${pad(D.counters.appeal)}`;
  const appeal = {
    id, userId: user.id, userName: userName(user), answers: session.answers, flags: session.flags,
    status: 'pending', jailCaseId: jail.caseId, jailReason: jail.reason, jailDuration: jail.durationText,
    jailModId: jail.modId, submittedAt: now(), reviewMessageId: null, reviewChannelId: ch.id,
  };
  D.appeals[id] = appeal;
  await db.save();
  try {
    const msg = await ch.send(appealPayload(appeal));
    appeal.reviewMessageId = msg.id;
    await db.save();
  } catch (e) {
    delete D.appeals[id];
    await db.save();
    throw e;
  }
  sessions.delete(user.id);
  await safeDM(user, { embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Appeal Submitted')
    .setDescription(`Your appeal has been submitted. Appeal ID: **${id}**. The staff team will review it as soon as possible.`)] });
  await logAction({
    type: 'APPEAL_SUBMITTED', title: 'Appeal Submitted', color: COLORS.info, target: user, moderator: null,
    action: 'Appeal submitted', reason: 'User submitted a jail appeal',
    fields: [{ name: 'Appeal ID', value: id }, { name: 'Jail Case', value: jail.caseId || 'N/A' }],
  });
}

async function startAppeal(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const user = i.user;
  if (!D.jails[user.id]?.active) return i.editReply('You do not currently have an active jail to appeal.');
  if (Object.values(D.appeals).some((a) => a.userId === user.id && a.status === 'pending')) {
    return i.editReply('You already have a pending appeal. Please wait for staff to review it.');
  }
  if (sessions.has(user.id)) return i.editReply('You already have an appeal in progress. Check your direct messages.');
  if (appSessions.has(user.id)) return i.editReply('You currently have an application in progress. Finish or cancel it before starting an appeal.');
  let dm;
  try {
    dm = await user.createDM();
    await dm.send({ embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('Jail Appeal')
      .setDescription('You will be asked five questions. Please answer each one seriously and honestly. Type "cancel" at any time to stop.')] });
  } catch {
    return i.editReply('I could not send you a direct message. Enable DMs from server members and click the button again.');
  }
  await i.editReply('I have sent you a direct message to begin your appeal.');
  runQuestionnaire(user, dm).catch((e) => console.error('[APPEAL]', e));
}

async function handleConfirm(i, action) {
  const session = sessions.get(i.user.id);
  if (!session || session.state !== 'confirm') {
    return i.reply('This appeal session has expired. Please click the appeal button in the server to start again.');
  }
  if (action === 'review') {
    const e = new EmbedBuilder().setColor(COLORS.info).setTitle('Your Answers');
    session.answers.forEach((a, n) => e.addFields({ name: `${n + 1}. ${QUESTIONS[n]}`, value: trunc(a, 1024) }));
    return i.reply({ embeds: [e] });
  }
  await i.update({ components: [] });
  if (action === 'cancel') {
    sessions.delete(i.user.id);
    return void i.followUp('Your appeal has been cancelled.');
  }
  session.state = 'submitting';
  try { await finalizeSubmit(i.user, session); } catch (e) {
    sessions.delete(i.user.id);
    console.error('[APPEAL] Submit failed:', e);
    await i.followUp('Your appeal could not be submitted right now. Please contact staff.').catch(() => {});
  }
}

async function handleDecision(i, action, appealId) {
  const guild = i.guild;
  const staff = await guild.members.fetch(i.user.id).catch(() => null);
  if (!isStaff(staff)) return i.reply({ content: 'Only staff members can review appeals.', flags: MessageFlags.Ephemeral });
  const appeal = D.appeals[appealId];
  if (!appeal) return i.reply({ content: 'That appeal no longer exists.', flags: MessageFlags.Ephemeral });
  if (appeal.status !== 'pending') {
    await i.reply({ content: `This appeal was already handled (${appeal.status}).`, flags: MessageFlags.Ephemeral });
    return void editAppealMessage(appeal).catch(() => {});
  }
  if (appeal.userId === i.user.id) return i.reply({ content: 'You cannot review your own appeal.', flags: MessageFlags.Ephemeral });
  await i.deferUpdate();

  const accepted = action === 'accept';
  let restored = 0;
  if (accepted) {
    try {
      const res = await releaseJail(guild, appeal.userId, 'Appeal accepted', { keepAppealId: appeal.id });
      restored = res.restored;
    } catch (e) {
      const msg = e instanceof UserError ? e.message : describeApiError(e);
      if (!(e instanceof UserError)) console.error('[APPEAL] Release failed:', e);
      return void i.followUp({ content: `Could not accept the appeal: ${msg}`, flags: MessageFlags.Ephemeral });
    }
  }
  appeal.status = accepted ? 'accepted' : 'denied';
  appeal.reviewedBy = i.user.id;
  appeal.reviewedAt = now();
  await db.save();
  await editAppealMessage(appeal).catch(() => {});

  const user = await client.users.fetch(appeal.userId).catch(() => ({ id: appeal.userId, username: appeal.userName }));
  if (user.send) {
    await safeDM(user, {
      embeds: [new EmbedBuilder().setColor(accepted ? COLORS.good : COLORS.error)
        .setTitle(accepted ? 'Appeal Accepted' : 'Appeal Denied')
        .setDescription(accepted
          ? `Your appeal (${appeal.id}) has been accepted. Your jail has been lifted and your roles were restored.`
          : `Your appeal (${appeal.id}) has been denied. Your jail remains in effect until it expires.`)],
    });
  }
  await sendLog(accepted ? CFG.appealAccepted : CFG.appealDenied, { embeds: [appealEmbed(appeal)], allowedMentions: { parse: [] } });
  await logAction({
    type: accepted ? 'APPEAL_ACCEPTED' : 'APPEAL_DENIED',
    title: accepted ? 'Appeal Accepted' : 'Appeal Denied',
    color: accepted ? COLORS.good : COLORS.error, target: user, moderator: i.user,
    action: accepted ? 'Appeal accepted, jail removed' : 'Appeal denied, jail kept',
    reason: accepted ? 'Jail appeal accepted' : 'Jail appeal denied',
    fields: [{ name: 'Appeal ID', value: appeal.id }, ...(accepted ? [{ name: 'Roles Restored', value: String(restored) }] : [])],
  });
}

/* ------------------------------ SNIPE / AFK ------------------------- */

function snipeEmbed(e, index, total) {
  const emb = new EmbedBuilder().setColor(COLORS.info).setTitle('Deleted Message')
    .setDescription(e.content ? trunc(e.content, 4000) : '*No text content*')
    .addFields(
      { name: 'Author', value: `<@${e.authorId}> (${e.authorName})`, inline: true },
      { name: 'Author ID', value: e.authorId, inline: true },
      { name: 'Channel', value: `<#${e.channelId}>`, inline: true },
      { name: 'Message ID', value: e.messageId || 'Unknown', inline: true },
      { name: 'Deleted', value: `<t:${unix(e.deletedAt)}:R>`, inline: true },
    )
    .setFooter({ text: `Snipe ${index} of ${total}` }).setTimestamp(e.deletedAt);
  if (e.avatar) emb.setThumbnail(e.avatar);
  if (e.attachments.length) {
    emb.addFields({ name: 'Attachments', value: trunc(e.attachments.map((a) => `[${a.name}](${a.url})`).join('\n'), 1024) });
    const img = e.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (img) emb.setImage(img.url);
  }
  if (e.stickers.length) emb.addFields({ name: 'Stickers', value: trunc(e.stickers.join(', '), 1024) });
  return emb;
}

async function clearAfk(message, member) {
  const data = D.afk[message.author.id];
  if (!data) return;
  delete D.afk[message.author.id];
  await db.save();
  if (data.nickChanged && member?.manageable && member.nickname === data.afkNick) {
    await member.setNickname(data.prevNick ?? null, 'AFK removed').catch(() => {});
  }
  const r = await message.reply({
    content: `Welcome back <@${message.author.id}>, your AFK status has been removed. You were AFK for ${formatDuration(now() - data.since)}.`,
    allowedMentions: { users: [message.author.id], repliedUser: false },
  }).catch(() => null);
  if (r) setTimeout(() => r.delete().catch(() => {}), 10000);
}

async function notifyAfkMentions(message) {
  const hits = message.mentions.users.filter((u) => !u.bot && u.id !== message.author.id && D.afk[u.id]);
  let n = 0;
  for (const u of hits.values()) {
    if (n++ >= 3) break;
    const a = D.afk[u.id];
    const e = new EmbedBuilder().setColor(COLORS.neutral).setTitle('User is AFK')
      .addFields(
        { name: 'User', value: `<@${u.id}>`, inline: true },
        { name: 'Reason', value: trunc(a.reason, 1024), inline: true },
        { name: 'AFK For', value: `${formatDuration(now() - a.since)} (since <t:${unix(a.since)}:R>)`, inline: true },
      );
    await message.reply({ embeds: [e], allowedMentions: NO_PING }).catch(() => {});
  }
}

/* ----------------------------- COMMANDS ----------------------------- */

const commands = new Map();
function def(names, spec) { for (const n of [].concat(names)) commands.set(n, spec); }
const usage = (u) => new UserError(`Usage: \`${PREFIX}${u}\``);

async function success(message, text, caseId) {
  const e = new EmbedBuilder().setColor(COLORS.good).setDescription(text);
  if (caseId) e.setFooter({ text: caseId });
  return message.reply({ embeds: [e], allowedMentions: NO_PING }).catch(() => null);
}
async function failure(message, text) {
  return message.reply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setDescription(text)], allowedMentions: NO_PING }).catch(() => null);
}
function tempDelete(msg, ms = 5000) { if (msg) setTimeout(() => msg.delete().catch(() => {}), ms); }
const auditReason = (ctx, r) => trunc(`${ctx.author.username}: ${r}`, 500);
const activeWarnCount = (id) => D.warnings.filter((w) => w.userId === id && w.active).length;

// Optional duration: "[duration] [reason]". No valid duration => permanent.
function parseDurReason(rest) {
  const [t, r] = splitFirst(rest);
  const ms = parseDuration(t);
  if (ms) return { ms, reason: r || 'No reason provided' };
  return { ms: null, reason: (rest || '').trim() || 'No reason provided' };
}

// ---- warn / unwarn
def('warn', { staff: true, async run(ctx) {
  const [tok, reason] = splitFirst(ctx.args);
  if (!tok || !reason) throw usage('warn @user <reason>');
  const { user } = await resolveTarget(ctx, tok);
  const c = await newCase({ type: 'WARN', targetId: user.id, modId: ctx.author.id, reason });
  D.warnings.push({ caseId: c.id, userId: user.id, modId: ctx.author.id, reason, createdAt: now(), active: true, removedAt: null, removedBy: null, removeCaseId: null });
  await db.save();
  const dm = await safeDM(user, { embeds: [dmEmbed(ctx.guild, { title: 'You have received a warning', color: COLORS.warn, reason, caseId: c.id })] });
  await postLog(c, { title: 'User Warned', color: COLORS.warn, target: user, moderator: ctx.author, action: 'Warn', reason,
    fields: [{ name: 'Active Warnings', value: String(activeWarnCount(user.id)) }, { name: 'DM Delivered', value: dm ? 'Yes' : 'No' }] });
  await success(ctx.message, `Warned <@${user.id}>. Active warnings: **${activeWarnCount(user.id)}**.${dm ? '' : '\nThe user has DMs closed, so the warning could not be delivered.'}`, c.id);
} });

def('unwarn', { staff: true, async run(ctx) {
  const [tok] = splitFirst(ctx.args);
  if (!tok) throw usage('unwarn @user');
  const { user } = await resolveTarget(ctx, tok, { needMember: false });
  const w = D.warnings.filter((x) => x.userId === user.id && x.active).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!w) throw new UserError('That user has no active warnings.');
  const c = await newCase({ type: 'UNWARN', targetId: user.id, modId: ctx.author.id, reason: `Removed warning ${w.caseId}` });
  w.active = false; w.removedAt = now(); w.removedBy = ctx.author.id; w.removeCaseId = c.id;
  await db.save();
  await postLog(c, { title: 'Warning Removed', color: COLORS.good, target: user, moderator: ctx.author, action: 'Unwarn', reason: `Removed warning ${w.caseId}: ${w.reason}`,
    fields: [{ name: 'Remaining Active Warnings', value: String(activeWarnCount(user.id)) }] });
  await success(ctx.message, `Removed the most recent warning from <@${user.id}>. Active warnings: **${activeWarnCount(user.id)}**.`, c.id);
} });

// ---- mute / unmute
def('mute', { staff: true, perm: P.ModerateMembers, permName: 'Moderate Members', async run(ctx) {
  const [tok, rest] = splitFirst(ctx.args);
  if (!tok) throw usage('mute @user [duration] [reason]');
  const { ms, reason } = parseDurReason(rest);
  if (ms && ms > MAX_TIMEOUT_MS) throw new UserError('The maximum timed mute is 28 days. Leave the duration out for a permanent mute.');
  const { user, member } = await resolveTarget(ctx, tok);
  requireBotPerm(ctx, P.ModerateMembers, 'Moderate Members');
  if (!member.moderatable) throw new UserError('I cannot mute that user (role hierarchy or permissions).');
  const durText = ms ? formatDuration(ms) : 'Permanent';
  const c = await newCase({ type: 'MUTE', targetId: user.id, modId: ctx.author.id, reason, duration: durText });
  await member.timeout(ms || MAX_TIMEOUT_MS, auditReason(ctx, reason));
  D.mutes[user.id] = { caseId: c.id, expiresAt: ms ? now() + ms : null, permanent: !ms, modId: ctx.author.id, reason, active: true };
  await db.save();
  const dm = await safeDM(user, { embeds: [dmEmbed(ctx.guild, { title: 'You have been muted', color: COLORS.mute, reason, duration: durText, caseId: c.id })] });
  await postLog(c, { title: 'User Muted', color: COLORS.mute, target: user, moderator: ctx.author, action: 'Mute', reason, duration: durText,
    fields: [{ name: 'Expires', value: ms ? `<t:${unix(now() + ms)}:R>` : 'Never (permanent)' }, { name: 'DM Delivered', value: dm ? 'Yes' : 'No' }] });
  await success(ctx.message, `Muted <@${user.id}> ${ms ? `for **${durText}**` : '**permanently**'}.`, c.id);
} });

def('unmute', { staff: true, perm: P.ModerateMembers, permName: 'Moderate Members', async run(ctx) {
  const [tok] = splitFirst(ctx.args);
  if (!tok) throw usage('unmute @user');
  const { user, member } = await resolveTarget(ctx, tok);
  requireBotPerm(ctx, P.ModerateMembers, 'Moderate Members');
  if (!member.isCommunicationDisabled()) throw new UserError('That user is not muted.');
  await member.timeout(null, auditReason(ctx, 'Unmuted'));
  if (D.mutes[user.id]) { D.mutes[user.id].active = false; D.mutes[user.id].endedAt = now(); }
  const c = await newCase({ type: 'UNMUTE', targetId: user.id, modId: ctx.author.id, reason: 'Manual unmute' });
  await postLog(c, { title: 'User Unmuted', color: COLORS.good, target: user, moderator: ctx.author, action: 'Unmute', reason: 'Manual unmute' });
  await success(ctx.message, `Unmuted <@${user.id}>.`, c.id);
} });

// ---- ban / unban / kick
def('ban', { staff: true, perm: P.BanMembers, permName: 'Ban Members', async run(ctx) {
  const [tok, reason] = splitFirst(ctx.args);
  if (!tok || !reason) throw usage('ban @user <reason>');
  const { user, member } = await resolveTarget(ctx, tok, { needMember: false });
  requireBotPerm(ctx, P.BanMembers, 'Ban Members');
  if (member && !member.bannable) throw new UserError('I cannot ban that user (role hierarchy or permissions).');
  const c = await newCase({ type: 'BAN', targetId: user.id, modId: ctx.author.id, reason });
  const dm = await safeDM(user, { embeds: [dmEmbed(ctx.guild, { title: 'You have been banned', color: COLORS.ban, reason, caseId: c.id })] });
  await ctx.guild.members.ban(user.id, { reason: auditReason(ctx, reason) });
  await postLog(c, { title: 'User Banned', color: COLORS.ban, target: user, moderator: ctx.author, action: 'Ban', reason,
    fields: [{ name: 'DM Delivered', value: dm ? 'Yes' : 'No' }] });
  await success(ctx.message, `Banned <@${user.id}>.`, c.id);
} });

def('unban', { staff: true, perm: P.BanMembers, permName: 'Ban Members', async run(ctx) {
  const [tok, reason] = splitFirst(ctx.args);
  const id = parseUserId(tok);
  if (!id) throw usage('unban <user ID>');
  requireBotPerm(ctx, P.BanMembers, 'Ban Members');
  const ban = await ctx.guild.bans.fetch(id).catch(() => null);
  if (!ban) throw new UserError('That user is not banned.');
  await ctx.guild.members.unban(id, auditReason(ctx, reason || 'No reason provided'));
  const c = await newCase({ type: 'UNBAN', targetId: id, modId: ctx.author.id, reason: reason || 'No reason provided' });
  await postLog(c, { title: 'User Unbanned', color: COLORS.good, target: ban.user, moderator: ctx.author, action: 'Unban', reason: reason || 'No reason provided' });
  await success(ctx.message, `Unbanned **${userName(ban.user)}** (${id}).`, c.id);
} });

def('kick', { staff: true, perm: P.KickMembers, permName: 'Kick Members', async run(ctx) {
  const [tok, reason] = splitFirst(ctx.args);
  if (!tok || !reason) throw usage('kick @user <reason>');
  const { user, member } = await resolveTarget(ctx, tok);
  requireBotPerm(ctx, P.KickMembers, 'Kick Members');
  if (!member.kickable) throw new UserError('I cannot kick that user (role hierarchy or permissions).');
  const c = await newCase({ type: 'KICK', targetId: user.id, modId: ctx.author.id, reason });
  const dm = await safeDM(user, { embeds: [dmEmbed(ctx.guild, { title: 'You have been kicked', color: COLORS.kick, reason, caseId: c.id })] });
  await member.kick(auditReason(ctx, reason));
  await postLog(c, { title: 'User Kicked', color: COLORS.kick, target: user, moderator: ctx.author, action: 'Kick', reason,
    fields: [{ name: 'DM Delivered', value: dm ? 'Yes' : 'No' }] });
  await success(ctx.message, `Kicked <@${user.id}>.`, c.id);
} });

// ---- strike / unstrike
def('strike', { staff: true, async run(ctx) {
  const [tok, reason] = splitFirst(ctx.args);
  if (!tok || !reason) throw usage('strike @user <reason>');
  const { user, member } = await resolveTarget(ctx, tok);
  assertStrikeRolesUsable(ctx);
  const c = await newCase({ type: 'STRIKE', targetId: user.id, modId: ctx.author.id, reason });
  D.counters.strike += 1;
  const created = now();
  D.strikes.push({ id: `STRIKE-${pad(D.counters.strike)}`, caseId: c.id, userId: user.id, modId: ctx.author.id, reason,
    createdAt: created, expiresAt: created + STRIKE_EXPIRY_MS, active: true, removedAt: null, removedBy: null, removedReason: null });
  await db.save();
  const count = activeStrikes(user.id).length;
  await syncStrikeRoles(member);
  const reached = count >= 3;
  await postLog(c, {
    title: 'Strike Issued', color: COLORS.strike, channelId: CFG.strikeLog, target: user, moderator: ctx.author, action: 'Strike', reason,
    fields: [{ name: 'Strike Number', value: String(count) }, { name: 'Current Strike Count', value: `${count} active` },
      { name: 'Expires', value: `<t:${unix(created + STRIKE_EXPIRY_MS)}:R>` }],
    content: reached ? `<@&${CFG.staffRole}> <@${user.id}> has reached the 3-strike limit and should be reviewed/demoted.` : undefined,
    allowedMentions: reached ? { roles: [CFG.staffRole] } : { parse: [] },
  });
  await success(ctx.message, `Issued strike **${count}** to <@${user.id}>.${reached ? '\nThis user has reached the 3-strike limit; staff have been notified.' : ''}`, c.id);
} });

def('unstrike', { staff: true, async run(ctx) {
  const [tok, numTok] = splitFirst(ctx.args);
  if (!tok || !/^\d+$/.test(numTok.trim())) throw usage('unstrike @user <strike number>');
  const { user, member } = await resolveTarget(ctx, tok, { needMember: false });
  const list = activeStrikes(user.id);
  if (!list.length) throw new UserError('That user has no active strikes.');
  const n = parseInt(numTok, 10);
  if (n < 1 || n > list.length) throw new UserError(`Strike number must be between 1 and ${list.length} (1 = oldest active strike).`);
  const s = list[n - 1];
  if (member) assertStrikeRolesUsable(ctx);
  const c = await newCase({ type: 'UNSTRIKE', targetId: user.id, modId: ctx.author.id, reason: `Removed strike ${n} (${s.caseId}): ${s.reason}` });
  s.active = false; s.removedAt = now(); s.removedBy = ctx.author.id; s.removedReason = 'unstrike'; s.removeCaseId = c.id;
  await db.save();
  if (member) await syncStrikeRoles(member);
  await postLog(c, {
    title: 'Strike Removed', color: COLORS.good, channelId: CFG.strikeLog, target: user, moderator: ctx.author, action: 'Unstrike',
    reason: `Original strike (${s.caseId}): ${s.reason}`,
    fields: [{ name: 'Strike Number', value: String(n) }, { name: 'Current Strike Count', value: `${activeStrikes(user.id).length} active` }],
  });
  await success(ctx.message, `Removed strike **${n}** from <@${user.id}>. Active strikes: **${activeStrikes(user.id).length}**.`, c.id);
} });

// ---- nick / unnick
def('nick', { staff: true, perm: P.ManageNicknames, permName: 'Manage Nicknames', async run(ctx) {
  const [tok, nickname] = splitFirst(ctx.args);
  if (!tok || !nickname) throw usage('nick @user <nickname>');
  if (nickname.length > 32) throw new UserError('Nicknames cannot be longer than 32 characters.');
  const { user, member } = await resolveTarget(ctx, tok);
  requireBotPerm(ctx, P.ManageNicknames, 'Manage Nicknames');
  if (!member.manageable) throw new UserError('I cannot change that user\'s nickname.');
  const old = member.nickname || member.user.username;
  await member.setNickname(nickname, auditReason(ctx, 'Nickname changed'));
  const c = await logAction({ type: 'NICK', title: 'Nickname Changed', color: COLORS.info, target: user, moderator: ctx.author, action: 'Nickname change',
    fields: [{ name: 'Old Nickname', value: old }, { name: 'New Nickname', value: nickname }] });
  await success(ctx.message, `Changed <@${user.id}>'s nickname to **${nickname}**.`, c.id);
} });

def('unnick', { staff: true, perm: P.ManageNicknames, permName: 'Manage Nicknames', async run(ctx) {
  const [tok] = splitFirst(ctx.args);
  if (!tok) throw usage('unnick @user');
  const { user, member } = await resolveTarget(ctx, tok);
  requireBotPerm(ctx, P.ManageNicknames, 'Manage Nicknames');
  if (!member.manageable) throw new UserError('I cannot change that user\'s nickname.');
  const old = member.nickname;
  if (!old) throw new UserError('That user does not have a nickname set.');
  await member.setNickname(null, auditReason(ctx, 'Nickname reset'));
  const c = await logAction({ type: 'UNNICK', title: 'Nickname Reset', color: COLORS.good, target: user, moderator: ctx.author, action: 'Nickname reset',
    fields: [{ name: 'Old Nickname', value: old }, { name: 'Restored To', value: user.username }] });
  await success(ctx.message, `Reset <@${user.id}>'s nickname.`, c.id);
} });

// ---- jail / unjail
def('jail', { staff: true, perm: P.ManageRoles, permName: 'Manage Roles', async run(ctx) {
  const [tok, rest] = splitFirst(ctx.args);
  if (!tok) throw usage('jail @user [duration] [reason]');
  const { ms, reason } = parseDurReason(rest);
  if (ms && ms > MAX_JAIL_MS) throw new UserError('The maximum timed jail is 365 days. Leave the duration out for a permanent jail.');
  const { user, member } = await resolveTarget(ctx, tok);
  requireBotPerm(ctx, P.ManageRoles, 'Manage Roles');
  const jailRole = ctx.guild.roles.cache.get(CFG.jailRole);
  if (!jailRole) throw new UserError('The configured jail role does not exist in this server.');
  if (jailRole.position >= ctx.me.roles.highest.position) throw new UserError('The jail role is above my highest role; I cannot assign it.');
  if (D.jails[user.id]?.active) throw new UserError('That user is already jailed.');

  const botTop = ctx.me.roles.highest.position;
  const all = member.roles.cache.filter((r) => r.id !== ctx.guild.id && r.id !== CFG.jailRole);
  const removable = all.filter((r) => !r.managed && r.position < botTop).map((r) => r.id);
  const keep = all.filter((r) => r.managed || r.position >= botTop).map((r) => r.id);

  const durText = ms ? formatDuration(ms) : 'Permanent';
  const c = await newCase({ type: 'JAIL', targetId: user.id, modId: ctx.author.id, reason, duration: durText });
  D.jails[user.id] = { active: true, caseId: c.id, roles: removable, jailedAt: now(), expiresAt: ms ? now() + ms : null, durationText: durText, reason, modId: ctx.author.id };
  await db.save();
  try {
    await member.roles.set([...keep, CFG.jailRole], auditReason(ctx, `Jailed: ${reason}`));
  } catch (e) {
    delete D.jails[user.id];
    await db.save();
    throw e;
  }
  const dm = await safeDM(user, { embeds: [dmEmbed(ctx.guild, { title: 'You have been jailed', color: COLORS.jail, reason, duration: durText, caseId: c.id,
    extra: [{ name: 'Appeal', value: `You may appeal in <#${CFG.appealMessageChannel}>.` }] })] });
  await postLog(c, { title: 'User Jailed', color: COLORS.jail, target: user, moderator: ctx.author, action: 'Jail', reason, duration: durText,
    fields: [{ name: 'Expires', value: ms ? `<t:${unix(now() + ms)}:R>` : 'Never (permanent)' }, { name: 'Roles Saved', value: String(removable.length) }, { name: 'DM Delivered', value: dm ? 'Yes' : 'No' }] });
  await success(ctx.message, `Jailed <@${user.id}> ${ms ? `for **${durText}**` : '**permanently**'}.`, c.id);
} });

def('unjail', { staff: true, perm: P.ManageRoles, permName: 'Manage Roles', async run(ctx) {
  const [tok] = splitFirst(ctx.args);
  if (!tok) throw usage('unjail @user');
  const { user } = await resolveTarget(ctx, tok, { needMember: false });
  requireBotPerm(ctx, P.ManageRoles, 'Manage Roles');
  const res = await releaseJail(ctx.guild, user.id, `Unjailed by ${ctx.author.username}`);
  const c = await newCase({ type: 'UNJAIL', targetId: user.id, modId: ctx.author.id, reason: 'Manual unjail' });
  await postLog(c, { title: 'User Unjailed', color: COLORS.good, target: user, moderator: ctx.author, action: 'Unjail', reason: 'Manual unjail',
    fields: [{ name: 'Roles Restored', value: String(res.restored) }, ...(res.skipped ? [{ name: 'Roles Not Restored', value: `${res.skipped} (deleted, managed or above my role)` }] : [])] });
  await success(ctx.message, `Unjailed <@${user.id}> and restored ${res.restored} role(s).${res.inGuild ? '' : '\nThe user is not in the server; jail state was cleared.'}`, c.id);
} });

// ---- purge / clean
const tooOld = (m) => now() - m.createdTimestamp >= 13.9 * 864e5;

def('purge', { staff: true, ephemeral: true, perm: P.ManageMessages, permName: 'Manage Messages', async run(ctx) {
  const [a, b] = splitFirst(ctx.args);
  let human = false, amountTok = a;
  if (a.toLowerCase() === 'human') { human = true; amountTok = splitFirst(b)[0]; }
  if (!/^\d+$/.test(amountTok || '')) throw usage('purge <amount>` or `' + PREFIX + 'purge human <amount>');
  const amount = parseInt(amountTok, 10);
  if (amount < 1 || amount > 1000) throw new UserError('Amount must be between 1 and 1000.');
  const perms = ctx.channel.permissionsFor(ctx.me);
  if (!perms?.has([P.ManageMessages, P.ReadMessageHistory])) throw new UserError('I need **Manage Messages** and **Read Message History** in this channel.');
  await ctx.message.delete().catch(() => {});
  let remaining = amount, before = ctx.message.id, deleted = 0, scanned = 0;
  while (remaining > 0 && scanned < 2000) {
    const batch = await ctx.channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    scanned += batch.size;
    before = batch.last().id;
    const picks = [...batch.values()].filter((m) => !m.pinned && !tooOld(m) && (!human || !m.author.bot)).slice(0, remaining);
    if (picks.length) {
      const res = await ctx.channel.bulkDelete(picks, true);
      deleted += res.size;
      remaining -= picks.length;
    }
    if (batch.every(tooOld) || batch.size < 100) break;
  }
  const c = await logAction({ type: 'PURGE', title: human ? 'Messages Purged (Human)' : 'Messages Purged', color: COLORS.neutral, moderator: ctx.author,
    action: human ? 'Purge (human only)' : 'Purge', fields: [{ name: 'Channel', value: `<#${ctx.channel.id}>` }, { name: 'Requested', value: String(amount) }, { name: 'Deleted', value: String(deleted) }] });
  tempDelete(await ctx.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.good).setDescription(`Deleted **${deleted}** message(s).`).setFooter({ text: c.id })] }).catch(() => null));
} });

def('clean', { staff: true, ephemeral: true, perm: P.ManageMessages, permName: 'Manage Messages', async run(ctx) {
  const [a] = splitFirst(ctx.args);
  let amount = 50;
  if (a) {
    if (!/^\d+$/.test(a) || parseInt(a, 10) < 1 || parseInt(a, 10) > 100) throw new UserError('Amount must be between 1 and 100.');
    amount = parseInt(a, 10);
  }
  const perms = ctx.channel.permissionsFor(ctx.me);
  if (!perms?.has([P.ManageMessages, P.ReadMessageHistory])) throw new UserError('I need **Manage Messages** and **Read Message History** in this channel.');
  const batch = await ctx.channel.messages.fetch({ limit: 100 });
  const mine = [...batch.values()].filter((m) => m.author.id === client.user.id && m.id !== ctx.message.id).slice(0, amount);
  const fresh = mine.filter((m) => !tooOld(m));
  let deleted = 0;
  if (fresh.length) deleted += (await ctx.channel.bulkDelete(fresh, true)).size;
  for (const m of mine.filter(tooOld).slice(0, 10)) { if (await m.delete().then(() => true).catch(() => false)) deleted++; }
  const c = await logAction({ type: 'CLEAN', title: 'Bot Messages Cleaned', color: COLORS.neutral, moderator: ctx.author, action: 'Clean',
    fields: [{ name: 'Channel', value: `<#${ctx.channel.id}>` }, { name: 'Deleted', value: String(deleted) }] });
  tempDelete(await ctx.channel.send({ embeds: [new EmbedBuilder().setColor(COLORS.good).setDescription(`Cleaned **${deleted}** bot message(s).`).setFooter({ text: c.id })] }).catch(() => null));
} });

// ---- lock / unlock / slowmode
const LOCK_FLAGS = { send: 'SendMessages', threads: 'SendMessagesInThreads' };
function readPerm(ch, id, flag) {
  const ow = ch.permissionOverwrites.cache.get(id);
  if (!ow) return null;
  if (ow.allow.has(flag)) return true;
  if (ow.deny.has(flag)) return false;
  return null;
}

def('lock', { staff: true, ephemeral: true, perm: P.ManageChannels, permName: 'Manage Channels', async run(ctx) {
  const ch = ctx.channel;
  if (!ch.permissionOverwrites) throw new UserError('This channel cannot be locked.');
  if (D.locks[ch.id]) throw new UserError('This channel is already locked.');
  if (!ch.permissionsFor(ctx.me).has([P.ManageChannels, P.ManageRoles])) throw new UserError('I need **Manage Channels** and **Manage Roles** in this channel.');
  const everyone = ctx.guild.roles.everyone.id;
  const allowIds = [client.user.id];
  if (ctx.guild.roles.cache.has(CFG.staffRole)) allowIds.unshift(CFG.staffRole);
  const ids = [everyone, ...allowIds];
  const prev = {};
  for (const id of ids) prev[id] = { send: readPerm(ch, id, P.SendMessages), threads: readPerm(ch, id, P.SendMessagesInThreads) };
  D.locks[ch.id] = { prev, by: ctx.author.id, at: now() };
  await db.save();
  try {
    for (const id of allowIds) await ch.permissionOverwrites.edit(id, { [LOCK_FLAGS.send]: true, [LOCK_FLAGS.threads]: true }, { reason: auditReason(ctx, 'Channel lock') });
    await ch.permissionOverwrites.edit(everyone, { [LOCK_FLAGS.send]: false, [LOCK_FLAGS.threads]: false }, { reason: auditReason(ctx, 'Channel lock') });
  } catch (e) {
    delete D.locks[ch.id];
    await db.save();
    throw e;
  }
  const c = await logAction({ type: 'LOCK', title: 'Channel Locked', color: COLORS.warn, moderator: ctx.author, action: 'Lock', fields: [{ name: 'Channel', value: `<#${ch.id}>` }] });
  await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.warn).setDescription('This channel has been locked by staff.').setFooter({ text: c.id })] }).catch(() => {});
} });

def('unlock', { staff: true, ephemeral: true, perm: P.ManageChannels, permName: 'Manage Channels', async run(ctx) {
  const ch = ctx.channel;
  const lock = D.locks[ch.id];
  if (!lock) throw new UserError('This channel was not locked by me.');
  for (const [id, p] of Object.entries(lock.prev)) {
    await ch.permissionOverwrites.edit(id, { [LOCK_FLAGS.send]: p.send, [LOCK_FLAGS.threads]: p.threads }, { reason: auditReason(ctx, 'Channel unlock') });
    const ow = ch.permissionOverwrites.cache.get(id);
    if (ow && ow.allow.bitfield === 0n && ow.deny.bitfield === 0n) await ow.delete().catch(() => {});
  }
  delete D.locks[ch.id];
  await db.save();
  const c = await logAction({ type: 'UNLOCK', title: 'Channel Unlocked', color: COLORS.good, moderator: ctx.author, action: 'Unlock', fields: [{ name: 'Channel', value: `<#${ch.id}>` }] });
  await ch.send({ embeds: [new EmbedBuilder().setColor(COLORS.good).setDescription('This channel has been unlocked.').setFooter({ text: c.id })] }).catch(() => {});
} });

def('slowmode', { staff: true, perm: P.ManageChannels, permName: 'Manage Channels', async run(ctx) {
  const [a] = splitFirst(ctx.args);
  if (!/^\d+$/.test(a || '')) throw usage('slowmode <seconds>');
  const secs = parseInt(a, 10);
  if (secs > 21600) throw new UserError('Slowmode must be between 0 and 21600 seconds.');
  if (typeof ctx.channel.setRateLimitPerUser !== 'function') throw new UserError('Slowmode cannot be set in this channel.');
  requireBotPerm(ctx, P.ManageChannels, 'Manage Channels');
  const old = ctx.channel.rateLimitPerUser || 0;
  await ctx.channel.setRateLimitPerUser(secs, auditReason(ctx, 'Slowmode changed'));
  const c = await logAction({ type: 'SLOWMODE', title: 'Slowmode Changed', color: COLORS.info, moderator: ctx.author, action: 'Slowmode',
    fields: [{ name: 'Channel', value: `<#${ctx.channel.id}>` }, { name: 'Old', value: `${old}s` }, { name: 'New', value: secs === 0 ? 'Disabled' : `${secs}s` }] });
  await success(ctx.message, secs === 0 ? 'Slowmode disabled.' : `Slowmode set to **${secs}s**.`, c.id);
} });

// ---- snipe / cs
def('snipe', { staff: true, async run(ctx) {
  const [a] = splitFirst(ctx.args);
  let n = 1;
  if (a) {
    if (!/^\d+$/.test(a) || parseInt(a, 10) < 1 || parseInt(a, 10) > SNIPE_LIMIT) throw new UserError(`Snipe number must be between 1 and ${SNIPE_LIMIT}.`);
    n = parseInt(a, 10);
  }
  const list = snipes.get(ctx.channel.id) || [];
  if (!list.length) throw new UserError('There are no deleted messages stored for this channel.');
  const idx = n === SNIPE_LIMIT ? list.length - 1 : n - 1;
  if (idx >= list.length) throw new UserError(`Only ${list.length} deleted message(s) are stored for this channel.`);
  await ctx.message.reply({ embeds: [snipeEmbed(list[idx], idx + 1, list.length)], allowedMentions: NO_PING });
} });

def('cs', { staff: true, async run(ctx) {
  const n = (snipes.get(ctx.channel.id) || []).length;
  snipes.delete(ctx.channel.id);
  const c = await logAction({ type: 'SNIPE_CLEAR', title: 'Snipe History Cleared', color: COLORS.neutral, moderator: ctx.author, action: 'Clear snipe history',
    fields: [{ name: 'Channel', value: `<#${ctx.channel.id}>` }, { name: 'Entries Cleared', value: String(n) }] });
  await success(ctx.message, `Cleared **${n}** stored deleted message(s).`, c.id);
} });

// ---- afk
def('afk', { staff: false, async run(ctx) {
  const reason = trunc(ctx.args.trim() || 'AFK', 200);
  const data = { reason, since: now(), prevNick: ctx.member.nickname ?? null, afkNick: null, nickChanged: false };
  const base = ctx.member.displayName;
  if (ctx.member.manageable && !base.startsWith('[AFK]') && ctx.me.permissions.has(P.ManageNicknames)) {
    const nn = trunc(`[AFK] ${base}`, 32);
    try { await ctx.member.setNickname(nn, 'AFK'); data.afkNick = nn; data.nickChanged = true; } catch { /* ignore */ }
  }
  D.afk[ctx.author.id] = data;
  await db.save();
  await ctx.message.reply({ content: `<@${ctx.author.id}> I set your AFK: ${reason}`, allowedMentions: NO_PING }).catch(() => {});
} });

// ---- dm
def('dm', { staff: true, async run(ctx) {
  const [tok, text] = splitFirst(ctx.args);
  if (!tok || !text) throw usage('dm @user <message>');
  const { user } = await resolveTarget(ctx, tok, { needMember: false, check: false });
  if (user.bot) throw new UserError('I cannot DM bots.');
  const e = new EmbedBuilder().setColor(COLORS.info).setTitle(`Message from ${ctx.guild.name} staff`).setDescription(trunc(text, 4000)).setTimestamp();
  const ok = await safeDM(user, { embeds: [e] });
  const c = await logAction({ type: 'DM', title: 'Direct Message Sent', color: COLORS.info, target: user, moderator: ctx.author, action: 'DM',
    fields: [{ name: 'Delivered', value: ok ? 'Yes' : 'No (DMs closed)' }, { name: 'Message Length', value: `${text.length} characters` }] });
  if (!ok) throw new UserError(`I could not deliver the message to <@${user.id}> (their DMs are closed). Case: ${c.id}`);
  await success(ctx.message, `Message sent to <@${user.id}>.`, c.id);
} });

// ---- say
def('say', { staff: false, ephemeral: true, async run(ctx) {
  if (!ctx.member.permissions.has(P.ManageMessages)) throw new UserError('You need the **Manage Messages** permission to use this command.');
  const text = ctx.args;
  if (!text.trim()) throw usage('say <message>');
  if (text.length > 2000) throw new UserError('Messages cannot exceed 2000 characters.');
  const canEveryone = ctx.member.permissions.has(P.MentionEveryone);
  ignoreDeleted.add(ctx.message.id);
  setTimeout(() => ignoreDeleted.delete(ctx.message.id), 60000);
  await ctx.message.delete().catch(() => {});
  await ctx.channel.send({ content: text, allowedMentions: { parse: canEveryone ? ['users', 'roles', 'everyone'] : ['users'] } });
  await logAction({ type: 'SAY', title: 'Say Command Used', color: COLORS.neutral, moderator: ctx.author, action: 'Say',
    fields: [{ name: 'Channel', value: `<#${ctx.channel.id}>` }, { name: 'Message Length', value: `${text.length} characters` }] });
} });

// ---- appealpanel
def('appealpanel', { staff: true, ephemeral: true, async run(ctx) {
  const ch = await postAppealPanel(true);
  await success(ctx.message, `Appeal panel posted in <#${ch.id}>.`);
} });

// ---- help
def('help', { staff: false, async run(ctx) {
  const fmt = (list) => list.map((c) => `\`${PREFIX}${c}\``).join('\n');
  const e = new EmbedBuilder().setColor(COLORS.info).setTitle('Command List')
    .setDescription('Every command also works as a slash command. Items in [brackets] are optional.')
    .addFields(
      { name: 'Moderation', value: fmt(['warn @user <reason>', 'unwarn @user', 'mute @user [duration] [reason]', 'unmute @user', 'kick @user <reason>', 'ban @user <reason>', 'unban <user ID>', 'nick @user <nickname>', 'unnick @user']) },
      { name: 'Strikes and Jail', value: fmt(['strike @user <reason>', 'unstrike @user <number>', 'jail @user [duration] [reason]', 'unjail @user', 'appealpanel']) },
      { name: 'Channel', value: fmt(['purge <amount>', 'purge human <amount>', 'clean [amount]', 'lock', 'unlock', 'slowmode <seconds>', 'snipe [1-150]', 'cs']) },
      { name: 'Other', value: fmt(['afk [reason]', 'dm @user <message>', 'say <message>', 'help']) },
      { name: 'Pings and Applications (slash only)', value: '`/pings`\n`/open applications` (staff)\n`/close applications` (staff)' },
    );
  await ctx.message.reply({ embeds: [e], allowedMentions: NO_PING });
} });

/* --------------------------- COMMAND DISPATCH ----------------------- */

async function handleCommand(message) {
  const body = message.content.slice(PREFIX.length);
  const m = /^(\S+)/.exec(body);
  if (!m) return;
  const name = m[1].toLowerCase();
  if (!/^[a-z]{1,15}$/.test(name)) return;
  const spec = commands.get(name);
  if (!spec) {
    return tempDelete(await failure(message, `Unknown command: \`${PREFIX}${name}\`. Use \`${PREFIX}help\` for the command list.`), 6000);
  }
  await execute(spec, name, message, body.slice(name.length).replace(/^[ \t]/, ''));
}

async function execute(spec, name, message, args) {
  try {
    const guild = message.guild;
    const member = message.member ?? await guild.members.fetch(message.author.id);
    const me = guild.members.me ?? await guild.members.fetchMe();
    const ctx = { message, guild, member, me, author: message.author, channel: message.channel, args };
    if (spec.staff && !isStaff(member)) throw new UserError('This command is restricted to staff.');
    if (spec.perm && !member.permissions.has(spec.perm)) throw new UserError(`You need the **${spec.permName}** permission to use this command.`);
    await spec.run(ctx);
  } catch (e) {
    if (e instanceof UserError) return void failure(message, e.message);
    console.error(`[CMD] ${name} failed:`, e);
    failure(message, describeApiError(e));
  }
}

/* ---------------------------- SLASH COMMANDS ------------------------ */

const U = 6, S = 3, I = 4, B = 5; // Discord option types: user, string, integer, boolean
const USER = ['user', U, 'User', 1];
const REASON = ['reason', S, 'Reason', 1];
const SLASH = [
  ['warn', 'Warn a user', [USER, REASON]],
  ['unwarn', 'Remove a user\'s most recent active warning', [USER]],
  ['mute', 'Timeout a user (permanent if no duration)', [USER, ['duration', S, 'Examples: 10m, 1h, 1d. Leave empty for permanent', 0], ['reason', S, 'Reason', 0]]],
  ['unmute', 'Remove a user\'s timeout', [USER]],
  ['ban', 'Ban a user', [USER, REASON]],
  ['unban', 'Unban a user by ID', [['user_id', S, 'User ID to unban', 1]]],
  ['kick', 'Kick a user', [USER, REASON]],
  ['strike', 'Give a user a strike', [USER, REASON]],
  ['unstrike', 'Remove an active strike', [USER, ['number', I, 'Strike number (1 = oldest active)', 1, { min_value: 1 }]]],
  ['nick', 'Change a user\'s nickname', [USER, ['nickname', S, 'New nickname', 1, { max_length: 32 }]]],
  ['unnick', 'Reset a user\'s nickname', [USER]],
  ['jail', 'Jail a user (permanent if no duration)', [USER, ['duration', S, 'Examples: 30m, 1h, 1d. Leave empty for permanent', 0], ['reason', S, 'Reason', 0]]],
  ['unjail', 'Release a user from jail', [USER]],
  ['purge', 'Delete recent messages', [['amount', I, 'Number of messages', 1, { min_value: 1, max_value: 1000 }], ['human', B, 'Only delete messages from real users']]],
  ['clean', 'Delete recent bot messages', [['amount', I, 'Amount (default 50)', 0, { min_value: 1, max_value: 100 }]]],
  ['lock', 'Lock this channel'],
  ['unlock', 'Unlock this channel'],
  ['slowmode', 'Set slowmode for this channel', [['seconds', I, 'Seconds (0 disables)', 1, { min_value: 0, max_value: 21600 }]]],
  ['snipe', 'Show a deleted message', [['number', I, 'Which one (1-150, 1 = newest)', 0, { min_value: 1, max_value: 150 }]]],
  ['cs', 'Clear snipe history for this channel'],
  ['afk', 'Set your AFK status', [['reason', S, 'Reason', 0]]],
  ['dm', 'Send a DM to a user as staff', [USER, ['message', S, 'Message to send', 1]]],
  ['say', 'Make the bot send a message', [['message', S, 'Message', 1]]],
  ['appealpanel', 'Post the jail appeal panel in the appeal channel'],
  ['help', 'List all commands'],
];

function slashBody() {
  return [...SLASH.map(([name, description, opts = []]) => ({
    name, description,
    options: opts.map(([n, type, d, req, extra]) => ({ name: n, type, description: d, required: !!req, ...(extra || {}) })),
  })), ...EXTRA_SLASH];
}

async function registerSlashCommands() {
  const appId = process.env.CLIENT_ID || client.user.id;
  const guildId = process.env.GUILD_ID || MAIN_GUILD?.id;
  if (!guildId) { console.warn('[SLASH] GUILD_ID is not set and no guild was found; slash commands not registered.'); return; }
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: slashBody() });
  console.log(`[SLASH] Registered ${SLASH.length + EXTRA_SLASH.length} slash commands in guild ${guildId}.`);
}

function slashArgs(i, slashDef) {
  const parts = [];
  for (const [name, type] of slashDef[2] || []) {
    if (slashDef[0] === 'purge' && name === 'human') continue;
    const o = i.options.get(name);
    if (!o) continue;
    parts.push(type === U ? `<@${o.value}>` : String(o.value));
  }
  if (slashDef[0] === 'purge' && i.options.getBoolean('human')) parts.unshift('human');
  return parts.join(' ');
}

async function handleSlash(i) {
  const spec = commands.get(i.commandName);
  const slashDef = SLASH.find((d) => d[0] === i.commandName);
  if (!spec || !slashDef) return i.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
  if (!i.guild || (MAIN_GUILD && i.guild.id !== MAIN_GUILD.id)) {
    return i.reply({ content: 'This command can only be used in the server.', flags: MessageFlags.Ephemeral });
  }
  await i.deferReply(spec.ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  let replied = false;
  // Adapter so prefix-command handlers work unchanged with interactions.
  const fake = {
    id: i.id, author: i.user, guild: i.guild, channel: i.channel, member: null,
    reply: async (opts) => {
      const o = typeof opts === 'string' ? { content: opts } : opts;
      if (!replied) { replied = true; return i.editReply(o); }
      return i.followUp(o);
    },
    delete: async () => {},
  };
  await execute(spec, i.commandName, fake, slashArgs(i, slashDef));
  if (!replied) await i.deleteReply().catch(() => {});
}

/* ---------------------------- PING ROLES ---------------------------- */

const pingRoleIds = () => PING_CFG.roles.map((r) => r.id);

function pingPanelPayload() {
  const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('Notification Preferences')
    .setDescription([
      'Choose the notifications you actually want to receive.',
      "You will only be pinged for the categories you select, so you don't receive notifications you don't want.",
      '',
      'Click **Choose Your Pings** below to pick one, several or all categories. You can change your choice at any time, either with this button or with `/pings`.',
    ].join('\n'))
    .addFields({
      name: 'Available Categories',
      value: PING_CFG.roles.map((r) => `${r.emoji} **${r.label}** - ${r.description}`).join('\n'),
    });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pings:open').setLabel('Choose Your Pings').setEmoji('🔔').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

function pingMenuPayload(member) {
  const roles = PING_CFG.roles.filter((r) => member.guild.roles.cache.has(r.id));
  if (!roles.length) throw new UserError('The ping roles are not set up correctly. Please contact staff.');
  const menu = new StringSelectMenuBuilder()
    .setCustomId('pings:select')
    .setPlaceholder('Select the categories you want to be pinged for')
    .setMinValues(0)
    .setMaxValues(roles.length)
    .addOptions(roles.map((r) => ({
      label: r.label, value: r.id, description: r.description, emoji: r.emoji, default: member.roles.cache.has(r.id),
    })));
  const embed = new EmbedBuilder().setColor(COLORS.info).setTitle('Choose Your Pings')
    .setDescription('Select every category you want to be notified about. Anything you leave unselected will be removed from you. Selecting nothing removes all ping roles.');
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral };
}

async function showPingMenu(i) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const member = await i.guild.members.fetch(i.user.id);
    const { flags, ...payload } = pingMenuPayload(member);
    await i.editReply(payload);
  } catch (e) {
    if (!(e instanceof UserError)) console.error('[PINGS] Menu failed:', e);
    await i.editReply({ content: e instanceof UserError ? e.message : 'I could not open the ping menu right now. Please try again later.', embeds: [], components: [] });
  }
}

async function handlePingSelect(i) {
  await i.deferUpdate();
  const fail = (text) => i.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setDescription(text)], components: [] });
  try {
    const member = await i.guild.members.fetch(i.user.id);
    const valid = new Set(pingRoleIds());
    const selected = new Set(i.values.filter((v) => valid.has(v)));
    const known = PING_CFG.roles.filter((r) => i.guild.roles.cache.has(r.id));
    const toAdd = known.filter((r) => selected.has(r.id) && !member.roles.cache.has(r.id));
    const toRemove = known.filter((r) => !selected.has(r.id) && member.roles.cache.has(r.id));

    const blocked = [...toAdd, ...toRemove].filter((r) => !i.guild.roles.cache.get(r.id).editable);
    if (blocked.length) {
      console.warn(`[PINGS] Cannot manage role(s): ${blocked.map((r) => r.id).join(', ')}. Check Manage Roles and role position.`);
      return void await fail('I cannot manage one or more of these roles right now. Please contact staff.');
    }
    if (toAdd.length) await member.roles.add(toAdd.map((r) => r.id), 'Ping roles selected');
    if (toRemove.length) await member.roles.remove(toRemove.map((r) => r.id), 'Ping roles deselected');

    const list = (arr) => arr.map((r) => `${r.emoji} ${r.label}`).join('\n') || 'None';
    const current = known.filter((r) => selected.has(r.id));
    const e = new EmbedBuilder().setColor(COLORS.good).setTitle('Ping Preferences Updated')
      .setDescription(toAdd.length || toRemove.length ? 'Your notification preferences have been saved.' : 'No changes were needed. Your preferences are already up to date.')
      .addFields({ name: 'Your Ping Roles', value: list(current) });
    if (toAdd.length) e.addFields({ name: 'Added', value: list(toAdd), inline: true });
    if (toRemove.length) e.addFields({ name: 'Removed', value: list(toRemove), inline: true });
    await i.editReply({ embeds: [e], components: [] });
  } catch (e) {
    console.error('[PINGS] Update failed:', e);
    await fail(describeApiError(e));
  }
}

/* ---------------------------- APPLICATIONS -------------------------- */

const appSessions = new Map(); // userId -> { type } for applications in progress
const NOW_OPEN = () => (D.config.applicationsOpen ?? APP_CFG.defaultOpen);

function appStore() {
  D.applications ??= {};
  const a = D.applications;
  a.submissions ??= {}; // APP-0001 -> submission
  a.active ??= {};      // userId -> { type, startedAt } (applications currently being filled in)
  a.lastSubmit ??= {};  // `${userId}:${type}` -> timestamp
  return a;
}

function applicationPanelPayload() {
  const open = NOW_OPEN();
  const types = Object.entries(APP_CFG.types);
  const embed = new EmbedBuilder().setColor(open ? COLORS.good : COLORS.error).setTitle('Applications')
    .setDescription([
      'Interested in contributing to the server? Select the position you want to apply for below.',
      '',
      `The application consists of **${types[0][1].questions.length} questions** and is completed in your direct messages with the bot. Please make sure your DMs are open, and answer every question honestly and in detail.`,
    ].join('\n'))
    .addFields(
      { name: 'Positions', value: types.map(([, t]) => `**${t.label}** - ${t.description}`).join('\n') },
      { name: 'Status', value: open ? '🟢 Applications are currently **open**.' : '🔴 Applications are currently **closed**.' },
    );
  const row = new ActionRowBuilder().addComponents(types.map(([key, t]) => new ButtonBuilder()
    .setCustomId(`app:start:${key}`).setLabel(t.buttonLabel).setStyle(ButtonStyle.Primary).setDisabled(!open)));
  return { embeds: [embed], components: [row] };
}

async function upsertPanel(channelId, marker, payload, name) {
  const ch = await getChannel(channelId);
  if (!ch || !ch.isTextBased()) { console.warn(`[PANEL] ${name} channel ${channelId} unavailable.`); return null; }
  const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = msgs && [...msgs.values()].find((m) => m.author.id === client.user.id
    && m.components.some((r) => r.components.some((c) => c.customId === marker)));
  try {
    return existing ? await existing.edit(payload) : await ch.send(payload);
  } catch (e) {
    console.error(`[PANEL] Could not post ${name} panel: ${e.message} (need View Channel, Send Messages, Embed Links).`);
    return null;
  }
}

const refreshApplicationPanel = () => upsertPanel(APP_CFG.panelChannel, 'app:start:staff', applicationPanelPayload(), 'Application');

async function setupPanels() {
  for (const r of PING_CFG.roles) {
    if (!MAIN_GUILD?.roles.cache.has(r.id)) console.warn(`[CONFIG] Ping role ${r.label} (${r.id}) was not found.`);
  }
  for (const [name, id] of [['pendingChannel', APP_CFG.pendingChannel], ['acceptedLog', APP_CFG.acceptedLog], ['deniedLog', APP_CFG.deniedLog]]) {
    if (!(await getChannel(id))) console.warn(`[CONFIG] APP_CFG.${name} (${id}) was not found.`);
  }
  for (const t of Object.values(APP_CFG.types)) {
    if (!MAIN_GUILD?.roles.cache.has(t.roleId)) console.warn(`[CONFIG] Role for ${t.label} (${t.roleId}) was not found.`);
  }
  await upsertPanel(PING_CFG.channel, 'pings:open', pingPanelPayload(), 'Ping role');
  await refreshApplicationPanel();
}

function closedEmbed() {
  return new EmbedBuilder().setColor(COLORS.error).setTitle('Applications Closed')
    .setDescription('Applications are currently **closed**. Please check back later; this panel will update when applications reopen.');
}

function buildApplicationEmbeds(sub) {
  const type = APP_CFG.types[sub.type];
  const unixTs = unix(sub.submittedAt);
  const base = () => new EmbedBuilder().setColor(type.color).setTitle(trunc(`${type.label} - ${sub.id}`, 240)).setTimestamp(sub.submittedAt);
  const embeds = [];
  let cur = base().setDescription(`**Applicant:** <@${sub.userId}> (${trunc(sub.userName, 60)})`)
    .addFields(
      { name: 'Applicant', value: `<@${sub.userId}>`, inline: true },
      { name: 'Discord ID', value: `\`${sub.userId}\``, inline: true },
      { name: 'Application Type', value: type.label, inline: true },
      { name: 'Submission Time', value: `<t:${unixTs}:F> (<t:${unixTs}:R>)` },
    );
  cur.setDescription(null);
  if (sub.avatar) cur.setThumbnail(sub.avatar);
  let size = 400;
  sub.answers.forEach((a, n) => {
    const name = trunc(`${n + 1}. ${type.questions[n]}`, 256);
    const value = trunc(a, 1024);
    if (size + name.length + value.length > 4800) { embeds.push(cur); cur = base(); size = 100; }
    cur.addFields({ name, value });
    size += name.length + value.length;
  });
  embeds.push(cur);
  if (embeds.length > 1) embeds.forEach((e, n) => e.setFooter({ text: `Part ${n + 1} of ${embeds.length} | Applicant ID: ${sub.userId}` }));
  else embeds[0].setFooter({ text: `Applicant ID: ${sub.userId}` });
  return embeds;
}

async function startApplication(i, typeKey) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const type = APP_CFG.types[typeKey];
  if (!type) return i.editReply('That application type no longer exists.');
  if (!NOW_OPEN()) return i.editReply({ embeds: [closedEmbed()] });
  const user = i.user;
  const store = appStore();
  if (appSessions.has(user.id) || store.active[user.id]) return i.editReply('You already have an application in progress. Check your direct messages, or type "cancel" there to stop it.');
  if (sessions.has(user.id)) return i.editReply('You currently have a jail appeal in progress. Finish or cancel it before starting an application.');
  const last = store.lastSubmit[`${user.id}:${typeKey}`];
  if (last && now() - last < APP_CFG.cooldownMs) {
    return i.editReply(`You have already submitted a ${type.label} recently. You can apply again <t:${unix(last + APP_CFG.cooldownMs)}:R>.`);
  }
  appSessions.set(user.id, { type: typeKey }); // reserve immediately so double clicks cannot start two sessions
  let dm;
  try {
    dm = await user.createDM();
    await dm.send({ embeds: [new EmbedBuilder().setColor(type.color).setTitle(type.label)
      .setDescription(`You will be asked **${type.questions.length} questions**. Please answer each one seriously, honestly and in detail (at least ${APP_CFG.minAnswer} characters).\n\nType **cancel** at any time to stop. If you do not reply within 15 minutes, the application will time out.`)] });
  } catch {
    appSessions.delete(user.id);
    return i.editReply('I could not send you a direct message. Enable DMs from server members and click the button again.');
  }
  store.active[user.id] = { type: typeKey, startedAt: now() };
  await db.save();
  await i.editReply('I have sent you a direct message to begin your application.');
  runApplication(user, dm, typeKey).catch((e) => console.error('[APPLICATION]', e));
}

async function runApplication(user, dm, typeKey) {
  const type = APP_CFG.types[typeKey];
  const total = type.questions.length;
  const answers = [];
  try {
    for (let q = 0; q < total; q++) {
      await dm.send({ embeds: [new EmbedBuilder().setColor(type.color).setTitle(`${type.label} - Question ${q + 1} of ${total}`)
        .setDescription(type.questions[q]).setFooter({ text: 'Reply with your answer in this chat. Type "cancel" to stop.' })] });
      let a;
      for (;;) {
        a = await askAnswer(dm, user);
        if (a === null || a === CANCEL) break;
        if (a.length < APP_CFG.minAnswer) { await dm.send(`Please give a more detailed answer (at least ${APP_CFG.minAnswer} characters) and send it again.`); continue; }
        break;
      }
      if (a === null) return void await dm.send('Your application timed out. Click the application button in the server to start again.');
      if (a === CANCEL) return void await dm.send('Your application has been cancelled. Nothing was submitted.');
      answers.push(a);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('appdm:submit').setLabel('Submit Application').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('appdm:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );
    const prompt = await dm.send({
      embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('Ready to Submit')
        .setDescription(`You have answered all ${total} questions. Submit your **${type.label}** now? You cannot edit it after submitting.`)],
      components: [row],
    });
    let btn;
    try {
      btn = await prompt.awaitMessageComponent({ filter: (c) => c.user.id === user.id, time: APP_CFG.confirmTimeoutMs });
    } catch {
      await prompt.edit({ components: [] }).catch(() => {});
      return void await dm.send('Your application timed out before it was submitted. Click the application button in the server to start again.');
    }
    if (btn.customId === 'appdm:cancel') {
      await btn.update({ components: [] });
      return void await dm.send('Your application has been cancelled. Nothing was submitted.');
    }
    await btn.update({ components: [] });
    if (!appStore().active[user.id]) return; // session was invalidated

    const sub = await submitApplication(user, typeKey, answers);
    if (sub.delivered) {
      await dm.send({ embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Application Submitted')
        .setDescription(`Your **${type.label}** has been submitted. Application ID: **${sub.id}**. The staff team will review it as soon as possible.`)] });
    } else {
      await dm.send('Your application was saved, but I could not deliver it to the review channel. Please contact a staff member and mention your application ID: **' + sub.id + '**.');
    }
  } catch (e) {
    console.error('[APPLICATION] Error:', e);
    await safeDM(user, 'An error occurred while processing your application. Please try again later.');
  } finally {
    appSessions.delete(user.id);
    delete appStore().active[user.id];
    await db.save();
  }
}

async function submitApplication(user, typeKey, answers) {
  const type = APP_CFG.types[typeKey];
  const store = appStore();
  D.counters.application = (D.counters.application || 0) + 1;
  const sub = {
    id: `APP-${pad(D.counters.application)}`, userId: user.id, userName: userName(user), avatar: user.displayAvatarURL(),
    type: typeKey, answers, submittedAt: now(), delivered: false, status: 'pending', reviewChannelId: APP_CFG.pendingChannel, reviewMessageIds: [],
  };
  store.submissions[sub.id] = sub;
  store.lastSubmit[`${user.id}:${typeKey}`] = sub.submittedAt;
  await db.save();
  try {
    const ch = await getChannel(APP_CFG.pendingChannel);
    if (!ch || !ch.isTextBased()) throw new Error(`Pending channel ${APP_CFG.pendingChannel} unavailable.`);
    const embeds = buildApplicationEmbeds(sub);
    for (const [n, embed] of embeds.entries()) {
      const payload = { embeds: [embed], allowedMentions: NO_PING };
      if (n === embeds.length - 1) payload.components = [reviewRow(sub.id)]; // buttons sit under the last part
      const msg = await ch.send(payload);
      sub.reviewMessageIds.push(msg.id);
    }
    sub.delivered = true;
  } catch (e) {
    console.error(`[APPLICATION] Delivery of ${sub.id} failed:`, e.message);
  }
  await db.save();
  return sub;
}

async function recoverApplications() {
  const store = appStore();
  const stale = Object.keys(store.active);
  if (!stale.length) return;
  store.active = {}; // sessions cannot survive a restart
  await db.save();
  for (const uid of stale) {
    const user = await client.users.fetch(uid).catch(() => null);
    if (user) await safeDM(user, { embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Application Interrupted')
      .setDescription('The bot restarted while you were filling in your application, so it was cancelled and nothing was submitted. Please click the application button in the server to start again.')] });
  }
}

/* ------------------------ APPLICATION REVIEW ------------------------ */

const reviewRow = (appId) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`appreview:accept:${appId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId(`appreview:deny:${appId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
);

async function handleApplicationReview(i, action, appId) {
  const reply = (content) => i.reply({ content, flags: MessageFlags.Ephemeral });
  const reviewer = await i.guild.members.fetch(i.user.id).catch(() => null);
  if (!reviewer || !APP_CFG.reviewerRoles.some((r) => reviewer.roles.cache.has(r))) {
    return reply('You do not have permission to review applications.');
  }
  const store = appStore();
  const sub = store.submissions[appId];
  if (!sub) return reply('That application no longer exists.');
  if ((sub.status ?? 'pending') !== 'pending') return reply(`This application was already handled (${sub.status}).`);
  if (sub.userId === i.user.id) return reply('You cannot review your own application.');
  const type = APP_CFG.types[sub.type];
  if (!type) return reply('That application type no longer exists.');
  const accepted = action === 'accept';

  await i.deferUpdate();
  if ((sub.status ?? 'pending') !== 'pending') return void i.followUp({ content: `This application was already handled (${sub.status}).`, flags: MessageFlags.Ephemeral });
  sub.status = 'processing'; // lock against double clicks while roles are being applied

  const fail = (text) => {
    sub.status = 'pending';
    return i.followUp({ content: text, flags: MessageFlags.Ephemeral });
  };

  if (accepted) {
    try {
      const role = i.guild.roles.cache.get(type.roleId);
      if (!role) return void await fail('The role for this application type was not found. Check `roleId` in the configuration.');
      if (!role.editable) return void await fail(`I cannot assign <@&${role.id}>. Make sure I have Manage Roles and my role is above it.`);
      const applicant = await i.guild.members.fetch(sub.userId).catch(() => null);
      if (!applicant) return void await fail('The applicant is no longer in the server, so the role could not be given. The application is still pending.');
      await applicant.roles.add(role.id, `${type.label} ${sub.id} accepted by ${i.user.username}`);
    } catch (e) {
      console.error('[APPLICATION] Accept failed:', e);
      return void await fail(`Could not accept the application: ${describeApiError(e)}`);
    }
  }

  sub.status = accepted ? 'accepted' : 'denied';
  sub.reviewedBy = i.user.id;
  sub.reviewedAt = now();
  await db.save();

  const decided = unix(sub.reviewedAt);
  const label = accepted ? 'Accepted' : 'Denied';
  const color = accepted ? COLORS.good : COLORS.error;

  // Update the pending message: remove buttons and show the decision.
  try {
    const embed = EmbedBuilder.from(i.message.embeds[i.message.embeds.length - 1]).setColor(color)
      .addFields({ name: 'Decision', value: `**${label}** by <@${i.user.id}> on <t:${decided}:F>` });
    await i.editReply({ embeds: [embed], components: [] });
  } catch (e) { console.error('[APPLICATION] Could not update review message:', e.message); }

  // Decision log.
  const log = new EmbedBuilder().setColor(color).setTitle(`${type.label} ${label}`).setTimestamp(sub.reviewedAt)
    .addFields(
      { name: 'Applicant', value: `<@${sub.userId}> (${trunc(sub.userName, 60)})`, inline: true },
      { name: 'Discord ID', value: `\`${sub.userId}\``, inline: true },
      { name: 'Application ID', value: sub.id, inline: true },
      { name: 'Application Type', value: type.label, inline: true },
      { name: 'Reviewed By', value: `<@${i.user.id}> (${userName(i.user)})`, inline: true },
      { name: 'Submitted', value: `<t:${unix(sub.submittedAt)}:F>`, inline: true },
      { name: 'Decision Time', value: `<t:${decided}:F>`, inline: true },
    );
  if (accepted) log.addFields({ name: 'Role Granted', value: `<@&${type.roleId}>`, inline: true });
  await sendLog(accepted ? APP_CFG.acceptedLog : APP_CFG.deniedLog, { embeds: [log], allowedMentions: NO_PING });

  // Tell the applicant what happens next.
  const dmOk = await safeDM(await client.users.fetch(sub.userId).catch(() => ({ send: async () => { throw new Error('no user'); } })), {
    embeds: [new EmbedBuilder().setColor(color).setTitle(`${type.label} ${label}`)
      .setDescription(accepted
        ? `Congratulations! Your **${type.label}** (${sub.id}) has been **accepted** and you have been given the **${i.guild.roles.cache.get(type.roleId)?.name ?? 'new'}** role.\n\n**What to do next:**\n${type.acceptedSteps.map((s, n) => `${n + 1}. ${s}`).join('\n')}`
        : `Thank you for applying. After review, your **${type.label}** (${sub.id}) was **not accepted** at this time.\n\n**What you can do next:**\n${type.deniedSteps.map((s, n) => `${n + 1}. ${s}`).join('\n')}`)
      .setTimestamp()],
  });
  if (!dmOk) await i.followUp({ content: 'The decision was saved, but I could not DM the applicant (their DMs are closed).', flags: MessageFlags.Ephemeral }).catch(() => {});
}

/* ------------------------ NEW SLASH COMMANDS ------------------------ */

const EXTRA_SLASH = [
  { name: 'pings', description: 'Choose which ping roles you want to receive' },
  { name: 'open', description: 'Open something for members', options: [{ type: 1, name: 'applications', description: 'Allow members to submit applications' }] },
  { name: 'close', description: 'Close something for members', options: [{ type: 1, name: 'applications', description: 'Stop members from starting new applications' }] },
];

// Returns true if the interaction was one of the new commands.
async function handleNewSlash(i) {
  if (!EXTRA_SLASH.some((c) => c.name === i.commandName)) return false;
  if (!i.guild || (MAIN_GUILD && i.guild.id !== MAIN_GUILD.id)) {
    await i.reply({ content: 'This command can only be used in the server.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (i.commandName === 'pings') { await showPingMenu(i); return true; }

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const member = await i.guild.members.fetch(i.user.id);
    if (!isStaff(member)) throw new UserError('This command is restricted to staff.');
    if (i.options.getSubcommand() !== 'applications') throw new UserError('Unknown subcommand.');
    const open = i.commandName === 'open';
    if (NOW_OPEN() === open) throw new UserError(`Applications are already ${open ? 'open' : 'closed'}.`);
    D.config.applicationsOpen = open;
    D.config.applicationsChangedBy = i.user.id;
    D.config.applicationsChangedAt = now();
    await db.save();
    await refreshApplicationPanel().catch((e) => console.error('[PANEL] Refresh failed:', e.message));
    await i.editReply({ embeds: [new EmbedBuilder().setColor(open ? COLORS.good : COLORS.error)
      .setDescription(open ? 'Applications are now **open**. Members can submit applications.' : 'Applications are now **closed**. Members cannot start new applications. Applications already in progress may still be completed.')] });
    await sendLog(CFG.mainLog, { embeds: [new EmbedBuilder().setColor(COLORS.neutral).setTitle(`Applications ${open ? 'Opened' : 'Closed'}`)
      .addFields({ name: 'Staff Member', value: `<@${i.user.id}> (${userName(i.user)})` }).setTimestamp()], allowedMentions: NO_PING });
  } catch (e) {
    if (!(e instanceof UserError)) console.error('[APPLICATION] Toggle failed:', e);
    await i.editReply({ embeds: [new EmbedBuilder().setColor(COLORS.error).setDescription(e instanceof UserError ? e.message : describeApiError(e))] }).catch(() => {});
  }
  return true;
}

/* ------------------------------ SCHEDULER --------------------------- */

let ticking = false;

async function expireJails(guild) {
  for (const [uid, j] of Object.entries(D.jails)) {
    if (!j.active || !j.expiresAt || j.expiresAt > now()) continue;
    try {
      const res = await releaseJail(guild, uid, 'Jail duration expired');
      const user = await client.users.fetch(uid).catch(() => ({ id: uid, username: 'Unknown' }));
      const c = await newCase({ type: 'UNJAIL', targetId: uid, modId: client.user.id, reason: 'Jail duration expired', extra: { auto: true, jailCase: j.caseId } });
      await postLog(c, { title: 'Jail Expired', color: COLORS.good, target: user, moderator: client.user, action: 'Unjail (automatic)', reason: 'Jail duration expired',
        fields: [{ name: 'Original Case', value: j.caseId || 'N/A' }, { name: 'Roles Restored', value: String(res.restored) }] });
      if (user.send) await safeDM(user, { embeds: [dmEmbed(guild, { title: 'Your jail has expired', color: COLORS.good, reason: 'Your roles have been restored.', caseId: c.id })] });
    } catch (e) {
      console.error(`[TICK] Jail release failed for ${uid}:`, e);
      if (!j.releaseFailed) {
        j.releaseFailed = true;
        await db.save();
        await sendLog(CFG.mainLog, { embeds: [new EmbedBuilder().setColor(COLORS.error).setTitle('Jail Release Failed')
          .setDescription(`Automatic release failed for <@${uid}>. I will keep retrying. Check my permissions and role position.`).setTimestamp()] });
      }
    }
  }
}

async function expireMutes(guild) {
  for (const [uid, m] of Object.entries(D.mutes)) {
    if (!m.active) continue;
    if (m.permanent) {
      // Permanent mute: keep renewing Discord's 28-day timeout until unmuted.
      const member = await guild.members.fetch(uid).catch(() => null);
      if (!member) continue;
      const until = member.communicationDisabledUntilTimestamp;
      if (!until || until <= now()) { m.active = false; m.endedAt = now(); await db.save(); continue; } // removed manually
      if (until - now() < 2 * 864e5) await member.timeout(MAX_TIMEOUT_MS, 'Permanent mute renewal').catch((e) => console.error('[TICK] Mute renewal failed:', e.message));
      continue;
    }
    if (m.expiresAt > now()) continue;
    m.active = false;
    m.endedAt = now();
    await db.save();
    const user = await client.users.fetch(uid).catch(() => ({ id: uid, username: 'Unknown' }));
    await postLog(D.cases[m.caseId] || { id: m.caseId }, { title: 'Mute Expired', color: COLORS.good, target: user, moderator: client.user, action: 'Unmute (automatic)', reason: 'Mute duration expired' });
  }
}

async function expireStrikes(guild) {
  const expired = D.strikes.filter((s) => s.active && s.expiresAt <= now());
  if (!expired.length) return;
  const users = new Set();
  for (const s of expired) { s.active = false; s.removedAt = now(); s.removedReason = 'expired'; users.add(s.userId); }
  await db.save();
  
