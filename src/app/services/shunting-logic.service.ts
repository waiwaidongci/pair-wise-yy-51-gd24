import { Injectable } from '@angular/core'
import type {
  CapacitySource,
  ReviewComment,
  RoutePackage,
  ShuntingDraft,
  ShuntingRecord,
  ShuntingStatus,
  TankWagon,
  Yard,
} from '../types'

/** 源数据缺站场容量时补的默认限编值，必须标待核验 */
export const DEFAULT_YARD_CAPACITY = 10
export const ACTIVE_WRITE_STATUSES: ShuntingStatus[] = ['生效', '恢复生效', '排队', '恢复排队']

type RawYard = Partial<Yard> & Pick<Yard, 'id' | 'name' | 'segmentIds'>

@Injectable({ providedIn: 'root' })
export class ShuntingLogicService {
  /** 已有数据缺站场容量：补默认值并标待核验 */
  normalizeYards(raw: RawYard[]): Yard[] {
    return raw.map((yard) => {
      const known = typeof yard.capacity === 'number' && Number.isFinite(yard.capacity)
      const source: CapacitySource = known && yard.capacitySource === '台账实测' ? '台账实测' : '默认值待核验'
      return {
        id: yard.id,
        name: yard.name,
        segmentIds: yard.segmentIds ?? [],
        capacity: known ? yard.capacity as number : DEFAULT_YARD_CAPACITY,
        capacitySource: source,
        note: source === '默认值待核验'
          ? `${yard.note ?? ''}容量缺失，补默认 ${DEFAULT_YARD_CAPACITY} 辆，待核验`.trim()
          : yard.note,
      }
    })
  }

  /** 运输单缺罐车明细：按编组数补齐默认罐车（风险按序分布，供风险核算） */
  ensureWagons(route: RoutePackage): RoutePackage {
    if (route.wagons?.length === route.wagonCount) return route
    const wagons: TankWagon[] = Array.from({ length: route.wagonCount }, (_, index) => {
      const level: TankWagon['level'] = index % 7 === 3 ? '高' : index % 3 === 0 ? '中' : '低'
      return {
        id: `${route.trainCode}-W${String(index + 1).padStart(3, '0')}`,
        itemNo: `UN-${route.cargo.includes('UN') ? route.cargo.split('（UN')[1]?.split('）')[0] ?? '0000' : '0000'}-${index + 1}`,
        weight: level === '高' ? 3 : level === '中' ? 2 : 1,
        level,
        tonnage: Math.round((route.tonnage / route.wagonCount) * 10) / 10,
      }
    })
    return { ...route, wagons, remainingWagonIds: route.remainingWagonIds ?? wagons.map((wagon) => wagon.id) }
  }

  /** 站场是否可作为该运输单的中间解编站：至少接入一个运行区段 */
  yardEligible(yard: Yard, route: RoutePackage): boolean {
    return yard.segmentIds.some((segmentId) => route.segments.some((segment) => segment.id === segmentId))
  }

  /** 受影响区段：站场接入区段及其后的全部区段（余车继续走的区段） */
  affectedSegmentIds(yard: Yard, route: RoutePackage): string[] {
    const firstHit = route.segments.findIndex((segment) => yard.segmentIds.includes(segment.id))
    if (firstHit < 0) return []
    return route.segments.slice(firstHit).map((segment) => segment.id)
  }

  /** 生效/排队中的有效占用（写入失败与冲突不占容量） */
  occupiedCapacity(yardId: string, records: ShuntingRecord[]): number {
    return records
      .filter((record) => record.yardId === yardId && ACTIVE_WRITE_STATUSES.includes(record.status))
      .reduce((sum, record) => sum + record.detachedCount, 0)
  }

  /** 同站场队列中等待的记录数（后到单据此看到等待位置） */
  waitingAhead(yardId: string, records: ShuntingRecord[]): number {
    return records.filter((record) => record.yardId === yardId && (record.status === '排队' || record.status === '恢复排队')).length
  }

  /**
   * 同一运输单、同一提交时刻（同一 tick）的先到有效方案：
   * 两名调度同时提交同一运输单时，先到生效、后到留冲突；
   * 不同时刻的顺序解编（如后续站场二次解编）允许，不视为并发冲突。
   */
  conflictingRoute(routeId: string, records: ShuntingRecord[], requestId: string, createdAt: string): ShuntingRecord | undefined {
    return records.find(
      (record) => record.routeId === routeId
        && record.requestId !== requestId
        && record.createdAt === createdAt
        && ACTIVE_WRITE_STATUSES.includes(record.status),
    )
  }

