<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const STORAGE_KEY = 'quietly-chat-username'
const PREF_NOTIFY_KEY = 'quietly-chat-notify-pref'
const LABEL_DELAY_KEY = 'quietly-label-notify-delay'
const UNCATEGORIZED_KEY = '__uncategorized__'

type ChatMessage = {
  id: string
  groupId: string
  user: string
  text: string
  createdAt: number
}

type AccountLabel = {
  id: string
  owner: string
  name: string
  createdAt: number
}

const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const postUrl = `${apiBase}/api/messages`
const accountsUrl = `${apiBase}/api/accounts`
const accountLabelsUrl = `${apiBase}/api/account-labels`
const accountLabelAssignmentsUrl = `${apiBase}/api/account-label-assignments`

const loginName = ref(
  typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) ?? '' : '',
)
const sessionUser = ref('')
const wantNotify = ref(
  typeof localStorage !== 'undefined' ? localStorage.getItem(PREF_NOTIFY_KEY) !== '0' : true,
)
const directory = ref<string[]>([])
const accountLabels = ref<AccountLabel[]>([])
const assignmentByTarget = ref<Record<string, string>>({})
const newLabelName = ref('')
const labelErr = ref('')

const listUrl = computed(() => {
  const u = sessionUser.value.trim()
  if (!u) {
    return ''
  }
  return `${apiBase}/api/messages?owner=${encodeURIComponent(u)}`
})

const otherSystemAccounts = computed(() => {
  const me = sessionUser.value.trim()
  return directory.value.filter((a) => a && a !== me)
})
function readLabelDelays(): Record<string, number> {
  if (typeof localStorage === 'undefined') {
    return {}
  }
  try {
    const s = localStorage.getItem(LABEL_DELAY_KEY)
    if (!s) {
      return {}
    }
    const o = JSON.parse(s) as Record<string, number>
    if (o && typeof o === 'object') {
      return o
    }
  } catch {
    // ignore
  }
  return {}
}

const delayByLabel = ref<Record<string, number>>(readLabelDelays())
const labelDelaySaveHint = ref('')

const draft = ref('')
const messages = ref<ChatMessage[]>([])
const error = ref('')
const sending = ref(false)
const notifyStatus = ref<'default' | 'granted' | 'denied' | 'unsupported'>('default')

const seenMessageIds = new Set<string>()
let initialSync = true
let pollTimer: ReturnType<typeof setInterval> | undefined
const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function storagePrefNotify(on: boolean) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(PREF_NOTIFY_KEY, on ? '1' : '0')
  }
}

watch(wantNotify, (v) => {
  storagePrefNotify(v)
  if (!v) {
    clearNotifyTimers()
  }
})

function getDelaySecForLabelKey(key: string): number {
  const n = delayByLabel.value[key]
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return 0
  }
  return Math.min(300, Math.max(0, Math.floor(n)))
}

/** 发件人在当前账号下的分类 id（或「未分类」占位），用于读本机延迟配置 */
function getNotifyBucketKey(m: ChatMessage) {
  const s = m.user.trim()
  const me = sessionUser.value.trim()
  if (!s || s === me) {
    return ''
  }
  return assignmentByTarget.value[s] || UNCATEGORIZED_KEY
}

/** 通知去重键：分类 + 发件人用户名，避免同分类下多人互相顶替定时器 */
function getNotifyScheduleKey(m: ChatMessage) {
  const cat = getNotifyBucketKey(m)
  const u = m.user.trim()
  if (!cat || !u) {
    return ''
  }
  return `${cat}\n${u}`
}

/** 发件人已归类 → 使用该分类的延迟；未归类 → 「未分类」行的延迟 */
function getDelaySecForMessage(m: ChatMessage) {
  const b = getNotifyBucketKey(m)
  if (!b) {
    return 0
  }
  return getDelaySecForLabelKey(b)
}

function labelNameForMessage(m: ChatMessage) {
  const s = m.user.trim()
  const me = sessionUser.value.trim()
  if (s === me) {
    return ''
  }
  const id = assignmentByTarget.value[s] ?? ''
  if (!id) {
    return '未分类'
  }
  return accountLabels.value.find((l) => l.id === id)?.name ?? '未分类'
}

