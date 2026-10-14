import './style.css';
import { type Settings, isMobile } from '../config/settings';
import { ballColor } from '../rendering/textures';
import type { RuleState } from '../game-rules/RuleSet';
import { AI_LEVEL_NAMES } from '../ai/ai';

export interface UIHandlers {
  startPractice(): void;
  startLocal(p1: string, p2: string): void;
  startAI(level: 0 | 1 | 2, name: string): void;
  hostOnline(name: string): Promise<string>;
  joinOnline(code: string, name: string): Promise<void>;
  cancelOnline(): void;
  openLab(): void;
  runScene(key: string): void;
  resume(): void;
  quitToMenu(): void;
  rematch(): void;
  replay(): void;
  toggleTop(): void;
  settingsChanged(): void;
  placeConfirm(): void;
  setHit(a: number, b: number): void;
  elevDelta(deg: number): void;
  gauge(phase: 'down' | 'move' | 'up', v: number): void;
  togglePracticeEdit(): void;
  rerack(): void;
  toggleDebug(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

export class UI {
  root: HTMLElement;
  private hud!: HTMLElement; private status!: HTMLElement; private toastBox!: HTMLElement;
  private hit!: HTMLElement; private hitCanvas!: HTMLCanvasElement; private elevLabel!: HTMLElement;
  private gauge!: HTMLElement; private gMask!: HTMLElement; private gKnob!: HTMLElement; private gPct!: HTMLElement;
  private placeBar!: HTMLElement; private hint!: HTMLElement; private stats!: HTMLElement;
  private overlay: HTMLElement | null = null;
  private hitA = 0; private hitB = 0;
  private toolbar!: HTMLElement;
  private editBtn!: HTMLButtonElement;
  private mobile = isMobile();
  menuOpen = false;

  constructor(root: HTMLElement, public settings: Settings, private h: UIHandlers) {
    this.root = root;
    this.build();
  }

  // ------------------------------------------------------------------ 구성
  private build() {
    const r = this.root;
    this.hud = el('div'); this.hud.id = 'hud'; r.append(this.hud);
    this.status = el('div'); this.status.id = 'status'; r.append(this.status);
    this.toastBox = el('div'); this.toastBox.id = 'toast'; r.append(this.toastBox);
    this.hint = el('div'); this.hint.id = 'hint'; r.append(this.hint);
    this.stats = el('div'); this.stats.id = 'stats'; r.append(this.stats);

    this.toolbar = el('div'); this.toolbar.id = 'toolbar';
    const mk = (t: string, title: string, fn: () => void) => { const b = el('button', 'panel', t); b.title = title; b.onclick = fn; this.toolbar.append(b); return b; };
    mk('⏸', '일시정지 (Esc)', () => this.showPause());
    mk('⟲', '직전 샷 리플레이 (P)', () => this.h.replay());
    mk('🎥', '탑뷰 전환 (T)', () => this.h.toggleTop());
    mk('⚙', '설정', () => this.showSettings(false));
    this.editBtn = mk('✋', '연습: 공 자유 배치 (B)', () => this.h.togglePracticeEdit());
    const rk = mk('△', '다시 랙 (연습)', () => this.h.rerack());
    rk.id = 'rerackBtn';
    r.append(this.toolbar);

    // 타점 선택
    this.hit = el('div', 'panel'); this.hit.id = 'hit';
    this.hitCanvas = el('canvas'); this.hitCanvas.width = 208; this.hitCanvas.height = 208;
    const cap = el('div', 'cap', '타점 (클릭)');
    const elev = el('div', 'elev');
    const bm = el('button', '', '−'), bp = el('button', '', '+');
    this.elevLabel = el('span', '', '큐 각도 0°');
    bm.onclick = () => this.h.elevDelta(-3); bp.onclick = () => this.h.elevDelta(3);
    elev.append(bm, this.elevLabel, bp);
    this.hit.append(this.hitCanvas, cap, elev);
    r.append(this.hit);
    const setFromEvent = (e: PointerEvent) => {
      const rc = this.hitCanvas.getBoundingClientRect();
      let x = ((e.clientX - rc.left) / rc.width) * 2 - 1, y = -(((e.clientY - rc.top) / rc.height) * 2 - 1);
      const l = Math.hypot(x, y);
      if (l > 0.95) { x *= 0.95 / l; y *= 0.95 / l; }
      this.setHitPoint(x, y);
      this.h.setHit(x, y);
    };
    let dragging = false;
    this.hitCanvas.addEventListener('pointerdown', (e) => { dragging = true; this.hitCanvas.setPointerCapture(e.pointerId); setFromEvent(e); e.stopPropagation(); });
    this.hitCanvas.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
    this.hitCanvas.addEventListener('pointerup', () => { dragging = false; });
    this.hitCanvas.addEventListener('dblclick', () => { this.setHitPoint(0, 0); this.h.setHit(0, 0); });
    this.setHitPoint(0, 0);

    // 파워 게이지
    this.gauge = el('div', 'panel'); this.gauge.id = 'gauge';
    const track = el('div', 'track');
    this.gMask = el('div', 'mask'); this.gKnob = el('div', 'knob');
    track.append(this.gMask, this.gKnob);
    this.gPct = el('div', 'pct', '0%');
    this.gauge.append(el('div', 'cap', '파워'), track, this.gPct, el('div', 'cap', '아래로 당겼다<br>놓으면 발사'));
    r.append(this.gauge);
    const gv = (e: PointerEvent) => {
      const rc = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientY - rc.top) / rc.height));
    };
    let gd = false;
    track.addEventListener('pointerdown', (e) => { gd = true; track.setPointerCapture(e.pointerId); this.h.gauge('down', gv(e)); e.stopPropagation(); });
    track.addEventListener('pointermove', (e) => { if (gd) this.h.gauge('move', gv(e)); });
    const up = (e: PointerEvent) => { if (!gd) return; gd = false; this.h.gauge('up', gv(e)); };
    track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    this.setPower(0);

