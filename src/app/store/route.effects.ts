import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, map, mergeMap, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import { RouteState } from './route.reducer'
import * as RouteActions from './route.actions'

@Injectable()
export class RouteEffects {
  private readonly actions$ = inject(Actions)
  private readonly api = inject(RouteApiService)
  private readonly store = inject(Store<{ routes: RouteState }>)

  loadRoutes$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getRoutePackages().pipe(
      map((routes) => RouteActions.loadRoutesSuccess({ routes })),
      catchError((error: unknown) => of(RouteActions.loadRoutesFailure({ error: error instanceof Error ? error.message : '无法读取路径数据' }))),
    )),
  ))

  loadYards$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadRoutes),
    switchMap(() => this.api.getYards().pipe(
      map((yards) => RouteActions.loadYardsSuccess({ yards })),
      catchError(() => of(RouteActions.loadYardsSuccess({ yards: [] }))),
    )),
  ))

  submitShunting$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.submitShunting),
    withLatestFrom(this.store),
    mergeMap(([{ requestId }, state]: [{ requestId: string }, { routes: RouteState }]) => {
      const record = state.routes.records.find((item) => item.requestId === requestId)
      // 冲突单不发起写入，直接结束（reducer 已留冲突痕迹）
      if (record?.status === '冲突') return of(RouteActions.shuntingWriteSuccess({ requestId }))
      const simulateFailure = record?.simulateFailure ?? false
      return this.api.submitShunting(requestId, simulateFailure).pipe(
        map(() => RouteActions.shuntingWriteSuccess({ requestId })),
        catchError((error: unknown) => of(RouteActions.shuntingWriteFailure({
          requestId,
          error: error instanceof Error ? error.message : `解编请求 ${requestId} 写入失败`,
        }))),
      )
    }),
  ))

  recoverShunting$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.recoverShunting),
    mergeMap(({ requestId }) => this.api.recoverShunting(requestId).pipe(
      map(() => RouteActions.shuntingRecoverSuccess({ requestId })),
      catchError((error: unknown) => of(RouteActions.shuntingWriteFailure({
        requestId,
        error: error instanceof Error ? error.message : `解编请求 ${requestId} 恢复失败`,
      }))),
    )),
  ))
}