function resetSessionSync() {
  clearNotifyTimers()
  seenMessageIds.clear()
  initialSync = true
  messages.value = []
}

function clearNotifyTimers() {
  for (const t of notifyTimers.values()) {
    clearTimeout(t)
  }
  notifyTimers.clear()
}

function updateNotifyStatus() {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    notifyStatus.value = 'unsupported'
    return
  }
  if (Notification.permission === 'granted') {
    notifyStatus.value = 'granted'
  } else if (Notification.permission === 'denied') {
    notifyStatus.value = 'denied'
  } else {
    notifyStatus.value = 'default'
  }
}

function showBrowserNotification(m: ChatMessage) {
  if (notifyStatus.value !== 'granted' || !wantNotify.value) {
    return
  }
  const u = m.user.trim()
  const me = sessionUser.value.trim()
  if (!u || u === me) {
    return
  }
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    return
  }
  const text =
    m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text
  const lb = labelNameForMessage(m)
  const title = lb ? `「${lb}」${m.user}` : `来自 ${m.user}`
  try {
    new Notification(title, {
      body: text,
      tag: m.id,
    })
  } catch {
    // ignore
  }
}

function scheduleLabelNotify(m: ChatMessage) {
  const u = m.user.trim()
  const me = sessionUser.value.trim()
  if (!u || u === me) {
    return
  }
  const scheduleKey = getNotifyScheduleKey(m)
  if (!scheduleKey) {
    return
  }
  const sec = getDelaySecForMessage(m)
  const prev = notifyTimers.get(scheduleKey)
  if (prev) {
    clearTimeout(prev)
  }
  const t = setTimeout(() => {
    notifyTimers.delete(scheduleKey)
    showBrowserNotification(m)
  }, sec * 1000)
  notifyTimers.set(scheduleKey, t)
}

function processAndNotify(fetched: ChatMessage[]) {
  for (const m of fetched) {
    if (seenMessageIds.has(m.id)) {
      continue
    }
    if (!initialSync) {
      scheduleLabelNotify(m)
    }
    seenMessageIds.add(m.id)
  }
  initialSync = false
  messages.value = [...fetched]
}

async function loadDirectory() {
  const u = sessionUser.value.trim()
  if (!u) {
    return
  }
  const res = await fetch(
    `${accountsUrl}?owner=${encodeURIComponent(u)}`,
  )
  if (!res.ok) {
    throw new Error('accounts')
  }
  const data = (await res.json()) as { accounts: string[] }
  directory.value = data.accounts ?? []
}

async function loadAccountLabels() {
  const u = sessionUser.value.trim()
  if (!u) {
    return
  }
  const res = await fetch(
    `${accountLabelsUrl}?owner=${encodeURIComponent(u)}`,
  )
  if (!res.ok) {
    throw new Error('account-labels')
  }
  const data = (await res.json()) as { labels: AccountLabel[] }
  accountLabels.value = data.labels ?? []
}

async function loadLabelAssignments() {
  const u = sessionUser.value.trim()
  if (!u) {
    return
  }
  const res = await fetch(
    `${accountLabelAssignmentsUrl}?owner=${encodeURIComponent(u)}`,
  )
  if (!res.ok) {
    throw new Error('assignments')
  }
  const data = (await res.json()) as {
    assignments: { target: string; categoryId: string }[]
  }
  const next: Record<string, string> = {}
  for (const row of data.assignments ?? []) {
    next[row.target] = row.categoryId
  }
  assignmentByTarget.value = next
}

async function loadMessages() {
  const url = listUrl.value
  if (!url) {
    return
  }
  try {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = (await res.json()) as { messages: ChatMessage[] }
    const list = data.messages ?? []
    processAndNotify(list)
    error.value = ''
  } catch {
    if (!error.value) {
      error.value = '无法连接聊天服务，请确认已启动 API（pnpm dev:api）'
    }
  }
}

async function prepareSession() {
  labelErr.value = ''
  try {
    await Promise.all([
      loadDirectory(),
      loadAccountLabels(),
      loadLabelAssignments(),
    ])
  } catch {
    labelErr.value = '无法加载系统用户或账号分类，请检查 API。'
  }
  resetSessionSync()
  await loadMessages()
}

