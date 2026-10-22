import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type {
  Account,
  Activity,
  Article,
  Breakdown,
  Call,
  Detail,
  DocIndex,
  DocPart,
  DocSection,
  DocText,
  DocView,
  Feed,
  FileOp,
  Files,
  FileView,
  Git,
  Harness,
  HarnessItem,
  HarnessScope,
  Hook,
  Info,
  Limit,
  NewsView,
  Used,
} from '../types'

const PANE = 'status-panel'
const TITLE = 'Status'
const COLUMNS = 41
const BEAT_MS = 5000
const BRIGHT_MAGENTA = '#e58cf5'
const BRIGHT_BLUE = '#7ab8ff'

const info = atom({ plugin: 'status-panel', key: 'info' } as const, null)
const EMPTY: Activity = { calls: [], counts: {}, total: 0 }
const activity = atom({ plugin: 'status-panel', key: 'activity' } as const, EMPTY)
const tab = atom({ plugin: 'status-panel', key: 'tab' } as const, 'tab1')
const scope = atom({ plugin: 'status-panel', key: 'scope' } as const, 'global')
const kind = atom({ plugin: 'status-panel', key: 'kind' } as const, 'memory')
const NO_USE: Used = { memory: {}, agents: {}, skills: {}, mcp: {}, hooks: {} }
const used = atom({ plugin: 'status-panel', key: 'used' } as const, NO_USE)
const page = atom({ plugin: 'status-panel', key: 'page' } as const, 0)
const detail = atom({ plugin: 'status-panel', key: 'detail' } as const, null)

const DOC_CHARS = 60000
const PREVIEW_CHARS = 300
const DETAIL_ROWS = 24
const HOOK_ROWS = 16
const INDENT_MAX = 8
const ALL = '*'
const LIST_ROWS = 10

type Tab = { id: string; label: string }

const HARNESS_TAB = 'tab6'
const FILES_TAB = 'tab7'
const NEWS_TAB = 'tab8'
const DOCS_TAB = 'tab10'

// Status, git, the calendar, the harness (what the user's `~/.claude` and the
// project set up, and what the session did with it), news from a few feeds,
// the project's files with what the agent did to each, and Claude Code's
// documentation in Korean.
const TABS: readonly Tab[] = [
  { id: 'tab1', label: '상태' },
  { id: 'tab2', label: 'Git' },
  { id: 'tab5', label: '달력' },
  { id: HARNESS_TAB, label: '하네스' },
  { id: NEWS_TAB, label: '뉴스' },
  { id: FILES_TAB, label: '파일' },
  { id: DOCS_TAB, label: '문서' },
]

// Inside the harness tab: a row of scopes, then a row of kinds. After the two
// scopes come what this session used (of either scope or of neither) and its
// activity (tool calls and agents), which has no kinds.
const SCOPES: readonly (Tab & { id: keyof Harness | 'used' | 'activity' })[] = [
  { id: 'global', label: '글로벌' },
  { id: 'project', label: '로컬' },
  { id: 'used', label: '사용됨' },
  { id: 'activity', label: '활동' },
]

const SECTIONS: readonly (Tab & { id: keyof HarnessScope; title: string })[] = [
  { id: 'memory', label: 'CLAUDE', title: 'CLAUDE.md' },
  { id: 'agents', label: 'Agent', title: 'SubAgent' },
  { id: 'skills', label: 'Skill', title: 'Skills' },
  { id: 'mcp', label: 'MCP', title: 'MCP' },
  { id: 'hooks', label: 'Hook', title: 'Hook' },
]

const colorForLeft = (left: number) =>
  left > 50 ? 'green' : left > 20 ? 'yellow' : 'red'

// Cells a text takes on a terminal: Hangul and other wide forms take two.
const cells = (text: string) =>
  [...text].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1), 0)

// Cuts a text to the room it has, keeping its end (a path) or its start.
const fit = (text: string, room: number, keep: 'start' | 'end') => {
  if (cells(text) <= room) {
    return text
  }

  const chars = keep === 'start' ? [...text] : [...text].reverse()
  const kept: string[] = []
  let used = 1

  for (const char of chars) {
    used += cells(char)

    if (used > room) {
      break
    }

    kept.push(char)
  }

  return keep === 'start' ? `${kept.join('')}…` : `…${kept.reverse().join('')}`
}

const two = (n: number) => String(n).padStart(2, '0')

const resetLine = (limit: Limit | undefined, now: number) => {
  if (limit?.resetsAt === undefined) {
    return null
  }

  const at = new Date(limit.resetsAt)
  const left = Math.floor((at.getTime() - now) / 1000)
  const when = `${two(at.getMonth() + 1)}/${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`

  if (left <= 0) {
    return { text: `초기화 ${when}`, color: 'blue', at, eta: '' }
  }

  const days = Math.floor(left / 86400)
  const hours = Math.floor((left % 86400) / 3600)
  const eta = days > 0 ? `${days}d ${hours}h` : `${hours}h`
  const color = left > 172800 ? 'blue' : left > 43200 ? 'yellow' : 'red'

  return { text: `초기화 ${when} (${eta} 후)`, color, at, eta }
}

// Seven-segment digits in box-drawing strokes, three cells by three rows.
const DIGITS: Record<string, readonly [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['  ╻', '  ┃', '  ╹'],
  '2': ['╺━┓', '┏━┛', '┗━╸'],
  '3': ['╺━┓', '╺━┫', '╺━┛'],
  '4': ['╻ ╻', '┗━┫', '  ╹'],
  '5': ['┏━╸', '┗━┓', '╺━┛'],
  '6': ['┏━╸', '┣━┓', '┗━┛'],
  '7': ['╺━┓', '  ┃', '  ╹'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '╺━┛'],
}

// Two digits side by side, as the three rows that draw them.
const bigDigits = (pair: string) =>
  [0, 1, 2].map(line => [...pair].map(digit => DIGITS[digit]?.[line] ?? '   ').join(' '))

const COLON = ['•', ' ', '•'] as const
const FACE_CELLS = 17

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A rate-limit window's name as /usage prints it; a window it does not know
// (a per-model week, a gateway's spend limit) is named from its kind.
const limitName = (kind: string) =>
  kind === 'five_hour'
    ? 'Current session'
    : kind === 'seven_day'
      ? 'Current week (all models)'
      : kind.startsWith('seven_day_')
        ? `Current week (${kind.slice('seven_day_'.length).replaceAll('_', ' ')})`
        : kind.replaceAll('_', ' ')

const timeZone = () => {
  try {
    return ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
  } catch {
    return ''
  }
}

// `Resets 12am (Asia/Seoul)` today, `Resets Oct 13 at 8am (Asia/Seoul)` after.
const resetsLabel = (resetsAt: string, now: number) => {
  const at = new Date(resetsAt)
  const today = new Date(now)
  const hour = `${at.getHours() % 12 || 12}${at.getMinutes() === 0 ? '' : `:${two(at.getMinutes())}`}${at.getHours() < 12 ? 'am' : 'pm'}`
  const isSameDay =
    at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()

  return isSameDay
    ? `Resets ${hour}${timeZone()}`
    : `Resets ${MONTHS[at.getMonth()] ?? ''} ${at.getDate()} at ${hour}${timeZone()}`
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const dayLabel = (at: Date) =>
  `${two(at.getMonth() + 1)}/${two(at.getDate())} (${WEEKDAYS[at.getDay()] ?? ''})`

type Day = { day: number; isToday: boolean; isReset: boolean; isNextMonth: boolean }

// This month in weeks from Sunday; a reset in the next month adds that
// month's days up to the end of the reset's week, so it is always on the grid.
const calendarWeeks = (today: Date, reset: Date | null) => {
  const year = today.getFullYear()
  const month = today.getMonth()
  const lead = new Date(year, month, 1).getDay()
  const length = new Date(year, month + 1, 0).getDate()
  const next = new Date(year, month + 1, 1)
  const isResetNext =
    reset !== null && reset.getFullYear() === next.getFullYear() && reset.getMonth() === next.getMonth()
  const isResetHere = reset !== null && reset.getFullYear() === year && reset.getMonth() === month
  const cells: (Day | null)[] = Array.from({ length: lead }, () => null)

  for (let day = 1; day <= length; day += 1) {
    cells.push({
      day,
      isToday: day === today.getDate(),
      isReset: isResetHere && day === reset.getDate(),
      isNextMonth: false,
    })
  }

  if (isResetNext) {
    const last = reset.getDate() + (6 - reset.getDay())

    for (let day = 1; day <= last; day += 1) {
      cells.push({ day, isToday: false, isReset: day === reset.getDate(), isNextMonth: true })
    }
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7))
}

const effortColor = (effort: string) =>
  ({ low: 'gray', medium: 'green', high: 'yellow', xhigh: BRIGHT_MAGENTA, max: 'red' })[effort] ?? 'cyan'

let effort = ''
let breakdown: Breakdown | null = null
let git: Git | null = null
let branch = ''
let home = ''
let account: Account | null = null
let harness: Harness | null = null

const readHome = async ($: EngineInterface) => {
  if (home === '') {
    home = (await $.env.get('HOME')) ?? ''
  }

  return home
}

// The signed-in account, as `claude auth status` reports it.
const readAccount = async ($: EngineInterface): Promise<Account | null> => {
  try {
    const ran = await $.process.run(['claude', 'auth', 'status'], { timeoutMs: 10000 })
    const raw = JSON.parse(ran.stdout) as { loggedIn?: boolean; email?: string; subscriptionType?: string }

    if (raw.loggedIn !== true) {
      return { error: '로그인되어 있지 않습니다' }
    }

    return { email: raw.email ?? '(알 수 없음)', plan: raw.subscriptionType }
  } catch {
    return account
  }
}

const accountLine = (one: Account) =>
  'error' in one ? one.error : `${one.email}${one.plan === undefined ? '' : ` (${one.plan})`}`

const readBranch = async ($: EngineInterface, cwd: string) => {
  try {
    if ((await $.session.repo()) === null) {
      return ''
    }

    const head = await $.process.run(['git', '-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 3000 })
    const name = head.exitCode === 0 ? head.stdout.trim() : ''

    if (name !== 'HEAD') {
      return name
    }

    const short = await $.process.run(['git', '-C', cwd, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 3000 })

    return short.exitCode === 0 ? short.stdout.trim() : ''
  } catch {
    return ''
  }
}

// `git status --porcelain=v2 --branch` and `git diff --numstat HEAD`, as counts.
const parseGit = (status: string, numstat: string): Git => {
  const found: Git = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    added: 0,
    deleted: 0,
    ahead: 0,
    behind: 0,
    files: [],
    branches: [],
    commits: [],
  }

  for (const line of status.split('\n')) {
    const ab = /^# branch\.ab \+(\d+) -(\d+)/.exec(line)

    if (ab !== null) {
      found.ahead = Number(ab[1])
      found.behind = Number(ab[2])
    } else if (line.startsWith('? ')) {
      found.untracked += 1
      found.files.push({ code: '??', path: line.slice(2) })
    } else if (/^[12u] /.test(line)) {
      const code = line.slice(2, 4)
      const fields = line.startsWith('2 ') ? 9 : line.startsWith('u ') ? 10 : 8
      const path = (line.split(' ').slice(fields).join(' ').split('\t')[0] ?? '').trim()

      found.staged += code[0] === '.' ? 0 : 1
      found.unstaged += code[1] === '.' ? 0 : 1
      found.files.push({ code: code.replaceAll('.', ' '), path })
    }
  }

  for (const line of numstat.split('\n')) {
    const [added, deleted] = line.split('\t')

    found.added += Number(added) || 0
    found.deleted += Number(deleted) || 0
  }

  return found
}

const readGit = async ($: EngineInterface, cwd: string): Promise<Git | null> => {
  if ((await $.session.repo()) === null) {
    return null
  }

  const status = await $.process.run(['git', '-C', cwd, 'status', '--porcelain=v2', '--branch'], { timeoutMs: 5000 })

  if (status.exitCode !== 0) {
    return null
  }

  const numstat = await $.process.run(['git', '-C', cwd, 'diff', '--numstat', 'HEAD'], { timeoutMs: 5000 })

  const found = parseGit(status.stdout, numstat.exitCode === 0 ? numstat.stdout : '')
  // Local branches, the most recently committed first, and the last three commits.
  const branches = await $.process.run(
    ['git', '-C', cwd, 'branch', '--sort=-committerdate', '--format=%(HEAD)%09%(refname:short)'],
    { timeoutMs: 5000 },
  )
  const log = await $.process.run(['git', '-C', cwd, 'log', '-3', '--format=%h%x09%s'], { timeoutMs: 5000 })

  if (branches.exitCode === 0) {
    found.branches = branches.stdout
      .split('\n')
      .filter(line => line.includes('\t'))
      .map(line => ({ name: line.slice(line.indexOf('\t') + 1).trim(), isCurrent: line.startsWith('*') }))
  }

  if (log.exitCode === 0) {
    found.commits = log.stdout
      .split('\n')
      .filter(line => line.includes('\t'))
      .map(line => ({ hash: line.slice(0, line.indexOf('\t')), subject: line.slice(line.indexOf('\t') + 1) }))
  }

  return found
}

const EMPTY_SCOPE: HarnessScope = { memory: [], agents: [], skills: [], mcp: [], hooks: [] }

const isItem = (one: HarnessItem | null): one is HarnessItem => one !== null

// The `.md` files right under a directory, by name; none when it is missing.
// A symbolic link is listed as `other`, and a linked file counts as one.
const markdownIn = async ($: EngineInterface, dir: string) =>
  (await $.fs.list(dir).catch(() => []))
    .filter(one => (one.kind === 'file' || one.isLink) && one.name.endsWith('.md'))
    .map(one => one.name)
    .sort()

// A value of a file's leading `---` block.
const frontmatter = (text: string, key: string) =>
  new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '')?.[1]?.trim()

const IMPORTED = '불러온 파일'
const IMPORT_DEPTH = 3
const IMPORTS_PER_FILE = 20

type Named = { name: string; path: string; group?: string }

type Loaded = Named & { note: string; text: string }

// Those of some files that exist, each with its line and character counts
// and its text.
const loadFiles = async ($: EngineInterface, files: Named[]) => {
  const found = await Promise.all(
    files.map(async (one): Promise<Loaded | null> => {
      const text = await $.fs.read(one.path).catch(() => null)

      return text === null ? null : { ...one, note: `${text.split('\n').length}줄 ${tokens(text.length)}자`, text }
    }),
  )

  return found.filter((one): one is Loaded => one !== null)
}

