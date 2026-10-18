import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, SessionContextBreakdown, SessionRateLimit, SessionRepo } from 'claude-code'

const PANE = {
  component: 'Pane',
  requestId: 'status-panel',
  props: {
    title: 'Status',
    isFocused: false,
    bodyColumns: 34,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const RUN = {
  command: 'status-panel',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 29 },
  { kind: 'seven_day', percentUsed: 56 },
]

// The engine beneath the plugin: what its `$` calls resolve to.
// What /context would list; the pane reads the rows and the two totals.
const BREAKDOWN = {
  categories: [
    { name: 'System prompt', tokens: 3200, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 350000, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'MCP tools (deferred)', tokens: 42000, color: 'inactive', isDeferred: true, kind: 'deferred' },
    { name: 'Free space', tokens: 613800, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 353200,
  rawMaxTokens: 1000000,
} as unknown as SessionContextBreakdown

type Extra = { repo?: SessionRepo; agents?: AgentInfo[]; costUsd?: number; onOpen?: () => void }

const world = (on: On, percent: number | undefined, rateLimits: SessionRateLimit[], now = 0, extra: Extra = {}) => {
  const clock = mock.clock(on, { now })
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: '/home/me/work' }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  on('session.id', () => ({ value: 'cd064ad4' }))
  on('session.version', () => ({ value: { version: '2.1.291' } }))
  on('session.repo', () => ({ value: extra.repo ?? null }))
  on('session.turns', () => ({ value: 3 }))
  on('agent.list', () => ({ value: extra.agents ?? [] }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1000000, percent, breakdown: BREAKDOWN },
      rateLimits,
      cost: extra.costUsd === undefined ? undefined : { usd: extra.costUsd },
    },
  }))
  on('ui.open', () => {
    extra.onOpen?.()

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('fs.write', () => ({ value: undefined }))

  return clock
}

test('the pane draws the status line figures in four sections', async ($, on) => {
  world(on, 38, LIMITS)
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'status-panel', surface, ...PANE })

    for (const heading of [/^사용량$/, /^컨텍스트$/, /^Current session$/, /^Current week \(all models\)$/]) {
      expect(await ui.find({ type: 'Text', text: heading })).toBeDefined()
    }

    expect(await ui.find({ type: 'Text', text: /\/work$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +29% used$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +56% used$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ +38% used$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '62% 남음 (620k)' })).toBeDefined()
    await ui.unmount()
  }
})

test('sections without a reading are left out', async ($, on) => {
  world(on, undefined, [])
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^사용량$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /% used$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /요일$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^초기화 /})).toBeUndefined()
  await ui.unmount()
})

test('the calendar marks today and the weekly reset day', async ($, on) => {
  const reset = new Date(2026, 9, 10, 9, 0)
  world(on, 38, [{ kind: 'seven_day', percentUsed: 56, resetsAt: reset.toISOString() }], new Date(2026, 9, 7, 12, 0).getTime())
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  expect(await ui.find({ type: 'Text', text: /^ +10월 7일 수요일$/ })).toBeDefined()
  // 12:00 in seven-segment digits, on the status tab.
  expect((await ui.findAll({ type: 'Text', text: /^(?! +$)[ ╻┃╹╺━┓┏┛┗╸┫┣]{7}$/ })).map(one => one.text)).toEqual([
    '  ╻ ╺━┓',
    '┏━┓ ┏━┓',
    '  ┃ ┏━┛',
    '┃ ┃ ┃ ┃',
    '  ╹ ┗━╸',
    '┗━┛ ┗━┛',
  ])
  expect(await ui.find({ type: 'Text', text: /^달력$/ })).toBeUndefined()

  await ui.press({ key: 'tab-tab5' })
  expect(await ui.find({ type: 'Text', text: /^달력$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^ 7$/ }))?.props.inverse).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^10$/ }))?.props.underline).toBe(true)
  expect(await ui.find({ type: 'Text', text: '2026년 10월' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '초기화 10/10 (토) 09:00' })).toBeDefined()
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('a reset in the next month extends the grid to its week', async ($, on) => {
  const reset = new Date(2026, 10, 3, 9, 0)
  world(on, 38, [{ kind: 'seven_day', percentUsed: 56, resetsAt: reset.toISOString() }], new Date(2026, 9, 29, 12, 0).getTime())
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-tab5' })

  expect((await ui.find({ type: 'Text', text: /^29$/ }))?.props.inverse).toBe(true)
  const threes = await ui.findAll({ type: 'Text', text: /^ 3$/ })
  expect(threes.map(one => one.props.underline)).toEqual([false, true])
  expect(await ui.find({ type: 'Text', text: '초기화 11/03 (화) 09:00' })).toBeDefined()
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the context card lists the rows of /context with tokens and shares', async ($, on) => {
  world(on, 38, LIMITS)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  expect(await ui.find({ type: 'Text', text: /^컨텍스트$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +353k \/ 1\.0M$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^System prompt +$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {3}3\.2k 0\.3%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {3}350k {2}35%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}42k {5}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Autocompact buffer$/ })).toBeDefined()
  await ui.unmount()
})

