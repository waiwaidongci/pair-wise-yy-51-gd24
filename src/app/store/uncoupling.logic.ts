import type { RiskLevel, RoutePackage, TankCar, UncouplingPlan, UncouplingRecord, Yard } from '../types'
import type { RouteState } from './route.reducer'

export const DEFAULT_YARD_CAPACITY = 12
export const ACTIVE_STATUSES: string[] = ['写入中', '生效', '已恢复']

export function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function buildWagons(order: RoutePackage): TankCar[] {
  const isClass3 = order.hazardClass.includes('3')
  const highCount = isClass3 ? Math.round(order.wagonCount * 0.35) : Math.round(order.wagonCount * 0.15)
  const midCount = Math.round(order.wagonCount * 0.4)
  return Array.from({ length: order.wagonCount }, (_, i) => {
    const risk: RiskLevel = i < highCount ? '高' : i < highCount + midCount ? '中' : '低'
    return {
      id: `${order.id}-W${String(i + 1).padStart(2, '0')}`,
      orderId: order.id,
      cargo: order.cargo,
      hazardClass: order.hazardClass,
      tonnage: Math.round(order.tonnage / order.wagonCount),
      risk,
    }
  })
}

export function ensureWagons(order: RoutePackage): TankCar[] {
  return order.wagons && order.wagons.length === order.wagonCount ? order.wagons : buildWagons(order)
}

export function riskLevelOf(wagons: TankCar[]): RiskLevel {
  if (wagons.some((w) => w.risk === '高')) return '高'
  if (wagons.some((w) => w.risk === '中')) return '中'
  return '低'
}

// 余车风险分：与工作台口径一致（>=70 高、>=45 中、其余低），解下高风险车后明显下降
export function riskScoreOf(wagons: TankCar[]): number {
  const high = wagons.filter((w) => w.risk === '高').length
  const mid = wagons.filter((w) => w.risk === '中').length
  if (high > 0) return Math.min(100, 70 + high * 5)
  if (mid > 0) return Math.min(69, 45 + mid * 4)
  return Math.min(44, wagons.length * 4)
}

export function affectedSegmentIdsOf(order: RoutePackage, segmentId: string): string[] {
  const idx = order.segments.findIndex((s) => s.id === segmentId)
  const from = idx === -1 ? 0 : idx
  return order.segments.slice(from).map((s) => s.id)
}

export function normalizeYard(raw: Partial<Yard> & { id: string; name: string; segmentId: string }): Yard {
  const hasCapacity = typeof raw.capacity === 'number' && Number.isFinite(raw.capacity)
  if (hasCapacity) {
    return {
      id: raw.id, name: raw.name, segmentId: raw.segmentId,
      capacity: raw.capacity as number,
      capacityVerified: raw.capacityVerified ?? true,
      capacitySource: raw.capacitySource ?? '核定',
    }
  }
  // 已有数据缺站场容量：补默认值并标待核验
  return {
    id: raw.id, name: raw.name, segmentId: raw.segmentId,
    capacity: DEFAULT_YARD_CAPACITY, capacityVerified: false, capacitySource: '默认',
  }
}

export interface DecideResult { record: UncouplingRecord }

// 纯函数：根据当前状态决定解编方案的状态（先到生效 / 后到冲突 / 容量排队）
// excludeRequestNo 用于排除同一请求号的乐观写入记录，避免自己与自己冲突
export function decideUncoupling(plan: UncouplingPlan, state: RouteState, excludeRequestNo?: string): DecideResult {
  const exclude = excludeRequestNo ?? plan.requestNo
  const order = state.routes.find((r) => r.id === plan.orderId)
  const yard = state.yards.find((y) => y.id === plan.yardId)
  if (!order || !yard) throw new Error('运输单或站场不存在')
  const segment = order.segments.find((s) => s.id === plan.segmentId) ?? order.segments[0]
  const allWagons = ensureWagons(order)
  const uncoupled = allWagons.filter((w) => plan.uncoupledWagonIds.includes(w.id))
  const remaining = allWagons.filter((w) => !plan.uncoupledWagonIds.includes(w.id))
  const affectedSegmentIds = affectedSegmentIdsOf(order, plan.segmentId)
  const affectedCommentIds = state.comments.filter((c) => affectedSegmentIds.includes(c.segmentId)).map((c) => c.id)

  const relevant = state.uncouplingRecords.filter((r) => r.requestNo !== exclude)
  // 先到先得：仅同一运输单的在途（写入中）方案算作同时提交的先到方，后到留冲突
  const winner = relevant.find((r) => r.orderId === plan.orderId && r.status === '写入中')
  let status: UncouplingRecord['status']
  let basedOnRequestNo: string | undefined
  let queuePosition = 0
  if (winner) {
    // 两名调度同时提交同一运输单：先到方案生效，后到留冲突
    status = '已冲突'
    basedOnRequestNo = winner.requestNo
  } else {
    const occupied = relevant
      .filter((r) => r.yardId === plan.yardId && ACTIVE_STATUSES.includes(r.status))
      .reduce((sum, r) => sum + r.uncoupledCount, 0)
    const queuedPlans = relevant.filter((r) => r.yardId === plan.yardId && r.status === '排队中').length
    const available = yard.capacity - occupied
    if (available >= uncoupled.length && available > 0) {
      status = '生效'
    } else {
      // 站场容量不足：待解编车排队，后到单看到等待位置
      status = '排队中'
      queuePosition = queuedPlans + 1
    }
  }

  const record: UncouplingRecord = {
    id: `UR-${plan.requestNo}`,
    requestNo: plan.requestNo,
    orderId: order.id,
    trainCode: order.trainCode,
    yardId: yard.id,
    yardName: yard.name,
    segmentId: segment.id,
    segmentName: segment.name,
    uncoupledWagonIds: uncoupled.map((w) => w.id),
    remainingWagonIds: remaining.map((w) => w.id),
    uncoupledCount: uncoupled.length,
    remainingCount: remaining.length,
    queuePosition,
    status,
    basedOnRequestNo,
    affectedSegmentIds,
    affectedCommentIds,
    remainingRisk: riskLevelOf(remaining),
    remainingScore: riskScoreOf(remaining),
    permitSnapshot: order.permit,
    permissionSnapshot: order.permission,
    dispatcher: plan.dispatcher,
    submittedAt: nowTime(),
  }
  return { record }
}
