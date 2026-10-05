import { createReducer, on } from '@ngrx/store'
import type { ReviewComment, RoutePackage, ShuntingRecord, Yard } from '../types'
import * as RouteActions from './route.actions'
import { ShuntingLogicService } from '../services/shunting-logic.service'

const logic = new ShuntingLogicService()
const nowText = () => {
  const time = new Date()
  return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}

/** 按站场与提交先后重排等待位置（后到单看到等待位置） */
function recomputeQueues(records: ShuntingRecord[]): ShuntingRecord[] {
  const waiting = records
    .filter((record) => record.status === '排队' || record.status === '恢复排队')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.requestId.localeCompare(b.requestId))
  const counters = new Map<string, number>()
  const positionOf = new Map<string, number>()
  for (const record of waiting) {
    const next = (counters.get(record.yardId) ?? 0) + 1
    counters.set(record.yardId, next)
    positionOf.set(record.requestId, next)
  }
  return records.map((record) =>
    record.status === '排队' || record.status === '恢复排队'
      ? { ...record, queuePosition: positionOf.get(record.requestId) ?? 0 }
      : { ...record, queuePosition: 0 },
  )
}

/** 生效解编：受影响区段会签立即失效重算，其余照原依据保留；回写余车 */
function applyEffectiveRecord(state: RouteState, record: ShuntingRecord): RouteState {
  const { invalidated, recomputed } = logic.recomputeComments(record, state.comments)
  const invalidIds = new Set(invalidated.map((comment) => comment.id))
  const supersedes = new Map(recomputed.map((comment) => [comment.replaces, comment.id]))
  const comments = [
    ...recomputed,
    ...state.comments.map((comment) => invalidIds.has(comment.id)
      ? { ...comment, status: '已失效' as const, supersededBy: supersedes.get(comment.id) }
      : comment),
  ]
  const routes = state.routes.map((route) => logic.applyToRoute(route, record))
  return {
    ...state,
    routes,
    comments,
    version: state.version + 1,
    records: recomputeQueues(state.records.map((item) => item.requestId === record.requestId
      ? { ...record, invalidatedCommentIds: invalidated.map((comment) => comment.id), recomputedCommentIds: recomputed.map((comment) => comment.id) }
      : item)),
  }
}

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  yards: Yard[]
  records: ShuntingRecord[]
  pendingRequestId: string
  shuntingError: string
  loading: boolean
  error: string
  version: number
}

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 7,
  yards: [], records: [], pendingRequestId: '', shuntingError: '',
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认', basis: '《危规》水源地通行条款 + 甘安委〔2026〕17 号' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受', basis: '豫应急护〔2026〕09 号监护方案' },
    { id: 'RV-33', segmentId: 'S-301', role: '运营', author: '周敏', content: '新丰镇交口保留 10 分钟技术检查，编组顺序不得调整。', status: '已接受', basis: '西运技〔2026〕44 号交口协议' },
  ],
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => {
    const normalized = routes.map((route) => logic.ensureWagons(route))
    return { ...state, loading: false, routes: normalized, selectedRouteId: state.selectedRouteId || normalized[0]?.id || '', selectedSegmentId: state.selectedSegmentId || normalized[0]?.segments[0]?.id || '' }
  }),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RouteActions.loadYardsSuccess, (state, { yards }) => ({ ...state, yards: logic.normalizeYards(yards) })),
  on(RouteActions.selectRoute, (state, { id }) => ({ ...state, selectedRouteId: id, selectedSegmentId: state.routes.find((route) => route.id === id)?.segments[0]?.id ?? '' })),
  on(RouteActions.selectSegment, (state, { id }) => ({ ...state, selectedSegmentId: id })),
  on(RouteActions.updateSegmentLevel, (state, { id, level }) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => ({ ...route, segments: route.segments.map((segment) => segment.id === id ? { ...segment, level, status: level === '高' ? '需绕行' as const : '待复核' as const } : segment) })),
  })),
  on(RouteActions.addComment, (state, { comment }) => ({ ...state, comments: [comment, ...state.comments] })),
  on(RouteActions.resolveComment, (state, { id, status }) => ({ ...state, comments: state.comments.map((comment) => comment.id === id ? { ...comment, status } : comment) })),
  on(RouteActions.createAlternative, (state) => ({
    ...state,
    version: state.version + 1,
    routes: state.routes.map((route) => route.id === state.selectedRouteId ? { ...route, id: `${route.id}-ALT`, score: Math.max(72, route.score - 2) } : route),
  })),

  // 提交即建单：reducer 串行处理同一 tick 的两份提交，先到方案占先、后到留冲突
  on(RouteActions.submitShunting, (state, { draft, requestId }) => {
    const record = logic.buildRecord({ draft, requestId, routes: state.routes, yards: state.yards, records: state.records, createdAt: nowText() })
    if (!record) return state
    const records = recomputeQueues([...state.records, record])
    const stored = records.find((item) => item.requestId === requestId) ?? record
    return {
      ...state,
      records,
      shuntingError: '',
      // 冲突单不发起写入；排队/生效均待后端确认
      pendingRequestId: stored.status === '冲突' ? '' : requestId,
    }
  }),

  on(RouteActions.shuntingWriteSuccess, (state, { requestId }) => {
    const record = state.records.find((item) => item.requestId === requestId)
    if (!record || record.status === '冲突') return { ...state, pendingRequestId: '' }
    if (record.status === '排队') {
      // 排队单写入成功但容量仍不足：保持排队，等待位置已可见，暂不触动会签
      return { ...state, pendingRequestId: '', shuntingError: '', records: recomputeQueues(state.records) }
    }
    const next = applyEffectiveRecord(state, { ...record, status: '生效' })
    return { ...next, pendingRequestId: '', shuntingError: '' }
  }),

  on(RouteActions.shuntingWriteFailure, (state, { requestId, error }) => ({
    ...state,
    pendingRequestId: '',
    shuntingError: error,
    records: state.records.map((record) => record.requestId === requestId && record.status !== '冲突'
      ? { ...record, status: '写入失败' as const, note: '写入未落盘，解编前许可与方案已暂存，可按请求号恢复' }
      : record),
  })),

  // 按请求号恢复：重发写入（attempts 累加），解编前许可仍挂在记录上可查
  on(RouteActions.recoverShunting, (state, { requestId }) => {
    const record = state.records.find((item) => item.requestId === requestId)
    if (!record || record.status !== '写入失败') return state
    return {
      ...state,
      shuntingError: '',
      pendingRequestId: requestId,
      records: state.records.map((item) => item.requestId === requestId ? { ...item, attempts: item.attempts + 1 } : item),
    }
  }),

  on(RouteActions.shuntingRecoverSuccess, (state, { requestId }) => {
    const record = state.records.find((item) => item.requestId === requestId)
    if (!record) return { ...state, pendingRequestId: '' }
    // 按当前容量/占用重新评估：恢复生效或恢复排队；若同单已被先到方案占用则留冲突
    const others = state.records.filter((item) => item.requestId !== requestId)
    const fresh = logic.buildRecord({
      draft: {
        routeId: record.routeId,
        yardId: record.yardId,
        detachedWagonIds: record.detachedWagonIds,
        dispatcher: record.dispatcher,
        simulateFailure: false,
      },
      requestId,
      routes: state.routes,
      yards: state.yards,
      records: others,
      createdAt: record.createdAt,
      attempts: record.attempts,
    })
    const recoveredStatus = fresh?.status === '排队' ? '恢复排队' as const : fresh?.status === '冲突' ? '冲突' as const : '恢复生效' as const
    const restored: ShuntingRecord = {
      ...record,
      ...(fresh ?? {}),
      status: recoveredStatus,
      // 解编前许可沿用首次提交快照
      permitBefore: record.permitBefore,
      permissionBefore: record.permissionBefore,
      createdAt: record.createdAt,
      attempts: record.attempts,
    }
    const records = recomputeQueues(state.records.map((item) => item.requestId === requestId ? restored : item))
    const nextState = { ...state, records, pendingRequestId: '', shuntingError: '' }
    return recoveredStatus === '恢复生效'
      ? applyEffectiveRecord(nextState, records.find((item) => item.requestId === requestId) ?? restored)
      : nextState
  }),
)
