import { createReducer, on } from '@ngrx/store'
import type { ReviewComment, RoutePackage, UncouplingRecord, Yard } from '../types'
import * as RouteActions from './route.actions'
import { ACTIVE_STATUSES, decideUncoupling } from './uncoupling.logic'

export interface RouteState {
  routes: RoutePackage[]
  selectedRouteId: string
  selectedSegmentId: string
  comments: ReviewComment[]
  yards: Yard[]
  uncouplingRecords: UncouplingRecord[]
  loading: boolean
  error: string
  version: number
}

export const initialState: RouteState = {
  routes: [], selectedRouteId: '', selectedSegmentId: '', loading: false, error: '', version: 6,
  yards: [],
  uncouplingRecords: [],
  comments: [
    { id: 'RV-31', segmentId: 'S-203', role: '安全', author: '韩洁', content: '水源地保护段限速 45 km/h，并要求随车配置吸附围油栏。', status: '待确认' },
    { id: 'RV-32', segmentId: 'S-207', role: '应急', author: '罗晋', content: '长隧道出口需增加 15 分钟现场监护窗口，接受后方可放行。', status: '已接受' },
  ],
}

// 解下哪些罐车决定余车风险：受影响区段等级按余车重算，受影响会签立即失效，其余照原依据保留
function applyRisk(state: RouteState, record: UncouplingRecord): RouteState {
  return {
    ...state,
    version: state.version + 1,
    uncouplingRecords: state.uncouplingRecords.map((r) =>
      r.requestNo === record.requestNo
        ? { ...r, status: record.status, queuePosition: record.queuePosition, recoveredAt: record.recoveredAt ?? r.recoveredAt, completedAt: record.completedAt ?? r.completedAt }
        : r,
    ),
    routes: state.routes.map((route) =>
      route.id === record.orderId
        ? {
            ...route,
            score: record.remainingScore,
            segments: route.segments.map((segment) =>
              record.affectedSegmentIds.includes(segment.id) ? { ...segment, level: record.remainingRisk } : segment,
            ),
          }
        : route,
    ),
    comments: state.comments.map((comment) =>
      record.affectedCommentIds.includes(comment.id)
        ? { ...comment, status: '已失效' as const, invalidatedBy: record.requestNo }
        : comment,
    ),
  }
}

// 容量释放后按等待位置顺序放行排队方案
function promoteQueue(state: RouteState, yardId: string): RouteState {
  let next = state
  const queued = next.uncouplingRecords
    .filter((r) => r.yardId === yardId && r.status === '排队中')
    .sort((a, b) => a.queuePosition - b.queuePosition)
  for (const candidate of queued) {
    const yard = next.yards.find((y) => y.id === yardId)
    if (!yard) continue
    const occupied = next.uncouplingRecords
      .filter((r) => r.yardId === yardId && ACTIVE_STATUSES.includes(r.status))
      .reduce((sum, r) => sum + r.uncoupledCount, 0)
    if (yard.capacity - occupied >= candidate.uncoupledCount) {
      next = applyRisk(next, { ...candidate, status: '生效' as const, queuePosition: 0 })
    }
  }
  return next
}

export const routeReducer = createReducer(
  initialState,
  on(RouteActions.loadRoutes, (state) => ({ ...state, loading: true, error: '' })),
  on(RouteActions.loadRoutesSuccess, (state, { routes }) => ({ ...state, loading: false, routes, selectedRouteId: state.selectedRouteId || routes[0]?.id || '', selectedSegmentId: state.selectedSegmentId || routes[0]?.segments[0]?.id || '' })),
  on(RouteActions.loadRoutesFailure, (state, { error }) => ({ ...state, loading: false, error })),
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

  on(RouteActions.loadUncouplingDataSuccess, (state, { yards, records }) => {
    let next: RouteState = { ...state, yards, uncouplingRecords: records }
    for (const record of records) {
      if (record.status === '生效' || record.status === '已恢复') next = applyRisk(next, record)
    }
    return next
  }),
  on(RouteActions.loadUncouplingDataFailure, (state, { error }) => ({ ...state, error })),

  on(RouteActions.submitUncoupling, (state, { plan }) => {
    if (state.uncouplingRecords.some((r) => r.requestNo === plan.requestNo)) return state
    const { record } = decideUncoupling(plan, state, plan.requestNo)
    return { ...state, uncouplingRecords: [{ ...record, status: '写入中' as const }, ...state.uncouplingRecords] }
  }),
  on(RouteActions.submitUncouplingSuccess, (state, { record }) => {
    const exists = state.uncouplingRecords.some((r) => r.requestNo === record.requestNo)
    const base: RouteState = exists
      ? { ...state, uncouplingRecords: state.uncouplingRecords.map((r) => r.requestNo === record.requestNo ? { ...r, status: record.status, queuePosition: record.queuePosition, basedOnRequestNo: record.basedOnRequestNo } : r) }
      : { ...state, uncouplingRecords: [record, ...state.uncouplingRecords] }
    return record.status === '生效' || record.status === '已恢复' ? applyRisk(base, record) : base
  }),
  on(RouteActions.submitUncouplingFailure, (state, { requestNo }) => ({
    ...state,
    error: '写入失败：已按请求号挂起，可执行恢复',
    uncouplingRecords: state.uncouplingRecords.map((r) => r.requestNo === requestNo ? { ...r, status: '待恢复' as const } : r),
  })),

  on(RouteActions.recoverUncouplingSuccess, (state, { record }) => {
    const shouldActivate = record.queuePosition === 0
    const recovered: UncouplingRecord = {
      ...record,
      status: shouldActivate ? '已恢复' : '排队中',
      recoveredAt: shouldActivate ? new Date().toTimeString().slice(0, 5) : undefined,
    }
    const base: RouteState = { ...state, uncouplingRecords: state.uncouplingRecords.map((r) => r.requestNo === record.requestNo ? recovered : r) }
    return shouldActivate ? applyRisk(base, recovered) : base
  }),
  on(RouteActions.recoverUncouplingFailure, (state, { error }) => ({ ...state, error })),

  on(RouteActions.completeUncoupling, (state, { requestNo }) => {
    const record = state.uncouplingRecords.find((r) => r.requestNo === requestNo)
    if (!record) return state
    const updated: RouteState = {
      ...state,
      uncouplingRecords: state.uncouplingRecords.map((r) => r.requestNo === requestNo ? { ...r, status: '已完成' as const, completedAt: new Date().toTimeString().slice(0, 5) } : r),
    }
    return promoteQueue(updated, record.yardId)
  }),
)