// The `.md` files of a folder, to be listed as a section named after it.
const folderFiles = async ($: EngineInterface, dir: string, group: string): Promise<Named[]> =>
  (await markdownIn($, dir)).map(name => ({ name, path: `${dir}/${name}`, group }))

// A path with its `.` and `..` segments worked out.
const normal = (path: string) =>
  path
    .split('/')
    .reduce<string[]>(
      (kept, part) => (part === '.' ? kept : part === '..' && kept.length > 1 ? kept.slice(0, -1) : [...kept, part]),
      [],
    )
    .join('/')

// The files a text names with `@path`, outside its code, as absolute paths;
// one that names no file is found out when it is read.
const importsOf = (text: string, dir: string) =>
  [...text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').matchAll(/(?:^|\s)@([^\s]+)/g)]
    .map(found => (found[1] ?? '').replace(/[),;:'"]+$/, '').replace(/\.$/, ''))
    .filter(name => name !== '')
    .slice(0, IMPORTS_PER_FILE)
    .map(name => normal(name.startsWith('~/') ? `${home}${name.slice(1)}` : name.startsWith('/') ? name : `${dir}/${name}`))

// A long path with its middle folders left out: `~/.config/…/guide.md`.
const brief = (path: string) => {
  const parts = short(path).split('/')

  return parts.length > 4 ? [...parts.slice(0, 2), '…', ...parts.slice(-1)].join('/') : parts.join('/')
}

// The files some instruction files import, and those these import in turn.
const readImports = async ($: EngineInterface, from: Loaded[]) => {
  const seen = new Set(from.map(one => one.path))
  const found: Loaded[] = []
  let next = from

  for (let depth = 0; depth < IMPORT_DEPTH && next.length > 0; depth += 1) {
    const paths = [
      ...new Set(next.flatMap(one => importsOf(one.text, one.path.slice(0, one.path.lastIndexOf('/'))))),
    ].filter(path => !seen.has(path))

    for (const path of paths) {
      seen.add(path)
    }

    next = await loadFiles($, paths.map(path => ({ name: brief(path), path, group: IMPORTED })))
    found.push(...next)
  }

  return found
}

// The instruction files that exist, each with its line count: the scope's
// own, those of its folders a section apiece, and those all of them import.
const readMemory = async ($: EngineInterface, files: Named[], folders: Named[][]): Promise<HarnessItem[]> => {
  const own = await loadFiles($, [...files, ...folders.flat()])

  return [...own, ...(await readImports($, own))].map(one => ({
    name: one.name,
    note: one.note,
    path: one.path,
    group: one.group,
  }))
}

// The agent files of a `.claude` folder, each with the model it names.
const readAgents = async ($: EngineInterface, dir: string): Promise<HarnessItem[]> =>
  Promise.all(
    (await markdownIn($, `${dir}/agents`)).map(async file => {
      const text = await $.fs.read(`${dir}/agents/${file}`).catch(() => '')

      return {
        name: frontmatter(text, 'name') ?? file.slice(0, -3),
        note: frontmatter(text, 'model'),
        path: `${dir}/agents/${file}`,
      }
    }),
  )

// The skill folders (those holding a SKILL.md) and the command files.
const readSkills = async ($: EngineInterface, dir: string): Promise<HarnessItem[]> => {
  const folders = (await $.fs.list(`${dir}/skills`).catch(() => [])).filter(one => one.kind === 'dir' || one.isLink)
  const skills = await Promise.all(
    folders.map(async (one): Promise<HarnessItem | null> => {
      const path = `${dir}/skills/${one.name}/SKILL.md`

      return (await $.fs.exists(path).catch(() => false)) ? { name: one.name, path } : null
    }),
  )
  const commands = (await markdownIn($, `${dir}/commands`)).map(file => ({
    name: `/${file.slice(0, -3)}`,
    note: '명령',
    path: `${dir}/commands/${file}`,
  }))

  return [...skills.filter(isItem).sort((one, other) => one.name.localeCompare(other.name)), ...commands]
}

type Servers = Record<
  string,
  {
    type?: string
    command?: string
    args?: string[]
    url?: string
    env?: Record<string, string>
    headers?: Record<string, string>
  }
>

// A server's details: how it is started or reached, and the names (never the
// values) of the variables and headers it is given.
const serverItems = (found: Servers | undefined, path: string): HarnessItem[] =>
  Object.entries(found ?? {}).map(([name, one]) => {
    const env = Object.keys(one.env ?? {})
    const headers = Object.keys(one.headers ?? {})
    const lines = [
      ...(one.command === undefined ? [] : [[one.command, ...(one.args ?? [])].join(' ')]),
      ...(one.url === undefined ? [] : [one.url.split('?')[0] ?? one.url]),
      ...(env.length === 0 ? [] : [`env: ${env.join(', ')}`]),
      ...(headers.length === 0 ? [] : [`headers: ${headers.join(', ')}`]),
    ]

    return {
      name,
      note: one.type ?? (one.command !== undefined ? 'stdio' : one.url !== undefined ? 'http' : undefined),
      lines: lines.length === 0 ? ['세부 정보가 없습니다.'] : lines,
      path,
    }
  })

type HookGroups = Record<
  string,
  { matcher?: string; hooks?: { type?: string; command?: string; prompt?: string; url?: string }[] }[]
>

// The hooks of some settings sources by event: how many, and for each its
// matcher and what it runs; an event's file is the first source's that has it.
const hookItems = (sources: { settings: unknown; path: string }[]): HarnessItem[] => {
  const found: Record<string, Hook[]> = {}
  const files: Record<string, string> = {}

  for (const source of sources) {
    for (const [event, groups] of Object.entries((source.settings as { hooks?: HookGroups }).hooks ?? {})) {
      files[event] ??= source.path

      for (const group of groups) {
        for (const one of group.hooks ?? []) {
          found[event] = [
            ...(found[event] ?? []),
            {
              matcher: group.matcher === undefined || group.matcher === '' ? ALL : group.matcher,
              type: one.type ?? 'command',
              command: (one.command ?? one.prompt ?? one.url ?? '').trim(),
            },
          ]
        }
      }
    }
  }

  return Object.entries(found).map(([name, hooks]) => ({ name, note: `${hooks.length}개`, hooks, path: files[name] }))
}

// Numbers the commands that hooks of two events or more run alike, in the
// order they come, and marks each hook running one.
const markShared = (found: Harness): Harness => {
  const events: Record<string, Set<string>> = {}

  for (const item of [...found.global.hooks, ...found.project.hooks]) {
    for (const one of item.hooks ?? []) {
      events[one.command] = (events[one.command] ?? new Set()).add(item.name)
    }
  }

  const shared = Object.keys(events).filter(command => command !== '' && (events[command]?.size ?? 0) > 1)
  const marked = (items: HarnessItem[]) =>
    items.map(item => ({
      ...item,
      hooks: item.hooks?.map(one =>
        shared.includes(one.command)
          ? { ...one, shared: { index: shared.indexOf(one.command) + 1, events: events[one.command]?.size ?? 0 } }
          : one,
      ),
    }))

  return {
    global: { ...found.global, hooks: marked(found.global.hooks) },
    project: { ...found.project, hooks: marked(found.project.hooks) },
  }
}

// A shell command in the pieces a line is made of: words (a quoted stretch
// kept whole), and `;`, `;;` and a line's end apiece.
const shellTokens = (command: string) => {
  const tokens: string[] = []
  let word = ''
  let quote = ''

  const end = () => {
    if (word !== '') {
      tokens.push(word)
      word = ''
    }
  }

  for (let at = 0; at < command.length; at += 1) {
    const char = command[at] ?? ''

    if (quote !== '') {
      word += char
      quote = char === quote ? '' : quote
    } else if (char === '\\') {
      word += char + (command[at + 1] ?? '')
      at += 1
    } else if (char === "'" || char === '"') {
      word += char
      quote = char
    } else if (char === ';') {
      end()
      tokens.push(command[at + 1] === ';' ? ';;' : ';')
      at += command[at + 1] === ';' ? 1 : 0
    } else if (char === '\n') {
      end()
      tokens.push(';')
    } else if (char === ' ' || char === '\t') {
      end()
    } else {
      word += char
    }
  }

  end()

  return tokens
}

// A shell command as lines to read: one statement a line, what an `if`, a
// loop, a `case` and its branches, and braces hold set in. Only how it is
// shown; the command is not changed, and a script it cannot follow is still
// all there, laid out less well.
const shellLines = (command: string) => {
  const tokens = shellTokens(command)
  const lines: { depth: number; text: string }[] = []
  const cases: number[] = []
  let line: string[] = []
  let depth = 0
  let isPattern = false

  const flush = () => {
    if (line.length > 0) {
      lines.push({ depth, text: line.join(' ') })
      line = []
    }
  }

  tokens.forEach((token, at) => {
    const next = tokens[at + 1]

    if (token === ';') {
      // `; then` and `; do` stay on the line they close.
      if ((next === 'then' || next === 'do') && line.length > 0) {
        line[line.length - 1] += ';'
      } else {
        flush()
      }
    } else if (token === ';;') {
      flush()
      depth = (cases[cases.length - 1] ?? depth - 2) + 1
      isPattern = true
    } else if (line.length === 0 && (token === 'fi' || token === 'done' || token === '}')) {
      depth = Math.max(0, depth - 1)
      line.push(token)
    } else if (line.length === 0 && token === 'esac') {
      depth = Math.max(0, cases.pop() ?? depth - 1)
      isPattern = false
      line.push(token)
    } else if (line.length === 0 && (token === 'else' || token === 'elif')) {
      depth = Math.max(0, depth - 1)
      line.push(token)

      if (token === 'else') {
        flush()
        depth += 1
      }
    } else {
      line.push(token)

      if (token === 'then' || token === 'do' || (token === '{' && line.length === 1)) {
        flush()
        depth += 1
      } else if (token === 'in' && line[0] === 'case') {
        flush()
        cases.push(depth)
        depth += 1
        isPattern = true
      } else if (isPattern && line.length === 1 && token.endsWith(')')) {
        flush()
        depth += 1
        isPattern = false
      }
    }
  })

  flush()

  return lines
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨'

// A text in rows of at most `room` cells, broken between its words; a word
// longer than a row is cut where the row ends.
const wrapWords = (text: string, room: number) => {
  const rows: string[] = []
  let line = ''

  for (const word of text.split(' ')) {
    if (line !== '' && cells(line) + 1 + cells(word) <= room) {
      line = `${line} ${word}`
    } else {
      if (line !== '') {
        rows.push(line)
      }

      const pieces = wrap(word, room)
      rows.push(...pieces.slice(0, -1))
      line = pieces[pieces.length - 1] ?? ''
    }
  }

  return [...rows, line]
}

const short = (path: string) => (home !== '' && path.startsWith(home) ? `~${path.slice(home.length)}` : path)

const FILES_MAX = 20000
const FILE_ROWS = 20
const OPS_MAX = 20
const SCAN_MAX = 300
const INDENT_FILES = 12

// Folders a walk of a project that is no git repository stays out of.
const PRUNED = ['.git', 'node_modules', '.build', 'dist', '.venv', '__pycache__', 'DerivedData']
const OPS = ['C', 'R', 'U', 'D'] as const
const OP_COLORS: Record<string, string> = { C: 'green', R: BRIGHT_BLUE, U: 'yellow', D: 'red' }
const NO_VIEW: FileView = { filter: 'all', open: [], picked: '', page: 0 }

const files = atom({ plugin: 'status-panel', key: 'files' } as const, null)
const touched = atom({ plugin: 'status-panel', key: 'touched' } as const, {})
const fileView = atom({ plugin: 'status-panel', key: 'fileView' } as const, NO_VIEW)

// `find` over a project's files, the pruned folders left out; `more` narrows it.
const findArgs = (root: string, more: string[]) => [
  'find',
  root,
  '-type',
  'd',
  '(',
  ...PRUNED.flatMap((name, at) => (at === 0 ? ['-name', name] : ['-o', '-name', name])),
  ')',
  '-prune',
  '-o',
  '-type',
  'f',
  '!',
  '-name',
  '.DS_Store',
  ...more,
  '-print',
]

// The lines of a listing that are under the root, as paths from it.
const under = (root: string, listing: string) =>
  listing
    .split('\n')
    .filter(line => line.startsWith(`${root}/`))
    .map(line => line.slice(root.length + 1))

// Reads the project's files: those git knows and does not ignore where the
// project is a repository, else a walk of its folders.
const readProject = async ($: EngineInterface): Promise<Files | null> => {
  const root = await $.session.root()
  let paths: string[] | null = null
  let isCut = false

  if ((await $.session.repo().catch(() => null)) !== null) {
    const listed = await $.process
      .run(['git', '-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { timeoutMs: 10000 })
      .catch(() => null)

    if (listed !== null && listed.exitCode === 0) {
      // The index still lists a file removed from the folder.
      const gone = await $.process
        .run(['git', '-C', root, 'ls-files', '-z', '--deleted'], { timeoutMs: 10000 })
        .catch(() => null)
      const removed = new Set((gone !== null && gone.exitCode === 0 ? gone.stdout : '').split('\0'))
      paths = listed.stdout.split('\0').filter(path => path !== '' && !removed.has(path))
      isCut = listed.isStdoutTruncated
    }
  }

  if (paths === null) {
    const found = await $.process.run(findArgs(root, []), { timeoutMs: 15000 })
    paths = under(root, found.stdout)
    isCut = found.isStdoutTruncated
  }

  const sorted = [...new Set(paths)].sort()
  const next: Files = { root, paths: sorted.slice(0, FILES_MAX), isPartial: isCut || sorted.length > FILES_MAX }
  await update($, files, () => next)

  return next
}

// Records what was done to some files, the last few a file kept.
const noteOps = ($: EngineInterface, ops: [string, FileOp][]) =>
  update($, touched, now => {
    const next = { ...now }

    for (const [path, op] of ops) {
      next[path] = [...(next[path] ?? []), op].slice(-OPS_MAX)
    }

    return next
  }).catch(() => undefined)

// The file a tool call reads or writes, as the call names it.
const fileOf = (e: unknown) => {
  const one = e as { tool?: string; file_path?: unknown; notebook_path?: unknown }
  const path = one.tool === 'NotebookEdit' ? one.notebook_path : one.file_path

  return ['Read', 'Write', 'Edit', 'NotebookEdit'].includes(one.tool ?? '') && typeof path === 'string' ? path : null
}

// A path as one from the project's root; none when it is outside it.
const within = (root: string, path: string) => {
  const whole = normal(path.startsWith('/') ? path : `${root}/${path}`)

  return root !== '' && whole.startsWith(`${root}/`) ? whole.slice(root.length + 1) : null
}

// A time as `find -newermt` reads it, in the local zone.
const findTime = (ms: number) => {
  const at = new Date(ms)

  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`
}

let scans: Promise<unknown> = Promise.resolve()

// What a shell command did to the project's files cannot be read off it, so
// the files are compared across it: one there only after was made, one there
// only before removed, and one written since it began changed. Another
// program writing meanwhile is counted too.
const scan = async ($: EngineInterface, since: number, tool: string) => {
  const before = await read($, files)
  const root = await $.session.root()
  const written = await $.process
    .run(findArgs(root, ['-newermt', findTime(since - 1000)]), { timeoutMs: 15000 })
    .catch(() => null)
  const after = await readProject($).catch(() => null)

  if (before === null || after === null || before.root !== after.root) {
    return
  }

  const was = new Set(before.paths)
  const is = new Set(after.paths)
  const at = await $.clock.now()
  const made = after.paths.filter(path => !was.has(path))
  const removed = before.paths.filter(path => !is.has(path))
  const changed = under(root, written?.stdout ?? '').filter(path => was.has(path) && is.has(path))
  const ops: [string, FileOp][] = [
    ...made.map((path): [string, FileOp] => [path, { op: 'C', at, tool }]),
    ...removed.map((path): [string, FileOp] => [path, { op: 'D', at, tool }]),
    ...changed.map((path): [string, FileOp] => [path, { op: 'U', at, tool }]),
  ]
  await noteOps($, ops.slice(0, SCAN_MAX))
}

type FileRow = { path: string; name: string; depth: number; isDir: boolean; isOpen: boolean; ops: string[] }

const opsOf = (found: FileOp[] | undefined) => OPS.filter(op => (found ?? []).some(one => one.op === op))

// The files tab's rows: folders before files, a folder's own under it when
// it is open, each with what was done to it (a folder: to anything in it).
// The touched view shows those files alone, every folder open.
const fileRows = (paths: string[], marks: Record<string, FileOp[]>, view: FileView) => {
  const marked = Object.keys(marks)
  const isTouched = view.filter === 'touched'
  const shown = isTouched ? marked : [...new Set([...paths, ...marked])]
  const folders = new Map<string, { folders: Set<string>; files: string[] }>()
  const inside = new Map<string, Set<string>>()
  const folder = (path: string) => {
    const found = folders.get(path) ?? { folders: new Set<string>(), files: [] }
    folders.set(path, found)

    return found
  }

  for (const path of shown) {
    const parts = path.split('/')

    parts.slice(0, -1).forEach((_, at) => {
      folder(parts.slice(0, at).join('/')).folders.add(parts.slice(0, at + 1).join('/'))
    })
    folder(parts.slice(0, -1).join('/')).files.push(path)
  }

  for (const path of marked) {
    const parts = path.split('/')

    parts.slice(0, -1).forEach((_, at) => {
      const key = parts.slice(0, at + 1).join('/')
      const found = inside.get(key) ?? new Set<string>()
      inside.set(key, found)

      for (const op of opsOf(marks[path])) {
        found.add(op)
      }
    })
  }

  const rows: FileRow[] = []
  const walk = (path: string, depth: number) => {
    const found = folders.get(path)

    for (const each of [...(found?.folders ?? [])].sort()) {
      const isOpen = isTouched || view.open.includes(each)
      rows.push({
        path: each,
        name: `${each.slice(each.lastIndexOf('/') + 1)}/`,
        depth,
        isDir: true,
        isOpen,
        ops: OPS.filter(op => inside.get(each)?.has(op) === true),
      })

      if (isOpen) {
        walk(each, depth + 1)
      }
    }

    for (const each of [...(found?.files ?? [])].sort()) {
      rows.push({
        path: each,
        name: each.slice(each.lastIndexOf('/') + 1),
        depth,
        isDir: false,
        isOpen: false,
        ops: opsOf(marks[each]),
      })
    }
  }

  walk('', 0)

  return rows
}

// Counts one use of a piece of the harness, or with `once` marks it used
// without adding to a count it already has.
const bump = ($: EngineInterface, kind: keyof HarnessScope, key: string, once = false) =>
  update($, used, now => ({
    ...now,
    [kind]: { ...now[kind], [key]: once ? Math.max(now[kind][key] ?? 0, 1) : (now[kind][key] ?? 0) + 1 },
  })).catch(() => undefined)

// What a settings hook's matcher is tried on, of a classic event's input.
const subjectOf = (e: unknown) => {
  const one = e as Record<string, unknown>
  const found = one.tool ?? one.tool_name ?? one.source ?? one.trigger ?? one.agent_type ?? one.notification_type

  return typeof found === 'string' ? found : ''
}

// Whether a settings hook's matcher takes the subject: none and `*` take all.
const matches = (matcher: string, subject: string) => {
  if (matcher === '' || matcher === '*') {
    return true
  }

  try {
    return new RegExp(`^(?:${matcher})$`).test(subject)
  } catch {
    return matcher === subject
  }
}

// How often an event fired with a subject one of the matchers takes: an
// estimate of the settings hooks' runs, which the engine does not report.
const hookRuns = (counts: Record<string, number>, event: string, matchers: string[]) =>
  Object.entries(counts).reduce((sum, [key, count]) => {
    const [name = '', subject = ''] = key.split('\t')

    return name === event && matchers.some(one => matches(one, subject)) ? sum + count : sum
  }, 0)

// A server's name as tool names spell it (`mcp__<server>__<tool>`).
const spelled = (server: string) => server.replace(/[^a-zA-Z0-9_-]/g, '_')

const serverCalls = (counts: Record<string, number>, server: string) =>
  Object.entries(counts).reduce((sum, [key, count]) => (key.split('\t')[0] === server ? sum + count : sum), 0)

// How often this session used an item of the lists.
const usesOf = (now: Used, kind: keyof HarnessScope, one: HarnessItem) =>
  kind === 'memory'
    ? (now.memory[one.path ?? ''] ?? 0)
    : kind === 'agents'
      ? (now.agents[one.name] ?? 0)
      : kind === 'skills'
        ? (now.skills[one.name.replace(/^\//, '')] ?? 0)
        : kind === 'mcp'
          ? serverCalls(now.mcp, spelled(one.name))
          : hookRuns(now.hooks, one.name, (one.hooks ?? []).map(each => each.matcher))

const times = (count: number) => `${count}회`

// What this session used of a kind, as items: those the lists hold keep their
// file to preview, and one they do not (a plugin's, a connector) says so.
const usedItems = (now: Used, kind: keyof HarnessScope, found: Harness | null): HarnessItem[] => {
  const known = found === null ? [] : [...found.global[kind], ...found.project[kind]]

  if (kind === 'memory') {
    return Object.entries(now.memory).map(([path, count]) => ({ name: short(path), note: times(count), path }))
  }

  if (kind === 'mcp') {
    const servers = [...new Set(Object.keys(now.mcp).map(key => key.split('\t')[0] ?? ''))]

    return servers.map(server => ({
      path: known.find(one => spelled(one.name) === server)?.path,
      name: known.find(one => spelled(one.name) === server)?.name ?? server,
      note: times(serverCalls(now.mcp, server)),
      lines: Object.entries(now.mcp)
        .filter(([key]) => key.split('\t')[0] === server)
        .sort((one, other) => other[1] - one[1])
        .map(([key, count]) => `${key.split('\t')[1] ?? ''} · ${times(count)}`),
    }))
  }

  if (kind === 'hooks') {
    const events = [...new Set(known.map(one => one.name))]

    return events
      .map(event => {
        const hooks = known.filter(one => one.name === event).flatMap(one => one.hooks ?? [])

        return {
          name: event,
          path: known.find(one => one.name === event)?.path,
          count: hookRuns(now.hooks, event, hooks.map(one => one.matcher)),
          hooks: hooks.map(one => ({ ...one, count: hookRuns(now.hooks, event, [one.matcher]) })),
        }
      })
      .filter(one => one.count > 0)
      .map(one => ({ name: one.name, note: times(one.count), hooks: one.hooks, path: one.path }))
  }

  return Object.entries(now[kind]).map(([name, count]) => {
    const path = known.find(one => one.name.replace(/^\//, '') === name)?.path

    return path === undefined
      ? { name, note: times(count), lines: ['목록에 없는 항목입니다.'] }
      : { name, note: times(count), path }
  })
}

// The instruction files the engine reads as a session starts, as far as they
// can be told without its load events: the user's own and those above the
// working directory, each with what it imports.
const readLoaded = async ($: EngineInterface) => {
  const own = `${await readHome($)}/.claude/CLAUDE.md`
  const above = await $.fs
    .ancestors({ names: ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'] })
    .catch(() => [])

  return [
    ...new Set([
      ...((await $.fs.exists(own).catch(() => false)) ? [own] : []),
      ...above.flatMap(one => one.parts.map(part => part.path)),
    ]),
  ]
}

// When a file was last changed; -1 when it is not there.
const changedAt = ($: EngineInterface, path: string) =>
  $.fs.stat(path).then(
    one => one.mtimeMs,
    () => -1,
  )

// The fields of a text's leading `---` block, a line that carries on a value
// joined to it, and the markdown after the block.
const splitDoc = (text: string) => {
  const head = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  const fields: [string, string][] = []

  for (const line of (head?.[1] ?? '').split('\n')) {
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    const last = fields[fields.length - 1]

    if (field !== null) {
      fields.push([field[1] ?? '', (field[2] ?? '').replace(/^[>|][+-]?$/, '')])
    } else if (last !== undefined && line.trim() !== '') {
      last[1] = `${last[1]} ${line.trim()}`.trim()
    }
  }

  return { fields, body: text.slice(head?.[0].length ?? 0).replace(/^\n+/, '') }
}

// A file as the lower half draws it: its path, its fields and its markdown,
// whole up to what one drawing takes.
const readDoc = async ($: EngineInterface, path: string) => {
  const at = await changedAt($, path)
  const text = await $.fs.read(path).catch(() => null)

  if (text === null) {
    return { lines: [short(path), '파일을 읽지 못했습니다.'], file: path, at }
  }

  const { fields, body } = splitDoc(text.replaceAll('\r\n', '\n'))

  return {
    lines: [],
    file: path,
    at,
    path: short(path),
    fields,
    text: body.length > DOC_CHARS ? `${body.slice(0, DOC_CHARS)}\n\n…` : body,
  }
}

let stamp = ''

// The harness's folders by their entries and its files by when each was last
// changed: a change to any of them changes this text. `~/.claude.json` is left
// out, since the engine rewrites it all the time.
const readStamp = async ($: EngineInterface) => {
  const base = await readHome($)
  const root = await $.session.root()
  const folders = [
    ...[`${base}/.claude`, `${root}/.claude`].flatMap(dir =>
      ['rules', 'agents', 'skills', 'commands'].map(name => `${dir}/${name}`),
    ),
    memoryDir(base, root),
  ]
  const files = [
    `${base}/.claude/CLAUDE.md`,
    `${base}/.claude/settings.json`,
    `${root}/CLAUDE.md`,
    `${root}/.claude/CLAUDE.md`,
    `${root}/CLAUDE.local.md`,
    `${root}/.claude/settings.json`,
    `${root}/.claude/settings.local.json`,
    `${root}/.mcp.json`,
    ...[...(harness?.global.memory ?? []), ...(harness?.project.memory ?? [])].map(one => one.path ?? ''),
  ]
  const listed = await Promise.all(
    folders.map(dir =>
      $.fs.list(dir).then(
        entries => entries.map(one => `${one.name}:${one.mtimeMs}`).join(','),
        () => '-',
      ),
    ),
  )
  const stats = await Promise.all([...new Set(files)].filter(path => path !== '').map(path => changedAt($, path)))

  return [...listed, ...stats].join('|')
}

// While the harness tab is shown, each beat: the lists are read again when
// their files changed, and the picked item's details when its file did.
const watch = async ($: EngineInterface) => {
  if ((await read($, tab)) !== HARNESS_TAB) {
    return
  }

  if ((await readStamp($)) !== stamp) {
    harness = await readHarness($).catch(() => harness)
    // Taken again, since what was read decides which files are watched.
    stamp = await readStamp($)
    await refresh($, false)
  }

  const held = await read($, detail)

  if (held !== null && held.file !== undefined && (await changedAt($, held.file)) !== held.at) {
    const next: Detail = { key: held.key, title: held.title, ...(await readDoc($, held.file)) }
    await update($, detail, now => (now?.key === held.key ? next : now))
  }
}

// Shows an item's details under the list; a press on the shown one clears them.
const pick = async ($: EngineInterface, key: string, one: HarnessItem) => {
  if ((await read($, detail))?.key === key) {
    await update($, detail, () => null)

    return
  }

  const shown =
    one.hooks !== undefined
      ? { lines: [], path: one.path === undefined ? undefined : short(one.path), hooks: one.hooks }
      : one.lines !== undefined
        ? { lines: one.lines }
        : one.path === undefined
          ? { lines: [] }
          : await readDoc($, one.path)
  const next: Detail = { key, title: one.name, ...shown }
  await update($, detail, () => next)
}

// A text in rows of at most `room` cells.
const wrap = (text: string, room: number) => {
  const rows: string[] = []
  let line = ''
  let used = 0

  for (const char of text) {
    if (used + cells(char) > room) {
      rows.push(line)
      line = ''
      used = 0
    }

    line += char
    used += cells(char)
  }

  return line === '' && rows.length > 0 ? rows : [...rows, line]
}

// The project's auto memory, kept under the user's folder by the root's path.
const memoryDir = (base: string, root: string) =>
  `${base}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}/memory`

// What the user's `~/.claude` and the project's root set up for the session,
// read from their files and settings; only names and short notes are kept.
// A plugin's own agents, skills, servers and hooks are not listed.
const readHarness = async ($: EngineInterface): Promise<Harness> => {
  const base = await readHome($)
  const root = await $.session.root()
  const state = (await $.fs
    .read(`${base}/.claude.json`)
    .then(text => JSON.parse(text) as unknown)
    .catch(() => ({}))) as { mcpServers?: Servers; projects?: Record<string, { mcpServers?: Servers }> }
  const [user, shared, local] = await Promise.all(
    (['user', 'project', 'local'] as const).map(source => $.settings.read({ source }).catch(() => ({}))),
  )
  const global: HarnessScope = {
    memory: await readMemory(
      $,
      [{ name: 'CLAUDE.md', path: `${base}/.claude/CLAUDE.md` }],
      [await folderFiles($, `${base}/.claude/rules`, 'rules/')],
    ),
    agents: await readAgents($, `${base}/.claude`),
    skills: await readSkills($, `${base}/.claude`),
    mcp: serverItems(state.mcpServers, `${base}/.claude.json`),
    hooks: hookItems([{ settings: user, path: `${base}/.claude/settings.json` }]),
  }

  // Started in the home directory, the project's `.claude` is the user's own.
  if (root === base) {
    return markShared({ global, project: EMPTY_SCOPE })
  }

  const file = (await $.fs
    .read(`${root}/.mcp.json`)
    .then(text => JSON.parse(text) as unknown)
    .catch(() => ({}))) as { mcpServers?: Servers }

  return markShared({
    global,
    project: {
      memory: await readMemory(
        $,
        ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].map(name => ({ name, path: `${root}/${name}` })),
        [
          await folderFiles($, `${root}/.claude/rules`, 'rules/'),
          await folderFiles($, memoryDir(base, root), 'memory/'),
        ],
      ),
      agents: await readAgents($, `${root}/.claude`),
      skills: await readSkills($, `${root}/.claude`),
      mcp: [
        ...serverItems(file.mcpServers, `${root}/.mcp.json`),
        ...serverItems(state.projects?.[root]?.mcpServers, `${base}/.claude.json`),
      ],
      hooks: hookItems([
        { settings: shared, path: `${root}/.claude/settings.json` },
        { settings: local, path: `${root}/.claude/settings.local.json` },
      ]),
    },
  })
}

// A length of time in its two largest units: `1d 3h`, `2h 05m`, `7m`, `42s`.
const span = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  return hours >= 24
    ? `${Math.floor(hours / 24)}d ${hours % 24}h`
    : hours > 0
      ? `${hours}h ${two(minutes % 60)}m`
      : minutes > 0
        ? `${minutes}m`
        : `${seconds}s`
}

// What /context lists, estimated locally (`summary`): no token-count call.
const readBreakdown = async ($: EngineInterface): Promise<Breakdown | null> => {
  const found = (await $.session.usage({ breakdown: 'summary' })).context.breakdown

  return found === undefined
    ? null
    : {
        categories: found.categories.map(one => ({
          name: one.name,
          tokens: one.tokens,
          color: one.color,
          kind: one.kind,
        })),
        total: found.totalTokens,
        max: found.rawMaxTokens,
      }
}

const tokens = (count: number) =>
  count >= 1000000
    ? `${(count / 1000000).toFixed(1)}M`
    : count >= 10000
      ? `${Math.round(count / 1000)}k`
      : count >= 1000
        ? `${(count / 1000).toFixed(1)}k`
        : String(count)

const refresh = async ($: EngineInterface, withBranch: boolean) => {
  const [cwd, model, version, sessionId, usage, now, turns, agents] = await Promise.all([
    $.session.cwd(),
    $.session.model(),
    $.session.version(),
    $.session.id(),
    $.session.usage(),
    $.clock.now(),
    $.session.turns(),
    $.agent.list(),
  ])
  await readHome($)

  if (withBranch) {
    branch = await readBranch($, cwd)
    breakdown = await readBreakdown($).catch(() => breakdown)
    git = await readGit($, cwd).catch(() => null)
  }

  const next: Info = {
    cwd: home !== '' && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd,
    branch,
    model,
    effort,
    version: version.version,
    sessionId,
    ctxPercentUsed: usage.context.percent,
    ctxWindow: usage.context.window,
    breakdown,
    startedAt: usage.startedAt,
    turns,
    costUsd: usage.cost?.usd,
    git,
    account,
    harness,
    agents: agents.map(one => ({ name: one.name ?? one.description, type: one.type, status: one.status })),
    limits: usage.rateLimits.map(one => ({ kind: one.kind, percentUsed: one.percentUsed, resetsAt: one.resetsAt })),
    now,
  }
  await update($, info, () => next)
}

// The status line script prints nothing while this beat is fresh, so the
// same figures are not shown twice; a stale or zero beat brings it back.
const beat = async ($: EngineInterface, isOn?: boolean) => {
  const panes = await $.ui.panes()
  const isDrawn = isOn ?? panes.some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)
  const seconds = isDrawn ? Math.floor((await $.clock.now()) / 1000) : 0

  if ((await readHome($)) !== '') {
    await $.fs.write(`${home}/.claude/status-panel/${await $.session.id()}`, String(seconds))
  }
}

// The news tab's feeds. GeekNews gives no feed of its newest page, but its
// own feed is in the same order. GitHub's trending repositories have no feed
// at all: they are read from the page, two rows each. claude.dev is
// Anthropic's blog on building with Claude.
const SOURCES: readonly (Tab & { url: string; heading?: string; isTrending?: boolean })[] = [
  { id: 'geeknews', label: 'GeekNews', url: 'https://news.hada.io/rss/news' },
  { id: 'inven', label: '인벤', url: 'https://webzine.inven.co.kr/news/rss.php' },
  { id: 'aitimes', label: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml' },
  { id: 'github', label: 'GitHub', url: 'https://github.com/trending', heading: 'GitHub 트렌딩', isTrending: true },
  { id: 'claudedev', label: 'claude.dev', url: 'https://claude.dev/rss.xml', heading: 'claude.dev 블로그' },
]
const NEWS_ROWS = 10
const NEWS_FRESH_MS = 10 * 60 * 1000
const ARTICLES_MAX = 50
const SUMMARY_CHARS = 300
const SUMMARY_ROWS = 4
const AGE_CELLS = 6
const NO_NEWS_VIEW: NewsView = { source: 'geeknews', page: 0, picked: '' }

const news = atom({ plugin: 'status-panel', key: 'news' } as const, {})
const newsView = atom({ plugin: 'status-panel', key: 'newsView' } as const, NO_NEWS_VIEW)

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') {
      return ENTITIES[name.toLowerCase()] ?? whole
    }

    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))

    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })

// An element's text as plain words: a CDATA section is markup as it is, any
// other text is escaped once more; a block's tags part words, others go.
const textOf = (raw: string) => {
  const html = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g, (_, cdata?: string, text?: string) =>
    cdata ?? unescape(text ?? ''),
  )

  return unescape(html.replace(/<\/?(?:p|br|div|li|ul|ol|h\d|tr|td|img|blockquote|figure)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

// The first of some elements a block has, as it is written.
const element = (block: string, names: readonly string[]) => {
  for (const name of names) {
    const found = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(block)

    if (found !== null) {
      return found[1] ?? ''
    }
  }

  return ''
}

// A feed's date: RFC 822 or ISO 8601; a bare `YYYY-MM-DD HH:MM:SS`, as
// AI타임스 writes it, is Korean time.
const dateOf = (text: string) => {
  if (text === '') {
    return NaN
  }

  const bare = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d(?::\d\d)?)$/.exec(text)

  return Date.parse(bare === null ? text : `${bare[1]}T${bare[2]}+09:00`)
}

// The articles of an RSS or Atom feed, in its order; an entry with no title
// or link is left out.
const parseFeed = (xml: string): Article[] =>
  (xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [])
    .map(block => {
      const link =
        textOf(element(block, ['link'])) ||
        (/<link\b[^>]*\bhref=["']([^"']+)["']/.exec(block)?.[1] ?? '')
      const summary = textOf(element(block, ['description', 'summary', 'content']))

      return {
        title: textOf(element(block, ['title'])),
        link: unescape(link.trim()),
        summary: summary.length > SUMMARY_CHARS ? `${summary.slice(0, SUMMARY_CHARS)}…` : summary,
        at: dateOf(textOf(element(block, ['pubDate', 'published', 'updated', 'dc:date']))),
      }
    })
    .filter(one => one.title !== '' && one.link !== '')
    .slice(0, ARTICLES_MAX)

// How long ago an article came out: minutes, hours, then days.
const ago = (at: number, now: number) => {
  if (Number.isNaN(at)) {
    return ''
  }

  const minutes = Math.max(0, Math.floor((now - at) / 60000))

  return minutes < 60 ? `${minutes}분` : minutes < 1440 ? `${Math.floor(minutes / 60)}시간` : `${Math.floor(minutes / 1440)}일`
}

// A count as GitHub writes it (`1,397`), short: `+1.4k`.
const gained = (written: string) => {
  const count = Number(written.replace(/,/g, ''))

  return written === '' || Number.isNaN(count) ? '' : count >= 1000 ? `+${(count / 1000).toFixed(1)}k` : `+${count}`
}

// The repositories of GitHub's trending page, in its order.
const parseTrending = (page: string): Article[] =>
  (page.match(/<article class="Box-row"[\s\S]*?<\/article>/g) ?? [])
    .map(block => {
      const repo = /<h2[\s\S]*?href="\/([^"]+)"/.exec(block)?.[1] ?? ''
      const language = textOf(/itemprop="programmingLanguage">([^<]*)</.exec(block)?.[1] ?? '')
      const stars = /href="\/[^"]+\/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)/.exec(block)?.[1] ?? ''
      const today = /([\d,]+) stars today/.exec(block)?.[1] ?? ''
      const words = textOf(/<p class="[^"]*">([\s\S]*?)<\/p>/.exec(block)?.[1] ?? '')

      return {
        title: repo,
        link: `https://github.com/${repo}`,
        summary: words.length > SUMMARY_CHARS ? `${words.slice(0, SUMMARY_CHARS)}…` : words,
        at: NaN,
        aside: gained(today),
        meta: [language, stars === '' ? '' : `★${stars}`, today === '' ? '' : `오늘 +${today}`].filter(one => one !== '').join(' · '),
      }
    })
    .filter(one => one.title !== '')
    .slice(0, ARTICLES_MAX)

const hostOf = (link: string) => /^[a-z]+:\/\/(?:www\.)?([^/?#]+)/i.exec(link)?.[1] ?? link

// The feeds being read, so a feed is asked for once at a time.
const reading = new Set<string>()

// Reads a source's feed, unless it was read well within the last minutes; a
// feed that fails keeps the articles it had and says what went wrong.
const readFeed = async ($: EngineInterface, id: string, isForced: boolean) => {
  const source = SOURCES.find(one => one.id === id)

  if (source === undefined || reading.has(id)) {
    return
  }

  const held = (await read($, news))[id]
  const now = await $.clock.now()

  if (!isForced && held !== undefined && held.error === '' && now - held.readAt < NEWS_FRESH_MS) {
    return
  }

  reading.add(id)

  try {
    const got = await $.http.fetch(source.url).catch(() => null)
    const articles = got?.ok !== true ? [] : source.isTrending === true ? parseTrending(got.text) : parseFeed(got.text)
    const error =
      got === null
        ? '피드를 읽지 못했습니다.'
        : !got.ok
          ? `피드를 읽지 못했습니다(HTTP ${got.status}).`
          : articles.length === 0
            ? '피드에 기사가 없습니다.'
            : ''
    const next: Feed =
      error === '' ? { articles, readAt: now, error } : { articles: held?.articles ?? [], readAt: held?.readAt ?? 0, error }
    await update($, news, feeds => ({ ...feeds, [id]: next }))
  } finally {
    reading.delete(id)
  }
}

// A change as plain words with its code still in backticks: a mark escaped
// outside code is the mark itself, and an escaped backtick a quote, so the
// backticks left pair up.
const unmark = (text: string) => {
  let plain = ''
  let isCode = false

  for (let at = 0; at < text.length; at += 1) {
    const char = text[at] ?? ''
    const after = text[at + 1] ?? ''

    if (char === '`') {
      isCode = !isCode
      plain += char
    } else if (!isCode && char === '\\' && /[!-/:-@[-`{-~]/.test(after)) {
      plain += after === '`' ? "'" : after
      at += 1
    } else {
      plain += char
    }
  }

  return plain
}

// Claude Code's documentation in Korean: the index the site gives for it (a
// section under each `###`, a group under each `####`, one under that under
// each `#####`, then a page in each bullet), and each page in markdown.
const DOCS_URL = 'https://code.claude.com/docs/ko'
const DOCS_INDEX_URL = 'https://code.claude.com/docs/_llms/ko.txt'
const DOC_ROWS = 12
// A part of a page grows to about this many characters, then ends at a
// paragraph; a heading always starts one.
const PART_CHARS = 2400
// The most of a part a drawing is given, well under what one may draw.
const PART_MAX = 60000
// The pages read are kept, the oldest let go past this many.
const DOC_TEXTS_MAX = 12
const DOC_PAGE = /^- \[(.*)\]\(https:\/\/code\.claude\.com\/docs\/ko\/([^)\s]+?)(?:\.md)?\)(?::\s*(.*))?$/
const DOC_LINK = /^https:\/\/code\.claude\.com\/docs\/ko\/([^#?]+?)(?:\.md)?(?:[#?].*)?$/
// GitHub's alerts, as the pages write their notes, by the words drawn instead.
const ALERTS: Record<string, string> = { NOTE: '참고', TIP: '팁', IMPORTANT: '중요', WARNING: '경고', CAUTION: '주의' }
const NO_DOC_VIEW: DocView = { section: 0, page: 0, picked: '', part: 0, isToc: false }
const docIndex = atom({ plugin: 'status-panel', key: 'docIndex' } as const, null)
const docTexts = atom({ plugin: 'status-panel', key: 'docTexts' } as const, {})
const docView = atom({ plugin: 'status-panel', key: 'docView' } as const, NO_DOC_VIEW)

// The sections of the index, each page once, none left empty.
const parseDocIndex = (markdown: string) => {
  const sections: DocSection[] = []
  const seen = new Set<string>()
  let outer = ''

  for (const line of markdown.split('\n')) {
    const heading = /^(#{3,5}) (.+?)\s*$/.exec(line)
    const section = sections[sections.length - 1]

    if (heading !== null) {
      const depth = heading[1]?.length ?? 0
      const name = unmark(heading[2] ?? '')

      if (depth === 3) {
        sections.push({ name, groups: [] })
      } else if (section !== undefined) {
        outer = depth === 4 ? name : outer
        section.groups.push({ name: depth === 4 || outer === '' ? name : `${outer} › ${name}`, pages: [] })
      }

      continue
    }

    const listed = DOC_PAGE.exec(line)
    const slug = listed?.[2] ?? ''

    if (listed === null || section === undefined || seen.has(slug)) {
      continue
    }

    if (section.groups.length === 0) {
      section.groups.push({ name: '', pages: [] })
    }

    seen.add(slug)
    section.groups[section.groups.length - 1]?.pages.push({
      slug,
      title: unmark(listed[1] ?? slug),
      about: unmark(listed[3] ?? ''),
    })
  }

  return sections
    .map(one => ({ ...one, groups: one.groups.filter(group => group.pages.length > 0) }))
    .filter(one => one.groups.length > 0)
}

// A section's list in rows: each group's name over its pages.
const docRows = (section: DocSection) =>
  section.groups.flatMap(group => [
    ...(group.name === '' ? [] : [{ kind: 'group' as const, name: group.name }]),
    ...group.pages.map(page => ({ kind: 'page' as const, page })),
  ])

// Where a page is listed: its section, and the page of that section's list.
const placeOfDoc = (sections: DocSection[], slug: string) => {
  for (const [section, one] of sections.entries()) {
    const at = docRows(one).findIndex(each => each.kind === 'page' && each.page.slug === slug)

    if (at >= 0) {
      return { section, page: Math.floor(at / DOC_ROWS) }
    }
  }

  return undefined
}

const findDoc = (sections: DocSection[], slug: string) =>
  sections.flatMap(one => one.groups.flatMap(group => group.pages)).find(one => one.slug === slug)

// A page's markdown as a drawing takes it, in parts: the note on the index
// above its title, the title and the line under it (the index has them) left
// out; links to the site made whole, a fence's attributes and the alerts'
// marks dropped. A part never ends inside a fence.
const parseDoc = (markdown: string) => {
  const lines = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .split('\n')
  const titleAt = lines.findIndex(line => line.startsWith('# '))
  const title = titleAt < 0 ? '' : unmark(lines[titleAt]?.slice(2).trim() ?? '')
  let at = titleAt + 1

  // The line under the title, a quote.
  while (lines[at]?.trim() === '') {
    at += 1
  }

  while ((lines[at] ?? '').startsWith('>')) {
    at += 1
  }

  const parts: DocPart[] = []
  let heading = ''
  let held: string[] = []
  let fence = ''
  const close = () => {
    const text = held.join('\n').trim()

    if (text !== '') {
      parts.push({ heading, text: text.length > PART_MAX ? `${text.slice(0, PART_MAX)}\n\n…` : text })
    }

    held = []
  }

  for (const raw of lines.slice(at)) {
    const fenced = /^(\s*)(`{3,}|~{3,})(\S*)/.exec(raw)
    let line = raw

    if (fenced !== null) {
      const mark = fenced[2] ?? ''

      if (fence === '') {
        fence = mark
        line = `${fenced[1] ?? ''}${mark}${fenced[3] ?? ''}`
      } else if (mark.startsWith(fence) && raw.trim() === mark) {
        fence = ''
      }
    } else if (fence === '') {
      line = raw
        .replace(/\]\(\//g, '](https://code.claude.com/')
        .replace(/^(\s*>+\s*)\[!(\w+)\]\s*$/, (whole, quote: string, kind: string) =>
          ALERTS[kind.toUpperCase()] === undefined ? whole : `${quote}**${ALERTS[kind.toUpperCase()]}**`,
        )
    }

    if (fence === '' && fenced === null && line.startsWith('## ')) {
      close()
      heading = unmark(line.slice(3).trim())
    } else if (fence === '' && fenced === null && line.trim() === '' && held.join('\n').length >= PART_CHARS) {
      close()
      continue
    }

    held.push(line)
  }

  close()

  return { title, parts }
}

// Reads the index, unless it was read well within the last minutes; one that
// fails keeps the sections it had and says what went wrong.
const readDocIndex = async ($: EngineInterface, isForced: boolean) => {
  const held = await read($, docIndex)
  const now = await $.clock.now()

  if (reading.has(DOCS_TAB) || (!isForced && held !== null && held.error === '' && now - held.readAt < NEWS_FRESH_MS)) {
    return
  }

  reading.add(DOCS_TAB)

  try {
    const got = await $.http.fetch(DOCS_INDEX_URL).catch(() => null)
    const sections = got?.ok === true ? parseDocIndex(got.text) : []
    const error =
      got === null
        ? '문서 목록을 읽지 못했습니다.'
        : !got.ok
          ? `문서 목록을 읽지 못했습니다(HTTP ${got.status}).`
          : sections.length === 0
            ? '문서 목록에 페이지가 없습니다.'
            : ''

    await update($, docIndex, standing =>
      error === '' ? { sections, readAt: now, error } : { sections: standing?.sections ?? [], readAt: standing?.readAt ?? 0, error },
    )
  } finally {
    reading.delete(DOCS_TAB)
  }
}

// Reads a page, as the index is; a page the site keeps elsewhere (it answers
// with a web page, not markdown) is one to open in the browser.
const readDocPage = async ($: EngineInterface, slug: string, isForced: boolean) => {
  const held = (await read($, docTexts))[slug]
  const now = await $.clock.now()
  const key = `doc:${slug}`

  if (reading.has(key) || (!isForced && held !== undefined && held.error === '' && now - held.readAt < NEWS_FRESH_MS)) {
    return
  }

  reading.add(key)

  try {
    const got = await $.http.fetch(`${DOCS_URL}/${slug}.md`).catch(() => null)
    const isPage = got?.ok === true && !/text\/html/i.test(got.headers['content-type'] ?? '') && !/^\s*<(!doctype|html)/i.test(got.text)
    const made = isPage && got !== null ? parseDoc(got.text) : { title: '', parts: [] }
    const error =
      got === null
        ? '문서를 읽지 못했습니다.'
        : !got.ok
          ? `문서를 읽지 못했습니다(HTTP ${got.status}).`
          : !isPage
            ? '이 문서는 사이트 밖에 있습니다. [열기]로 브라우저에서 보세요.'
            : made.parts.length === 0
              ? '문서에 내용이 없습니다.'
              : ''

    await update($, docTexts, standing => {
      const kept = error === '' ? { ...made, readAt: now, error } : { title: '', parts: [], readAt: 0, ...standing[slug], error }
      const all = { ...standing, [slug]: kept }
      const oldest = Object.entries(all)
        .sort(([, a], [, b]) => b.readAt - a.readAt)
        .slice(DOC_TEXTS_MAX)
        .map(([one]) => one)

      return Object.fromEntries(Object.entries(all).filter(([one]) => one === slug || !oldest.includes(one)))
    })
  } finally {
    reading.delete(key)
  }
}

// Shows a page: its section's list turned to it, and its first part.
const pickDoc = async ($: EngineInterface, slug: string) => {
  const sections = (await read($, docIndex))?.sections ?? []
  const place = placeOfDoc(sections, slug)

  await update($, docView, held => ({
    ...NO_DOC_VIEW,
    ...held,
    ...(place ?? {}),
    picked: slug,
    part: 0,
    isToc: false,
  }))
  void readDocPage($, slug, false).catch(() => undefined)
}

const OPEN = '[열기]'
const SEND = '[세션에 넣기]'

// Hands an item's file to an app by name, or with none to the system's own.
const openFile = async ($: EngineInterface, one: HarnessItem, app: string) => {
  if (one.path === undefined) {
    return
  }

  const ran = await $.process
    .run(app === '' ? ['open', one.path] : ['open', '-a', app, one.path], { timeoutMs: 5000 })
    .catch(() => null)

  if (ran === null || ran.exitCode !== 0) {
    $.ui.toast(`열지 못했습니다: ${one.name}`)
  }
}

export const register: Register = (on, options) => {
  // The app the harness tab's open buttons use, as the mod is configured.
  const app = typeof options.openWith === 'string' ? options.openWith.trim() : ''

  on('session.start', async ($, e, next) => {
    home = (await $.env.get('HOME')) ?? ''
    const settings = await $.settings.read()
    effort = typeof settings.effortLevel === 'string' ? settings.effortLevel : effort

    await $.command.register({
      name: 'status-panel',
      description: 'Show the status pane (location, model, context, rate limits)',
    })
    // The pane opens on the figures the session has at once; what takes
    // reading (the account, git, the harness) fills in behind it, so no
    // failure or wait among those keeps the pane from showing.
    await refresh($, false).catch(() => undefined)
    await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    await beat($).catch(() => undefined)

    $.clock.every(BEAT_MS, () => {
      void beat($).catch(() => undefined)

      // Each beat, so the clock is never more than a beat behind.
      void refresh($, false).catch(() => undefined)
      void watch($).catch(() => undefined)
    })

    void (async () => {
      account = await readAccount($)
      await refresh($, true)
      harness = await readHarness($).catch(() => harness)

      // A load event may have come before this hook stood, so those files are
      // marked here; `once` keeps an event that did come from counting twice.
      for (const path of await readLoaded($).catch(() => [])) {
        await bump($, 'memory', path, true)
      }

      await refresh($, false)
      await readProject($)
    })().catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'status-panel' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE, columns: COLUMNS })
    account = await readAccount($)
    harness = await readHarness($).catch(() => harness)
    await refresh($, true).catch(() => undefined)
    await readProject($).catch(() => undefined)
    await beat($).catch(() => undefined)

    return { text: opened.isPlaced ? 'Status pane opened.' : `Status pane waits: ${opened.reason}` }
  })

  on('ui.close', async ($, e, next) => {
    const closed = await next(e)

    if (e.id === PANE) {
      await beat($, false).catch(() => undefined)
    }

    return closed
  })

  on('turn.step', async function* ($, e, next) {
    if (e.effort !== undefined) {
      effort = String(e.effort)
    }

    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const call: Call = { id: e.tool_use_id, tool: e.tool, state: 'run' }
    const [, server, ...name] = e.tool.startsWith('mcp__') ? e.tool.split('__') : []

    if (server !== undefined) {
      void bump($, 'mcp', `${server}\t${name.join('__')}`)
    }

    await update($, activity, now => ({
      ...now,
      calls: [...now.calls, call].slice(-30),
      counts: { ...now.counts, [call.tool]: (now.counts[call.tool] ?? 0) + 1 },
      total: now.total + 1,
    })).catch(() => undefined)
    // The project file the call reads or writes; a Write makes it when it is
    // not there yet.
    const root = await $.session.root().catch(() => '')
    const named = fileOf(e)
    const target = named === null ? null : within(root, named)
    const isNew = e.tool === 'Write' && target !== null && !(await $.fs.exists(`${root}/${target}`).catch(() => true))
    const since = await $.clock.now().catch(() => 0)
    const ran = await next(e)
    const state: Call['state'] = ran.deny !== undefined || ran.isError === true ? 'err' : 'ok'

    if (state === 'ok' && target !== null) {
      void noteOps($, [[target, { op: e.tool === 'Read' ? 'R' : isNew ? 'C' : 'U', at: since, tool: e.tool }]])

      if (isNew) {
        void readProject($).catch(() => undefined)
      }
    }

    // A shell command is compared across, one at a time and never waited on.
    if (e.tool === 'Bash' && ran.deny === undefined) {
      scans = scans.then(() => scan($, since, e.tool)).catch(() => undefined)
    }

    await update($, activity, now => ({
      ...now,
      calls: now.calls.map(one => (one.id === call.id ? { ...one, state } : one)),
    })).catch(() => undefined)

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    void bump($, 'agents', e.subagentType)

    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    void bump($, 'skills', e.skill)

    return next(e)
  })

  // A classic event counts toward the settings hooks on it, when the settings
  // have any (the rest change no state); a load of an instruction file also
  // marks the file. The counting is never waited on: the event goes straight on.
  on('classic.*', ($, e, next) => {
    const event = next.event.slice('classic.'.length)

    if ([...(harness?.global.hooks ?? []), ...(harness?.project.hooks ?? [])].some(one => one.name === event)) {
      void bump($, 'hooks', `${event}\t${subjectOf(e)}`)
    }

    if (event === 'InstructionsLoaded') {
      const load = e as { file_path?: string; load_reason?: string }

      if (load.file_path !== undefined) {
        void bump($, 'memory', load.file_path, load.load_reason === 'session_start')
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, activity, now => ({ ...now, lastTurnMs: e.durationMs })).catch(() => undefined)
    await refresh($, true).catch(() => undefined)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, false).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await beat($, false).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const now = await read($, info)
    const held = await read($, tab)
    const shown = TABS.some(one => one.id === held) ? held : 'tab1'
    const heldScope = await read($, scope)
    const heldKind = await read($, kind)
    const area = SCOPES.find(one => one.id === heldScope) ?? SCOPES[0]
    const section = SECTIONS.find(one => one.id === heldKind) ?? SECTIONS[0]
    const opened = await read($, detail)
    const heldPage = await read($, page)
    // State an earlier build of the mod left may lack what this one added.
    const uses: Used = { ...NO_USE, ...(await read($, used)) }
    const project = await read($, files)
    const marks = (await read($, touched)) ?? {}
    const view: FileView = { ...NO_VIEW, ...(await read($, fileView)) }
    const feeds = (await read($, news)) ?? {}
    const newsAt: NewsView = { ...NO_NEWS_VIEW, ...(await read($, newsView)) }
    const docList = await read($, docIndex)
    const texts = await read($, docTexts)
    const docAt: DocView = { ...NO_DOC_VIEW, ...(await read($, docView)) }
    const isFirst = shown === 'tab1'
    const acts = await read($, activity)
    const AGENT_COLORS: Record<string, string> = {
      running: 'yellow',
      pending: 'yellow',
      waiting: 'cyan',
      idle: 'gray',
      completed: 'green',
      failed: 'red',
      killed: 'red',
    }

    if (now === null) {
      return <Text dimColor>상태를 읽는 중입니다.</Text>
    }

    const width = Math.max(26, e.props.bodyColumns)
    const room = width - 2
    const ctxLeft = now.ctxPercentUsed === undefined ? undefined : 100 - Math.round(now.ctxPercentUsed)
    const ctxLeftK = ctxLeft === undefined ? 0 : Math.round(((ctxLeft / 100) * now.ctxWindow) / 1000)
    const sevenDay = now.limits.find(one => one.kind === 'seven_day')
    const reset = resetLine(sevenDay, now.now)
    const today = new Date(now.now)
    const weeks = calendarWeeks(today, reset?.at ?? null)
    const clock = `${two(today.getHours())}:${two(today.getMinutes())}`
    const hours = bigDigits(two(today.getHours()))
    const minutes = bigDigits(two(today.getMinutes()))
    const faceGap = Math.floor((room - FACE_CELLS) / 2)
    const pad = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - cells(text)))
    const centre = (text: string) => ' '.repeat(Math.max(0, Math.floor((room - cells(text)) / 2))) + text

    // A meter as /usage draws it: filled blocks, then blank to the figure.
    const meter = (used: number) => {
      const size = Math.max(4, room - 10)
      const filled = Math.min(size, Math.max(0, Math.round((used * size) / 100)))

      return '█'.repeat(filled) + ' '.repeat(size - filled)
    }
    const usedLabel = (used: number) => `${Math.round(used)}% used`.padStart(10)

    // A section opens with a blank row and an accent mark; `title · aside`
    // puts the aside at the right edge. Rows are indented under it.
    const top = (heading: string) => {
      const [title = '', ...rest] = heading.split(' · ')
      const aside = rest.join(' · ')

      return (
        <Box flexDirection="column">
          <Text> </Text>
          <Box>
            <Text color="cyan">▍</Text>
            <Text bold>{title}</Text>
            <Text dimColor>
              {' '.repeat(Math.max(1, width - 1 - cells(title) - cells(aside)))}
              {aside}
            </Text>
          </Box>
        </Box>
      )
    }
    const bottom = () => null
    const row = (content: RenderChildren) => (
      <Box>
        <Text>{'  '}</Text>
        {content}
      </Box>
    )
    // The items of the scope and kind shown: a list as read, or what was used.
    const items =
      area === undefined || section === undefined
        ? []
        : area.id === 'used'
          ? usedItems(uses, section.id, now.harness ?? null)
          : area.id === 'activity'
            ? []
            : (now.harness?.[area.id]?.[section.id] ?? [])
    // Whether the session used anything a scope lists of a kind: what marks
    // the scope's tab and, in the scope shown, the kind's.
    const isUsedIn = (scopeId: string, kindId: string) => {
      const kindOf = SECTIONS.find(one => one.id === kindId)?.id

      return kindOf === undefined
        ? false
        : scopeId === 'global' || scopeId === 'project'
          ? (now.harness?.[scopeId]?.[kindOf] ?? []).some(one => usesOf(uses, kindOf, one) > 0)
          : scopeId === area?.id && usedItems(uses, kindOf, now.harness ?? null).length > 0
    }
    // Those under the kind's own heading; the rest are in sections of their own.
    const own = items.filter(one => one.group === undefined)
    // A row of tabs, the held one underlined; those the width has no room for
    // go on in a row under it.
    const bar = (
      prefix: string,
      tabs: readonly Tab[],
      heldId: string,
      onPress: (id: string) => Promise<unknown>,
      isMarked?: (id: string) => boolean,
    ) => {
      // Before a name: a blank cell, or for tabs that can be marked the mark's
      // cell and a blank one, so a dot does not touch the name.
      const lead = isMarked === undefined ? 1 : 2
      const taken = (one: Tab) => lead + cells(one.label) + 1

      return (
      <Box flexDirection="column">
        {tabs
          .reduce<Tab[][]>((lines, one) => {
            const last = lines[lines.length - 1]
            const used = (last ?? []).reduce((sum, each) => sum + taken(each), 0)

            if (last !== undefined && used + taken(one) <= width) {
              last.push(one)
            } else {
              lines.push([one])
            }

            return lines
          }, [])
          .map(line => {
            const selected = line.findIndex(one => one.id === heldId)

            return (
              <Box flexDirection="column">
                <Box>
                  {line.map(one => (
                    <Box>
                      <Text color="green">{isMarked?.(one.id) === true ? '● ' : ' '.repeat(lead)}</Text>
                      {one.id === heldId ? (
                        <Text bold color="cyan">
                          {one.label}{' '}
                        </Text>
                      ) : (
                        <Button
                          key={`${prefix}-${one.id}`}
                          plain
                          dimColor
                          label={`${one.label} `}
                          onPress={() => onPress(one.id)}
                        />
                      )}
                    </Box>
                  ))}
                </Box>
                {selected >= 0 && (
                  <Text color="cyan">
                    {' '.repeat(line.slice(0, selected).reduce((sum, one) => sum + taken(one), lead))}
                    {'━'.repeat(cells(line[selected]?.label ?? ''))}
                  </Text>
                )}
              </Box>
            )
          })}
      </Box>
      )
    }
    // The upper half: a page of items, each a button, the picked one marked.
    const listed = (items: HarnessItem[]) => {
      const pages = Math.max(1, Math.ceil(items.length / LIST_ROWS))
      const at = Math.min(heldPage, pages - 1)

      return (
        <Box flexDirection="column">
          {items.slice(at * LIST_ROWS, (at + 1) * LIST_ROWS).map((one, index, drawn) => {
            const key = [area?.id, section?.id, one.group?.replace(/\/$/, ''), one.name]
              .filter(part => part !== undefined)
              .join('/')
            // A section of its own opens where the page comes to its first item.
            const isOpening = one.group !== undefined && one.group !== drawn[index - 1]?.group
            const isPicked = opened?.key === key
            const isUsed = area?.id !== 'used' && section !== undefined && usesOf(uses, section.id, one) > 0
            const note = one.note ?? ''
            // An item with a file has an open button at the row's end.
            const kept = one.path === undefined ? 0 : cells(OPEN) + 1
            const space = room - 2 - kept - (note === '' ? 0 : cells(note) + 1)

            return (
              <Box flexDirection="column">
                {isOpening && top(`${one.group} · ${items.filter(each => each.group === one.group).length}`)}
                {row(
                  <Box>
                    <Text color={isPicked ? 'cyan' : 'green'}>{isPicked ? '▸ ' : isUsed ? '● ' : '  '}</Text>
                    <Button
                      key={`item-${key}`}
                      plain
                      dimColor={opened !== null && !isPicked}
                      label={pad(fit(one.name, space, 'start'), room - 2 - kept - cells(note))}
                      onPress={() => pick($, key, one)}
                    />
                    <Text dimColor>{note}</Text>
                    {one.path !== undefined && <Text> </Text>}
                    {one.path !== undefined && <Button key={`open-${key}`} plain label={OPEN} onPress={() => openFile($, one, app)} />}
                  </Box>,
                )}
              </Box>
            )
          })}
          {pages > 1 &&
            row(
              <Box>
                {at === 0 ? (
                  <Text dimColor>◂ 이전</Text>
                ) : (
                  <Button key="page-prev" plain label="◂ 이전" onPress={() => update($, page, () => at - 1)} />
                )}
                <Text dimColor>{`  ${at + 1}/${pages}  `}</Text>
                {at === pages - 1 ? (
                  <Text dimColor>다음 ▸</Text>
                ) : (
                  <Button key="page-next" plain label="다음 ▸" onPress={() => update($, page, () => at + 1)} />
                )}
              </Box>,
            )}
        </Box>
      )
    }
    // The lower half: the details of the item picked above, when it is one
    // of the scope and kind shown.
    const detailed = () => {
      const prefix = `${area?.id}/${section?.id}/`
      const picked = opened !== null && opened.key.startsWith(prefix) ? opened : null
      const rows = (picked?.lines ?? []).flatMap(line => wrap(line, room))
      const fields = picked?.fields ?? []
      // The fields' names in one column, as wide as the longest up to a third.
      const named = Math.min(Math.floor(room / 3), Math.max(0, ...fields.map(([name]) => cells(name)))) + 1

      return (
        <Box flexDirection="column">
          {top(picked === null ? '세부 내용' : `세부 내용 · ${fit(picked.title ?? '', room - 12, 'end')}`)}
          {picked === null && row(<Text dimColor>위에서 항목을 선택하세요.</Text>)}
          {wrap(picked?.path ?? '', room)
            .filter(line => line !== '')
            .map(line => row(<Text dimColor>{line}</Text>))}
          {fields.map(([name, value]) =>
            wrap(value, room - named).map((line, index) =>
              row(
                <Box>
                  <Text dimColor>{pad(index === 0 ? fit(name, named - 1, 'start') : '', named)}</Text>
                  <Text>{line}</Text>
                </Box>,
              ),
            ),
          )}
          {fields.length > 0 && <Text> </Text>}
          {picked?.text !== undefined && picked.text !== '' && (
            <Box paddingLeft={2} width={width}>
              <Markdown text={picked.text} />
            </Box>
          )}
          {(picked?.hooks ?? []).map(one => {
            // What it runs, laid out by its shell syntax; a line too long goes
            // on under itself, set in once more. The file [열기] opens has it whole.
            const ran = shellLines(one.command).flatMap(each => {
              const indent = Math.min(INDENT_MAX, each.depth * 2)

              return wrapWords(each.text, room - 2 - indent - 2).map(
                (piece, index) => `${' '.repeat(indent + (index === 0 ? 0 : 2))}${piece}`,
              )
            })
            const aside = `${one.type}${one.count === undefined ? '' : ` · ${times(one.count)}`}`
            const name = one.matcher === ALL ? '전체' : one.matcher

            return (
              <Box flexDirection="column">
                <Text> </Text>
                {row(
                  <Box>
                    <Text bold color="cyan">
                      {pad(fit(name, room - cells(aside) - 1, 'start'), room - cells(aside))}
                    </Text>
                    <Text dimColor>{aside}</Text>
                  </Box>,
                )}
                {one.shared !== undefined &&
                  row(
                    <Text dimColor>
                      {`공통 ${CIRCLED[one.shared.index - 1] ?? `(${one.shared.index})`} · ${one.shared.events}개 이벤트에서 같음`}
                    </Text>,
                  )}
                {ran.slice(0, HOOK_ROWS).map(line =>
                  row(
                    <Box>
                      <Text dimColor>│ </Text>
                      <Text>{line}</Text>
                    </Box>,
                  ),
                )}
                {ran.length > HOOK_ROWS && row(<Text dimColor>│ … 외 {ran.length - HOOK_ROWS}줄</Text>)}
              </Box>
            )
          })}
          {rows.slice(0, DETAIL_ROWS).map(line => row(<Text>{line}</Text>))}
          {rows.length > DETAIL_ROWS && row(<Text dimColor>… 외 {rows.length - DETAIL_ROWS}줄</Text>)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" width={width}>
        {bar('tab', TABS, shown, async id => {
          await update($, tab, () => id)

          // The harness is read again each time its tab is opened.
          if (id === HARNESS_TAB) {
            harness = await readHarness($).catch(() => harness)
            await refresh($, false).catch(() => undefined)
          }

          // And the project's files each time theirs is.
          if (id === FILES_TAB) {
            await readProject($).catch(() => undefined)
          }

          // The news shown is read when its tab is opened, unless it is fresh.
          if (id === NEWS_TAB) {
            void readFeed($, newsAt.source, false).catch(() => undefined)
          }

          // And the documentation's index, and the page that was open, when theirs is.
          if (id === DOCS_TAB) {
            void readDocIndex($, false).catch(() => undefined)

            if (docAt.picked !== '') {
              void readDocPage($, docAt.picked, false).catch(() => undefined)
            }
          }
        })}
        {isFirst && (
          <Box flexDirection="column">
            <Text> </Text>
            {now.account !== null &&
              row(
                <Box>
                  <Text color={'error' in now.account ? 'red' : 'green'}>● </Text>
                  <Text bold={!('error' in now.account)} dimColor={'error' in now.account}>
                    {fit(accountLine(now.account), room - 2, 'start')}
                  </Text>
                </Box>,
              )}
            {row(
              <Box>
                <Text color="cyan">
                  {fit(now.cwd, room - (now.branch === '' ? 0 : Math.min(cells(now.branch), 12) + 5), 'end')}
                </Text>
                {now.branch !== '' && <Text dimColor> · </Text>}
                {now.branch !== '' && <Text color={BRIGHT_MAGENTA}> {fit(now.branch, 12, 'start')}</Text>}
              </Box>,
            )}
            {row(
              <Box>
                <Text color="magenta">{now.model}</Text>
                {now.effort !== '' && <Text dimColor> · </Text>}
                {now.effort !== '' && <Text color={effortColor(now.effort)}>{now.effort}</Text>}
                <Text dimColor> · </Text>
                <Text color={BRIGHT_BLUE}>v{now.version}</Text>
              </Box>,
            )}
            {row(
              <Box>
                <Text>{span(now.now - now.startedAt)}</Text>
                <Text dimColor> · 프롬프트 </Text>
                <Text>{now.turns}</Text>
                {now.costUsd !== undefined && <Text dimColor> · </Text>}
                {now.costUsd !== undefined && <Text color="green">${now.costUsd.toFixed(2)}</Text>}
              </Box>,
            )}
            {row(<Text dimColor>{fit(`세션 ${now.sessionId}`, room, 'start')}</Text>)}
            {now.limits.length > 0 && top('사용량')}
            {now.limits.map((one, index) => (
              <Box flexDirection="column">
                {index > 0 && <Text> </Text>}
                {row(<Text bold>{fit(limitName(one.kind), room, 'start')}</Text>)}
                {row(
                  <Box>
                    <Text color={colorForLeft(100 - one.percentUsed)}>{meter(one.percentUsed)}</Text>
                    <Text>{usedLabel(one.percentUsed)}</Text>
                  </Box>,
                )}
                {one.resetsAt !== undefined && row(<Text dimColor>{fit(resetsLabel(one.resetsAt, now.now), room, 'start')}</Text>)}
              </Box>
            ))}
            {(now.breakdown !== null || now.ctxPercentUsed !== undefined) &&
              top(
                now.breakdown === null
                  ? '컨텍스트'
                  : `컨텍스트 · ${tokens(now.breakdown.total)} / ${tokens(now.breakdown.max)}`,
              )}
            {now.ctxPercentUsed !== undefined &&
              row(
                <Box>
                  <Text color={BRIGHT_MAGENTA}>{meter(now.ctxPercentUsed)}</Text>
                  <Text>{usedLabel(now.ctxPercentUsed)}</Text>
                </Box>,
              )}
            {ctxLeft !== undefined && row(<Text dimColor>{ctxLeft}% 남음 ({ctxLeftK}k)</Text>)}
            {now.breakdown?.categories.map(one => {
              const share = now.breakdown === null || now.breakdown.max === 0 ? 0 : (one.tokens / now.breakdown.max) * 100
              const isOutside = one.kind === 'deferred'

              return row(
                <Box>
                  <Text color={one.color} dimColor={isOutside}>■ </Text>
                  <Text dimColor={isOutside || one.kind === 'free'}>
                    {fit(one.name, room - 14, 'start').padEnd(room - 14)}
                  </Text>
                  <Text dimColor={isOutside}>
                    {tokens(one.tokens).padStart(7)}
                    {isOutside ? '     ' : `${share < 10 ? share.toFixed(1) : Math.round(share)}%`.padStart(5)}
                  </Text>
                </Box>,
              )
            })}
            <Text> </Text>
            {faceGap < 0 && row(<Text bold color="cyan">{clock}</Text>)}
            {faceGap >= 0 &&
              [0, 1, 2].map(line =>
                row(
                  <Box>
                    <Text>{' '.repeat(faceGap)}</Text>
                    <Text bold color="cyan">{hours[line]}</Text>
                    <Text dimColor> {COLON[line]} </Text>
                    <Text bold color={BRIGHT_BLUE}>{minutes[line]}</Text>
                  </Box>,
                ),
              )}
            {row(
              <Text dimColor>
                {centre(`${today.getMonth() + 1}월 ${today.getDate()}일 ${WEEKDAYS[today.getDay()] ?? ''}요일`)}
              </Text>,
            )}
          </Box>
        )}
        {shown === 'tab2' && (
          <Box flexDirection="column">
            {top(now.branch === '' ? 'Git' : `Git · ${fit(now.branch, room - 8, 'start')}`)}
            {now.git === null && row(<Text dimColor>Git 저장소가 아닙니다.</Text>)}
            {now.git !== null &&
              row(
                <Box>
                  <Text dimColor>스테이징 </Text>
                  <Text color="green">{now.git.staged}</Text>
                  <Text dimColor> · 수정 </Text>
                  <Text color="yellow">{now.git.unstaged}</Text>
                  <Text dimColor> · 새 파일 </Text>
                  <Text color="cyan">{now.git.untracked}</Text>
                </Box>,
              )}
            {now.git !== null &&
              row(
                <Box>
                  <Text color="green">+{now.git.added}</Text>
                  <Text color="red"> -{now.git.deleted}</Text>
                  <Text dimColor> · 원격 대비 </Text>
                  <Text>↑{now.git.ahead} ↓{now.git.behind}</Text>
                </Box>,
              )}
            {bottom()}
            {now.git !== null && top(`브랜치 · ${now.git.branches.length}`)}
            {now.git !== null && now.git.branches.length === 0 && row(<Text dimColor>브랜치가 없습니다.</Text>)}
            {now.git?.branches.slice(0, 8).map(one =>
              row(
                <Box>
                  <Text color="green">{one.isCurrent ? '● ' : '  '}</Text>
                  <Text bold={one.isCurrent} color={one.isCurrent ? BRIGHT_MAGENTA : undefined}>
                    {fit(one.name, room - 2, 'start')}
                  </Text>
                </Box>,
              ),
            )}
            {now.git !== null && now.git.branches.length > 8 && row(<Text dimColor>… 외 {now.git.branches.length - 8}개</Text>)}
            {now.git !== null && top('최근 커밋')}
            {now.git !== null && now.git.commits.length === 0 && row(<Text dimColor>커밋이 없습니다.</Text>)}
            {now.git?.commits.map(one =>
              row(
                <Box>
                  <Text color="yellow">{one.hash} </Text>
                  <Text>{fit(one.subject, room - cells(one.hash) - 1, 'start')}</Text>
                </Box>,
              ),
            )}
            {now.git !== null && top(`변경된 파일 · ${now.git.files.length}`)}
            {now.git !== null && now.git.files.length === 0 && row(<Text dimColor>변경 사항이 없습니다.</Text>)}
            {now.git?.files.slice(0, 12).map(one =>
              row(
                <Box>
                  <Text color={one.code === '??' ? 'cyan' : one.code[0] === ' ' ? 'yellow' : 'green'}>{one.code} </Text>
                  <Text>{fit(one.path, room - 3, 'end')}</Text>
                </Box>,
              ),
            )}
            {now.git !== null && now.git.files.length > 12 && row(<Text dimColor>… 외 {now.git.files.length - 12}개</Text>)}
            {now.git !== null && bottom()}
          </Box>
        )}
        {shown === 'tab5' && (
          <Box flexDirection="column">
            {top(`달력 · ${today.getFullYear()}년 ${today.getMonth() + 1}월`)}
            {row(<Text dimColor>{WEEKDAYS.join(' ')}</Text>)}
            {weeks.map(week =>
              row(
                <Box>
                  {week.map(cell =>
                    cell === null ? (
                      <Text>{'   '}</Text>
                    ) : (
                      <Box>
                        <Text
                          color={cell.isReset ? reset?.color : undefined}
                          inverse={cell.isToday}
                          bold={cell.isToday}
                          underline={cell.isReset && !cell.isToday}
                          dimColor={cell.isNextMonth && !cell.isReset}
                        >
                          {String(cell.day).padStart(2)}
                        </Text>
                        <Text> </Text>
                      </Box>
                    ),
                  )}
                </Box>,
              ),
            )}
            {reset !== null &&
              row(
                <Text color={reset.color}>
                  초기화 {dayLabel(reset.at)} {two(reset.at.getHours())}:{two(reset.at.getMinutes())}
                </Text>,
              )}
          </Box>
        )}
        {shown === NEWS_TAB &&
          (() => {
            const source = SOURCES.find(one => one.id === newsAt.source) ?? SOURCES[0]
            const feed = source === undefined ? undefined : feeds[source.id]
            const articles = feed?.articles ?? []
            const pages = Math.max(1, Math.ceil(articles.length / NEWS_ROWS))
            const at = Math.min(newsAt.page, pages - 1)
            const picked = articles.find(one => one.link === newsAt.picked)
            const space = room - 2 - 1 - AGE_CELLS
            const readAt = feed === undefined || feed.readAt === 0 ? null : new Date(feed.readAt)
            const pager = `◂ 이전  ${at + 1}/${pages}  다음 ▸`
            const when = picked === undefined || Number.isNaN(picked.at) ? null : new Date(picked.at)

            if (source === undefined) {
              return null
            }

            // A feed not yet read, as when the pane opens on this tab.
            if (feed === undefined) {
              void readFeed($, source.id, false).catch(() => undefined)
            }

            return (
              <Box flexDirection="column">
                {bar('news', SOURCES, source.id, async id => {
                  await update($, newsView, now => ({ ...NO_NEWS_VIEW, ...now, source: id, page: 0, picked: '' }))
                  void readFeed($, id, false).catch(() => undefined)
                })}
                {top(
                  readAt === null
                    ? (source.heading ?? source.label)
                    : `${source.heading ?? source.label} · ${articles.length}개 · ${two(readAt.getHours())}:${two(readAt.getMinutes())} 읽음`,
                )}
                {feed === undefined && row(<Text dimColor>피드를 읽는 중입니다.</Text>)}
                {feed !== undefined && feed.error !== '' && row(<Text color="red">{fit(feed.error, room, 'start')}</Text>)}
                {articles.slice(at * NEWS_ROWS, (at + 1) * NEWS_ROWS).map((one, index) => {
                  const age = one.aside ?? ago(one.at, now.now)
                  // A repository's words go in a second row, dim.
                  const words = source.isTrending === true ? one.summary || '(설명 없음)' : null

                  return (
                    <Box flexDirection="column">
                      {row(
                        <Box>
                          <Text color="cyan">{one.link === newsAt.picked ? '› ' : '  '}</Text>
                          <Button
                            key={`news-${source.id}-${at * NEWS_ROWS + index}`}
                            plain
                            label={pad(fit(one.title, space, 'start'), space)}
                            onPress={() =>
                              update($, newsView, now => {
                                const held = { ...NO_NEWS_VIEW, ...now }

                                return { ...held, picked: held.picked === one.link ? '' : one.link }
                              })
                            }
                          />
                          <Text dimColor={one.aside === undefined} color={one.aside === undefined ? undefined : 'yellow'}>
                            {' '.repeat(1 + Math.max(0, AGE_CELLS - cells(age)))}
                            {age}
                          </Text>
                        </Box>,
                      )}
                      {words !== null && row(<Text dimColor>{`  ${fit(words, room - 2, 'start')}`}</Text>)}
                    </Box>
                  )
                })}
                {row(
                  <Box>
                    {at === 0 ? (
                      <Text dimColor>◂ 이전</Text>
                    ) : (
                      <Button
                        key="news-prev"
                        plain
                        label="◂ 이전"
                        onPress={() => update($, newsView, now => ({ ...NO_NEWS_VIEW, ...now, page: at - 1 }))}
                      />
                    )}
                    <Text dimColor>{`  ${at + 1}/${pages}  `}</Text>
                    {at === pages - 1 ? (
                      <Text dimColor>다음 ▸</Text>
                    ) : (
                      <Button
                        key="news-next"
                        plain
                        label="다음 ▸"
                        onPress={() => update($, newsView, now => ({ ...NO_NEWS_VIEW, ...now, page: at + 1 }))}
                      />
                    )}
                    <Text>{' '.repeat(Math.max(1, room - cells(pager) - cells('새로고침')))}</Text>
                    <Button
                      key="news-refresh"
                      plain
                      label="새로고침"
                      onPress={() => void readFeed($, source.id, true).catch(() => undefined)}
                    />
                  </Box>,
                )}
                {top(
                  picked === undefined
                    ? '세부 내용'
                    : picked.meta !== undefined
                      ? `세부 내용 · ${picked.meta}`
                      : when === null
                        ? `세부 내용 · ${source.label}`
                        : `세부 내용 · ${source.label} · ${two(when.getMonth() + 1)}/${two(when.getDate())} ${two(when.getHours())}:${two(when.getMinutes())}`,
                )}
                {picked === undefined && row(<Text dimColor>위에서 기사를 고르세요.</Text>)}
                {picked !== undefined &&
                  (() => {
                    const summary = wrapWords(picked.summary, room)

                    return (
                      <Box flexDirection="column">
                        {wrapWords(picked.title, room).map(line => row(<Text bold>{line}</Text>))}
                        {picked.summary !== '' &&
                          summary
                            .slice(0, SUMMARY_ROWS)
                            .map((line, index) =>
                              row(
                                <Text dimColor>
                                  {index === SUMMARY_ROWS - 1 && summary.length > SUMMARY_ROWS ? fit(`${line}…`, room, 'start') : line}
                                </Text>,
                              ),
                            )}
                        {row(
                          <Box>
                            <Button
                              key="news-open"
                              plain
                              label={OPEN}
                              onPress={async () => {
                                const opened = await $.process.run(['open', picked.link], { timeoutMs: 5000 }).catch(() => null)

                                if (opened === null || opened.exitCode !== 0) {
                                  $.ui.toast(`기사를 열지 못했습니다: ${hostOf(picked.link)}`)
                                }
                              }}
                            />
                            <Text> </Text>
                            <Button
                              key="news-send"
                              plain
                              label={SEND}
                              onPress={async () => {
                                const filled = await $.prompt.fill({ text: `${picked.link} `, mode: 'insert' }).catch(() => null)

                                $.ui.toast(filled?.isFilled === true ? '프롬프트에 주소를 넣었습니다.' : '프롬프트에 넣지 못했습니다.')
                              }}
                            />
                            <Text dimColor> {fit(hostOf(picked.link), room - cells(OPEN) - cells(SEND) - 2, 'start')}</Text>
                          </Box>,
                        )}
                      </Box>
                    )
                  })()}
              </Box>
            )
          })()}
        {shown === DOCS_TAB &&
          (() => {
            const sections = docList?.sections ?? []
            const sectionAt = Math.min(docAt.section, Math.max(0, sections.length - 1))
            const section = sections[sectionAt]
            const rows = section === undefined ? [] : docRows(section)
            const pages = Math.max(1, Math.ceil(rows.length / DOC_ROWS))
            const at = Math.min(docAt.page, pages - 1)
            const count = sections.reduce((sum, one) => sum + one.groups.reduce((all, group) => all + group.pages.length, 0), 0)
            const readAt = docList === null || docList.readAt === 0 ? null : new Date(docList.readAt)
            const picked = docAt.picked === '' ? undefined : findDoc(sections, docAt.picked)
            const text: DocText | undefined = picked === undefined ? undefined : texts[picked.slug]
            const parts = text?.parts ?? []
            const partAt = Math.min(docAt.part, Math.max(0, parts.length - 1))
            const part: DocPart | undefined = parts[partAt]
            const link = picked === undefined ? DOCS_URL : `${DOCS_URL}/${picked.slug}`
            // The parts that start a heading, each a line of the headings' list.
            const heads = parts.flatMap((one, index) => (index === 0 || parts[index - 1]?.heading !== one.heading ? [{ index, heading: one.heading }] : []))
            // The links in the part shown to pages of the index, which the pane
            // turns to rather than the browser.
            const inner = [...(part?.text ?? '').matchAll(/\]\((https:\/\/code\.claude\.com\/docs\/ko\/[^)\s]+)\)/g)]
              .map(one => one[1] ?? '')
              .filter((one, index, all) => all.indexOf(one) === index && findDoc(sections, DOC_LINK.exec(one)?.[1] ?? '') !== undefined)
              .slice(0, 256)
            const toPart = async (place: number, isToc = false) => {
              await update($, docView, held => ({ ...NO_DOC_VIEW, ...held, part: place, isToc }))
              await $.ui.scroll({ in: PANE, to: { key: 'docs-open' }, block: 'start' }).catch(() => undefined)
            }
            const pager = (prefix: string, place: number, all: number, go: (page: number) => Promise<unknown>, end?: RenderChildren) => (
              <Box>
                {place === 0 ? (
                  <Text dimColor>◂ 이전</Text>
                ) : (
                  <Button key={`${prefix}-prev`} plain label="◂ 이전" onPress={() => go(place - 1)} />
                )}
                <Text dimColor>{`  ${place + 1}/${all}  `}</Text>
                {place === all - 1 ? (
                  <Text dimColor>다음 ▸</Text>
                ) : (
                  <Button key={`${prefix}-next`} plain label="다음 ▸" onPress={() => go(place + 1)} />
                )}
                {end}
              </Box>
            )
            const pagerCells = (place: number, all: number) => cells(`◂ 이전  ${place + 1}/${all}  다음 ▸`)

            // An index not yet read, as when the pane opens on this tab; and
            // the page it was on.
            if (docList === null) {
              void readDocIndex($, false).catch(() => undefined)
            }

            if (picked !== undefined && text === undefined) {
              void readDocPage($, picked.slug, false).catch(() => undefined)
            }

            return (
              <Box flexDirection="column">
                {top(
                  readAt === null
                    ? 'Claude Code 문서'
                    : `Claude Code 문서 · ${count}개 · ${two(readAt.getHours())}:${two(readAt.getMinutes())} 읽음`,
                )}
                {docList === null && row(<Text dimColor>문서 목록을 읽는 중입니다.</Text>)}
                {docList !== null && docList.error !== '' && row(<Text color="red">{fit(docList.error, room, 'start')}</Text>)}
                {sections.length > 0 &&
                  bar(
                    'docs-section',
                    sections.map((one, index) => ({ id: String(index), label: one.name })),
                    String(sectionAt),
                    id => update($, docView, held => ({ ...NO_DOC_VIEW, ...held, section: Number(id), page: 0 })),
                  )}
                {rows.slice(at * DOC_ROWS, (at + 1) * DOC_ROWS).map(one =>
                  one.kind === 'group'
                    ? row(<Text bold color="cyan">{fit(one.name, room, 'start')}</Text>)
                    : row(
                        <Box>
                          <Text color="cyan">{one.page.slug === picked?.slug ? '› ' : '  '}</Text>
                          <Button
                            key={`doc-${one.page.slug}`}
                            plain
                            label={fit(one.page.title, room - 2, 'start')}
                            onPress={() => pickDoc($, one.page.slug)}
                          />
                        </Box>,
                      ),
                )}
                {sections.length > 0 &&
                  row(
                    pager(
                      'docs',
                      at,
                      pages,
                      place => update($, docView, held => ({ ...NO_DOC_VIEW, ...held, page: place })),
                      <Box>
                        <Text>{' '.repeat(Math.max(1, room - pagerCells(at, pages) - cells('새로고침')))}</Text>
                        <Button
                          key="docs-refresh"
                          plain
                          label="새로고침"
                          onPress={async () => {
                            await readDocIndex($, true).catch(() => undefined)

                            if (picked !== undefined) {
                              await readDocPage($, picked.slug, true).catch(() => undefined)
                            }
                          }}
                        />
                      </Box>,
                    ),
                  )}
                {top(
                  picked === undefined || parts.length === 0
                    ? '문서 내용'
                    : `문서 내용 · ${part?.heading === '' ? '머리말' : fit(part?.heading ?? '', room - 12, 'start')}`,
                )}
                {picked === undefined && row(<Text dimColor>위에서 문서를 고르세요.</Text>)}
                {picked !== undefined && (
                  <Box flexDirection="column">
                    {wrapWords(text?.title || picked.title, room).map(line => row(<Text bold>{line}</Text>))}
                    {row(
                      <Box>
                        <Button
                          key="docs-open"
                          plain
                          label={OPEN}
                          onPress={async () => {
                            const opened = await $.process.run(['open', link], { timeoutMs: 5000 }).catch(() => null)

                            if (opened === null || opened.exitCode !== 0) {
                              $.ui.toast(`문서를 열지 못했습니다: ${hostOf(link)}`)
                            }
                          }}
                        />
                        <Text> </Text>
                        <Button
                          key="docs-send"
                          plain
                          label={SEND}
                          onPress={async () => {
                            const filled = await $.prompt.fill({ text: `${link} `, mode: 'insert' }).catch(() => null)

                            $.ui.toast(filled?.isFilled === true ? '프롬프트에 주소를 넣었습니다.' : '프롬프트에 넣지 못했습니다.')
                          }}
                        />
                      </Box>,
                    )}
                    {picked.about !== '' && wrapWords(picked.about, room).map(line => row(<Text dimColor>{line}</Text>))}
                    {text === undefined && row(<Text dimColor>문서를 읽는 중입니다.</Text>)}
                    {text !== undefined && text.error !== '' && wrapWords(text.error, room).map(line => row(<Text color="red">{line}</Text>))}
                    {parts.length > 1 &&
                      row(
                        pager(
                          'docs-part',
                          partAt,
                          parts.length,
                          place => toPart(place),
                          <Box>
                            <Text>{' '.repeat(Math.max(1, room - pagerCells(partAt, parts.length) - cells('목차')))}</Text>
                            <Button key="docs-toc" plain label="목차" onPress={() => toPart(partAt, !docAt.isToc)} />
                          </Box>,
                        ),
                      )}
                    {docAt.isToc &&
                      heads.map(one =>
                        row(
                          <Box>
                            <Text color="cyan">{one.index <= partAt && (heads.find(each => each.index > one.index)?.index ?? parts.length) > partAt ? '› ' : '  '}</Text>
                            <Button
                              key={`docs-toc-${one.index}`}
                              plain
                              label={fit(one.heading === '' ? '머리말' : one.heading, room - 2, 'start')}
                              onPress={() => toPart(one.index)}
                            />
                          </Box>,
                        ),
                      )}
                    {!docAt.isToc && part !== undefined && (
                      <Box flexDirection="column">
                        <Text> </Text>
                        {partAt > 0 && parts[partAt - 1]?.heading === part.heading && part.heading !== '' &&
                          row(<Text dimColor>{fit(`${part.heading} (이어서)`, room, 'start')}</Text>)}
                        <Box paddingLeft={2} width={width}>
                          <Markdown
                            key="docs-text"
                            text={part.text}
                            pressableLinks={inner}
                            onLinkPress={pressed => {
                              const slug = DOC_LINK.exec(pressed.href)?.[1]

                              if (slug !== undefined && findDoc(sections, slug) !== undefined) {
                                void pickDoc($, slug)
                                  .then(() => $.ui.scroll({ in: PANE, to: { key: 'docs-open' }, block: 'start' }))
                                  .catch(() => undefined)
                              }
                            }}
                          />
                        </Box>
                      </Box>
                    )}
                    {!docAt.isToc &&
                      parts.length > 1 &&
                      row(pager('docs-part-end', partAt, parts.length, place => toPart(place)))}
                  </Box>
                )}
              </Box>
            )
          })()}
        {shown === FILES_TAB &&
          (() => {
            const rows = fileRows(project?.paths ?? [], marks, view)
            const pages = Math.max(1, Math.ceil(rows.length / FILE_ROWS))
            const at = Math.min(view.page, pages - 1)
            const done = marks[view.picked] ?? []
            const isGone = done[done.length - 1]?.op === 'D'
            const picked = view.picked

            return (
              <Box flexDirection="column">
                {top(`파일 · 손댄 것 ${Object.keys(marks).length} / 전체 ${project?.paths.length ?? 0}`)}
                {project === null && row(<Text dimColor>파일 목록을 읽는 중입니다.</Text>)}
                {project?.isPartial === true && row(<Text dimColor>파일이 많아 일부만 표시합니다.</Text>)}
                {bar(
                  'files',
                  [
                    { id: 'all', label: '전체' },
                    { id: 'touched', label: '손댄 것만' },
                  ],
                  view.filter === 'touched' ? 'touched' : 'all',
                  id => update($, fileView, now => ({ ...NO_VIEW, ...now, filter: id, page: 0 })),
                )}
                {project !== null && rows.length === 0 && row(<Text dimColor>표시할 파일이 없습니다.</Text>)}
                {rows.slice(at * FILE_ROWS, (at + 1) * FILE_ROWS).map(one => {
                  const indent = Math.min(INDENT_FILES, one.depth * 2)
                  const space = room - indent - 2 - (OPS.length + 1)
                  const last = marks[one.path]?.[(marks[one.path]?.length ?? 0) - 1]

                  return row(
                    <Box>
                      <Text color="cyan">
                        {' '.repeat(indent)}
                        {one.isDir ? (one.isOpen ? '▾ ' : '▸ ') : one.path === picked ? '› ' : '  '}
                      </Text>
                      <Button
                        key={`${one.isDir ? 'dir' : 'file'}-${one.path}`}
                        plain
                        dimColor={!one.isDir && last?.op === 'D'}
                        label={pad(fit(one.name, space, 'start'), space)}
                        onPress={() =>
                          update($, fileView, now => {
                            const held = { ...NO_VIEW, ...now }

                            return one.isDir
                              ? {
                                  ...held,
                                  open: held.open.includes(one.path)
                                    ? held.open.filter(each => each !== one.path)
                                    : [...held.open, one.path],
                                }
                              : { ...held, picked: held.picked === one.path ? '' : one.path }
                          })
                        }
                      />
                      <Text>{' '.repeat(OPS.length + 1 - one.ops.length)}</Text>
                      {one.ops.map(op => (
                        <Text bold color={OP_COLORS[op]}>
                          {op}
                        </Text>
                      ))}
                    </Box>,
                  )
                })}
                {pages > 1 &&
                  row(
                    <Box>
                      {at === 0 ? (
                        <Text dimColor>◂ 이전</Text>
                      ) : (
                        <Button
                          key="files-prev"
                          plain
                          label="◂ 이전"
                          onPress={() => update($, fileView, now => ({ ...NO_VIEW, ...now, page: at - 1 }))}
                        />
                      )}
                      <Text dimColor>{`  ${at + 1}/${pages}  `}</Text>
                      {at === pages - 1 ? (
                        <Text dimColor>다음 ▸</Text>
                      ) : (
                        <Button
                          key="files-next"
                          plain
                          label="다음 ▸"
                          onPress={() => update($, fileView, now => ({ ...NO_VIEW, ...now, page: at + 1 }))}
                        />
                      )}
                    </Box>,
                  )}
                {top(
                  picked === ''
                    ? '세부 내용'
                    : `세부 내용 · ${fit(picked.slice(picked.lastIndexOf('/') + 1), room - 12, 'end')}`,
                )}
                {picked === '' && row(<Text dimColor>위에서 파일을 선택하세요.</Text>)}
                {picked !== '' && wrap(picked, room).map(line => row(<Text dimColor>{line}</Text>))}
                {picked !== '' &&
                  !isGone &&
                  project !== null &&
                  row(
                    <Button
                      key="file-open"
                      plain
                      label={OPEN}
                      onPress={() =>
                        openFile($, { name: picked.slice(picked.lastIndexOf('/') + 1), path: `${project.root}/${picked}` }, app)
                      }
                    />,
                  )}
                {picked !== '' && done.length === 0 && row(<Text dimColor>에이전트가 손대지 않은 파일입니다.</Text>)}
                {picked !== '' &&
                  done.map(one => {
                    const when = new Date(one.at)

                    return row(
                      <Box>
                        <Text dimColor>
                          {two(when.getHours())}:{two(when.getMinutes())}{' '}
                        </Text>
                        <Text bold color={OP_COLORS[one.op]}>
                          {one.op}
                        </Text>
                        <Text> {one.tool}</Text>
                      </Box>,
                    )
                  })}
              </Box>
            )
          })()}
        {shown === HARNESS_TAB && area !== undefined && section !== undefined && (
          <Box flexDirection="column">
            {bar(
              'scope',
              SCOPES,
              area.id,
              async id => {
                await update($, scope, () => id)
                await update($, page, () => 0)
              },
              // Only the two scopes are marked: all of what was used is used.
              id => (id === 'global' || id === 'project') && SECTIONS.some(one => isUsedIn(id, one.id)),
            )}
            {area.id === 'activity' && (
              <Box flexDirection="column">
                {top('활동')}
                {row(
                  <Box>
                    <Text dimColor>마지막 턴 </Text>
                    <Text>{acts.lastTurnMs === undefined ? '-' : span(acts.lastTurnMs)}</Text>
                    <Text dimColor> · 도구 호출 </Text>
                    <Text>{acts.total}</Text>
                  </Box>,
                )}
                {bottom()}
                {top('최근 도구 호출')}
                {acts.calls.length === 0 && row(<Text dimColor>아직 없습니다.</Text>)}
                {acts.calls.slice(-8).map(one =>
                  row(
                    <Box>
                      <Text color={one.state === 'run' ? 'yellow' : one.state === 'ok' ? 'green' : 'red'}>
                        {one.state === 'run' ? '●' : one.state === 'ok' ? '✓' : '✗'}{' '}
                      </Text>
                      <Text dimColor={one.state !== 'run'}>{fit(one.tool, room - 2, 'start')}</Text>
                    </Box>,
                  ),
                )}
                {bottom()}
                {top('도구별 횟수')}
                {acts.total === 0 && row(<Text dimColor>아직 없습니다.</Text>)}
                {Object.entries(acts.counts)
                  .sort((one, other) => other[1] - one[1])
                  .slice(0, 8)
                  .map(([tool, count]) =>
                    row(
                      <Box>
                        <Text>{fit(tool, room - 6, 'start').padEnd(room - 6)}</Text>
                        <Text color="cyan">{String(count).padStart(5)}</Text>
                      </Box>,
                    ),
                  )}
                {bottom()}
                {top(`에이전트 · ${now.agents.length}`)}
                {now.agents.length === 0 && row(<Text dimColor>실행한 에이전트가 없습니다.</Text>)}
                {now.agents.slice(-8).map(one =>
                  row(
                    <Box>
                      <Text color={AGENT_COLORS[one.status] ?? 'gray'}>● </Text>
                      <Text>{fit(one.name, room - 12, 'start').padEnd(room - 12)}</Text>
                      <Text color={AGENT_COLORS[one.status] ?? 'gray'}>{one.status.padStart(10)}</Text>
                    </Box>,
                  ),
                )}
                {bottom()}
              </Box>
            )}
            {area.id !== 'activity' && (
              <Box flexDirection="column">
            {bar(
              'kind',
              SECTIONS,
              section.id,
              async id => {
                await update($, kind, () => id)
                await update($, page, () => 0)
              },
              id => isUsedIn(area.id, id),
            )}
            {top(`${section.title} · ${area.label} ${own.length}`)}
            {area.id !== 'used' && now.harness === null && row(<Text dimColor>하네스 정보를 읽지 못했습니다.</Text>)}
            {area.id !== 'used' && now.harness !== null && own.length === 0 && row(<Text dimColor>항목이 없습니다.</Text>)}
            {area.id === 'used' && items.length === 0 && row(<Text dimColor>이 세션에서 사용된 항목이 없습니다.</Text>)}
            {listed(items)}
            {detailed()}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
