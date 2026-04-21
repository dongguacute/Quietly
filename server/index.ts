import { createHash } from 'node:crypto'

import cors from 'cors'
import express from 'express'

export type ChatGroup = {
  id: string
  name: string
  owner: string
  createdAt: number
}

export type ChatMessage = {
  id: string
  groupId: string
  user: string
  text: string
  createdAt: number
}

const groups: ChatGroup[] = []
const groupIds = new Set<string>()
const messages: ChatMessage[] = []
const MAX_MESSAGES = 2000

/** 全站唯一公共会话，所有账号读写同一列表 */
const GLOBAL_CHAT_GROUP_ID = 'quietly-global'

function ensureGlobalChatGroup() {
  if (groups.some((g) => g.id === GLOBAL_CHAT_GROUP_ID)) {
    return
  }
  const g: ChatGroup = {
    id: GLOBAL_CHAT_GROUP_ID,
    name: '公共',
    owner: '__global__',
    createdAt: Date.now(),
  }
  groupIds.add(g.id)
  groups.push(g)
}

const systemAccounts = new Set<string>()

function touchAccount(name: string) {
  const n = name.trim().slice(0, 32)
  if (n) {
    systemAccounts.add(n)
  }
}

export type AccountLabel = {
  id: string
  owner: string
  name: string
  createdAt: number
}

const accountLabels: AccountLabel[] = []
const labelIdSet = new Set<string>()

type LabelPlacement = {
  owner: string
  target: string
  categoryId: string
}
const labelPlacements: LabelPlacement[] = []