  /** 解下哪些罐车决定余车风险：按余车保留的风险权重重算风险分 */
  remainingScore(route: RoutePackage, remainingWagonIds: string[]): number {
    const wagons = route.wagons ?? []
    const totalWeight = wagons.reduce((sum, wagon) => sum + wagon.weight, 0) || 1
    const remainingWeight = wagons
      .filter((wagon) => remainingWagonIds.includes(wagon.id))
      .reduce((sum, wagon) => sum + wagon.weight, 0)
    return Math.min(100, Math.round(route.score * (remainingWeight / totalWeight)))
  }

  /** 组装解编记录：容量不足排队；同一运输单后到留冲突 */
  buildRecord(input: {
    draft: ShuntingDraft
    requestId: string
    routes: RoutePackage[]
    yards: Yard[]
    records: ShuntingRecord[]
    createdAt: string
    attempts?: number
    statusOverride?: ShuntingStatus
  }): ShuntingRecord | undefined {
    const { draft, requestId, routes, yards, records, createdAt } = input
    const route = routes.find((item) => item.id === draft.routeId)
    const yard = yards.find((item) => item.id === draft.yardId)
    if (!route || !yard) return undefined

    const remainingWagonIds = (route.remainingWagonIds ?? route.wagons?.map((wagon) => wagon.id) ?? [])
      .filter((id) => !draft.detachedWagonIds.includes(id))
    const detachedCount = draft.detachedWagonIds.length
    const remainingScore = this.remainingScore(route, remainingWagonIds)
    const occupied = this.occupiedCapacity(yard.id, records)
    const capacity = yard.capacity
    const available = Math.max(0, capacity - occupied)

    const conflict = this.conflictingRoute(route.id, records, requestId, createdAt)
    let status: ShuntingStatus
    let queuePosition = 0
    let conflictWith: string | undefined
    if (conflict) {
      status = '冲突'
      conflictWith = conflict.requestId
    } else if (detachedCount > available) {
      queuePosition = this.waitingAhead(yard.id, records) + 1
      status = '排队'
    } else {
      status = '生效'
    }
    if (input.statusOverride) status = input.statusOverride

    return {
      ...draft,
      requestId,
      trainCode: route.trainCode,
      yardName: yard.name,
      detachedCount,
      remainingCount: remainingWagonIds.length,
      remainingWagonIds,
      remainingScore,
      status,
      queuePosition,
      capacity,
      capacitySource: yard.capacitySource,
      occupiedCapacity: occupied,
      availableCapacity: available,
      affectedSegmentIds: this.affectedSegmentIds(yard, route),
      invalidatedCommentIds: [],
      recomputedCommentIds: [],
      permitBefore: route.permit,
      permissionBefore: route.permission,
      createdAt,
      attempts: input.attempts ?? 1,
      conflictWith,
      note: yard.capacitySource === '默认值待核验' ? '站场容量为默认值，先按限编排队核算，待核验' : undefined,
    }
  }

  /**
   * 受影响区段的会签立即失效重算，其余照原依据保留。
   * 返回失效的旧意见与按余车风险重算的新意见。
   */
  recomputeComments(record: ShuntingRecord, comments: ReviewComment[]): {
    invalidated: ReviewComment[]
    recomputed: ReviewComment[]
  } {
    const affected = new Set(record.affectedSegmentIds)
    const invalidated = comments.filter(
      (comment) => affected.has(comment.segmentId) && comment.status !== '已失效',
    )
    const recomputed: ReviewComment[] = invalidated.map((old) => {
      const newId = `RV-RC-${record.requestId.slice(-4)}-${old.id}`
      return {
        id: newId,
        segmentId: old.segmentId,
        role: old.role,
        author: '规则引擎重算',
        content: `解编 ${record.requestId} 后余车 ${record.remainingCount} 辆、余车风险 ${record.remainingScore} 分，按 ${old.role} 专业原条件重新核定：${old.content}`,
        status: '待确认',
        basis: old.basis ?? `原 ${old.id} 会签条件`,
        reRecordId: record.requestId,
        replaces: old.id,
      } satisfies ReviewComment
    })
    return { invalidated, recomputed }
  }

  /** 生效后回写运输单余车编组与余车风险分（排队/冲突/失败不改单） */
  applyToRoute(route: RoutePackage, record: ShuntingRecord): RoutePackage {
    if (route.id !== record.routeId) return route
    return {
      ...route,
      wagonCount: record.remainingCount,
      remainingWagonIds: record.remainingWagonIds,
      score: record.remainingScore,
    }
  }
}
