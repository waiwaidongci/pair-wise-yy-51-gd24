import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatInputModule } from '@angular/material/input'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatTableModule } from '@angular/material/table'
import { MatDividerModule } from '@angular/material/divider'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { ACTIVE_STATUSES, ensureWagons } from '../store/uncoupling.logic'
import type { RoutePackage, TankCar, UncouplingRecord, Yard } from '../types'

@Component({
  selector: 'app-uncoupling',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatCheckboxModule, MatTableModule, MatDividerModule, MatProgressBarModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">中间站场临时限编</p><h1>解编记录与站场容量</h1><p>运输单、运行区段、站场容量与会签意见接成解编记录；容量不足则待解编车排队，后到单可见等待位置。</p></div>
        <div class="head-actions">
          <button mat-stroked-button (click)="refresh()">重新读取</button>
          <button mat-stroked-button color="warn" (click)="submitSimultaneous()">模拟两名调度同时提交</button>
          <button mat-flat-button color="primary" (click)="submit()">提交解编方案</button>
        </div>
      </div>

      @if (state?.loading) { <mat-progress-bar mode="indeterminate" /> }

      <div class="grid-4">
        <article class="card metric"><span>在册站场</span><strong>{{ state?.yards?.length || 0 }}</strong><small>容量按核定/默认</small></article>
        <article class="card metric"><span>待解编车（排队）</span><strong class="risk-mid">{{ queuedCount }}</strong><small>后到单见等待位置</small></article>
        <article class="card metric"><span>已生效方案</span><strong class="risk-low">{{ activeCount }}</strong><small>余车继续走</small></article>
        <article class="card metric"><span>冲突 / 待恢复</span><strong class="risk-high">{{ conflictCount }}</strong><small>先到生效，后到留冲突</small></article>
      </div>

      <div class="grid-2">
        <section class="card">
          <h2>新建解编方案</h2>
          <div class="form-grid">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>运输单</mat-label>
              <mat-select [ngModel]="orderId" (ngModelChange)="onOrderChange($event)">
                @for (order of state?.routes || []; track order.id) { <mat-option [value]="order.id">{{ order.id }} · {{ order.trainCode }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>解编站场</mat-label>
              <mat-select [ngModel]="yardId" (ngModelChange)="yardId = $event">
                @for (yard of applicableYards; track yard.id) { <mat-option [value]="yard.id">{{ yard.name }}（{{ yard.id }}）</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>受影响运行区段</mat-label>
              <input matInput [value]="selectedYard ? selectedYard.segmentId + ' · ' + segmentName : ''" readonly />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>调度员</mat-label>
              <input matInput [(ngModel)]="dispatcher" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>请求号</mat-label>
              <input matInput [(ngModel)]="requestNo" />
            </mat-form-field>
            <div class="sim-fail"><mat-checkbox [(ngModel)]="simulateFailure">模拟写入失败（按请求号恢复）</mat-checkbox></div>
          </div>

          <div class="wagon-head">
            <h3>选择解下罐车</h3>
            <span class="spacer"></span>
            <button mat-button (click)="selectHighRisk()">全选高风险</button>
            <button mat-button (click)="clearWagons()">清空</button>
            <button mat-button (click)="invertWagons()">反选</button>
          </div>
          <div class="wagon-list">
            @for (wagon of wagons; track wagon.id) {
              <label class="wagon" [class.checked]="selectedWagonIds.has(wagon.id)">
                <mat-checkbox [checked]="selectedWagonIds.has(wagon.id)" (change)="toggleWagon(wagon.id)" />
                <b>{{ wagon.id }}</b><small>{{ wagon.cargo }}</small>
                <span class="risk-badge" [class.risk-high]="wagon.risk==='高'" [class.risk-mid]="wagon.risk==='中'" [class.risk-low]="wagon.risk==='低'">{{ wagon.risk }}</span>
              </label>
            }
          </div>
          <p class="hint">已选 {{ selectedWagonIds.size }} 辆；解下高风险罐车可降低余车风险，受影响区段会签立即失效重算。</p>
        </section>

        <section class="card">
          <h2>站场容量与等待队列</h2>
          @for (yard of state?.yards || []; track yard.id) {
            <div class="yard">
              <div class="yard-head">
                <b>{{ yard.name }}</b>
                <span class="spacer"></span>
                <span class="cap-tag" [class.default]="!yard.capacityVerified">{{ yard.capacitySource === '默认' ? '默认' : '核定' }} {{ yard.capacity }} 辆</span>
                @if (!yard.capacityVerified) { <span class="verify-tag">待核验</span> }
              </div>
              <div class="cap-bar"><i [style.width.%]="capacityPct(yard)"></i></div>
              <small class="cap-meta">已占用 {{ occupied(yard) }} · 可用 {{ available(yard) }} · 排队 {{ queued(yard).length }} 单</small>
              @if (queued(yard).length) {
                <div class="queue">
                  @for (rec of queued(yard); track rec.requestNo) {
                    <div class="queue-item"><span class="pos">等待位置 {{ rec.queuePosition }}</span><b>{{ rec.dispatcher }}</b><small>{{ rec.requestNo }} · {{ rec.uncoupledCount }} 辆</small></div>
                  }
                </div>
              }
            </div>
          }
        </section>
      </div>

      <section class="card records">
        <h2>解编记录</h2>
        <table mat-table [dataSource]="state?.uncouplingRecords || []">
          <ng-container matColumnDef="requestNo"><th mat-header-cell *matHeaderCellDef>请求号</th><td mat-cell *matCellDef="let r"><b>{{ r.requestNo }}</b><small class="block">{{ r.submittedAt }} · {{ r.dispatcher }}</small></td></ng-container>
          <ng-container matColumnDef="order"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let r">{{ r.orderId }}<small class="block">{{ r.trainCode }}</small></td></ng-container>
          <ng-container matColumnDef="yard"><th mat-header-cell *matHeaderCellDef>站场 / 区段</th><td mat-cell *matCellDef="let r">{{ r.yardName }}<small class="block">{{ r.segmentId }} · {{ r.segmentName }}</small></td></ng-container>
          <ng-container matColumnDef="counts"><th mat-header-cell *matHeaderCellDef>解下 / 余车</th><td mat-cell *matCellDef="let r"><b>{{ r.uncoupledCount }}</b> / {{ r.remainingCount }}</td></ng-container>
          <ng-container matColumnDef="queue"><th mat-header-cell *matHeaderCellDef>等待位置</th><td mat-cell *matCellDef="let r">{{ r.queuePosition > 0 ? ('#' + r.queuePosition) : '—' }}</td></ng-container>
          <ng-container matColumnDef="risk"><th mat-header-cell *matHeaderCellDef>余车风险</th><td mat-cell *matCellDef="let r"><span class="risk-badge" [class.risk-high]="r.remainingRisk==='高'" [class.risk-mid]="r.remainingRisk==='中'" [class.risk-low]="r.remainingRisk==='低'">{{ r.remainingRisk }}</span><small class="block">{{ r.remainingScore }} 分</small></td></ng-container>
          <ng-container matColumnDef="comments"><th mat-header-cell *matHeaderCellDef>会签影响</th><td mat-cell *matCellDef="let r">{{ r.affectedCommentIds.length ? (r.affectedCommentIds.length + ' 条失效重算') : '原依据保留' }}<small class="block" *ngIf="r.basedOnRequestNo">先到方案 {{ r.basedOnRequestNo }}</small></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let r"><span class="status" [class]="statusClass(r.status)">{{ r.status }}</span></td></ng-container>
          <ng-container matColumnDef="permit"><th mat-header-cell *matHeaderCellDef>解编前许可</th><td mat-cell *matCellDef="let r"><button mat-button (click)="queryPermit(r.requestNo)">查询</button>
            @if (queriedRequestNo === r.requestNo) { <div class="permit"><b>{{ r.permitSnapshot }}</b><small>解编前许可（{{ r.permissionSnapshot }}）· 未受解编影响，仍可查</small></div> }</td></ng-container>
          <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let r">
            @if (r.status === '待恢复') { <button mat-stroked-button color="primary" (click)="recover(r.requestNo)">按请求号恢复</button> }
            @if (r.status === '生效' || r.status === '已恢复') { <button mat-stroked-button (click)="complete(r.requestNo)">完成并释放容量</button> }
          </td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </section>

      <section class="card comments">
        <h2>会签意见联动</h2>
        @for (comment of state?.comments || []; track comment.id) {
          <div class="comment" [class.invalidated]="comment.status === '已失效'">
            <div class="comment-head"><b>{{ comment.role }} · {{ comment.author }}</b><small>{{ comment.segmentId }} · {{ comment.id }}</small><span class="status" [class]="comment.status === '已失效' ? 'risk-high' : 'risk-low'">{{ comment.status }}</span></div>
            <p>{{ comment.content }}</p>
            @if (comment.status === '已失效') { <small class="invalid-note">受解编影响立即失效重算 @if (comment.invalidatedBy) { · 请求号 {{ comment.invalidatedBy }} }</small> }
            @else { <small class="keep-note">照原依据保留</small> }
          </div>
        }
      </section>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.head-actions{display:flex;gap:8px;flex-wrap:wrap}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.form-grid .sim-fail{display:flex;align-items:center}
    .wagon-head{display:flex;align-items:center;gap:8px;margin:16px 0 8px}.wagon-head h3{margin:0}.wagon-head button{min-width:auto}
    .wagon-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;max-height:240px;overflow:auto;padding:4px}
    .wagon{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e1e7ef;border-radius:6px;cursor:pointer}.wagon.checked{border-color:#2563eb;background:#f5f8ff}
    .wagon b{font-size:13px}.wagon small{color:#7a8798;font-size:12px}.wagon .risk-badge{margin-left:auto}
    .hint{color:#7a8798;font-size:12px;margin:10px 0 0}
    .yard{padding:12px 0;border-bottom:1px solid #edf0f5}.yard-head{display:flex;align-items:center;gap:8px}.yard-head b{font-size:14px}
    .cap-tag{font-size:12px;color:#475569}.cap-tag.default{color:#d97706}.verify-tag{font-size:11px;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px}
    .cap-bar{height:8px;background:#eef2f6;border-radius:4px;overflow:hidden;margin:8px 0 4px}.cap-bar i{display:block;height:100%;background:#2563eb}
    .cap-meta{color:#7a8798;font-size:12px}.queue{margin-top:8px}.queue-item{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fff7ed;border-left:3px solid #d97706;border-radius:4px;margin-bottom:4px}.queue-item .pos{font-size:12px;color:#92400e;font-weight:700}.queue-item b{font-size:13px}.queue-item small{color:#7a8798;font-size:11px}
    .records{margin-top:16px}.records table{width:100%}.block{display:block;color:#7a8798;margin-top:3px}
    .status{font-size:12px;padding:2px 8px;border-radius:10px;background:#eef2f6;color:#475569}.status.risk-low{background:#dcfce7;color:#15803d}.status.risk-mid{background:#fef3c7;color:#92400e}.status.risk-high{background:#fee2e2;color:#b91c1c}
    .risk-badge{font-size:12px;padding:1px 8px;border-radius:10px;background:#eef2f6;color:#475569}.risk-badge.risk-low{background:#dcfce7;color:#15803d}.risk-badge.risk-mid{background:#fef3c7;color:#92400e}.risk-badge.risk-high{background:#fee2e2;color:#b91c1c}
    .permit{margin-top:6px;padding:6px 8px;background:#f8fafc;border-left:3px solid #2563eb;border-radius:4px}.permit small{display:block;color:#7a8798;margin-top:2px}
    .comments{margin-top:16px}.comment{padding:14px;border-bottom:1px solid #e7ebf1}.comment.invalidated{background:#fef2f2}
    .comment-head{display:flex;justify-content:space-between;align-items:center}.comment-head small{display:block;color:#7a8798;margin-top:4px}.comment p{color:#475569;margin:8px 0}
    .invalid-note{color:#b91c1c;font-size:12px}.keep-note{color:#15803d;font-size:12px}
    @media(max-width:620px){.form-grid{grid-template-columns:1fr}}
  `],
})
export class UncouplingComponent {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  state: RouteState | null = null

  orderId = ''
  yardId = ''
  dispatcher = '调度员·当前'
  requestNo = ''
  simulateFailure = false
  selectedWagonIds = new Set<string>()
  queriedRequestNo = ''
  readonly columns = ['requestNo', 'order', 'yard', 'counts', 'queue', 'risk', 'comments', 'status', 'permit', 'actions']

  constructor() {
    this.state$.subscribe((s) => {
      this.state = s
      if (!this.orderId && s.routes.length) {
        this.orderId = s.routes[0].id
        this.yardId = this.applicableYards[0]?.id ?? ''
        this.resetWagons()
        this.requestNo = this.genRequestNo()
      }
    })
  }

  get selectedOrder(): RoutePackage | undefined { return this.state?.routes.find((o) => o.id === this.orderId) }
  get selectedYard(): Yard | undefined { return this.state?.yards.find((y) => y.id === this.yardId) }
  get applicableYards(): Yard[] {
    const order = this.selectedOrder
    if (!order) return []
    const segIds = new Set(order.segments.map((s) => s.id))
    return (this.state?.yards || []).filter((y) => segIds.has(y.segmentId))
  }
  get wagons(): TankCar[] { return this.selectedOrder ? ensureWagons(this.selectedOrder) : [] }
  get segmentName(): string { return this.selectedOrder?.segments.find((s) => s.id === this.selectedYard?.segmentId)?.name ?? '' }

  get queuedCount(): number { return (this.state?.uncouplingRecords || []).filter((r) => r.status === '排队中').length }
  get activeCount(): number { return (this.state?.uncouplingRecords || []).filter((r) => ACTIVE_STATUSES.includes(r.status)).length }
  get conflictCount(): number { return (this.state?.uncouplingRecords || []).filter((r) => r.status === '已冲突' || r.status === '待恢复').length }

  onOrderChange(id: string) {
    this.orderId = id
    this.yardId = this.applicableYards[0]?.id ?? ''
    this.resetWagons()
  }
  resetWagons() {
    this.selectedWagonIds = new Set(this.wagons.filter((w) => w.risk === '高').map((w) => w.id))
  }
  selectHighRisk() { this.selectedWagonIds = new Set(this.wagons.filter((w) => w.risk === '高').map((w) => w.id)) }
  clearWagons() { this.selectedWagonIds = new Set() }
  invertWagons() {
    const next = new Set<string>()
    for (const w of this.wagons) if (!this.selectedWagonIds.has(w.id)) next.add(w.id)
    this.selectedWagonIds = next
  }
  toggleWagon(id: string) {
    const next = new Set(this.selectedWagonIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    this.selectedWagonIds = next
  }

  occupied(yard: Yard): number {
    return (this.state?.uncouplingRecords || []).filter((r) => r.yardId === yard.id && ACTIVE_STATUSES.includes(r.status)).reduce((s, r) => s + r.uncoupledCount, 0)
  }
  queued(yard: Yard): UncouplingRecord[] {
    return (this.state?.uncouplingRecords || []).filter((r) => r.yardId === yard.id && r.status === '排队中').sort((a, b) => a.queuePosition - b.queuePosition)
  }
  available(yard: Yard): number { return yard.capacity - this.occupied(yard) }
  capacityPct(yard: Yard): number { return Math.min(100, Math.round((this.occupied(yard) / yard.capacity) * 100)) }

  statusClass(status: string): string {
    if (status === '生效' || status === '已恢复' || status === '已完成') return 'risk-low'
    if (status === '排队中' || status === '待恢复') return 'risk-mid'
    if (status === '已冲突') return 'risk-high'
    return ''
  }

  private genRequestNo(): string { return `Q-${Date.now().toString().slice(-6)}` }

  private buildPlan(requestNo: string, dispatcher: string, simulateFailure: boolean) {
    return {
      requestNo,
      orderId: this.orderId,
      yardId: this.yardId,
      segmentId: this.selectedYard?.segmentId ?? '',
      uncoupledWagonIds: Array.from(this.selectedWagonIds),
      dispatcher,
      simulateFailure,
    }
  }

  submit() {
    if (!this.orderId || !this.yardId || this.selectedWagonIds.size === 0) return
    this.store.dispatch(RouteActions.submitUncoupling({ plan: this.buildPlan(this.requestNo, this.dispatcher, this.simulateFailure) }))
    this.requestNo = this.genRequestNo()
  }

  submitSimultaneous() {
    if (!this.orderId || !this.yardId || this.selectedWagonIds.size === 0) return
    const base = this.genRequestNo()
    this.store.dispatch(RouteActions.submitUncoupling({ plan: this.buildPlan(`${base}-A`, '调度员·甲', false) }))
    this.store.dispatch(RouteActions.submitUncoupling({ plan: this.buildPlan(`${base}-B`, '调度员·乙', false) }))
  }

  recover(requestNo: string) { this.store.dispatch(RouteActions.recoverUncoupling({ requestNo })) }
  complete(requestNo: string) { this.store.dispatch(RouteActions.completeUncoupling({ requestNo })) }
  queryPermit(requestNo: string) { this.queriedRequestNo = this.queriedRequestNo === requestNo ? '' : requestNo }
  refresh() { this.store.dispatch(RouteActions.loadUncouplingData()) }
}
