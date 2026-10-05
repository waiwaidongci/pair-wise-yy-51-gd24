import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { map, Observable, shareReplay, switchMap, timer } from 'rxjs'
import type { RoutePackage, Yard } from '../types'

interface RouteData {
  items: RoutePackage[]
  yards: Yard[]
}

@Injectable({ providedIn: 'root' })
export class RouteApiService {
  private readonly http = inject(HttpClient)
  private readonly data$ = this.http.get<RouteData>('route-data.json').pipe(shareReplay(1))

  getRoutePackages() {
    return this.data$.pipe(map((response) => response.items))
  }

  getYards() {
    return this.data$.pipe(map((response) => response.yards))
  }

  /**
   * 提交解编写入（模拟后端持久化）。
   * simulateFailure 时后端拒绝写入，方案保留请求号，等待按号恢复。
   */
  submitShunting(requestId: string, simulateFailure: boolean): Observable<{ acknowledged: true; requestId: string }> {
    return timer(420).pipe(
      switchMap(() => new Observable<{ acknowledged: true; requestId: string }>((observer) => {
        if (simulateFailure) {
          observer.error(new Error(`写入失败：解编请求 ${requestId} 未持久化，可凭请求号恢复`))
          return
        }
        observer.next({ acknowledged: true, requestId })
        observer.complete()
      })),
    )
  }

  /** 按请求号恢复：后端幂等确认，同一请求号恢复不产生第二份方案 */
  recoverShunting(requestId: string): Observable<{ acknowledged: true; requestId: string }> {
    return timer(420).pipe(map(() => ({ acknowledged: true as const, requestId })))
  }
}