test('each tab shows its own cards and nothing of the others', async ($, on) => {
  world(on, 38, LIMITS)
  await $.command.run(RUN)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'status-panel', surface, ...PANE })

    for (const card of [/^사용량$/, /^컨텍스트$/]) {
      expect(await ui.find({ type: 'Text', text: card })).toBeDefined()
    }

    await ui.press({ key: 'tab-tab2' })
    expect(await ui.find({ type: 'Text', text: /^컨텍스트$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'Git 저장소가 아닙니다.' })).toBeDefined()

    // The activity is inside the harness tab, beside its scopes, with no row of kinds.
    expect(await ui.find({ key: 'tab-tab3' })).toBeUndefined()
    await ui.press({ key: 'tab-tab6' })
    expect(await ui.find({ type: 'Text', text: /^Git$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^최근 도구 호출$/ })).toBeUndefined()
    await ui.press({ key: 'scope-activity' })
    expect(await ui.find({ type: 'Text', text: /^최근 도구 호출$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '실행한 에이전트가 없습니다.' })).toBeDefined()
    expect(await ui.find({ key: 'kind-agents' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^세부 내용$/ })).toBeUndefined()
    await ui.press({ key: 'scope-global' })
    expect(await ui.find({ key: 'kind-agents' })).toBeDefined()

    await ui.press({ key: 'tab-tab1' })
    expect(await ui.find({ type: 'Text', text: /^컨텍스트$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('each rate-limit window is drawn as /usage draws it: name, meter, reset', async ($, on) => {
  const now = new Date(2026, 9, 7, 12, 0).getTime()
  world(
    on,
    38,
    [
      { kind: 'five_hour', percentUsed: 28, resetsAt: new Date(2026, 9, 7, 16, 7).toISOString() },
      { kind: 'seven_day', percentUsed: 72, resetsAt: new Date(2026, 9, 13, 8, 0).toISOString() },
      { kind: 'seven_day_fable', percentUsed: 0, resetsAt: new Date(2026, 9, 13, 0, 0).toISOString() },
    ],
    now,
  )
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  expect((await ui.findAll({ type: 'Text', text: /^Current / })).map(one => one.text)).toEqual([
    'Current session',
    'Current week (all models)',
    'Current week (fable)',
  ])
  // 22 cells of meter in a 34-cell pane: 28% fills 6, 72% fills 16, 0% none.
  expect((await ui.findAll({ type: 'Text', text: /^[█ ]{22}$/ })).map(one => one.text.trimEnd().length)).toEqual([6, 16, 0, 8])
  expect((await ui.findAll({ type: 'Text', text: /% used$/ })).map(one => one.text.trim())).toEqual([
    '28% used',
    '72% used',
    '0% used',
    '38% used',
  ])
  expect(await ui.find({ type: 'Text', text: /^Resets 4:07pm/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Resets Oct 13 at 8am/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Resets Oct 13 at 12am/ })).toBeDefined()
  await ui.unmount()
})

test('the session row shows the time elapsed, the prompts sent and the cost', async ($, on) => {
  world(on, 38, LIMITS, (83 * 60 + 5) * 1000, { costUsd: 1.234 })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  expect(await ui.find({ type: 'Text', text: /^1h 23m$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^3$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\$1\.23$/ })).toBeDefined()
  await ui.unmount()
})

test('the git tab counts the working copy and lists its changed files', async ($, on) => {
  world(on, 38, LIMITS, 0, { repo: { root: '/home/me/work', remote: null, internal: false, name: 'work' } })
  on('process.run', (_, e) => {
    const stdout = e.argv.includes('status')
      ? '# branch.oid abc\n# branch.head main\n# branch.ab +2 -1\n' +
        '1 M. N... 100644 100644 100644 aaa bbb src/staged file.ts\n' +
        '1 .M N... 100644 100644 100644 aaa bbb src/edited.ts\n' +
        '2 R. N... 100644 100644 100644 aaa bbb R100 new name.ts\told.ts\n' +
        '? notes.md\n'
      : e.argv.includes('--numstat')
        ? '120\t34\tsrc/edited.ts\n-\t-\timage.png\n'
        : e.argv.includes('branch')
          ? '*\tmain\n \tfeature/calendar\n \tfix/tabs\n'
          : e.argv.includes('log')
            ? 'a1b2c3d\tAdd the calendar tab\n' +
              'e4f5a6b\tFix a tab underline that drifted with long names\n' +
              '0c1d2e3\tFirst commit\n'
            : 'main\n'

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-tab2' })

  expect(await ui.find({ type: 'Text', text: /^Git$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +main$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^\d+$/ })).map(one => one.text)).toEqual(['2', '1', '1'])
  expect(await ui.find({ type: 'Text', text: /^\+120$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ -34$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^↑2 ↓1$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^main$/ }))?.props.bold).toBe(true)
  expect((await ui.find({ type: 'Text', text: /^feature\/calendar$/ }))?.props.bold).toBe(false)
  expect(await ui.find({ type: 'Text', text: /^fix\/tabs$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^[0-9a-f]{7} $/ })).map(one => one.text)).toEqual([
    'a1b2c3d ',
    'e4f5a6b ',
    '0c1d2e3 ',
  ])
  expect(await ui.find({ type: 'Text', text: /^Add the calendar tab$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Fix a tab underline tha…$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^변경된 파일$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ +4$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^src\/staged file\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^new name\.ts$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the activity inside the harness tab follows tool calls and lists the agents', async ($, on) => {
  world(on, 38, LIMITS, 0, {
    agents: [{ id: 'a1', description: 'search the repo', type: 'Explore', status: 'running', name: 'scout' }],
  })
  on('tool.call', { tool: 'Read' }, () => ({ result: {}, text: 'ok' }) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: {}, text: 'boom', isError: true }) as never)
  await $.tool.call({ tool: 'Read', file_path: '/x' })
  await $.tool.call({ tool: 'Read', file_path: '/y' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-tab6' })
  await ui.press({ key: 'scope-activity' })

  expect((await ui.findAll({ type: 'Text', text: /^[✓✗●] $/ })).map(one => one.text)).toEqual(['✓ ', '✓ ', '✗ ', '● '])
  expect(await ui.find({ type: 'Text', text: /^Read +$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {4}2$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^에이전트$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^scout +$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {3}running$/ })).toBeDefined()
  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the status tab opens with the signed-in account and its plan', async ($, on) => {
  world(on, 38, LIMITS)
  on('process.run', (_, e) => {
    const stdout = e.argv[0] === 'claude'
      ? JSON.stringify({ loggedIn: true, email: 'someone@example.com', subscriptionType: 'max' })
      : ''

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const at = texts.indexOf('someone@example.com (max)')

  expect(at).toBeGreaterThan(-1)
  expect(at).toBeLessThan(texts.findIndex(one => one.includes('/work')))
  await ui.press({ key: 'tab-tab2' })
  expect(await ui.find({ type: 'Text', text: 'someone@example.com (max)' })).toBeUndefined()
})

const harness = (on: On) => {
  const FILES: Record<string, string> = {
    '/home/me/.claude/CLAUDE.md': 'one\n\ntwo\nthree',
    '/home/me/.claude/rules/env.md': '`@not/read.md` @~/.config/tool/guide.md',
    '/home/me/.config/tool/guide.md': 'a\n@./more.md @nobody',
    '/home/me/.config/tool/more.md': 'b',
    '/home/me/.claude/projects/-home-me-work/memory/MEMORY.md': 'm',
    '/home/me/.claude/agents/worker.md': '---\nname: lastmile-worker\nmodel: sonnet\n---\nbody',
    '/home/me/.claude.json': JSON.stringify({
      mcpServers: { rea: { command: 'rea-server', args: ['--stdio'], env: { TOKEN: 'secret' } } },
      projects: { '/home/me/work': { mcpServers: { local: { type: 'sse', url: 'http://x/sse?key=secret' } } } },
    }),
    '/home/me/work/CLAUDE.md': 'one\ntwo',
    '/home/me/work/.mcp.json': JSON.stringify({ mcpServers: { wiki: { url: 'http://y' } } }),
  }
  const DIRS: Record<string, [string, 'file' | 'dir'][]> = {
    '/home/me/.claude/rules': [['env.md', 'file']],
    '/home/me/.claude/projects/-home-me-work/memory': [['MEMORY.md', 'file'], ['notes.txt', 'file']],
    '/home/me/.claude/agents': [['worker.md', 'file']],
    '/home/me/.claude/skills': [['lastmile', 'dir'], ['notes.zip', 'file'], ['empty', 'dir']],
    '/home/me/.claude/commands': [['commit.md', 'file']],
    '/home/me/work/.claude/skills': [['deploy', 'dir']],
  }
  on('session.root', () => ({ value: '/home/me/work' }))
  on('fs.read', (_, e) => {
    const text = FILES[String(e.path)]

    if (text === undefined) {
      throw new Error('ENOENT')
    }

    return { value: text } as never
  })
  on('fs.list', (_, e) => {
    const entries = DIRS[String(e.path)]

    if (entries === undefined) {
      throw new Error('ENOENT')
    }

    return { value: entries.map(([name, kind]) => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.exists', (_, e) => ({ value: /\/(lastmile|deploy)\/SKILL\.md$/.test(String(e.path)) }))
  on('settings.read', (_, e) => ({
    value: (e.source === 'user'
      ? {
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', hooks: [{ command: 'guard' }, { command: 'log' }] },
              { hooks: [{ command: 'all' }] },
            ],
            Stop: [{ hooks: [{ command: 'bye' }] }],
          },
        }
      : e.source === 'local'
        ? { hooks: { SessionStart: [{ hooks: [{ command: 'hi' }] }] } }
        : {}) as never,
  }))
}

test('the harness tab has a row of scopes and a row of kinds, and lists the items of the held pair', async ($, on) => {
  world(on, 38, LIMITS)
  harness(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())
  const has = async (key: string) => (await ui.find({ key: `item-${key}` })) !== undefined

  expect(await ui.find({ key: 'scope-project' })).toBeUndefined()
  expect(await ui.find({ key: 'kind-agents' })).toBeUndefined()
  await ui.press({ key: 'tab-tab6' })
  expect(await texts()).toEqual(expect.arrayContaining(['하네스', '글로벌', 'CLAUDE']))
  expect(await ui.find({ type: 'Text', text: /^CLAUDE\.md$/ })).toBeDefined()
  expect(await has('global/memory/CLAUDE.md')).toBe(true)
  expect(await has('project/memory/CLAUDE.md')).toBe(false)
  expect(await texts()).toContain('4줄 14자')

  await ui.press({ key: 'scope-project' })
  expect(await ui.find({ type: 'Text', text: /^ {11}━{4}$/ })).toBeDefined()
  expect(await has('project/memory/CLAUDE.md')).toBe(true)
  expect(await has('global/memory/CLAUDE.md')).toBe(false)
  expect(await texts()).toContain('2줄 7자')

  await ui.press({ key: 'kind-agents' })
  expect(await ui.find({ type: 'Text', text: /^ {11}━{5}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^SubAgent$/ })).toBeDefined()
  expect(await texts()).toContain('항목이 없습니다.')
  await ui.press({ key: 'scope-global' })
  expect(await has('global/agents/lastmile-worker')).toBe(true)
  expect(await texts()).toContain('sonnet')

  await ui.press({ key: 'kind-skills' })
  expect(await has('global/skills/lastmile')).toBe(true)
  expect(await has('global/skills//commit')).toBe(true)
  expect(await has('global/skills/empty')).toBe(false)
  expect(await has('global/skills/notes.zip')).toBe(false)
  await ui.press({ key: 'scope-project' })
  expect(await has('project/skills/deploy')).toBe(true)

  await ui.press({ key: 'kind-mcp' })
  expect(await has('project/mcp/wiki')).toBe(true)
  expect(await has('project/mcp/local')).toBe(true)
  expect(await texts()).toEqual(expect.arrayContaining(['http', 'sse']))
  await ui.press({ key: 'scope-global' })
  expect(await has('global/mcp/rea')).toBe(true)
  expect(await texts()).toContain('stdio')

  await ui.press({ key: 'kind-hooks' })
  expect(await has('global/hooks/PreToolUse')).toBe(true)
  expect(await has('global/hooks/Stop')).toBe(true)
  expect(await texts()).toContain('3개')
  await ui.press({ key: 'scope-project' })
  expect(await has('project/hooks/SessionStart')).toBe(true)
  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('a press on a harness item shows its details under the list, and a second press clears them', async ($, on) => {
  world(on, 38, LIMITS)
  harness(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())

  await ui.press({ key: 'tab-tab6' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(await texts()).toEqual(expect.arrayContaining(['세부 내용', '위에서 항목을 선택하세요.']))
  await ui.press({ key: 'item-global/memory/CLAUDE.md' })

  // Under the whole list, not under the item pressed.
  const drawn = await texts()
  expect(drawn).toContain('~/.claude/CLAUDE.md')
  // The file whole, blank lines and all, as markdown.
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('one\n\ntwo\nthree')
  expect(drawn.indexOf('세부 내용')).toBeGreaterThan(drawn.findIndex(one => /^1줄 /.test(one)))
  expect(drawn.indexOf('~/.claude/CLAUDE.md')).toBeGreaterThan(drawn.indexOf('세부 내용'))
  expect(drawn).not.toContain('위에서 항목을 선택하세요.')
  await ui.press({ key: 'item-global/memory/CLAUDE.md' })
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  // A file's leading block is drawn as fields, and the rest as markdown.
  await ui.press({ key: 'kind-agents' })
  await ui.press({ key: 'item-global/agents/lastmile-worker' })
  expect(await texts()).toEqual(expect.arrayContaining(['name', 'lastmile-worker', 'model']))
  expect(await texts()).not.toContain('---')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('body')
  await ui.press({ key: 'item-global/agents/lastmile-worker' })

  await ui.press({ key: 'kind-mcp' })
  await ui.press({ key: 'item-global/mcp/rea' })
  expect(await texts()).toEqual(expect.arrayContaining(['rea-server --stdio', 'env: TOKEN']))
  await ui.press({ key: 'scope-project' })
  expect(await texts()).not.toContain('rea-server --stdio')
  await ui.press({ key: 'item-project/mcp/local' })
  expect(await texts()).toContain('http://x/sse')
  expect((await texts()).some(one => one.includes('secret'))).toBe(false)

  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'kind-hooks' })
  await ui.press({ key: 'item-global/hooks/PreToolUse' })
  // Each hook: what it is tried on and its kind, then what it runs.
  expect(await texts()).toEqual(expect.arrayContaining(['~/.claude/settings.json', 'Bash', 'command', 'guard', 'log', '전체', 'all']))
  expect((await texts()).some(one => one.includes('→'))).toBe(false)
  await ui.press({ key: 'item-global/hooks/PreToolUse' })
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the harness lists nothing for the project when the session started in the home directory', async ($, on) => {
  world(on, 38, LIMITS)
  on('session.root', () => ({ value: '/home/me' }))
  on('fs.read', (_, e) => {
    if (String(e.path) !== '/home/me/.claude/CLAUDE.md') {
      throw new Error('ENOENT')
    }

    return { value: 'one' } as never
  })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-tab6' })

  expect(await ui.find({ key: 'item-global/memory/CLAUDE.md' })).toBeDefined()
  await ui.press({ key: 'scope-project' })
  expect(await ui.find({ key: 'item-project/memory/CLAUDE.md' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '항목이 없습니다.' })).toBeDefined()
  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('a list longer than the upper half is paged', async ($, on) => {
  world(on, 38, LIMITS)
  on('session.root', () => ({ value: '/home/me/work' }))
  on('fs.list', (_, e) => {
    if (String(e.path) !== '/home/me/.claude/skills') {
      throw new Error('ENOENT')
    }

    return {
      value: Array.from({ length: 12 }, (_, at) => ({
        name: `s${String(at + 1).padStart(2, '0')}`,
        kind: 'dir' as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  on('fs.exists', () => ({ value: true }))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())

  await ui.press({ key: 'tab-tab6' })
  expect(await ui.find({ key: 'page-next' })).toBeUndefined()
  await ui.press({ key: 'kind-skills' })
  expect(await ui.find({ key: 'item-global/skills/s10' })).toBeDefined()
  expect(await ui.find({ key: 'item-global/skills/s11' })).toBeUndefined()
  expect(await ui.find({ key: 'page-prev' })).toBeUndefined()
  expect(await texts()).toContain('1/2')
  await ui.press({ key: 'page-next' })
  expect(await ui.find({ key: 'item-global/skills/s01' })).toBeUndefined()
  expect(await ui.find({ key: 'item-global/skills/s12' })).toBeDefined()
  expect(await texts()).toContain('2/2')
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'kind-skills' })
  expect(await ui.find({ key: 'item-global/skills/s01' })).toBeDefined()
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the harness marks what the session used, and lists it with counts under 사용됨', async ($, on) => {
  world(on, 38, LIMITS)
  harness(on)
  on('tool.call', { tool: /^mcp__/ }, () => ({ result: {}, text: 'ok' }) as never)
  on('classic.InstructionsLoaded', () => ({}))
  on('classic.Stop', () => ({}))
  on('tool.call', { tool: 'Bash' }, () => ({ result: {}, text: 'ok' }) as never)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }) as never)
  on('skill.prompt', (_, e) => ({ text: e.text }))
  await $.command.run(RUN)
  await $.classic.InstructionsLoaded({
    file_path: '/home/me/work/CLAUDE.md',
    memory_type: 'Project',
    load_reason: 'nested_traversal',
  })
  await $.tool.call({ tool: 'mcp__rea__open_binary' } as never)
  await $.tool.call({ tool: 'mcp__rea__open_binary' } as never)
  await $.tool.call({ tool: 'mcp__claude_ai_Gmail__search' } as never)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.agent.spawn({ subagentType: 'lastmile-worker', prompt: 'p', description: 'd' } as never)
  await $.skill.prompt({ skill: 'lastmile', text: 't' } as never)
  await $.skill.prompt({ skill: 'eli5', text: 't' } as never)
  await $.classic.Stop({} as never)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())
  const has = async (key: string) => (await ui.find({ key: `item-${key}` })) !== undefined

  // In the lists, a dot marks the used ones alone.
  await ui.press({ key: 'tab-tab6' })

  // On the tabs too: both scopes hold something used, and of the global
  // scope every kind but the instruction files.
  // The tabs stand before the first heading, the list after it; a dot is
  // followed by a blank cell in both.
  const dots = async (where: 'tabs' | 'list') => {
    const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
    const cut = texts.indexOf('▍')

    return (where === 'tabs' ? texts.slice(0, cut) : texts.slice(cut)).filter(one => one === '● ').length
  }
  const marks = () => dots('tabs')
  expect(await marks()).toBe(2 + 4)
  expect(await dots('list')).toBe(0)
  await ui.press({ key: 'scope-project' })
  expect(await dots('list')).toBe(1)
  await ui.press({ key: 'kind-skills' })
  expect(await dots('list')).toBe(0)
  await ui.press({ key: 'scope-global' })
  expect(await dots('list')).toBe(1)

  // Of the local scope, the instruction files alone.
  await ui.press({ key: 'scope-project' })
  expect(await marks()).toBe(2 + 1)
  await ui.press({ key: 'scope-used' })
  expect(await marks()).toBe(2 + 5)
  expect(await has('used/skills/lastmile')).toBe(true)
  expect(await has('used/skills/eli5')).toBe(true)
  expect(await has('used/skills/commit')).toBe(false)
  await ui.press({ key: 'item-used/skills/eli5' })
  expect(await texts()).toContain('목록에 없는 항목입니다.')
  await ui.press({ key: 'item-used/skills/lastmile' })
  // The path, wrapped at the pane's width.
  expect(await texts()).toEqual(expect.arrayContaining(['~/.claude/skills/lastmile/SKILL.', 'md']))

  await ui.press({ key: 'kind-memory' })
  expect(await has('used/memory/~/work/CLAUDE.md')).toBe(true)
  expect(await has('used/memory/~/.claude/rules/env.md')).toBe(false)

  await ui.press({ key: 'kind-agents' })
  expect(await has('used/agents/lastmile-worker')).toBe(true)
  expect(await texts()).toContain('1회')

  await ui.press({ key: 'kind-mcp' })
  expect(await has('used/mcp/rea')).toBe(true)
  expect(await has('used/mcp/claude_ai_Gmail')).toBe(true)
  expect(await has('used/mcp/wiki')).toBe(false)
  expect(await texts()).toContain('2회')
  await ui.press({ key: 'item-used/mcp/rea' })
  expect(await texts()).toContain('open_binary · 2회')

  // PreToolUse fired for four tool calls, one of them Bash: the `Bash` hooks
  // ran once each, the unmatched one four times.
  await ui.press({ key: 'kind-hooks' })
  expect(await has('used/hooks/PreToolUse')).toBe(true)
  expect(await has('used/hooks/Stop')).toBe(true)
  expect(await has('used/hooks/SessionStart')).toBe(false)
  await ui.press({ key: 'item-used/hooks/PreToolUse' })
  expect(await texts()).toEqual(expect.arrayContaining(['Bash', 'command · 1회', 'guard', 'log', '전체', 'command · 4회', 'all']))
  await ui.press({ key: 'item-used/hooks/PreToolUse' })
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('CLAUDE.md stands alone, and each folder and the imported files are sections of their own', async ($, on) => {
  world(on, 38, LIMITS)
  harness(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())
  const has = async (key: string) => (await ui.find({ key: `item-${key}` })) !== undefined

  // Global: CLAUDE.md under the kind's heading, then rules/, then what they import
  // (the import of an import too; not a name in code, nor one that is no file).
  await ui.press({ key: 'tab-tab6' })
  const drawn = await texts()
  expect(drawn).toEqual(expect.arrayContaining(['CLAUDE.md', '글로벌 1', 'rules/', '불러온 파일']))
  expect(drawn.indexOf('rules/')).toBeGreaterThan(drawn.indexOf('4줄 14자'))
  expect(drawn.indexOf('불러온 파일')).toBeGreaterThan(drawn.indexOf('rules/'))
  expect(drawn).not.toContain('memory/')
  expect(await has('global/memory/CLAUDE.md')).toBe(true)
  expect(await has('global/memory/rules/env.md')).toBe(true)
  expect(await has('global/memory/불러온 파일/~/.config/tool/guide.md')).toBe(true)
  expect(await has('global/memory/불러온 파일/~/.config/tool/more.md')).toBe(true)
  expect((await ui.findAll({ type: 'Button' })).filter(one => /^item-.*불러온 파일/.test(String(one.props.key)))).toHaveLength(2)
  await ui.press({ key: 'item-global/memory/rules/env.md' })
  expect(await texts()).toEqual(expect.arrayContaining(['env.md', '~/.claude/rules/env.md']))
  await ui.press({ key: 'item-global/memory/rules/env.md' })

  // Local: the project's own files, then its auto memory.
  await ui.press({ key: 'scope-project' })
  expect(await texts()).toEqual(expect.arrayContaining(['로컬 1', 'memory/']))
  expect(await texts()).not.toContain('rules/')
  expect(await has('project/memory/CLAUDE.md')).toBe(true)
  expect(await has('project/memory/memory/MEMORY.md')).toBe(true)
  expect(await has('project/memory/memory/notes.txt')).toBe(false)
  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the pane opens as the session starts, before anything that takes reading', async ($, on) => {
  const order: string[] = []
  world(on, 38, LIMITS, 0, { onOpen: () => order.push('open') })
  on('process.run', () => {
    order.push('run')

    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.list', () => {
    order.push('list')

    throw new Error('ENOENT')
  })
  on('session.start', () => ({ cwd: '/home/me/work' }) as never)
  on('settings.read', () => ({ value: {} as never }))
  on('command.register', () => ({ value: { command: 'status-panel' } }) as never)
  await $.session.start({} as never)

  expect(order[0]).toBe('open')
})

const opens = (on: On) => {
  const opened: string[][] = []
  on('process.run', (_, e) => {
    if (e.argv[0] === 'open') {
      opened.push([...e.argv])
    }

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  return opened
}

test('each harness item has an open button that hands its file, or the settings file defining it, to the system', async ($, on) => {
  world(on, 38, LIMITS)
  harness(on)
  const opened = opens(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  await ui.press({ key: 'tab-tab6' })
  await ui.press({ key: 'open-global/memory/rules/env.md' })
  await ui.press({ key: 'kind-skills' })
  await ui.press({ key: 'open-global/skills/lastmile' })
  await ui.press({ key: 'kind-mcp' })
  await ui.press({ key: 'open-global/mcp/rea' })
  await ui.press({ key: 'scope-project' })
  await ui.press({ key: 'open-project/mcp/wiki' })
  await ui.press({ key: 'open-project/mcp/local' })
  await ui.press({ key: 'kind-hooks' })
  await ui.press({ key: 'open-project/hooks/SessionStart' })
  await ui.press({ key: 'scope-global' })
  await ui.press({ key: 'open-global/hooks/Stop' })

  expect(opened).toEqual([
    ['open', '/home/me/.claude/rules/env.md'],
    ['open', '/home/me/.claude/skills/lastmile/SKILL.md'],
    ['open', '/home/me/.claude.json'],
    ['open', '/home/me/work/.mcp.json'],
    ['open', '/home/me/.claude.json'],
    ['open', '/home/me/work/.claude/settings.local.json'],
    ['open', '/home/me/.claude/settings.json'],
  ])
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the open button uses the app the mod is configured with', { options: { openWith: 'Visual Studio Code' } }, async ($, on) => {
  world(on, 38, LIMITS)
  harness(on)
  const opened = opens(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })

  await ui.press({ key: 'tab-tab6' })
  await ui.press({ key: 'open-global/memory/CLAUDE.md' })
  expect(opened).toEqual([['open', '-a', 'Visual Studio Code', '/home/me/.claude/CLAUDE.md']])
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('a file changed while the harness tab is shown is read again at the next beat', async ($, on) => {
  const clock = world(on, 38, LIMITS)
  const files: Record<string, { text: string; at: number }> = { '/home/me/.claude/CLAUDE.md': { text: 'one', at: 1 } }
  const rules: string[] = []
  on('session.root', () => ({ value: '/home/me/work' }))
  on('session.start', () => ({ cwd: '/home/me/work' }) as never)
  on('settings.read', () => ({ value: {} as never }))
  on('command.register', () => ({ value: { command: 'status-panel' } }) as never)
  on('fs.read', (_, e) => {
    const file = files[String(e.path)]

    if (file === undefined) {
      throw new Error('ENOENT')
    }

    return { value: file.text } as never
  })
  on('fs.stat', (_, e) => {
    const file = files[String(e.path)]

    if (file === undefined) {
      throw new Error('ENOENT')
    }

    return { value: { kind: 'file', size: file.text.length, mtimeMs: file.at, isLink: false } } as never
  })
  on('fs.list', (_, e) => {
    if (String(e.path) !== '/home/me/.claude/rules') {
      throw new Error('ENOENT')
    }

    return { value: rules.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })) }
  })
  await $.session.start({} as never)
  await clock.advance(0)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())

  await ui.press({ key: 'tab-tab6' })
  await ui.press({ key: 'item-global/memory/CLAUDE.md' })
  expect(await texts()).toContain('1줄 3자')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('one')

  // The file grows and a rule is added, with no press on the pane.
  files['/home/me/.claude/CLAUDE.md'] = { text: 'one\ntwo', at: 2 }
  files['/home/me/.claude/rules/new.md'] = { text: 'rule', at: 2 }
  rules.push('new.md')
  await clock.advance(5000)
  await clock.advance(0)

  expect(await texts()).toContain('2줄 7자')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('one\ntwo')
  expect(await ui.find({ key: 'item-global/memory/rules/new.md' })).toBeDefined()
  await ui.press({ key: 'item-global/memory/CLAUDE.md' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('a long hook command is cut to its first rows in the details', async ($, on) => {
  world(on, 38, LIMITS)
  on('session.root', () => ({ value: '/home/me/work' }))
  on('settings.read', (_, e) => ({
    value: (e.source === 'user'
      ? { hooks: { Stop: [{ hooks: [{ type: 'command', command: `echo ${'x'.repeat(1000)}` }] }] } }
      : {}) as never,
  }))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-tab6' })
  await ui.press({ key: 'kind-hooks' })
  await ui.press({ key: 'item-global/hooks/Stop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)

  expect(texts.filter(one => /^ *(echo|x+)$/.test(one))).toHaveLength(16)
  expect(texts.some(one => /^│ … 외 \d+줄$/.test(one))).toBe(true)
  await ui.press({ key: 'item-global/hooks/Stop' })
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('a hook command is laid out by its shell syntax, and one several events share is numbered', async ($, on) => {
  world(on, 38, LIMITS)
  const script = 'if [ -z "$A" ]; then echo "a; b"; else exit 0; fi; case "$X" in a*) run ;; *) { one; two; } >/dev/null ;; esac; done=1'
  on('session.root', () => ({ value: '/home/me/work' }))
  on('settings.read', (_, e) => ({
    value: (e.source === 'user'
      ? {
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: script }, { type: 'command', command: 'only-here' }] }],
            SessionEnd: [{ hooks: [{ type: 'command', command: script }] }],
          },
        }
      : {}) as never,
  }))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  await ui.press({ key: 'tab-tab6' })
  await ui.press({ key: 'kind-hooks' })
  await ui.press({ key: 'item-global/hooks/Stop' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  const from = texts.indexOf('if [ -z "$A" ]; then')

  expect(texts.slice(from).filter(one => one !== '│ ' && one !== '  ').slice(0, 15)).toEqual([
    'if [ -z "$A" ]; then',
    '  echo "a; b"',
    'else',
    '  exit 0',
    'fi',
    'case "$X" in',
    '  a*)',
    '    run',
    '  *)',
    '    {',
    '      one',
    '      two',
    '    } >/dev/null',
    'esac',
    'done=1',
  ])
  expect(texts.filter(one => one === '공통 ① · 2개 이벤트에서 같음')).toHaveLength(1)
  await ui.press({ key: 'item-global/hooks/Stop' })
  await ui.press({ key: 'kind-memory' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})

test('the files tab lists the project as a tree and marks what the agent made, read, changed and removed', async ($, on) => {
  world(on, 38, LIMITS)
  const listed = ['/p/a.md', '/p/old.md', '/p/src/b.ts', '/p/src/deep/c.ts', '/p/z.txt']
  const opened: string[][] = []
  let written: string[] = []
  on('session.root', () => ({ value: '/p' }))
  on('process.run', (_, e) => {
    if (e.argv[0] === 'open') {
      opened.push([...e.argv])
    }

    const stdout = e.argv[0] !== 'find' ? '' : (e.argv.includes('-newermt') ? written : listed).join('\n')

    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', (_, e) => ({ value: listed.includes(String(e.path)) }))
  on('tool.call', { tool: /^(Read|Edit)$/ }, () => ({ result: {}, text: 'ok' }) as never)
  on('tool.call', { tool: 'Write' }, (_, e) => {
    listed.push(String((e as { file_path?: string }).file_path))

    return { result: {}, text: 'ok' } as never
  })
  // The shell command removes one file, makes one and writes to another.
  on('tool.call', { tool: 'Bash' }, () => {
    listed.splice(listed.indexOf('/p/old.md'), 1)
    listed.push('/p/gen.txt')
    written = ['/p/gen.txt', '/p/src/deep/c.ts']

    return { result: {}, text: 'ok' } as never
  })
  await $.command.run(RUN)
  await $.tool.call({ tool: 'Read', file_path: '/p/a.md' })
  await $.tool.call({ tool: 'Write', file_path: '/p/src/new.ts', content: '' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/b.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Read', file_path: '/elsewhere/x.md' })
  await $.tool.call({ tool: 'Bash', command: 'make' })
  const ui = await $.ui.mount({ plugin: 'status-panel', surface: 'terminal', ...PANE })
  const texts = async () => (await ui.findAll({ type: 'Text' })).map(one => one.text.trim())
  const has = async (key: string) => (await ui.find({ key })) !== undefined
  const letters = async () => (await texts()).filter(one => /^[CRUD]$/.test(one))

  await ui.press({ key: 'tab-tab7' })
  expect(await texts()).toContain('손댄 것 6 / 전체 6')

  // Folders first and shut; a folder carries what was done inside it, and the
  // removed file stays listed.
  expect(await has('dir-src')).toBe(true)
  expect(await has('file-src/b.ts')).toBe(false)
  expect(await has('file-elsewhere/x.md')).toBe(false)
  expect(await letters()).toEqual(['C', 'U', 'R', 'C', 'D'])
  await ui.press({ key: 'dir-src' })
  expect(await has('file-src/b.ts')).toBe(true)
  expect(await has('file-src/new.ts')).toBe(true)
  expect(await has('dir-src/deep')).toBe(true)
  expect(await has('file-src/deep/c.ts')).toBe(false)
  expect(await letters()).toEqual(['C', 'U', 'U', 'U', 'C', 'R', 'C', 'D'])

  // The touched ones alone, every folder open.
  await ui.press({ key: 'files-touched' })
  expect(await has('file-src/deep/c.ts')).toBe(true)
  expect(await has('file-z.txt')).toBe(false)
  await ui.press({ key: 'files-all' })
  expect(await has('file-z.txt')).toBe(true)

  // A file's details: what was done, by which tool; one still there can be opened.
  await ui.press({ key: 'file-old.md' })
  expect(await texts()).toEqual(expect.arrayContaining(['old.md', 'Bash']))
  expect(await has('file-open')).toBe(false)
  await ui.press({ key: 'file-a.md' })
  expect(await texts()).toContain('Read')
  await ui.press({ key: 'file-open' })
  expect(opened).toEqual([['open', '/p/a.md']])
  await ui.press({ key: 'file-z.txt' })
  expect(await texts()).toContain('에이전트가 손대지 않은 파일입니다.')
  await ui.press({ key: 'file-z.txt' })
  await ui.press({ key: 'dir-src' })
  await ui.press({ key: 'tab-tab1' })
  await ui.unmount()
})