function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
  }
  pollTimer = setInterval(() => {
    void loadMessages()
  }, 2500)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

function patchLabelDelayKey(key: string, raw: number) {
  const n = Math.min(300, Math.max(0, Math.floor(raw) || 0))
  delayByLabel.value = { ...delayByLabel.value, [key]: n }
}

function applyLabelSave() {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LABEL_DELAY_KEY, JSON.stringify(delayByLabel.value))
  }
  labelDelaySaveHint.value = '已确认并保存各分类通知延迟（本机）'
  setTimeout(() => {
    labelDelaySaveHint.value = ''
  }, 2500)
}

async function refreshDirectory() {
  labelErr.value = ''
  try {
    await loadDirectory()
  } catch {
    labelErr.value = '无法刷新用户列表'
  }
}

async function createUserLabel() {
  const name = newLabelName.value.trim()
  if (!name) {
    labelErr.value = '请输入分类名称'
    return
  }
  labelErr.value = ''
  try {
    const res = await fetch(accountLabelsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, owner: sessionUser.value }),
    })
    const data = (await res.json()) as { label?: AccountLabel; error?: string }
    if (!res.ok) {
      labelErr.value = data.error ?? '创建失败'
      return
    }
    if (data.label) {
      accountLabels.value = [...accountLabels.value, data.label]
    } else {
      await loadAccountLabels()
    }
    newLabelName.value = ''
  } catch {
    labelErr.value = '网络错误'
  }
}

async function assignUserLabel(target: string, categoryId: string) {
  labelErr.value = ''
  const owner = sessionUser.value.trim()
  if (!owner) {
    return
  }
  try {
    const res = await fetch(accountLabelAssignmentsUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, target, categoryId }),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok) {
      labelErr.value = data.error ?? '保存失败'
      return
    }
    const next = { ...assignmentByTarget.value }
    if (!categoryId) {
      delete next[target]
    } else {
      next[target] = categoryId
    }
    assignmentByTarget.value = next
  } catch {
    labelErr.value = '网络错误'
  }
}

async function login() {
  const name = loginName.value.trim()
  if (!name) {
    error.value = '请输入用户名'
    return
  }
  error.value = ''
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, name)
  }
  sessionUser.value = name
  try {
    await prepareSession()
  } catch {
    error.value = '无法进入会话，请检查 API 是否已启动'
    sessionUser.value = ''
    return
  }
  updateNotifyStatus()
  if (wantNotify.value && 'Notification' in window && Notification.permission === 'default') {
    void Notification.requestPermission().then(() => {
      updateNotifyStatus()
    })
  } else {
    updateNotifyStatus()
  }
  startPolling()
}

function logout() {
  sessionUser.value = ''
  error.value = ''
  stopPolling()
  clearNotifyTimers()
  resetSessionSync()
  directory.value = []
  accountLabels.value = []
  assignmentByTarget.value = {}
  newLabelName.value = ''
  labelErr.value = ''
}

function requestNotificationAgain() {
  if (!('Notification' in window)) {
    return
  }
  void Notification.requestPermission().then(() => {
    updateNotifyStatus()
  })
}

async function send() {
  const u = sessionUser.value.trim()
  const t = draft.value
  if (!u || !t.trim()) {
    error.value = '请输入消息内容'
    return
  }
  sending.value = true
  error.value = ''
  try {
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: u,
        text: t,
        owner: u,
      }),
    })
    const data = (await res.json()) as
      | { message: ChatMessage; error?: string }
      | { error: string }
    if (!res.ok) {
      error.value = 'error' in data && data.error ? data.error : '发送失败'
      return
    }
    if ('message' in data && data.message) {
      const list = [...messages.value, data.message]
      processAndNotify(list)
    } else {
      void loadMessages()
    }
    void loadDirectory()
    draft.value = ''
  } catch {
    error.value = '网络错误，请检查 API 是否已启动'
  } finally {
    sending.value = false
  }
}

onMounted(() => {
  updateNotifyStatus()
  if (loginName.value.trim()) {
    const name = loginName.value.trim()
    void (async () => {
      try {
        sessionUser.value = name
        await prepareSession()
        startPolling()
      } catch {
        if (!error.value) {
          error.value = '无法连接聊天服务，请确认已启动 API'
        }
        sessionUser.value = ''
      }
    })()
  }
})

