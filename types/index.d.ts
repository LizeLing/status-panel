export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Category = { name: string; tokens: number; color: string; kind: string }

export type Breakdown = { categories: Category[]; total: number; max: number }

export type GitFile = { code: string; path: string }

export type GitBranch = { name: string; isCurrent: boolean }

export type GitCommit = { hash: string; subject: string }

export type Git = {
  staged: number
  unstaged: number
  untracked: number
  added: number
  deleted: number
  ahead: number
  behind: number
  files: GitFile[]
  branches: GitBranch[]
  commits: GitCommit[]
}

export type Agent = { name: string; type: string; status: string }

export type Call = { id: string; tool: string; state: 'run' | 'ok' | 'err' }

export type Activity = { calls: Call[]; counts: Record<string, number>; total: number; lastTurnMs?: number }

export type Account = { email: string; plan?: string } | { error: string }

// `path` names the file a press previews; `lines` are details known already.
// `group` names the section an item is listed under, apart from its kind's
// own: a folder of instruction files (`rules/`), or the files they import.
export type HarnessItem = {
  name: string
  note?: string
  path?: string
  lines?: string[]
  group?: string
  hooks?: Hook[]
  // In the list of what was used, the tokens it took, by name.
  costs?: [string, string][]
}

// One settings hook of an event: what it is tried on, its kind, what it runs,
// and in the list of what was used how often it ran. A command several events
// run alike is `shared`: its number among those, and how many events run it.
export type Hook = {
  matcher: string
  type: string
  command: string
  count?: number
  shared?: { index: number; events: number }
}

// What the lower half shows of the item picked: plain `lines`, or for a file
// its path, the fields of its leading `---` block, and its markdown.
export type Detail = {
  key: string
  title: string
  lines: string[]
  path?: string
  fields?: [string, string][]
  text?: string
  hooks?: Hook[]
  // The file read and when it was last changed, to tell a later change by.
  file?: string
  at?: number
}

export type HarnessScope = {
  memory: HarnessItem[]
  agents: HarnessItem[]
  skills: HarnessItem[]
  mcp: HarnessItem[]
  hooks: HarnessItem[]
}

export type Harness = { global: HarnessScope; project: HarnessScope }

// How often each piece of the harness was used this session, by kind and key:
// a file's path, an agent type, a skill's name, `server\ttool`, and
// `event\tsubject` (what a hook's matcher is tried on).
export type Used = Record<keyof HarnessScope, Record<string, number>>

// The tokens a piece of the harness took this session, as the API counted
// them. An agent's are its own requests' four counts, `added` being what they
// processed anew (input, cache writes, output) and `reread` its cache reads.
// Any other piece's `added` is what it put into a loop's prompt, measured
// between two requests, and `reread` how much later requests read it again,
// over `rereads` of them. `isSplit` when part of it was shared out by text
// length among what came in together; `usd` prices it by the list prices.
export type Spent = {
  input: number
  output: number
  write: number
  read: number
  added: number
  reread: number
  rereads: number
  usd: number
  model?: string
  isSplit?: boolean
}

// What each piece took, by kind and by the keys `Used` has, and what the
// skill listing and each MCP server's tool schemas hold in every request.
export type Spending = {
  items: Record<keyof HarnessScope, Record<string, Spent>>
  standing: { skills: Record<string, number>; mcp: Record<string, number> }
}

// One thing the agent did to a file: made, read, changed or removed it, when,
// and by which tool.
export type FileOp = { op: 'C' | 'R' | 'U' | 'D'; at: number; tool: string }

// The project's files, as paths under its root; `isPartial` when there were
// more than are kept.
export type Files = { root: string; paths: string[]; isPartial: boolean }

// A file git sees changed against HEAD: made, changed or removed, as the
// files tab marks them, and the lines added and removed; a file git does not
// track yet has no count, nor has a binary one.
export type Change = { path: string; op: 'C' | 'U' | 'D'; added?: number; removed?: number; isUntracked?: true }

// The working tree's changes against HEAD as last read; `error` says why
// there are none to read (no repository, no commit yet).
export type Changes = { files: Change[]; error: string }

// A changed file's hunks as `git diff` prints them, from the first `@@`, and
// how many lines past the room were left out.
export type Hunks = { path: string; text: string; cut: number }

