import { createAction, props } from '@ngrx/store'
import type { ReviewComment, RiskLevel, RoutePackage, UncouplingPlan, UncouplingRecord, Yard } from '../types'

export const loadRoutes = createAction('[Route Workbench] Load Routes')
export const loadRoutesSuccess = createAction('[Route API] Load Routes Success', props<{ routes: RoutePackage[] }>())
export const loadRoutesFailure = createAction('[Route API] Load Routes Failure', props<{ error: string }>())
export const selectRoute = createAction('[Route Workbench] Select Route', props<{ id: string }>())
export const selectSegment = createAction('[Risk Map] Select Segment', props<{ id: string }>())
export const updateSegmentLevel = createAction('[Risk Map] Update Level', props<{ id: string; level: RiskLevel }>())
export const addComment = createAction('[Approval] Add Comment', props<{ comment: ReviewComment }>())
export const resolveComment = createAction('[Approval] Resolve Comment', props<{ id: string; status: ReviewComment['status'] }>())
export const createAlternative = createAction('[Risk Map] Create Alternative')

export const loadUncouplingData = createAction('[Uncoupling] Load Data')
export const loadUncouplingDataSuccess = createAction('[Uncoupling API] Load Data Success', props<{ yards: Yard[]; records: UncouplingRecord[] }>())
export const loadUncouplingDataFailure = createAction('[Uncoupling API] Load Data Failure', props<{ error: string }>())

export const submitUncoupling = createAction('[Uncoupling] Submit Plan', props<{ plan: UncouplingPlan }>())
export const submitUncouplingSuccess = createAction('[Uncoupling API] Submit Success', props<{ record: UncouplingRecord }>())
export const submitUncouplingFailure = createAction('[Uncoupling API] Submit Failure', props<{ requestNo: string; error: string }>())

export const recoverUncoupling = createAction('[Uncoupling] Recover By Request No', props<{ requestNo: string }>())
export const recoverUncouplingSuccess = createAction('[Uncoupling API] Recover Success', props<{ record: UncouplingRecord }>())
export const recoverUncouplingFailure = createAction('[Uncoupling API] Recover Failure', props<{ requestNo: string; error: string }>())

export const completeUncoupling = createAction('[Uncoupling] Complete And Release Capacity', props<{ requestNo: string }>())
