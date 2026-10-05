import { inject, Injectable } from '@angular/core'
import { Actions, createEffect, ofType } from '@ngrx/effects'
import { Store } from '@ngrx/store'
import { catchError, concatMap, forkJoin, map, of, switchMap, withLatestFrom } from 'rxjs'
import { RouteApiService } from '../services/route-api.service'
import * as RouteActions from './route.actions'
import { decideUncoupling } from './uncoupling.logic'
import type { RouteState } from './route.reducer'
import type { UncouplingPlan, UncouplingRecord } from '../types'

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

  loadUncouplingData$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.loadUncouplingData),
    switchMap(() => forkJoin([this.api.getYards(), this.api.getUncouplingRecords()]).pipe(
      map(([yards, records]) => RouteActions.loadUncouplingDataSuccess({ yards, records })),
      catchError((error: unknown) => of(RouteActions.loadUncouplingDataFailure({ error: error instanceof Error ? error.message : '无法读取解编数据' }))),
    )),
  ))

  submitUncoupling$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.submitUncoupling),
    withLatestFrom(this.store.select((state) => state.routes)),
    concatMap(([{ plan }, state]: [{ plan: UncouplingPlan }, RouteState]) => {
      const existing = state.uncouplingRecords.find((r: UncouplingRecord) => r.requestNo === plan.requestNo)
      if (existing && existing.status !== '写入中') {
        return of(RouteActions.submitUncouplingSuccess({ record: existing }))
      }
      let record: UncouplingRecord
      try {
        record = decideUncoupling(plan, state, plan.requestNo).record
      } catch (error) {
        return of(RouteActions.submitUncouplingFailure({ requestNo: plan.requestNo, error: error instanceof Error ? error.message : '解编方案校验失败' }))
      }
      return this.api.writeUncoupling(plan, record).pipe(
        map((persisted) => RouteActions.submitUncouplingSuccess({ record: persisted })),
        catchError((error: unknown) => of(RouteActions.submitUncouplingFailure({ requestNo: plan.requestNo, error: error instanceof Error ? error.message : '写入失败' }))),
      )
    }),
  ))

  recoverUncoupling$ = createEffect(() => this.actions$.pipe(
    ofType(RouteActions.recoverUncoupling),
    concatMap(({ requestNo }) => this.api.recoverUncoupling(requestNo).pipe(
      map((record) => RouteActions.recoverUncouplingSuccess({ record })),
      catchError((error: unknown) => of(RouteActions.recoverUncouplingFailure({ requestNo, error: error instanceof Error ? error.message : '恢复失败' }))),
    )),
  ))
}
