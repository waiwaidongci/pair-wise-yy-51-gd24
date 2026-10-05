export type RiskLevel = '高' | '中' | '低'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
}

export interface TankWagon {
  id: string
  /** 危险货物细项编号 */
  itemNo: string
  /** 单车风险权重，用于解下/余车风险核算 */
  weight: number
  level: RiskLevel
  tonnage: number
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  segments: RiskSegment[]
  /** 编组罐车明细，缺失时按编组数补齐默认罐车 */
  wagons?: TankWagon[]
  /** 当前仍随车继续走的罐车（解编后余车） */
  remainingWagonIds?: string[]
}

/** 站场容量来源：实测台账 或 缺数据时补的默认值（待核验） */
export type CapacitySource = '台账实测' | '默认值待核验'

export interface Yard {
  id: string
  name: string
  /** 中间站场所在/可接入的运行区段 */
  segmentIds: string[]
  /** 站内可容留的罐车数（临时限编容量）；源数据缺失时补默认值 */
  capacity: number
  capacitySource: CapacitySource
  note?: string
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回' | '已失效'
  /** 会签依据（原依据保留） */
  basis?: string
  /** 受解编影响失效后，重算产生的接替意见号 */
  supersededBy?: string
  /** 重算意见：由哪条解编记录触发 */
  reRecordId?: string
  /** 重算意见：接替的失效意见 */
  replaces?: string
}

export type ShuntingStatus =
  | '生效'
  | '排队'
  | '冲突'
  | '写入失败'
  | '恢复生效'
  | '恢复排队'

/** 解编提交方案（两名调度同时提交时，方案整体参与先到比较） */
export interface ShuntingDraft {
  routeId: string
  yardId: string
  detachedWagonIds: string[]
  dispatcher: string
  /** 演练开关：模拟后端写入失败，验证按请求号恢复 */
  simulateFailure: boolean
}

export interface ShuntingRecord extends ShuntingDraft {
  /** 请求号：写入失败后按此号恢复 */
  requestId: string
  trainCode: string
  yardName: string
  detachedCount: number
  remainingCount: number
  remainingWagonIds: string[]
  /** 解下罐车决定的余车风险分 */
  remainingScore: number
  status: ShuntingStatus
  /** 排队位置：>0 表示在队列中（后到单可见的等待位置） */
  queuePosition: number
  capacity: number
  capacitySource: CapacitySource
  /** 解编时站场占用 / 可用容量快照 */
  occupiedCapacity: number
  availableCapacity: number
  /** 受影响运行区段（会签立即失效重算） */
  affectedSegmentIds: string[]
  /** 失效的会签意见号 */
  invalidatedCommentIds: string[]
  /** 重算产生的新会签意见号 */
  recomputedCommentIds: string[]
  /** 解编前许可快照：写入失败后仍可查 */
  permitBefore: string
  permissionBefore: RoutePackage['permission']
  createdAt: string
  attempts: number
  /** 冲突时留痕的先到请求号 */
  conflictWith?: string
  note?: string
}
