import { createAction, props } from '@ngrx/store'
import type { ReviewComment, RiskLevel, RoutePackage, ShuntingDraft, Yard } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const loadYards = createAction('[Shunting] Load Yards')
export const loadYardsSuccess = createAction('[Shunting API] Load Yards Success', props<{ yards: Yard[] }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

/** 提交解编：同 tick 双调度提交时由 reducer 串行建单，保证先到判定 */
export const submitShunting = createAction('[Shunting] Submit', props<{ draft: ShuntingDraft; requestId: string }>())
export const shuntingWriteSuccess = createAction('[Shunting API] Write Success', props<{ requestId: string }>())
export const shuntingWriteFailure = createAction('[Shunting API] Write Failure', props<{ requestId: string; error: string }>())
/** 写入失败后按请求号恢复 */
export const recoverShunting = createAction('[Shunting] Recover By Request Id', props<{ requestId: string }>())
export const shuntingRecoverSuccess = createAction('[Shunting API] Recover Success', props<{ requestId: string }>())
