// npm run log-time: work out time spent per session and fill LOG.md's three time columns.
//
//   Claude min: time Claude spent working on any prompt (prompt arrives -> Claude finishes).
//   you min:    time from Claude finishing to the user's next message, when that gap is
//               20 minutes or less (a longer gap means the user was away).
//   total min:  both together: the real time spent on the task.
// Sessions that ran at the same time count that time once. Shared time goes to whichever
// session started first, so the rows add up to the totals line.
//
// Each session's intervals live in timelog/<row>.json (one file per session, so parallel
// sessions never conflict). Usage:
//   npm run log-time -- --row="A1 spacing and targeting"      record this session from its local transcript
//   npm run log-time -- --row="0 setup" --events=dump.txt     record from saved list_events (kinds: result) output
//   npm run log-time                                          just recompute LOG.md
// One session that worked on several items: add --since=<ISO time> / --until=<ISO time>
// (the prompt that started each item) so each row gets only its own turns.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const USER_GAP_MAX_MS = 20 * 60 * 1000;
const DIR = 'timelog';
const LOG = 'LOG.md';
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// Turns -> intervals. turns: [{ start, end, byUser }] in ms, sorted. A user gap is the
// time between one turn ending and the next one the user started, if short enough.
function intervalsFromTurns(turns) {
  const claude = turns.map((t) => [t.start, Math.max(t.start, t.end)]);
  const user = [];
  for (let i = 1; i < turns.length; i++) {
    const gap = turns[i].start - turns[i - 1].end;
    if (turns[i].byUser && gap > 0 && gap <= USER_GAP_MAX_MS) user.push([turns[i - 1].end, turns[i].start]);
  }
  return { claude, user };
}

// This session's own transcript (Claude Code writes one .jsonl per session).
function turnsFromTranscript(path) {
  const entries = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.timestamp);
  const isPrompt = (e) => {
    if (e.type !== 'user' || e.isMeta || e.isSidechain) return false;
    const c = e.message?.content;
    if (typeof c === 'string') return true;
    return Array.isArray(c) && c.length > 0 && c.every((b) => b.type === 'text');
  };
  const text = (e) => (typeof e.message.content === 'string' ? e.message.content : e.message.content.map((b) => b.text).join(''));
  const turns = [];
  let working = false; // between a prompt and the stop that ends Claude's turn
  for (const e of entries) {
    const t = Date.parse(e.timestamp);
    const last = turns[turns.length - 1];
    if (isPrompt(e)) {
      if (working) continue; // a message sent while Claude was still working joins that turn
      // Background-task wakeups are Claude's time, not a reply from the user.
      const byUser = !/^\s*<(task-notification|system-reminder|wake)/.test(text(e));
      turns.push({ start: t, end: t, byUser });
      working = true;
    } else if (last && working && (e.type === 'assistant' || e.type === 'user' || e.type === 'system')) {
      last.end = Math.max(last.end, t);
      if (e.type === 'system' && e.subtype === 'stop_hook_summary') working = false;
    }
  }
  return turns;
}

// Saved output of list_events (kinds: ["result"]) for a session in another container.
function turnsFromEvents(paths) {
  const turns = [];
  for (const p of paths) {
    const s = readFileSync(p, 'utf8');
    const data = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
    for (const e of data.ccr?.data ?? data.data ?? []) {
      const r = e.result?.internal_anthropic_catchall ?? e.result;
      if (!r) continue;
      const end = Date.parse(e.created_at);
      const start = r.user_message_server_received_wall_ms ?? end - (r.duration_ms ?? 0);
      turns.push({ start, end, byUser: r.origin?.kind !== 'task' });
    }
  }
  return turns.sort((a, b) => a.start - b.start);
}