// How the files tab stands: all files, the touched ones or git's changes,
// the folders opened, the file picked, and the page shown.
export type FileView = { filter: string; open: string[]; picked: string; page: number }

// An article of a news feed: its title, link, summary (as much as the feed
// gives) and when it came out, as epoch milliseconds (NaN where the feed gave
// no date it reads).
// A trending repository has no date: `aside` stands where the age would (the
// stars of the day), and `meta` heads its details.
export type Article = { title: string; link: string; summary: string; at: number; aside?: string; meta?: string }

// A feed as last read: its articles, when it was read, and what went wrong
// the last time (empty when nothing did).
export type Feed = { articles: Article[]; readAt: number; error: string }

// How the news tab stands: the source shown, its page, and the article picked
// (by its link).
export type NewsView = { source: string; page: number; picked: string }

// A release's changes under one heading of the changelog: 추가, 변경, 개선,
// 수정, or empty for a release too short to be grouped.
export type ReleaseGroup = { kind: string; items: string[] }

export type Release = { version: string; groups: ReleaseGroup[] }

// The changelog as last read, as a feed is.
export type Changelog = { releases: Release[]; readAt: number; error: string }

// How the release tab stands: the page of versions, the version picked (empty
// for the one installed), the page of its changes, and the headings opened.
export type ReleaseView = { page: number; picked: string; detailPage: number; opened: string[] }

// A page of the Korean documentation as its index lists it: where it is under
// code.claude.com/docs/ko, its title and the line under it.
export type DocPage = { slug: string; title: string; about: string }

// A group of pages in a section, a group under another named by both.
export type DocGroup = { name: string; pages: DocPage[] }

// A section of the documentation, as the site's tabs divide it.
export type DocSection = { name: string; groups: DocGroup[] }

// The documentation's index as last read, as a feed is.
export type DocIndex = { sections: DocSection[]; readAt: number; error: string }

// A stretch of a page's text: what is under one heading, or a piece of it
// where that is long; `heading` is the heading it is under.
export type DocPart = { heading: string; text: string }

// A page's text as last read, in parts.
export type DocText = { title: string; parts: DocPart[]; readAt: number; error: string }

// How the docs tab stands: the section shown, the page of its list, the page
// picked, the part of it shown, and whether its headings are listed instead.
export type DocView = { section: number; page: number; picked: string; part: number; isToc: boolean }

// A piece of what the model reads: a block of a message (its words, a tool
// call, a tool's result, thinking, media) or a section of the system prompt,
// under the name it is drawn under.
export type ContextBlock = { title: string; text: string }

// An entry of the context as listed: a message by its place and who wrote it
// (`tone` is `user`, `result` or `assistant`), or a section of the system
// prompt by its id (`tone` its side of the cache, `shared` or `session`);
// its first words, its blocks and how many characters they hold.
export type ContextItem = { name: string; tone: string; preview: string; chars: number; blocks: ContextBlock[] }

// What the context tab read last: when, how many messages and sections, and
// what went wrong (empty when nothing did). The entries themselves stay in
// the module, as they can be long.
export type ContextRead = { readAt: number; messages: number; sections: number; error: string }

// How the context tab stands: the part shown (`messages` or `prompt`), the
// page of its list, the entry picked (by its name, empty for none) and the
// page of its blocks.
export type ContextView = { part: string; page: number; picked: string; detailPage: number }

export type Info = {
  cwd: string
  branch: string
  model: string
  effort: string
  version: string
  sessionId: string
  ctxPercentUsed?: number
  ctxWindow: number
  limits: Limit[]
  breakdown: Breakdown | null
  startedAt: number
  turns: number
  costUsd?: number
  git: Git | null
  agents: Agent[]
  account: Account | null
  harness: Harness | null
  now: number
}

declare module 'claude-code' {
  interface PluginState {
    'status-panel': { info: Info | null; tab: string; claudePart: string; activity: Activity; scope: string; kind: string; page: number; detail: Detail | null; used: Used; spent: Spending; files: Files | null; touched: Record<string, FileOp[]>; fileView: FileView; changes: Changes | null; hunks: Hunks | null; news: Record<string, Feed>; newsView: NewsView; changelog: Changelog | null; releaseView: ReleaseView; docIndex: DocIndex | null; docTexts: Record<string, DocText>; docView: DocView; contextRead: ContextRead | null; contextView: ContextView }
  }
}