onUnmounted(() => {
  stopPolling()
  clearNotifyTimers()
})

watch(
  () => messages.value.length,
  () => {
    if (!sessionUser.value) {
      return
    }
    requestAnimationFrame(() => {
      const el = document.getElementById('chat-end')
      el?.scrollIntoView({ behavior: 'smooth' })
    })
  },
)

function formatTime(ts: number) {
  return new Date(ts).toLocaleString()
}

function isSelf(m: ChatMessage) {
  return m.user.trim() === sessionUser.value.trim()
}
</script>

<template>
  <section class="chat">
    <h1>多用户聊天（演示）</h1>
    <p class="hint global-room-hint">
      所有登录账号共用<strong>同一公共消息列表</strong>；谁归在哪个分类、通知延迟几秒，仍按<strong>当前登录用户</strong>在本机的设置（有分类用该分类的延迟）。
    </p>

    <form v-if="!sessionUser" class="card login" @submit.prevent="login">
      <p class="hint">
        默认 API 在 <code>3000</code> 端口，开发时 Vite 会代理 <code>/api</code>。请另开终端执行
        <code>pnpm dev:api</code>，或使用 <code>pnpm dev:all</code>。
      </p>
      <label class="field">
        用户名
        <input
          v-model="loginName"
          type="text"
          name="username"
          autocomplete="username"
          placeholder="用于在本聊天室显示"
          maxlength="32"
        />
      </label>
      <label class="check">
        <input v-model="wantNotify" type="checkbox" />
        启用桌面通知（可随时在聊天页关闭；需浏览器授权）
      </label>
      <p v-if="notifyStatus === 'denied'" class="tip warn">
        通知已被系统拒绝。可在浏览器网站设置中允许本站通知后，点击下方按钮重试。
        <button type="button" class="linkish" @click="requestNotificationAgain">重新申请授权</button>
      </p>
      <p v-else-if="notifyStatus === 'unsupported'" class="tip">
        当前环境不支持系统通知，仍可正常使用消息列表。
      </p>
      <div v-if="error" class="err" role="alert">
        {{ error }}
      </div>
      <button type="submit" class="primary">
        进入聊天
      </button>
    </form>

    <template v-else>
      <div class="toolbar">
        <p class="session">
          已登录为 <strong>{{ sessionUser }}</strong>
        </p>
        <div class="toolbar-actions">
          <label class="check toolbar-notify">
            <input v-model="wantNotify" type="checkbox" />
            启用桌面通知
          </label>
          <span v-if="!wantNotify" class="tip mild">已关闭桌面通知，聊天与分类延迟设置仍保留（本机）</span>
          <span v-else-if="notifyStatus === 'granted'" class="tip ok">新消息在后台时：发件人有归类则用该分类的延迟，否则用「未分类」</span>
          <span v-else-if="notifyStatus === 'denied'" class="tip warn">系统已拒绝通知，可在浏览器设置中允许本站后
            <button type="button" class="linkish" @click="requestNotificationAgain">重试授权</button>
          </span>
          <span v-else-if="notifyStatus === 'default'" class="tip">需要授权后才能弹系统通知：
            <button type="button" class="linkish" @click="requestNotificationAgain">请求授权</button>
          </span>
          <span v-else class="tip">当前环境不支持系统通知</span>
          <button type="button" class="secondary toolbar-logout" @click="logout">退出</button>
        </div>
      </div>

      <div class="card user-classify">
        <h2 class="h2">系统内账号分类</h2>
        <p class="hint sub">
          每个登录账号都可以自建「分类」并把<strong>其他</strong>系统用户归到不同类里，仅本账号可见。下方列表来自已登录或曾发过消息的用户名。聊天内容为<strong>全站公共列表</strong>；桌面通知按<strong>发件人用户名</strong>是否归类决定延迟——<strong>有分类则用该分类的秒数，未分类则用「未分类」</strong>（本机保存）。
        </p>
        <div class="label-create">
          <input
            v-model="newLabelName"
            class="newg-input"
            type="text"
            placeholder="新建分类名称，例如 同事、家人"
            maxlength="32"
            @keydown.enter.prevent="createUserLabel"
          />
          <button type="button" class="secondary" @click="createUserLabel">添加分类</button>
          <button type="button" class="secondary" @click="refreshDirectory">刷新用户</button>
        </div>
        <div class="delay-legend">
          <h3 class="h3">各分类的通知延迟（秒）</h3>
          <p class="hint sub">
            你给某用户选了分类后，来自他的通知会使用<strong>该分类这一行的秒数</strong>；仍选「未分类」的用户则用第一行。0–300 秒；同一发件人延期间连续多条只弹最后一次。点确认写入本机。
          </p>
          <ul class="delay-cat-list">
            <li class="delay-cat-row">
              <span class="dn">未分类</span>
              <input
                :value="delayByLabel[UNCATEGORIZED_KEY] ?? 0"
                class="num"
                type="number"
                min="0"
                max="300"
                step="1"
                :aria-label="'未分类' + '通知延迟秒数'"
                @input="
                  patchLabelDelayKey(
                    UNCATEGORIZED_KEY,
                    +(($event.target as HTMLInputElement).value || 0),
                  )
                "
              />
              <button
                type="button"
                class="primary small"
                @click="applyLabelSave"
              >
                确认
              </button>
            </li>
            <li
              v-for="lab in accountLabels"
              :key="'dl-' + lab.id"
              class="delay-cat-row"
            >
              <span class="dn">{{ lab.name }}</span>
              <input
                :value="delayByLabel[lab.id] ?? 0"
                class="num"
                type="number"
                min="0"
                max="300"
                step="1"
                :aria-label="lab.name + '通知延迟秒数'"
                @input="
                  patchLabelDelayKey(
                    lab.id,
                    +(($event.target as HTMLInputElement).value || 0),
                  )
                "
              />
              <button
                type="button"
                class="primary small"
                @click="applyLabelSave"
              >
                确认
              </button>
            </li>
          </ul>
          <p v-if="labelDelaySaveHint" class="okhint">
            {{ labelDelaySaveHint }}
          </p>
        </div>
        <p v-if="labelErr" class="err label-err" role="status">
          {{ labelErr }}
        </p>
        <p v-if="!otherSystemAccounts.length" class="empty mild">暂无其他系统用户。请用另一浏览器或隐身窗口以其它用户名登录/发消息后，会出现在此列表。</p>
        <ul v-else class="assign-list">
          <li
            v-for="a in otherSystemAccounts"
            :key="a"
            class="assign-row"
          >
            <span class="aname">{{ a }}</span>
            <select
              class="select"
              :value="assignmentByTarget[a] ?? ''"
              @change="
                assignUserLabel(
                  a,
                  ($event.target as HTMLSelectElement).value,
                )
              "
            >
              <option value="">未分类</option>
              <option
                v-for="lab in accountLabels"
                :key="lab.id"
                :value="lab.id"
              >
                {{ lab.name }}
              </option>
            </select>
          </li>
        </ul>
      </div>

      <div v-if="error" class="err" role="alert">
        {{ error }}
      </div>

      <div class="list-head">消息</div>
      <div
        class="log"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="消息列表"
      >
        <p v-if="!messages.length" class="empty">还没有消息，先发一条吧。</p>
        <template v-else>
          <article
            v-for="m in messages"
            :key="m.id"
            class="bubble"
            :class="{ self: isSelf(m) }"
          >
            <div class="meta">
              <span class="who">{{ m.user }}</span>
              <time :datetime="new Date(m.createdAt).toISOString()">
                {{ formatTime(m.createdAt) }}
              </time>
            </div>
            <p class="text">{{ m.text }}</p>
          </article>
        </template>
        <div id="chat-end" />
      </div>

      <form class="compose" @submit.prevent="send">
        <input
          v-model="draft"
          type="text"
          placeholder="输入消息…"
          maxlength="2000"
          :disabled="sending"
          autocomplete="off"
        />
        <button type="submit" :disabled="sending" class="primary">
          {{ sending ? '发送中…' : '发送' }}
        </button>
      </form>
    </template>
  </section>
