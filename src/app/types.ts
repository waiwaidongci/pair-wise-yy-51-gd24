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

export interface TankCar {
  id: string
  orderId: string
  cargo: string
  hazardClass: string
  tonnage: number
  risk: RiskLevel
}

export interface Yard {
  id: string
  name: string
  segmentId: string
  capacity: number
  capacityVerified: boolean
  capacitySource: '核定' | '默认'
}

export type UncouplingStatus = '写入中' | '生效' | '排队中' | '已冲突' | '待恢复' | '已恢复' | '已完成'

export interface UncouplingPlan {
  requestNo: string
  orderId: string
  yardId: string
  segmentId: string
  uncoupledWagonIds: string[]
  dispatcher: string
  simulateFailure?: boolean
}

export interface UncouplingRecord {
  id: string
  requestNo: string
  orderId: string
  trainCode: string
  yardId: string
  yardName: string
  segmentId: string
  segmentName: string
  uncoupledWagonIds: string[]
  remainingWagonIds: string[]
  uncoupledCount: number
  remainingCount: number
  queuePosition: number
  status: UncouplingStatus
  basedOnRequestNo?: string
  affectedSegmentIds: string[]
  affectedCommentIds: string[]
  remainingRisk: RiskLevel
  remainingScore: number
  permitSnapshot: string
  permissionSnapshot: string
  dispatcher: string
  submittedAt: string
  recoveredAt?: string
  completedAt?: string
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
  wagons?: TankCar[]
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回' | '已失效'
  invalidatedBy?: string
}
