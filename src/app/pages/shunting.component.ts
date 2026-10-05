import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import { ShuntingLogicService } from '../services/shunting-logic.service'
import type { RoutePackage, TankWagon, Yard } from '../types'

@Component({
  selector: 'app-shunting',
  standalone: true,
  imports: [CommonModule, FormsModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule, MatProgressBarModule],
  template: `
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">中间站场临时限编</p><h1>解编记录</h1><p>运输单只解下部分罐车、余车继续走；容量不足排队，解下罐车决定余车风险，受影响区段会签立即失效重算。</p></div>
        <button mat-stroked-button (click)="refresh()">重新加载运输单与站场</button>
      </div>

      @if (snapshot.shuntingError) {
        <div class="card error-banner">写入告警：{{snapshot.shuntingError}} —— 方案与解编前许可已暂存，可在下方记录中按请求号恢复。</div>
      }
      @if (snapshot.pendingRequestId) { <mat-progress-bar mode="indeterminate" /> }

      <div class="grid-4">
        <article class="card metric"><span>限编站场</span><strong>{{snapshot.yards.length}}</strong><small>{{defaultYardCount}} 个容量为默认值待核验</small></article>
        <article class="card metric"><span>排队待解编</span><strong class="risk-mid">{{waitingCount}}</strong><small>后到单可查看等待位置</small></article>
        <article class="card metric"><span>生效解编</span><strong class="risk-low">{{effectiveCount}}</strong><small>余车风险已重算</small></article>
        <article class="card metric"><span>冲突 / 待恢复</span><strong class="risk-high">{{conflictCount}} / {{failedCount}}</strong><small>先到方案生效，失败按请求号恢复</small></article>
      </div>

      <div class="grid-2 wide-left">
        <section class="card">
          <h2>提交解编方案</h2>
          <div class="two">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>运输单</mat-label>
              <mat-select [(ngModel)]="routeId" (ngModelChange)="onRouteChange()">
                @for (route of snapshot.routes; track route.id) {
                  <mat-option [value]="route.id">{{route.id}} · {{route.trainCode}}（{{route.wagonCount}} 辆 / 风险 {{route.score}}）</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>中间站场</mat-label>
              <mat-select [(ngModel)]="yardId">
                @for (yard of eligibleYards; track yard.id) {
                  <mat-option [value]="yard.id">{{yard.name}} · 容 {{yard.capacity}} 辆{{yard.capacitySource === '默认值待核验' ? '（默认待核验）' : ''}}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          @if (selectedYard) {
            <div class="cap-box">
              <div><span>站场容量</span><b>{{selectedYard.capacity}} 辆</b><small [class.warn]="selectedYard.capacitySource === '默认值待核验'">{{selectedYard.capacitySource}}</small></div>
              <div><span>已占用</span><b>{{occupiedOf(selectedYard)}} 辆</b><small>生效/排队解下罐车合计</small></div>
              <div><span>可用</span><b [class.risk-high]="availableOf(selectedYard) === 0">{{availableOf(selectedYard)}} 辆</b><small>解下数超出即排队</small></div>
              <div><span>同站等待</span><b class="risk-mid">{{waitingAheadOf(selectedYard)}} 单</b><small>本单将排第 {{waitingAheadOf(selectedYard) + 1}} 位</small></div>
            </div>
          }

          <h3>勾选解下的罐车（其余为继续走的余车）</h3>
          <div class="wagon-tools">
            <button mat-button color="primary" (click)="selectWagons('high')">仅高风险罐车</button>
            <button mat-button color="primary" (click)="selectWagons('first8')">前 8 辆</button>
            <button mat-button (click)="clearDetached()">清空</button>
          </div>
          <div class="wagon-grid">
            @for (wagon of availableWagons; track wagon.id) {
              <button type="button" class="wagon" [class.on]="detached.has(wagon.id)" [class.high]="wagon.level==='高'" [class.mid]="wagon.level==='中'" (click)="toggleWagon(wagon.id)">
                <b>{{wagon.id}}</b><small>{{wagon.level}}风险 · {{wagon.tonnage}}t</small>
              </button>
            }
          </div>

          <div class="two" style="margin-top:12px">
            <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>调度员</mat-label><input matInput [(ngModel)]="dispatcher" placeholder="如：张调度" /></mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>写入演练</mat-label>
              <mat-select [(ngModel)]="simulateFailure"><mat-option [value]="false">正常写入</mat-option><mat-option [value]="true">模拟后端写入失败（可恢复）</mat-option></mat-select>
            </mat-form-field>
          </div>

          <div class="preview">
            <div><span>解下</span><b>{{detached.size}} 辆</b></div>
            <div><span>余车继续走</span><b>{{availableWagons.length - detached.size}} 辆</b></div>
            <div><span>解编后余车风险</span><b [class.risk-high]="previewRemainingScore >= 70" [class.risk-mid]="previewRemainingScore >= 45 && previewRemainingScore < 70" [class.risk-low]="previewRemainingScore < 45">{{previewRemainingScore}} 分</b><small>原 {{route?.score ?? '-'}} 分</small></div>
            <div><span>预计结论</span><b [class.risk-high]="previewStatus === '排队'" [class.risk-mid]="previewStatus === '冲突'">{{previewStatus}}</b></div>
          </div>

          <div class="submit-row">
            <button mat-flat-button color="primary" [disabled]="detached.size === 0 || !yardId || snapshot.pendingRequestId" (click)="submit(false)">提交解编</button>
            <button mat-stroked-button [disabled]="detached.size === 0 || !yardId || snapshot.pendingRequestId" (click)="submit(true)">两名调度同时提交（演练并发）</button>
          </div>
        </section>

        <aside>
          <section class="card">
            <h2>站场容量</h2>
            @for (yard of snapshot.yards; track yard.id) {
              <div class="yard-line" [class.active]="yard.id === yardId">
                <div><b>{{yard.name}}</b><small>{{yard.segmentIds.join(' / ')}}</small></div>
                <div class="yard-num"><strong>{{occupiedOf(yard)}}/{{yard.capacity}}</strong><small [class.warn]="yard.capacitySource === '默认值待核验'">{{yard.capacitySource === '默认值待核验' ? '默认待核验' : '台账'}}</small></div>
              </div>
            }
          </section>

          <section class="card" style="margin-top:14px">
            <h2>会签联动（当前运输单）</h2>
            @if (affectedPreviewIds.length) {
              <p class="hint">本次解编受影响区段：<b>{{affectedPreviewIds.join('、')}}</b>，区段内会签将立即失效并按余车风险重算，其余照原依据保留。</p>
            }
            @for (comment of linkedComments; track comment.id) {
              <div class="comment" [class.invalid]="comment.status === '已失效'">
                <div class="ch"><b>{{comment.role}} · {{comment.author}}</b><span class="tag" [class.risk-high]="comment.status==='已失效'">{{comment.status}}</span></div>
                <small>{{comment.segmentId}} · {{comment.id}}@if (comment.supersededBy) { → {{comment.supersededBy}} }</small>
                <p>{{comment.content}}</p>
                @if (comment.basis) { <small class="basis">依据：{{comment.basis}}</small> }
              </div>
            } @empty { <p class="hint">选择站场后显示区段会签联动。</p> }
          </section>
        </aside>
      </div>

      <section class="card" style="margin-top:16px">
        <h2>解编记录</h2>
        <div class="table-wrap">
          <table mat-table [dataSource]="snapshot.records">
            <ng-container matColumnDef="requestId"><th mat-header-cell *matHeaderCellDef>请求号</th><td mat-cell *matCellDef="let row"><b>{{row.requestId}}</b><small class="block">{{row.createdAt}} · {{row.dispatcher}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>运输单 / 余车</th><td mat-cell *matCellDef="let row">{{row.trainCode}} · {{row.routeId.slice(0,12)}}<small class="block">解下 {{row.detachedCount}} / 余车 {{row.remainingCount}}</small></td></ng-container>
            <ng-container matColumnDef="yard"><th mat-header-cell *matHeaderCellDef>站场 / 容量</th><td mat-cell *matCellDef="let row">{{row.yardName}}<small class="block">{{row.occupiedCapacity}}/{{row.capacity}} 占用{{row.capacitySource === '默认值待核验' ? ' · 默认待核验' : ''}}</small></td></ng-container>
            <ng-container matColumnDef="queue"><th mat-header-cell *matHeaderCellDef>等待位置</th><td mat-cell *matCellDef="let row">@if (row.queuePosition > 0) { <b class="risk-mid">第 {{row.queuePosition}} 位</b> } @else { — }</td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>余车风险</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.remainingScore>=70" [class.risk-mid]="row.remainingScore>=45 && row.remainingScore<70">{{row.remainingScore}}</b></td></ng-container>
            <ng-container matColumnDef="permit"><th mat-header-cell *matHeaderCellDef>解编前许可</th><td mat-cell *matCellDef="let row"><small>{{row.permitBefore}}（{{row.permissionBefore}}）</small></td></ng-container>
            <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row"><span class="status" [class.s-ok]="row.status==='生效'||row.status==='恢复生效'" [class.s-wait]="row.status==='排队'||row.status==='恢复排队'" [class.s-bad]="row.status==='冲突'||row.status==='写入失败'">{{row.status}}</span>@if (row.conflictWith) { <small class="block">先到：{{row.conflictWith}}</small> }<small class="block">第 {{row.attempts}} 次写入</small></td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row">@if (row.status === '写入失败') { <button mat-flat-button color="primary" (click)="recover(row.requestId)">按请求号恢复</button> }</td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
          @if (!snapshot.records.length) { <p class="hint" style="padding:18px">暂无解编记录。选择运输单、站场与解下罐车后提交。</p> }
        </div>
      </section>
    </main>
  `,
  styles: [`
    h2{margin:0 0 12px;font-size:17px}h3{margin:14px 0 8px;font-size:14px}
    .wide-left{grid-template-columns:minmax(0,1.5fr) minmax(320px,.8fr)}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}.two mat-form-field{width:100%}
    .error-banner{margin-bottom:14px;border-left:4px solid #dc2626;color:#b91c1c;background:#fef2f2}
    .cap-box{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:6px 0 4px}
    .cap-box>div{background:#f8fafc;border:1px solid #e7ebf1;border-radius:7px;padding:10px}
    .cap-box span,.cap-box small{display:block;color:#7a8798;font-size:11px}.cap-box b{font-size:18px}.cap-box .warn,.warn{color:#d97706}
    .wagon-tools{display:flex;gap:6px}
    .wagon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px;max-height:240px;overflow:auto;padding:4px}
    .wagon{text-align:left;border:1px solid #dbe2ea;border-radius:6px;padding:8px;background:#fff;cursor:pointer;color:inherit}
    .wagon b,.wagon small{display:block}.wagon small{color:#7a8798;font-size:11px}
    .wagon.on{border-color:#2563eb;background:#eff6ff;box-shadow:inset 0 0 0 1px #2563eb}
    .wagon.high b{color:#dc2626}.wagon.mid b{color:#d97706}.wagon.high.on b,.wagon.mid.on b{color:inherit}
    .preview{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:7px;padding:12px;margin-top:10px}
    .preview span,.preview small{display:block;color:#7a8798;font-size:11px}.preview b{font-size:19px}
    .submit-row{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
    .yard-line{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}
    .yard-line.active{padding-left:10px;border-left:3px solid #2563eb}.yard-line small{display:block;color:#7a8798;margin-top:3px}
    .yard-num{text-align:right}.yard-num small{display:block;margin-top:2px}
    .hint{color:#667085;font-size:13px;line-height:1.6;margin:0 0 8px}
    .comment.invalid{opacity:.72;border-left-color:#dc2626;background:#fef2f2}.ch{display:flex;justify-content:space-between}.ch .tag{font-size:12px}.basis{color:#94a3b8}.block{display:block;color:#7a8798}
    .table-wrap{overflow:auto}.status{font-weight:700;font-size:12px}.s-ok{color:#15803d}.s-wait{color:#d97706}.s-bad{color:#dc2626}
    @media(max-width:900px){.two{grid-template-columns:1fr}.cap-box,.preview{grid-template-columns:1fr 1fr}}
  `],
})
export class ShuntingComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  private readonly logic = inject(ShuntingLogicService)

  snapshot: RouteState = {
    routes: [], selectedRouteId: '', selectedSegmentId: '', comments: [], yards: [], records: [],
    pendingRequestId: '', shuntingError: '', loading: false, error: '', version: 0,
  }
  routeId = ''
  yardId = ''
  dispatcher = '当班调度'
  simulateFailure = false
  detached = new Set<string>()
  readonly columns = ['requestId', 'route', 'yard', 'queue', 'score', 'permit', 'status', 'action']

  constructor() {
    this.store.select('routes').subscribe((state: RouteState) => {
      this.snapshot = state
      if (!this.routeId || !state.routes.some((route) => route.id === this.routeId)) {
        this.routeId = state.selectedRouteId || state.routes[0]?.id || ''
        this.onRouteChange()
      }
      // 生效后解下的罐车已离开余车，清掉无效勾选
      this.detached = new Set([...this.detached].filter((id) => this.availableWagons.some((wagon) => wagon.id === id)))
    })
  }

  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }

  get route(): RoutePackage | undefined { return this.snapshot.routes.find((item) => item.id === this.routeId) }

  get eligibleYards(): Yard[] {
    const route = this.route
    return route ? this.snapshot.yards.filter((yard) => this.logic.yardEligible(yard, route)) : []
  }

  get selectedYard(): Yard | undefined { return this.snapshot.yards.find((yard) => yard.id === this.yardId) }

  /** 仅当前仍随车的罐车可被再次解下（余车继续走） */
  get availableWagons(): TankWagon[] {
    const route = this.route
    if (!route || !route.wagons) return []
    const wagons = route.wagons
    const remaining = new Set(route.remainingWagonIds ?? wagons.map((wagon) => wagon.id))
    return wagons.filter((wagon) => remaining.has(wagon.id))
  }

  get previewRemainingScore(): number {
    const route = this.route
    if (!route) return 0
    const remainingIds = this.availableWagons.map((wagon) => wagon.id).filter((id) => !this.detached.has(id))
    return this.logic.remainingScore(route, remainingIds)
  }

  get previewStatus(): string {
    const yard = this.selectedYard
    if (!yard) return '待选择'
    if (this.detached.size === 0) return '待选罐车'
    return this.detached.size > this.availableOf(yard) ? '排队' : '生效'
  }

  get affectedPreviewIds(): string[] {
    const route = this.route
    const yard = this.selectedYard
    return route && yard ? this.logic.affectedSegmentIds(yard, route) : []
  }

  get linkedComments() {
    const ids = new Set(this.affectedPreviewIds)
    return this.snapshot.comments.filter((comment) => ids.has(comment.segmentId))
  }

  get defaultYardCount() { return this.snapshot.yards.filter((yard) => yard.capacitySource === '默认值待核验').length }
  get waitingCount() { return this.snapshot.records.filter((record) => record.queuePosition > 0).length }
  get effectiveCount() { return this.snapshot.records.filter((record) => record.status === '生效' || record.status === '恢复生效').length }
  get conflictCount() { return this.snapshot.records.filter((record) => record.status === '冲突').length }
  get failedCount() { return this.snapshot.records.filter((record) => record.status === '写入失败').length }

  occupiedOf(yard: Yard) { return this.logic.occupiedCapacity(yard.id, this.snapshot.records) }
  waitingAheadOf(yard: Yard) { return this.logic.waitingAhead(yard.id, this.snapshot.records) }
  availableOf(yard: Yard) { return Math.max(0, yard.capacity - this.occupiedOf(yard)) }

  onRouteChange() {
    this.yardId = this.eligibleYards[0]?.id ?? ''
    this.detached = new Set()
  }

  toggleWagon(id: string) {
    const next = new Set(this.detached)
    next.has(id) ? next.delete(id) : next.add(id)
    this.detached = next
  }

  clearDetached() { this.detached = new Set() }

  selectWagons(mode: 'high' | 'first8') {
    const list = this.availableWagons
    this.detached = new Set(
      mode === 'high' ? list.filter((wagon) => wagon.level === '高').map((wagon) => wagon.id) : list.slice(0, 8).map((wagon) => wagon.id),
    )
  }

  private nextRequestId() {
    const time = Date.now().toString(36).toUpperCase().slice(-5)
    return `REQ-${time}-${Math.floor(Math.random() * 900 + 100)}`
  }

  submit(concurrent: boolean) {
    if (!this.routeId || !this.yardId || this.detached.size === 0) return
    const buildDraft = (dispatcher: string, simulateFailure: boolean) => ({
      routeId: this.routeId,
      yardId: this.yardId,
      detachedWagonIds: [...this.detached],
      dispatcher,
      simulateFailure,
    })
    if (concurrent) {
      // 同一 tick 派发两份提交：reducer 串行建单，先到生效、后到留冲突
      const id1 = this.nextRequestId()
      const id2 = this.nextRequestId()
      this.store.dispatch(RouteActions.submitShunting({ draft: buildDraft('调度甲', false), requestId: id1 }))
      this.store.dispatch(RouteActions.submitShunting({ draft: buildDraft('调度乙', false), requestId: id2 }))
      return
    }
    this.store.dispatch(RouteActions.submitShunting({ draft: buildDraft(this.dispatcher, this.simulateFailure), requestId: this.nextRequestId() }))
  }

  recover(requestId: string) { this.store.dispatch(RouteActions.recoverShunting({ requestId })) }
}