</template>

<style scoped>
.chat {
  max-width: 40rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.h2,
.h3 {
  font-size: 1rem;
  margin: 0 0 0.25rem;
  color: #2c3e50;
}

.h3 {
  font-size: 0.95rem;
  margin-top: 0.5rem;
}

.hint,
.tip,
.sub {
  font-size: 0.9rem;
  color: #555;
  line-height: 1.5;
  margin: 0;
}

.hint.sub {
  margin-bottom: 0.5rem;
}

.global-room-hint {
  margin: 0.35rem 0 1rem;
  max-width: 42rem;
}

.delay-legend {
  border-top: 1px solid #e8e8e8;
  padding-top: 0.75rem;
  margin-top: 0.25rem;
}

.delay-cat-list {
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.delay-cat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.75rem;
}

.delay-cat-row .dn {
  min-width: 4.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  color: #2c3e50;
}

.tip.ok {
  color: #1e6b4a;
}

.tip.warn {
  color: #8a4b00;
}

.tip.mild {
  color: #666;
}

.toolbar-logout {
  margin-left: auto;
}

.okhint {
  font-size: 0.9rem;
  color: #1e6b4a;
  margin: 0;
}

.hint code,
.tip code {
  font-size: 0.85em;
  background: #f2f2f2;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

.card {
  border: 1px solid #e5e5e5;
  border-radius: 10px;
  padding: 1.25rem;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.user-classify {
  gap: 0.75rem;
}

.label-create {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.assign-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.assign-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  justify-content: space-between;
}

.aname {
  font-weight: 600;
  color: #2c3e50;
  min-width: 6rem;
}

.empty.mild {
  font-size: 0.9rem;
  color: #777;
}

.label-err {
  font-size: 0.9rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
  font-weight: 600;
  color: #2c3e50;
}

.field.tight {
  width: 100%;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #444;
  cursor: pointer;
}

input[type="text"],
input[type="number"] {
  font: inherit;
  padding: 0.5rem 0.65rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  min-width: 0;
}

.login input[type="text"] {
  min-width: min(100%, 24rem);
}

.select {
  font: inherit;
  padding: 0.5rem 0.65rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  max-width: 100%;
}

.group-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: flex-end;
}

.newg {
  align-items: center;
  gap: 0.5rem;
}

.newg-input {
  flex: 1 1 10rem;
}

.delay-row {
  border-top: 1px solid #e8e8e8;
  padding-top: 0.75rem;
  margin-top: 0.25rem;
}

.delay-inputs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

input.num {
  width: 5.5rem;
}

.toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: flex-start;
}

.session {
  margin: 0;
  font-size: 0.95rem;
  color: #2c3e50;
}

.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
  width: 100%;
  justify-content: space-between;
}