function addAccountLabel(name: string, owner: string): AccountLabel {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error('分类名称不能为空')
  }
  const o = owner.trim().slice(0, 32)
  if (!o) {
    throw new Error('账号不能为空')
  }
  touchAccount(o)
  const lab: AccountLabel = {
    id: `L-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed.slice(0, 32),
    owner: o,
    createdAt: Date.now(),
  }
  if (labelIdSet.has(lab.id)) {
    return addAccountLabel(name, owner)
  }
  labelIdSet.add(lab.id)
  accountLabels.push(lab)
  return lab
}

function getLabelById(
  id: string,
  owner: string,
): AccountLabel | undefined {
  return accountLabels.find(
    (l) => l.id === id && l.owner === owner,
  )
}

function setLabelPlacement(
  owner: string,
  target: string,
  categoryId: string,
) {
  const o = owner.trim().slice(0, 32)
  const t = target.trim().slice(0, 32)
  if (!o) {
    throw new Error('需要指定账号')
  }
  if (!t) {
    throw new Error('需要指定目标用户')
  }
  touchAccount(o)
  if (o === t) {
    throw new Error('不能给自己归类')
  }
  if (!systemAccounts.has(t)) {
    throw new Error('目标用户不在系统内，请对方先登录或发过消息')
  }
  if (!systemAccounts.has(o)) {
    throw new Error('操作者未在系统内')
  }
  if (!categoryId || !categoryId.trim()) {
    const i = labelPlacements.findIndex(
      (p) => p.owner === o && p.target === t,
    )
    if (i >= 0) {
      labelPlacements.splice(i, 1)
    }
    return
  }
  const cid = categoryId.trim()
  if (!getLabelById(cid, o)) {
    throw new Error('分类不存在')
  }
  const idx = labelPlacements.findIndex(
    (p) => p.owner === o && p.target === t,
  )
  if (idx >= 0) {
    labelPlacements[idx]!.categoryId = cid
  } else {
    labelPlacements.push({ owner: o, target: t, categoryId: cid })
  }
}

function defaultGroupIdFor(owner: string): string {
  const h = createHash('sha256').update(owner, 'utf8').digest('base64url').slice(0, 20)
  return `d-${h}`
}

function ensureDefaultForOwner(owner: string) {
  const o = owner.trim().slice(0, 32)
  if (!o) {
    return
  }
  if (groups.some((g) => g.owner === o)) {
    return
  }
  const id = defaultGroupIdFor(o)
  const g: ChatGroup = {
    id,
    name: '默认',
    owner: o,
    createdAt: Date.now(),
  }
  groupIds.add(id)
  groups.push(g)
}

function getGroupById(groupId: string): ChatGroup | undefined {
  return groups.find((g) => g.id === groupId)
}

function getDefaultGroupIdForOwner(owner: string): string {
  const o = owner.trim().slice(0, 32)
  if (!o) {
    throw new Error('账号不能为空')
  }
  ensureDefaultForOwner(o)
  const g = groups.find((x) => x.owner === o && x.name === '默认')
  if (!g) {
    throw new Error('内部错误：无默认分组')
  }
  return g.id
}

function addMessage(
  user: string,
  text: string,
  groupId: string,
  owner: string,
): ChatMessage {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('消息不能为空')
  }
  if (!user.trim()) {
    throw new Error('用户名不能为空')
  }
  const gid = String(groupId ?? '').trim()
  if (!gid) {
    throw new Error('需要指定分组')
  }
  const o = owner.trim().slice(0, 32)
  if (!o) {
    throw new Error('需要指定账号')
  }
  const g = getGroupById(gid)
  if (!g) {
    throw new Error('分组不存在')
  }
  if (gid !== GLOBAL_CHAT_GROUP_ID && g.owner !== o) {
    throw new Error('分组与账号不匹配')
  }
  const u = user.trim().slice(0, 32)
  touchAccount(u)
  touchAccount(o)
  const msg: ChatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    groupId: gid,
    user: u,
    text: trimmed.slice(0, 2000),
    createdAt: Date.now(),
  }
  messages.push(msg)
  while (messages.length > MAX_MESSAGES) {
    messages.shift()
  }
  return msg
}

const app = express()
app.use(
  cors({
    origin: true,
  }),
)
app.use(express.json({ limit: '256kb' }))

app.get('/api/messages', (req, res) => {
  const owner = String(req.query.owner ?? '').trim().slice(0, 32)
  if (!owner) {
    return res.status(400).json({ error: '需要 query: owner（账号）' })
  }
  touchAccount(owner)
  ensureGlobalChatGroup()
  const list = messages.filter((m) => m.groupId === GLOBAL_CHAT_GROUP_ID)
  res.json({ messages: list })
})

app.post('/api/messages', (req, res) => {
  const { user, text, owner } = req.body as {
    user?: string
    text?: string
    owner?: string
  }
  try {
    const o = String(owner ?? '').trim().slice(0, 32)
    ensureGlobalChatGroup()
    const msg = addMessage(
      String(user ?? ''),
      String(text ?? ''),
      GLOBAL_CHAT_GROUP_ID,
      o,
    )
    res.status(201).json({ message: msg })
  } catch (e) {
    const m = e instanceof Error ? e.message : '无法发送'
    res.status(400).json({ error: m })
  }
})

app.get('/api/accounts', (req, res) => {
  const me = String(req.query.owner ?? '').trim().slice(0, 32)
  if (me) {
    touchAccount(me)
  }
  res.json({ accounts: [...systemAccounts].sort() })
})

app.get('/api/account-labels', (req, res) => {
  const owner = String(req.query.owner ?? '').trim().slice(0, 32)
  if (!owner) {
    return res.status(400).json({ error: '需要 query: owner' })
  }
  touchAccount(owner)
  res.json({ labels: accountLabels.filter((l) => l.owner === owner) })
})

app.post('/api/account-labels', (req, res) => {
  const { name, owner } = req.body as { name?: string; owner?: string }
  try {
    const lab = addAccountLabel(String(name ?? ''), String(owner ?? ''))
    res.status(201).json({ label: lab })
  } catch (e) {
    const m = e instanceof Error ? e.message : '无法创建'
    res.status(400).json({ error: m })
  }
})

app.get('/api/account-label-assignments', (req, res) => {
  const owner = String(req.query.owner ?? '').trim().slice(0, 32)
  if (!owner) {
    return res.status(400).json({ error: '需要 query: owner' })
  }
  touchAccount(owner)
  const rows = labelPlacements
    .filter((p) => p.owner === owner)
    .map((p) => ({ target: p.target, categoryId: p.categoryId }))
  res.json({ assignments: rows })
})

app.put('/api/account-label-assignments', (req, res) => {
  const { owner, target, categoryId } = req.body as {
    owner?: string
    target?: string
    categoryId?: string
  }
  try {
    setLabelPlacement(
      String(owner ?? ''),
      String(target ?? ''),
      String(categoryId ?? ''),
    )
    res.json({ ok: true })
  } catch (e) {
    const m = e instanceof Error ? e.message : '无法保存'
    res.status(400).json({ error: m })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

const port = Number(process.env.PORT) || 3000

app.listen(port, () => {
  console.log(`[chat API] http://127.0.0.1:${port}`)
})