    // 볼 인 핸드 확인 바
    this.placeBar = el('div'); this.placeBar.id = 'placebar';
    const ok = el('button', 'primary', '여기에 놓기 (Enter)');
    ok.onclick = () => this.h.placeConfirm();
    this.placeBar.append(ok);
    r.append(this.placeBar);
    this.placeBar.classList.add('hidden');
    this.setGameUiVisible(false);
  }

  setGameUiVisible(v: boolean) {
    for (const e of [this.hud, this.toolbar, this.hit, this.status, this.stats]) e.classList.toggle('hidden', !v);
    if (!v) { this.gauge.classList.add('hidden'); this.placeBar.classList.add('hidden'); this.hint.textContent = ''; }
  }

  setPracticeTools(v: boolean) {
    this.editBtn.classList.toggle('hidden', !v);
    document.getElementById('rerackBtn')!.classList.toggle('hidden', !v);
  }
  setEditActive(v: boolean) { this.editBtn.style.borderColor = v ? 'var(--accent)' : ''; }

  // ------------------------------------------------------------------ HUD
  setPlayers(state: RuleState, names: [string, string], sub: [string, string], onTable: number[], showGroups = true) {
    this.hud.innerHTML = '';
    for (let i = 0; i < 2; i++) {
      if (names[i] === '' ) continue;
      const g = state.groups[i];
      const c = el('div', 'pcard panel' + (state.turn === i && state.winner === null ? ' active' : ''));
      const gl = g === 'solid' ? '솔리드' : g === 'stripe' ? '스트라이프' : state.breakDone ? '오픈 테이블' : '브레이크';
      c.append(el('div', 'nm', names[i]), el('div', 'gr', `${sub[i] ? sub[i] + ' · ' : ''}${gl}`));
      const balls = el('div', 'balls');
      if (g && showGroups) {
        const ids = g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
        ids.push(8);
        for (const id of ids) {
          const m = el('span', 'mini' + (id > 8 ? ' stripe' : '') + (onTable.includes(id) ? '' : ' out'));
          if (id > 8) m.style.background = `linear-gradient(180deg,#f4f1e8 0 22%,${ballColor(id)} 22% 78%,#f4f1e8 78%)`;
          else m.style.background = ballColor(id);
          balls.append(m);
        }
      }
      c.append(balls);
      this.hud.append(c);
    }
  }
  setStatus(t: string) { this.status.textContent = t; }
  setStats(t: string) { this.stats.textContent = t; }
  setHint(t: string) { this.hint.textContent = t; this.hint.style.opacity = '1'; }

  toast(msg: string, kind: '' | 'foul' | 'good' = '', ms = 2600) {
    const t = el('div', 'toast ' + kind, msg);
    this.toastBox.append(t);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild!.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 700);
  }

  // ------------------------------------------------------------------ 타점/파워
  setHitPoint(a: number, b: number) {
    this.hitA = a; this.hitB = b;
    const c = this.hitCanvas, ctx = c.getContext('2d')!;
    const s = c.width, r = s / 2 - 4;
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s * 0.4, s * 0.38, 4, s / 2, s / 2, r);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfc9bd');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s / 2, 8); ctx.lineTo(s / 2, s - 8); ctx.moveTo(8, s / 2); ctx.lineTo(s - 8, s / 2); ctx.stroke();
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(220,60,40,.55)';
    ctx.beginPath(); ctx.arc(s / 2, s / 2, r * 0.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); // 미스큐 한계
    ctx.fillStyle = '#d4281f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s / 2 + a * r, s / 2 - b * r, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  setElevation(deg: number) { this.elevLabel.textContent = `큐 각도 ${deg.toFixed(0)}°`; }
  setPower(v: number) {
    this.gMask.style.top = `${v * 100}%`;
    this.gMask.style.height = `${(1 - v) * 100}%`;
    this.gKnob.style.top = `${v * 100}%`;
    this.gPct.textContent = `${Math.round(v * 100)}%`;
  }
  /** 게이지는 위쪽이 강함. 포인터 y 비율(0=위) → 파워 = 1 - y. 단, 당기는 방식 UX: 아래로 당길수록 큼 */
  showGauge(v: boolean) { this.gauge.classList.toggle('hidden', !v); }
  showPlaceBar(v: boolean) { this.placeBar.classList.toggle('hidden', !v); }
  setAimControlsVisible(v: boolean) { this.hit.classList.toggle('hidden', !v); }

  // ------------------------------------------------------------------ 오버레이
  private open(card: HTMLElement, clear = false) {
    this.closeOverlay();
    const o = el('div', 'overlay' + (clear ? ' clear' : ''));
    o.append(card);
    this.root.append(o);
    this.overlay = o;
    this.menuOpen = true;
  }
  closeOverlay() {
    this.overlay?.remove();
    this.overlay = null;
    this.menuOpen = false;
  }

  showMenu() {
    this.setGameUiVisible(false);
    const c = el('div', 'card panel');
    c.append(el('h1', '', '<span class="title-ball"></span>Pool 3D'), el('p', 'sub', '실사형 8볼 포켓볼 · 직접 구현한 당구 물리 엔진'));
    const g = el('div', 'menu-grid');
    const item = (t: string, s: string, fn: () => void, primary = false) => {
      const b = el('button', primary ? 'primary' : '', `${t}<small>${s}</small>`);
      b.onclick = fn; g.append(b);
    };
    item('연습 (1인)', '자유 배치·재랙 가능, 규칙 알림만', () => this.h.startPractice(), true);
    item('로컬 2인 대전', '한 화면에서 번갈아 플레이', () => this.showLocal());
    item('AI 대전', '초급 / 중급 / 고급 — 실제 물리 시뮬로 샷 평가', () => this.showAI());
    item('온라인 2인 (P2P)', '방 코드를 공유해 친구와 대전', () => this.showOnline());
    item('물리 테스트 랩', '스톱샷·끌어치기·컷샷·쿠션 검증 장면', () => this.h.openLab());
    item('설정', '조준선·그래픽·사운드·카메라·감도', () => this.showSettings(true));
    c.append(g);
    c.append(el('p', 'sub', `<br>조작: 드래그 = 조준 · 우클릭/Space 누른 채 마우스를 뒤로 당겼다 앞으로 = 스트로크 · Shift = 미세 조준 · 휠 = 줌 · ↑↓ = 큐 각도`));
    this.open(c);
  }

  private nameField(label: string, val: string) {
    const r = el('div', 'row'); const l = el('label', '', label);
    const i = el('input'); i.type = 'text'; i.value = val; i.maxLength = 12;
    r.append(l, i);
    return { row: r, input: i };
  }

  private showLocal() {
    const c = el('div', 'card panel', '<h2>로컬 2인 대전</h2>');
    const a = this.nameField('플레이어 1', '플레이어 1'), b = this.nameField('플레이어 2', '플레이어 2');
    const go = el('button', 'primary', '시작'); go.onclick = () => this.h.startLocal(a.input.value || 'P1', b.input.value || 'P2');
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => this.showMenu();
    const bar = el('div', 'row'); bar.append(back, go);
    c.append(a.row, b.row, bar);
    this.open(c);
  }

  private showAI() {
    const c = el('div', 'card panel', '<h2>AI 대전</h2>');
    const n = this.nameField('이름', this.settings.playerName);
    c.append(n.row);
    const g = el('div', 'menu-grid');
    const desc = ['오차가 크고 실수가 잦은 초보 상대', '정확한 편, 포지션도 어느 정도 고려', '거의 완벽한 정확도로 최적 샷 선택'];
    AI_LEVEL_NAMES.forEach((nm, i) => {
      const b = el('button', i === 1 ? 'primary' : '', `${nm}<small>${desc[i]}</small>`);
      b.onclick = () => { this.settings.playerName = n.input.value || '플레이어'; this.h.startAI(i as 0 | 1 | 2, this.settings.playerName); };
      g.append(b);
    });
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => this.showMenu();
    c.append(g, el('div', 'row'), back);
    this.open(c);
  }

  private showOnline() {
    const c = el('div', 'card panel', '<h2>온라인 2인 (P2P)</h2><p class="sub">공개 중계 서버를 통해 연결됩니다(별도 서버 불필요). 한 명이 방을 만들고 코드를 알려주세요.</p>');
    const n = this.nameField('이름', this.settings.playerName);
    const err = el('div', 'err');
    const hostBtn = el('button', 'primary', '방 만들기');
    const codeIn = el('input'); codeIn.type = 'text'; codeIn.placeholder = '방 코드 입력'; codeIn.maxLength = 5; codeIn.style.textTransform = 'uppercase';
    const joinBtn = el('button', '', '참가');
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => { this.h.cancelOnline(); this.showMenu(); };
    const box = el('div');
    hostBtn.onclick = async () => {
      err.textContent = ''; hostBtn.disabled = true;
      try {
        const code = await this.h.hostOnline(n.input.value || '플레이어');
        box.innerHTML = '';
        box.append(el('div', 'sub', '이 코드를 친구에게 알려주세요. 접속을 기다리는 중... (이 화면을 켠 채로 두세요 — 화면이 꺼지거나 다른 앱으로 가면 방이 사라질 수 있어요)'), el('div', 'code', code));
      } catch (e: any) { err.textContent = '방 생성 실패: ' + (e?.message || e); hostBtn.disabled = false; }
    };
    joinBtn.onclick = async () => {
      err.textContent = '';
      if (codeIn.value.trim().length < 4) { err.textContent = '방 코드를 입력하세요'; return; }
      joinBtn.disabled = true; joinBtn.textContent = '연결 중...';
      try { await this.h.joinOnline(codeIn.value, n.input.value || '플레이어'); }
      catch (e: any) { err.textContent = '참가 실패: ' + (e?.message || e); joinBtn.disabled = false; joinBtn.textContent = '참가'; }
    };
    const r1 = el('div', 'row'); r1.append(hostBtn);
    const r2 = el('div', 'row'); r2.append(codeIn, joinBtn);
    c.append(n.row, r1, box, el('div', 'sub', '— 또는 —'), r2, err, back);
    this.open(c);
  }

  showPause() {
    if (this.menuOpen) return;
    const c = el('div', 'card panel', '<h2>일시정지</h2>');
    const g = el('div', 'menu-grid');
    const add = (t: string, fn: () => void, p = false) => { const b = el('button', p ? 'primary' : '', t); b.onclick = fn; g.append(b); };
    add('계속하기', () => { this.closeOverlay(); this.h.resume(); }, true);
    add('설정', () => this.showSettings(false));
    add('직전 샷 리플레이', () => { this.closeOverlay(); this.h.replay(); });
    add('디버그 패널 (물리 파라미터)', () => { this.closeOverlay(); this.h.toggleDebug(); this.h.resume(); });
    add('메인 메뉴로', () => { this.closeOverlay(); this.h.quitToMenu(); });
    c.append(g);
    this.open(c, true);
  }

  showSettings(fromMenu: boolean) {
    const s = this.settings;
    const c = el('div', 'card panel', '<h2>설정</h2>');
    const seg = <T extends string | number | boolean>(label: string, opts: [string, T][], get: () => T, set: (v: T) => void) => {
      const r = el('div', 'row'); r.append(el('label', '', label));
      const sg = el('div', 'seg');
      const draw = () => { sg.innerHTML = ''; for (const [t, v] of opts) { const b = el('button', get() === v ? 'on' : '', t); b.onclick = () => { set(v); draw(); this.h.settingsChanged(); }; sg.append(b); } };
      draw(); r.append(sg); c.append(r);
    };
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const r = el('div', 'row'); r.append(el('label', '', label));
      const i = el('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(get());
      i.oninput = () => { set(parseFloat(i.value)); this.h.settingsChanged(); };
      r.append(i); c.append(r);
    };
    seg('조준선', [['초보', 0], ['중급', 1], ['프로', 2]], () => s.aimLevel, (v) => (s.aimLevel = v as 0 | 1 | 2));
    seg('그래픽 품질', [['낮음', 'low'], ['중간', 'medium'], ['높음', 'high']], () => s.quality, (v) => (s.quality = v as Settings['quality']));
    seg('샷 입력', [['스트로크', 'stroke'], ['파워 게이지', 'gauge']], () => s.control, (v) => (s.control = v as Settings['control']));
    slider('조준 감도', 0.3, 2.5, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v));
    seg('샷 후 카메라', [['탑뷰', 'top'], ['공 추적', 'follow'], ['유지', 'stay']], () => s.cameraAfterShot, (v) => (s.cameraAfterShot = v as Settings['cameraAfterShot']));
    seg('슬로모션/클로즈업', [['켬', true], ['끔', false]], () => s.cinematic, (v) => (s.cinematic = v));
    slider('마스터 볼륨', 0, 1, 0.05, () => s.master, (v) => (s.master = v));
    slider('효과음', 0, 1, 0.05, () => s.sfx, (v) => (s.sfx = v));
    seg('당구장 앰비언스', [['켬', true], ['끔', false]], () => s.ambienceOn, (v) => (s.ambienceOn = v));
    slider('앰비언스 볼륨', 0, 1, 0.05, () => s.ambience, (v) => (s.ambience = v));
    const back = el('button', 'primary', '닫기');
    back.onclick = () => { if (fromMenu) this.showMenu(); else { this.closeOverlay(); this.h.resume(); } };
    c.append(el('div', 'row'), back);
    this.open(c, !fromMenu);
  }

  showResult(winnerName: string, reason: string, youWon: boolean | null, shots: number) {
    const c = el('div', 'card panel');
    c.append(el('h2', '', youWon === false ? '패배' : '🏆 ' + winnerName + ' 승리'));
    c.append(el('p', 'sub', `${reason}<br>총 ${shots}샷`));
    const g = el('div', 'menu-grid');
    const add = (t: string, fn: () => void, p = false) => { const b = el('button', p ? 'primary' : '', t); b.onclick = fn; g.append(b); };
    add('다시 하기', () => { this.closeOverlay(); this.h.rematch(); }, true);
    add('마지막 샷 리플레이', () => { this.closeOverlay(); this.h.replay(); });
    add('메인 메뉴', () => { this.closeOverlay(); this.h.quitToMenu(); });
    c.append(g);
    this.open(c, true);
  }

  showLab(rows: { key: string; name: string; desc: string; pass: boolean; detail: string }[]) {
    const c = el('div', 'card panel');
    (c.style as any).width = 'min(820px,100%)';
    c.append(el('h2', '', '물리 테스트 랩'), el('p', 'sub', '현재 물리 파라미터로 검증 시나리오를 실행한 결과입니다. "3D 보기"로 같은 장면을 직접 볼 수 있습니다. (디버그 패널에서 값을 바꾼 뒤 다시 실행해 보세요)'));
    const t = el('table', 'lab');
    t.innerHTML = '<tr><th></th><th>시나리오</th><th>결과</th><th></th></tr>';
    for (const r of rows) {
      const tr = el('tr');
      tr.innerHTML = `<td class="${r.pass ? 'ok' : 'ng'}">${r.pass ? '✔' : '✘'}</td><td><b>${r.name}</b><br><span class="sub">${r.desc}</span></td><td>${r.detail}</td>`;
      const td = el('td'); const b = el('button', '', '3D 보기'); b.onclick = () => { this.closeOverlay(); this.h.runScene(r.key); };
      td.append(b); tr.append(td); t.append(tr);
    }
    c.append(t);
    const bar = el('div', 'row');
    const re = el('button', '', '다시 실행'); re.onclick = () => this.h.openLab();
    const dbg = el('button', '', '디버그 패널'); dbg.onclick = () => this.h.toggleDebug();
    const back = el('button', 'primary', '메뉴로'); back.onclick = () => this.showMenu();
    bar.append(re, dbg, back);
    c.append(bar);
    this.open(c);
  }

  showInfo(title: string, msg: string, btn = '확인', fn?: () => void) {
    const c = el('div', 'card panel', `<h2>${title}</h2><p class="sub">${msg}</p>`);
    const b = el('button', 'primary', btn); b.onclick = () => { this.closeOverlay(); fn?.(); };
    c.append(b);
    this.open(c, true);
  }

  showWaiting(msg: string, cancel: () => void) {
    const c = el('div', 'card panel', `<h2>${msg}</h2>`);
    const b = el('button', '', '취소'); b.onclick = () => { this.closeOverlay(); cancel(); };
    c.append(b);
    this.open(c, true);
  }
}