.list-head {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #888;
  margin: 0;
}

.err {
  padding: 0.6rem 0.75rem;
  background: #fff0f0;
  border: 1px solid #e8b4b4;
  border-radius: 6px;
  color: #7a1e1e;
  font-size: 0.9rem;
}

.log {
  min-height: 10rem;
  max-height: min(50vh, 24rem);
  overflow-y: auto;
  border: 1px solid #e5e5e5;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.empty {
  margin: 0;
  color: #888;
  font-size: 0.95rem;
}

.bubble {
  margin: 0;
  padding: 0.5rem 0.65rem;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #e8e8e8;
}

.bubble.self {
  background: #e8f6ef;
  border-color: #b8d9c7;
}

.meta {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #666;
}

.who {
  font-weight: 600;
  color: #2c3e50;
}

.text {
  margin: 0.25rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.45;
}

.compose {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.compose input {
  flex: 1 1 12rem;
  min-width: 0;
}

button.primary,
button.secondary {
  font: inherit;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

button.primary {
  border: none;
  background: #42b883;
  color: #fff;
  align-self: flex-start;
}

button.primary.small {
  padding: 0.45rem 0.9rem;
  font-size: 0.9rem;
  align-self: center;
}

button.primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

button.secondary {
  border: 1px solid #ccc;
  background: #fff;
  color: #2c3e50;
}

.linkish {
  border: none;
  background: none;
  color: #2563eb;
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
  padding: 0;
}

.linkish:hover {
  color: #1d4ed8;
}
</style>