function newestTranscript() {
  const dir = join(homedir(), '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const slug = (row) => row.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const iso = (ms) => new Date(ms).toISOString();

// Record a session.
const row = arg('row');
if (row) {
  const events = arg('events');
  const turns = events ? turnsFromEvents(events.split(',')) : turnsFromTranscript(arg('transcript') ?? newestTranscript());
  const since = arg('since') ? Date.parse(arg('since')) : -Infinity;
  const until = arg('until') ? Date.parse(arg('until')) : Infinity;
  if (!turns.length) throw new Error('no turns found');
  // A reply gap belongs to the item of the prompt it ends in.
  const all = intervalsFromTurns(turns);
  const claude = all.claude.filter(([a]) => a >= since && a < until);
  const user = all.user.filter(([, b]) => b >= since && b < until);
  mkdirSync(DIR, { recursive: true });
  const rec = { row, session: arg('session') ?? null, claude: claude.map((i) => i.map(iso)), user: user.map((i) => i.map(iso)) };
  writeFileSync(join(DIR, `${slug(row)}.json`), JSON.stringify(rec, null, 1) + '\n');
  console.log(`Recorded ${claude.length} turns for "${row}"`);
}

// Recompute. Sweep every moment across all sessions; each moment counts once.
const recs = existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
  : [];
const parse = (list) => list.map(([a, b]) => [Date.parse(a), Date.parse(b)]);
const sessions = recs.map((r) => ({ row: r.row, claude: parse(r.claude), user: parse(r.user) }));
for (const s of sessions) s.first = Math.min(...s.claude.map((i) => i[0]), ...s.user.map((i) => i[0]));
sessions.sort((a, b) => a.first - b.first);

function attribute(pick) {
  const per = new Map(sessions.map((s) => [s.row, 0]));
  const cuts = [...new Set(sessions.flatMap((s) => pick(s).flat()))].sort((a, b) => a - b);
  let union = 0;
  for (let i = 0; i + 1 < cuts.length; i++) {
    const [a, b] = [cuts[i], cuts[i + 1]];
    const owner = sessions.find((s) => pick(s).some(([x, y]) => x <= a && y >= b)); // earliest session active here
    if (!owner) continue;
    per.set(owner.row, per.get(owner.row) + (b - a));
    union += b - a;
  }
  return { per, union };
}
const claude = attribute((s) => s.claude);
const user = attribute((s) => s.user);
const total = attribute((s) => [...s.claude, ...s.user]);
const min = (ms) => String(Math.round(ms / 60000));

const lines = readFileSync(LOG, 'utf8').split('\n');
const out = [];
let headerSeen = false;
for (const line of lines) {
  if (line.startsWith('<!-- time-totals')) continue;
  const cols = line.split(' | ');
  if (!headerSeen && line.startsWith('date | session')) {
    headerSeen = true;
    out.push(`<!-- time-totals: written by npm run log-time -->All sessions: **${min(total.union)} min** in total (Claude ${min(claude.union)} min, you ${min(user.union)} min). Time when several sessions ran at once is counted once.`);
    out.push('');
    cols.splice(4, 3, 'Claude min', 'you min', 'total min');
    out.push(cols.join(' | '));
    continue;
  }
  if (headerSeen && /^\d{4}-\d\d-\d\d \| /.test(line) && cols.length >= 12) {
    const name = cols[1].trim();
    cols.splice(4, 3, ...(total.per.has(name) ? [claude.per.get(name), user.per.get(name), total.per.get(name)].map(min) : ['not logged', 'not logged', 'not logged']));
    out.push(cols.join(' | '));
    continue;
  }
  out.push(line);
}
// Drop the blank line left behind by the previous totals line.
writeFileSync(LOG, out.join('\n').replace(/\n\n\n+/g, '\n\n'));
console.log(`All sessions: ${min(total.union)} min total (Claude ${min(claude.union)}, you ${min(user.union)})`);
for (const s of sessions) console.log(`  ${s.row}: Claude ${min(claude.per.get(s.row))}, you ${min(user.per.get(s.row))}, total ${min(total.per.get(s.row))}`);
