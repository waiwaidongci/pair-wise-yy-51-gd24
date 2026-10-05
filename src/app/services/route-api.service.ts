import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { Observable, delay, map, of, switchMap, throwError } from 'rxjs'
import type { RoutePackage, UncouplingPlan, UncouplingRecord, Yard } from '../types'
import { buildWagons, normalizeYard, riskLevelOf, riskScoreOf } from '../store/uncoupling.logic'

interface RouteDataResponse { items: RoutePackage[]; yards: Array<Partial<Yard> & { id: string; name: string; segmentId: string }> }

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)
  private readonly recordStore = new Map<string, UncouplingRecord>()
  private readonly failedRequestNos = new Set<string>()
  private seeded = false

  getRoutePackages(): Observable<RoutePackage[]> {
    return this.http.get<RouteDataResponse>('route-data.json').pipe(
      map((response) => response.items.map((item) => ({ ...item, wagons: buildWagons(item) }))),
    )
  }

  getYards(): Observable<Yard[]> {
    return this.http.get<RouteDataResponse>('route-data.json').pipe(
      map((response) => (response.yards ?? []).map((raw) => normalizeYard(raw))),
    )
  }

  getUncouplingRecords(): Observable<UncouplingRecord[]> {
    if (this.seeded) return of(Array.from(this.recordStore.values()))
    return this.getRoutePackages().pipe(
      map((orders) => {
        this.seed(orders)
        return Array.from(this.recordStore.values())
      }),
    )
  }

  private seed(orders: RoutePackage[]): void {
    const order = orders.find((o) => o.id === 'HG-260930-006')
    if (!order) return
    const all = buildWagons(order)
    const first = all.slice(0, 6)
    const second = all.slice(6, 11)
    const remainingAfterFirst = all.slice(6)
    const remainingAfterSecond = all.slice(11)
    const make = (
      requestNo: string,
      uncoupled: typeof all,
      remaining: typeof all,
      status: UncouplingRecord['status'],
      queuePosition: number,
      dispatcher: string,
      submittedAt: string,
    ): UncouplingRecord => ({
      id: `UR-${requestNo}`,
      requestNo,
      orderId: order.id,
      trainCode: order.trainCode,
      yardId: 'Y-HFD',
      yardName: '合肥东编组站',
      segmentId: 'S-309',
      segmentName: '合肥东至宁波北',
      uncoupledWagonIds: uncoupled.map((w) => w.id),
      remainingWagonIds: remaining.map((w) => w.id),
      uncoupledCount: uncoupled.length,
      remainingCount: remaining.length,
      queuePosition,
      status,
      affectedSegmentIds: ['S-309'],
      affectedCommentIds: [],
      remainingRisk: riskLevelOf(remaining),
      remainingScore: riskScoreOf(remaining),
      permitSnapshot: order.permit,
      permissionSnapshot: order.permission,
      dispatcher,
      submittedAt,
    })
    this.recordStore.set('SEED-01', make('SEED-01', first, remainingAfterFirst, '生效', 0, '调度长·周敏', '14:02'))
    this.recordStore.set('SEED-02', make('SEED-02', second, remainingAfterSecond, '排队中', 1, '调度员·李哲', '14:20'))
    this.seeded = true
  }

  // 写入：按请求号幂等；simulateFailure 时先挂起待恢复副本再抛错
  writeUncoupling(plan: UncouplingPlan, record: UncouplingRecord): Observable<UncouplingRecord> {
    return of(null).pipe(
      delay(320 + Math.random() * 320),
      switchMap(() => {
        if (this.recordStore.has(plan.requestNo)) return of(this.recordStore.get(plan.requestNo) as UncouplingRecord)
        if (plan.simulateFailure && !this.failedRequestNos.has(plan.requestNo)) {
          this.failedRequestNos.add(plan.requestNo)
          this.recordStore.set(plan.requestNo, { ...record, status: '待恢复' })
          return throwError(() => new Error('写入失败：站场容量服务暂时不可用，已按请求号挂起'))
        }
        this.recordStore.set(plan.requestNo, record)
        return of(record)
      }),
    )
  }

  // 写入失败后按请求号恢复；解编前许可快照仍随记录可查
  recoverUncoupling(requestNo: string): Observable<UncouplingRecord> {
    return of(null).pipe(
      delay(280),
      switchMap(() => {
        const stored = this.recordStore.get(requestNo)
        if (!stored) return throwError(() => new Error('未找到请求号，无法恢复'))
        return of(stored)
      }),
    )
  }
}
