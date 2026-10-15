import './style.css';
import { type Settings, isMobile } from '../config/settings';
import { ballColor } from '../rendering/textures';
import type { RuleState } from '../game-rules/RuleSet';
import { AI_LEVEL_NAMES } from '../ai/ai';
import { ACHIEVEMENTS, levelFromXp, rankOf, type Profile } from '../meta/profile';
import { CUE_SKINS, CLOTH_SKINS, RAIL_SKINS, BALL_SETS, type Look } from '../meta/customize';

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
  openProfile(): void;
  openCustomize(): void;
  openDrills(): void;
  startDrill(id: string): void;
  openHelp(): void;
  startTutorial(): void;
  photoMode(): void;
  fullscreen(): void;
  emote(id: string): void;
  replaySpeed(x: number): void;
  camPreset(name: 'aim' | 'top' | 'follow' | 'rail'): void;
  lookChanged(look: Look): void;
  nextGame(): void;
  resetSettings(): void;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

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
  private camBtn!: HTMLButtonElement;
  private camIdx = 0;
  private cycleCamera() {
    const list = ['aim', 'top', 'follow', 'rail'] as const;
    this.camIdx = (this.camIdx + 1) % list.length;
    this.h.camPreset(list[this.camIdx]);
    this.toast(['조준 시점', '탑뷰', '공 추적', '레일 시점'][this.camIdx], '', 900);
  }
  private mobile = isMobile();
  menuOpen = false;

  profile: Profile | null = null;
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
    mk('⚙', '설정', () => this.showSettings(false));
    mk('📷', '포토 모드 (F2)', () => this.h.photoMode());
    mk('⛶', '전체화면 (F)', () => this.h.fullscreen());
    this.camBtn = mk('🎥', '카메라 전환 (T) — 길게/반복: 조준→탑뷰→추적→레일', () => this.cycleCamera());
    mk('❓', '도움말 (H)', () => this.h.openHelp());
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
  private score: [number, number] = [0, 0];
  private raceTo = 1;
  setScore(score: [number, number], raceTo: number) { this.score = score; this.raceTo = raceTo; }

  private miniBall(id: number, out: boolean) {
    const m = el('span', 'mini' + (id > 8 ? ' stripe' : '') + (out ? ' out' : ''));
    if (id > 8) m.style.background = `linear-gradient(180deg,#f4f1e8 0 22%,${ballColor(id)} 22% 78%,#f4f1e8 78%)`;
    else m.style.background = ballColor(id);
    m.title = String(id);
    return m;
  }

  setPlayers(state: RuleState, names: [string, string], sub: [string, string], onTable: number[], showGroups = true) {
    this.hud.innerHTML = '';
    const nine = state.game === 'nineball';
    const cards: HTMLElement[] = [];
    for (let i = 0; i < 2; i++) {
      if (names[i] === '') continue;
      const g = state.groups[i];
      const c = el('div', 'pcard panel' + (state.turn === i && state.winner === null ? ' active' : ''));
      const alg = state.game === 'algakki';
      const gl = alg ? `${state.ballOf![i] === 8 ? '⚫ 검은 공 (선공)' : '⚪ 흰 공'}${state.turn === i && state.winner === null ? ' · 샷 차례' : ''}` : nine ? (state.turn === i ? '샷 차례' : '대기') : g === 'solid' ? '솔리드' : g === 'stripe' ? '스트라이프' : state.breakDone ? '오픈 테이블' : '브레이크';
      const score = this.raceTo > 1 ? ` <span class="badge">${this.score[i]}/${this.raceTo}</span>` : '';
      c.append(el('div', 'nm', esc(names[i]) + score), el('div', 'gr', `${sub[i] ? sub[i] + ' · ' : ''}${gl}`));
      const balls = el('div', 'balls');
      if (!nine && g && showGroups) {
        const ids = g === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
        ids.push(8);
        for (const id of ids) balls.append(this.miniBall(id, !onTable.includes(id)));
      }
      c.append(balls);
      cards.push(c);
    }
    if (nine) {
      const mid = el('div', 'pcard panel');
      mid.style.opacity = '1';
      mid.append(el('div', 'gr', '테이블 위의 공'));
      const balls = el('div', 'balls');
      for (let id = 1; id <= 9; id++) balls.append(this.miniBall(id, !onTable.includes(id)));
      mid.append(balls);
      cards.splice(1, 0, mid);
    }
    this.hud.append(...cards);
  }

  private clockEl: HTMLElement | null = null;
  /** 샷 클락 (초). null = 숨김 */
  setClock(left: number | null) {
    if (!this.clockEl) { this.clockEl = el('div', 'clock'); this.root.append(this.clockEl); }
    if (left === null) { this.clockEl.classList.add('hidden'); return; }
    this.clockEl.classList.remove('hidden');
    this.clockEl.textContent = String(Math.max(0, Math.ceil(left)));
    this.clockEl.classList.toggle('warn', left <= 10);
  }

  setStatus(t: string) { this.status.textContent = t; }
  setStats(t: string) { this.stats.textContent = t; }
  private netBadge: HTMLElement | null = null;
  setNetStatus(t: string | null) {
    if (!this.netBadge) { this.netBadge = el('div', 'toast foul'); this.netBadge.style.cssText = 'position:fixed;top:120px;left:50%;transform:translateX(-50%);z-index:16;font-size:13px;padding:8px 14px;pointer-events:none'; this.root.append(this.netBadge); }
    this.netBadge.textContent = t ?? '';
    this.netBadge.classList.toggle('hidden', !t);
  }
  setHint(t: string) { this.hint.textContent = t; this.hint.style.opacity = '1'; }

  toast(msg: string, kind: '' | 'foul' | 'good' = '', ms = 2600) {
    const t = el('div', 'toast ' + kind);
    t.textContent = msg;
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
    this.setClock(null);
    const c = el('div', 'card panel');
    c.append(el('h1', '', '<span class="title-ball"></span>Pool 3D'), el('p', 'sub', '실사형 8볼 · 9볼 포켓볼 — 직접 구현한 당구 물리 엔진 · v1.0'));
    if (this.profile) {
      const st = this.profile.stats, lv = levelFromXp(st.xp);
      const pc = el('div', 'profilebar');
      pc.innerHTML = `<div class="lvl">${lv.level}</div><div class="pinfo"><b>${esc(this.settings.playerName)}</b> <span class="badge">${rankOf(lv.level)}</span><div class="xp"><i style="width:${Math.round((lv.cur / lv.next) * 100)}%"></i></div><small>${st.wins}승 ${st.losses}패 · 포켓 ${st.pots}개 · XP ${lv.cur}/${lv.next}</small></div>`;
      pc.onclick = () => this.h.openProfile();
      c.append(pc);
    }
    const g = el('div', 'menu-grid');
    const item = (t: string, s2: string, fn: () => void, primary = false) => {
      const b2 = el('button', primary ? 'primary' : '', `${t}<small>${s2}</small>`);
      b2.onclick = fn; g.append(b2);
    };
    item('연습 (1인)', '자유 배치·재랙 가능, 규칙 알림만', () => this.showPractice(), true);
    item('로컬 2인 대전', '한 화면에서 번갈아 플레이', () => this.showLocal());
    item('AI 대전', '초급 / 중급 / 고급 — 실제 물리 시뮬로 샷 평가', () => this.showAI());
    item('온라인 2인', '방 코드를 공유해 친구와 대전 (유실 복구 지원)', () => this.showOnline());
    item('알까기 ⚫⚪', '공 두 개로 벌이는 서바이벌 — 가위바위보로 선공(검은 공) 결정', () => this.showAlgakki());
    item('드릴 · 챌린지', '직선·컷·뱅크·포지션·점프·브레이크 등 10종, 별 3개 도전', () => this.h.openDrills());
    const row = el('div', 'row2');
    const mini = (t: string, fn: () => void) => { const b2 = el('button', '', t); b2.onclick = fn; row.append(b2); };
    mini('👤 프로필', () => this.h.openProfile());
    mini('🎨 커스터마이즈', () => this.h.openCustomize());
    mini('⚙ 설정', () => this.showSettings(true));
    mini('❓ 도움말', () => this.h.openHelp());
    mini('🧪 물리 랩', () => this.h.openLab());
    c.append(g, row);
    this.open(c);
  }

  /** 규칙/레이스/샷클락 선택 블록 */
  private matchBlock(c: HTMLElement, opts: { race?: boolean; clock?: boolean; noAlgakki?: boolean } = {}) {
    const s2 = this.settings;
    const seg = <T extends string | number>(label: string, list: [string, T][], get: () => T, set: (v: T) => void) => {
      const r = el('div', 'row'); r.append(el('label', '', label));
      const sg = el('div', 'seg');
      const draw = () => { sg.innerHTML = ''; for (const [t, v] of list) { const b = el('button', get() === v ? 'on' : '', t); b.onclick = () => { set(v); draw(); this.h.settingsChanged(); }; sg.append(b); } };
      draw(); r.append(sg); c.append(r);
    };
    seg('종목', opts.noAlgakki ? [['8볼', 'eight'], ['9볼', 'nine']] : [['8볼', 'eight'], ['9볼', 'nine'], ['알까기', 'algakki']], () => (opts.noAlgakki && s2.rules === 'algakki' ? 'eight' : s2.rules), (v) => (s2.rules = v as Settings['rules']));
    if (opts.race) seg('매치', [['단판', 1], ['3판 2선승', 2], ['5판 3선승', 3], ['7판 4선승', 4]], () => s2.raceTo, (v) => (s2.raceTo = v as number));
    if (opts.clock) seg('샷 클락', [['없음', 0], ['30초', 30], ['45초', 45], ['60초', 60]], () => s2.shotClock, (v) => (s2.shotClock = v as Settings['shotClock']));
  }

  private showAlgakki() {
    const c = el('div', 'card panel', '<h2>알까기 ⚫⚪</h2>');
    c.append(el('p', 'sub', '테이블에는 <b>검은 공(8번)</b>과 <b>흰 공</b> 단 두 개. <b>가위바위보</b>로 이긴 사람이 검은 공을 갖고 <b>선공</b>합니다. 각자 자기 공만 번갈아 쳐서 <b>상대 공을 먼저 포켓에 넣으면 승리</b>, 내 공이 빠지면 패배(동시에 빠져도 패배)! 끝까지 살아남은 공의 주인이 이깁니다.'));
    const g = el('div', 'menu-grid');
    const go = (fn: () => void) => () => { this.settings.rules = 'algakki'; fn(); };
    const add = (t: string, sub: string, fn: () => void) => { const b = el('button', '', `${t}<small>${sub}</small>`); b.onclick = go(fn); g.append(b); };
    add('로컬 2인', '한 화면에서 가위바위보 → 번갈아 샷', () => this.showLocal());
    add('AI 대전', '가위바위보로 선공을 정하고 AI와 대결', () => this.showAI());
    add('온라인 2인', '친구와 가위바위보(공정한 커밋-리빌) 후 대결', () => this.showOnline());
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => this.showMenu();
    c.append(g, el('div', 'row'), back);
    this.open(c);
  }

  /** 가위바위보 선택 오버레이 → 선택값('rock'|'paper'|'scissors') */
  askRps(title: string, sub = ''): Promise<'rock' | 'paper' | 'scissors'> {
    return new Promise((resolve) => {
      const c = el('div', 'card panel', `<h2>${esc(title)}</h2><p class="sub">${sub}</p>`);
      const row = el('div', 'rps');
      for (const [id, ico, nm] of [['scissors', '✌️', '가위'], ['rock', '✊', '바위'], ['paper', '✋', '보']] as const) {
        const b = el('button', '', `<span>${ico}</span><small>${nm}</small>`);
        b.onclick = () => { this.closeOverlay(); resolve(id); };
        row.append(b);
      }
      c.append(row);
      this.open(c);
    });
  }

  /** 대기 안내 (상대 선택/네트워크 대기) */
  showWait(msg: string) {
    const c = el('div', 'card panel', `<h2>${esc(msg)}</h2><p class="sub">잠시만 기다려 주세요...</p>`);
    this.open(c, true);
  }

  /** 가위바위보 결과 공개. 자동으로 닫히고 resolve */
  revealRps(left: { name: string; pick: string }, right: { name: string; pick: string }, text: string): Promise<void> {
    const ico: Record<string, string> = { rock: '✊', paper: '✋', scissors: '✌️' };
    return new Promise((resolve) => {
      const c = el('div', 'card panel');
      c.innerHTML = `<h2>가위바위보</h2><div class="rpsreveal"><div><span>${ico[left.pick]}</span><b>${esc(left.name)}</b></div><i>VS</i><div><span>${ico[right.pick]}</span><b>${esc(right.name)}</b></div></div><p class="sub" style="font-size:18px;color:var(--text)">${esc(text)}</p>`;
      this.open(c, true);
      setTimeout(() => { this.closeOverlay(); resolve(); }, 2000);
    });
  }

  private showPractice() {
    const c = el('div', 'card panel', '<h2>연습 (1인)</h2><p class="sub">혼자 자유롭게 연습합니다. ✋ 버튼으로 공을 직접 옮길 수 있어요.</p>');
    this.matchBlock(c, { noAlgakki: true });
    const go = el('button', 'primary', '시작'); go.onclick = () => { if (this.settings.rules === 'algakki') this.settings.rules = 'eight'; this.h.startPractice(); };
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => this.showMenu();
    const bar = el('div', 'row'); bar.append(back, go);
    c.append(bar);
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
    c.append(a.row, b.row);
    this.matchBlock(c, { race: true, clock: true });
    const go = el('button', 'primary', '시작'); go.onclick = () => this.h.startLocal(a.input.value || 'P1', b.input.value || 'P2');
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => this.showMenu();
    const bar = el('div', 'row'); bar.append(back, go);
    c.append(bar);
    this.open(c);
  }

  private showAI() {
    const c = el('div', 'card panel', '<h2>AI 대전</h2>');
    const n = this.nameField('이름', this.settings.playerName);
    c.append(n.row);
    this.matchBlock(c, { race: true, clock: true });
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
    const mb = el('div');
    this.matchBlock(mb, { race: true, clock: true });
    const r1 = el('div', 'row'); r1.append(hostBtn);
    const r2 = el('div', 'row'); r2.append(codeIn, joinBtn);
    c.append(n.row, mb, r1, box, el('div', 'sub', '— 또는 —'), r2, err, back);
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
    const head = (t: string) => c.append(el('h3', 'sec', t));
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
    head('조준 · 입력');
    seg('조준선', [['초보', 0], ['중급', 1], ['프로', 2]], () => s.aimLevel, (v) => (s.aimLevel = v as 0 | 1 | 2));
    seg('조준선 색', [['흰색', 'white'], ['하늘', 'cyan'], ['노랑', 'yellow']], () => s.aimColor, (v) => (s.aimColor = v as Settings['aimColor']));
    seg('샷 입력', [['스트로크', 'stroke'], ['파워 게이지', 'gauge']], () => s.control, (v) => (s.control = v as Settings['control']));
    slider('조준 감도', 0.3, 2.5, 0.05, () => s.sensitivity, (v) => (s.sensitivity = v));
    slider('카메라 높이 감도', 0.2, 2.5, 0.05, () => s.pitchSensitivity, (v) => (s.pitchSensitivity = v));
    seg('드래그 방향', [['기본', false], ['반대로', true]], () => s.invertDrag, (v) => (s.invertDrag = v));
    head('그래픽 · 카메라');
    seg('그래픽 품질', [['낮음', 'low'], ['중간', 'medium'], ['높음', 'high']], () => s.quality, (v) => (s.quality = v as Settings['quality']));
    seg('자동 품질 조절', [['켬', true], ['끔', false]], () => s.autoQuality, (v) => (s.autoQuality = v));
    seg('샷 후 카메라', [['탑뷰', 'top'], ['공 추적', 'follow'], ['유지', 'stay']], () => s.cameraAfterShot, (v) => (s.cameraAfterShot = v as Settings['cameraAfterShot']));
    seg('슬로모션/클로즈업', [['켬', true], ['끔', false]], () => s.cinematic, (v) => (s.cinematic = v));
    seg('화면 흔들림', [['켬', false], ['끔', true]], () => s.reduceMotion, (v) => (s.reduceMotion = v));
    head('사운드');
    slider('마스터 볼륨', 0, 1, 0.05, () => s.master, (v) => (s.master = v));
    slider('효과음', 0, 1, 0.05, () => s.sfx, (v) => (s.sfx = v));
    seg('당구장 앰비언스', [['켬', true], ['끔', false]], () => s.ambienceOn, (v) => (s.ambienceOn = v));
    slider('앰비언스 볼륨', 0, 1, 0.05, () => s.ambience, (v) => (s.ambience = v));
    seg('배경 음악', [['켬', true], ['끔', false]], () => s.musicOn, (v) => (s.musicOn = v));
    slider('음악 볼륨', 0, 1, 0.05, () => s.music, (v) => (s.music = v));
    head('편의 · 접근성');
    seg('진동 (모바일)', [['켬', true], ['끔', false]], () => s.haptics, (v) => (s.haptics = v));
    slider('UI 크기', 0.8, 1.5, 0.05, () => s.uiScale, (v) => (s.uiScale = v));
    seg('FPS 표시', [['끔', false], ['켬', true]], () => s.showFps, (v) => (s.showFps = v));
    const tut = el('button', '', '튜토리얼'); tut.onclick = () => { this.closeOverlay(); this.h.startTutorial(); };
    const rst = el('button', 'ghost', '설정 초기화'); rst.onclick = () => { if (confirm('모든 설정을 기본값으로 되돌릴까요? (프로필·기록은 유지)')) { this.h.resetSettings(); this.showSettings(fromMenu); } };
    const back = el('button', 'primary', '닫기');
    back.onclick = () => { if (fromMenu) this.showMenu(); else { this.closeOverlay(); this.h.resume(); } };
    const bar = el('div', 'row'); bar.append(tut, rst, back);
    c.append(bar);
    this.open(c, !fromMenu);
  }

  showResult(winnerName: string, reason: string, youWon: boolean | null, shots: number, match?: { score: [number, number]; raceTo: number; names: [string, string]; matchOver: boolean; xp?: number }) {
    const c = el('div', 'card panel');
    const title = match && !match.matchOver ? `${esc(winnerName)} 게임 승리` : youWon === false ? '패배' : '🏆 ' + esc(winnerName) + ' 승리';
    c.append(el('h2', '', title));
    let info = `${esc(reason)}<br>총 ${shots}샷`;
    if (match && match.raceTo > 1) info = `<b style="font-size:22px">${match.score[0]} : ${match.score[1]}</b> (먼저 ${match.raceTo}승)<br>${info}`;
    if (match?.xp) info += `<br><span class="badge">+${match.xp} XP</span>`;
    c.append(el('p', 'sub', info));
    const g = el('div', 'menu-grid');
    const add = (t: string, fn: () => void, p = false) => { const b = el('button', p ? 'primary' : '', t); b.onclick = fn; g.append(b); };
    if (match && !match.matchOver) add('다음 게임', () => { this.closeOverlay(); this.h.nextGame(); }, true);
    else add('다시 하기', () => { this.closeOverlay(); this.h.rematch(); }, true);
    add('마지막 샷 리플레이', () => { this.closeOverlay(); this.h.replay(); });
    add('프로필 보기', () => this.h.openProfile());
    add('메인 메뉴', () => { this.closeOverlay(); this.h.quitToMenu(); });
    c.append(g);
    this.open(c, true);
  }

  // ------------------------------------------------------------------ 프로필 / 업적
  showProfile() {
    if (!this.profile) return;
    const st = this.profile.stats, lv = levelFromXp(st.xp);
    const c = el('div', 'card panel');
    (c.style as any).width = 'min(640px,100%)';
    c.append(el('h2', '', '프로필'));
    const pc = el('div', 'profilebar');
    pc.innerHTML = `<div class="lvl">${lv.level}</div><div class="pinfo"><b>${esc(this.settings.playerName)}</b> <span class="badge">${rankOf(lv.level)}</span><div class="xp"><i style="width:${Math.round((lv.cur / lv.next) * 100)}%"></i></div><small>XP ${lv.cur}/${lv.next} · 총 ${st.xp}</small></div>`;
    c.append(pc);
    const rows: [string, string][] = [
      ['게임', `${st.games}`], ['승 / 패', `${st.wins} / ${st.losses}`], ['승률', st.games ? `${Math.round((st.wins / st.games) * 100)}%` : '-'],
      ['샷', `${st.shots}`], ['포켓', `${st.pots}`], ['포켓 성공률', st.shots ? `${Math.round((st.pots / st.shots) * 100)}%` : '-'],
      ['최다 연속 포켓', `${st.bestRun}`], ['최장 포켓', `${st.longestPot.toFixed(2)} m`], ['뱅크샷', `${st.bankPots}`],
      ['파울', `${st.fouls}`], ['스크래치', `${st.scratches}`], ['브레이크 포켓', `${st.breakPots}/${st.breaks}`],
      ['온라인 승', `${st.onlineWins}/${st.onlineGames}`], ['AI 승 (초/중/고)', st.aiWins.join(' / ')], ['플레이 시간', `${Math.floor(st.playSeconds / 60)}분`],
    ];
    const grid = el('div', 'stats-grid');
    for (const [k, v] of rows) grid.append(el('div', 'stat', `<small>${k}</small><b>${v}</b>`));
    c.append(grid);
    const done = ACHIEVEMENTS.filter((a) => st.achievements[a.id]).length;
    c.append(el('h3', 'sec', `업적 ${done}/${ACHIEVEMENTS.length}`));
    const list = el('div', 'ach-list');
    for (const a of ACHIEVEMENTS) {
      const got = !!st.achievements[a.id];
      list.append(el('div', 'ach' + (got ? ' got' : ''), `<span class="ico">${got ? '🏆' : '🔒'}</span><div><b>${a.name}</b><small>${a.desc} · +${a.xp} XP</small></div>`));
    }
    c.append(list);
    const bar = el('div', 'row');
    const nm = el('input'); nm.type = 'text'; nm.value = this.settings.playerName; nm.maxLength = 12;
    nm.onchange = () => { this.settings.playerName = nm.value.trim() || '플레이어'; this.h.settingsChanged(); };
    const back = el('button', 'primary', '닫기'); back.onclick = () => this.showMenu();
    bar.append(nm, back);
    c.append(el('div', 'sub', '이름 변경:'), bar);
    this.open(c);
  }

  // ------------------------------------------------------------------ 커스터마이즈
  showCustomize(level: number) {
    const c = el('div', 'card panel');
    (c.style as any).width = 'min(620px,100%)';
    c.append(el('h2', '', '커스터마이즈'), el('p', 'sub', `레벨을 올리면 더 많은 스킨이 열립니다 (현재 Lv.${level}). 선택하면 바로 적용됩니다.`));
    const look = this.settings.look;
    const section = <T extends { id: string; name: string; unlock: number }>(title: string, list: T[], key: keyof Look, sw?: (x: T) => string) => {
      c.append(el('h3', 'sec', title));
      const row = el('div', 'swatches');
      const draw = () => {
        row.innerHTML = '';
        for (const it of list) {
          const locked = it.unlock > level;
          const b = el('button', 'swatch' + (look[key] === it.id ? ' on' : '') + (locked ? ' locked' : ''));
          if (sw) b.style.setProperty('--sw', sw(it));
          b.innerHTML = `<i></i><span>${it.name}</span>${locked ? `<em>🔒 Lv.${it.unlock}</em>` : ''}`;
          b.onclick = () => { if (locked) { this.toast(`Lv.${it.unlock} 에 열립니다`, 'foul', 1200); return; } look[key] = it.id; this.h.lookChanged({ ...look }); draw(); };
          row.append(b);
        }
      };
      draw(); c.append(row);
    };
    section('큐', CUE_SKINS, 'cue', (x) => `linear-gradient(90deg, ${x.shaft} 0 55%, ${x.butt} 55%)`);
    section('당구대 천', CLOTH_SKINS, 'cloth', (x) => `rgb(${x.rgb.map((v) => Math.min(255, v * 1.4)).join(',')})`);
    section('레일 목재', RAIL_SKINS, 'rail', (x) => x.wood);
    section('공 세트', BALL_SETS, 'balls', () => 'radial-gradient(circle at 35% 30%, #fff, #d4281f 60%, #111)');
    const back = el('button', 'primary', '완료'); back.onclick = () => this.showMenu();
    c.append(el('div', 'row'), back);
    this.open(c, true);
  }

  // ------------------------------------------------------------------ 드릴
  showDrills(list: { id: string; name: string; desc: string; best: number; attempts: number }[]) {
    const c = el('div', 'card panel');
    (c.style as any).width = 'min(640px,100%)';
    c.append(el('h2', '', '드릴 · 챌린지'), el('p', 'sub', '정해진 횟수 안에 목표를 달성해 별 3개를 모으세요. 첫 클리어마다 XP를 받습니다.'));
    const g = el('div', 'menu-grid');
    for (const d of list) {
      const b = el('button', '', `${d.name} <span class="stars">${'★'.repeat(d.best)}${'☆'.repeat(3 - d.best)}</span><small>${d.desc} · ${d.attempts}회</small>`);
      b.onclick = () => this.h.startDrill(d.id);
      g.append(b);
    }
    const back = el('button', 'ghost', '← 뒤로'); back.onclick = () => this.showMenu();
    c.append(g, el('div', 'row'), back);
    this.open(c);
  }

  /** 드릴 진행 HUD (상단 중앙) */
  setDrillHud(t: string | null) {
    if (!this.drillEl) { this.drillEl = el('div', 'panel drillhud'); this.root.append(this.drillEl); }
    this.drillEl.classList.toggle('hidden', !t);
    if (t) this.drillEl.innerHTML = t;
  }
  private drillEl: HTMLElement | null = null;

  showDrillResult(name: string, stars: number, detail: string, onRetry: () => void, onList: () => void) {
    const c = el('div', 'card panel', `<h2>${esc(name)}</h2><p style="font-size:34px;margin:6px 0" class="stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</p><p class="sub">${detail}</p>`);
    const g = el('div', 'menu-grid');
    const b1 = el('button', 'primary', '다시 도전'); b1.onclick = () => { this.closeOverlay(); onRetry(); };
    const b2 = el('button', '', '드릴 목록'); b2.onclick = () => { this.closeOverlay(); onList(); };
    g.append(b1, b2);
    c.append(g);
    this.open(c, true);
  }

  // ------------------------------------------------------------------ 도움말 / 코치
  showHelp() {
    const c = el('div', 'card panel');
    (c.style as any).width = 'min(640px,100%)';
    c.append(el('h2', '', '도움말'));
    const rows: [string, string][] = [
      ['드래그 (좌클릭 / 한 손가락)', '조준 방향 회전. 세로로 끌면 카메라 높이'],
      ['Shift + 드래그', '미세 조준 (감도 1/10)'],
      ['← → / A D', '키보드 미세 조준'],
      ['우클릭 또는 Space 누른 채 마우스를 아래로 당겼다 위로 밀기', '스트로크 — 미는 속도가 곧 파워'],
      ['알까기', '검은 공(8)·흰 공 두 개만. 가위바위보 승자가 검은 공+선공. 상대 공을 넣으면 승리, 내 공이 빠지면 패배'],
      ['오른쪽 파워 게이지', '아래로 당겼다 놓으면 발사 (모바일 기본)'],
      ['왼쪽 아래 타점 원', '클릭으로 타점 지정. 점선 원 밖은 미스큐 위험'],
      ['↑ ↓ / W S / Alt+휠 / +−', '큐 각도(엘리베이션). 크게 올리면 점프·마세'],
      ['휠 / 핀치', '줌'],
      ['T / 🎥', '카메라 전환 (조준 → 탑뷰 → 추적 → 레일)'],
      ['R', '카메라 초기화'],
      ['P', '직전 샷 리플레이 (0.25× / 0.5× / 1×)'],
      ['Enter', '볼 인 핸드 확정 / 테스트 랩 다시 실행'],
      ['F / F2', '전체화면 / 포토 모드'],
      ['Esc', '일시정지'],
    ];
    const t = el('table', 'lab');
    for (const [k, v] of rows) t.append(el('tr', '', `<td><b>${k}</b></td><td>${v}</td>`));
    c.append(t);
    c.append(el('h3', 'sec', '규칙 요약'), el('p', 'sub', '<b>8볼</b>: 브레이크 후 첫 포켓으로 솔리드/스트라이프 결정, 자기 공을 모두 넣고 8번으로 마무리. 파울(스크래치·상대 공 먼저 맞힘·무접촉·쿠션 없음)은 볼 인 핸드. 8번 조기 포켓/스크래치는 패배.<br><b>9볼</b>: 항상 가장 낮은 번호를 먼저 맞혀야 하고, 합법적으로 9번을 넣으면 승리. 파울은 볼 인 핸드.'));
    const back = el('button', 'primary', '닫기'); back.onclick = () => { if (this.inGame) { this.closeOverlay(); this.h.resume(); } else this.showMenu(); };
    c.append(back);
    this.open(c, this.inGame);
  }
  inGame = false;

  private coachEl: HTMLElement | null = null;
  coach(text: string | null, label = '다음', onNext?: () => void) {
    if (!this.coachEl) { this.coachEl = el('div', 'panel coach'); this.root.append(this.coachEl); }
    this.coachEl.classList.toggle('hidden', !text);
    if (!text) return;
    this.coachEl.innerHTML = `<div>${text}</div>`;
    if (onNext) { const b = el('button', 'primary', label); b.onclick = onNext; this.coachEl.append(b); }
  }

  // ------------------------------------------------------------------ 이모트 / 리플레이 바 / 포토 모드
  private emoteBar: HTMLElement | null = null;
  setOnlineTools(v: boolean) {
    if (!this.emoteBar) {
      this.emoteBar = el('div', 'panel emotes');
      for (const [id, t] of [['gg', 'GG'], ['up', '👍'], ['smile', '😀'], ['sweat', '😅'], ['fire', '🔥'], ['think', '🤔']]) {
        const b = el('button', '', t); b.onclick = () => this.h.emote(id); this.emoteBar.append(b);
      }
      this.root.append(this.emoteBar);
    }
    this.emoteBar.classList.toggle('hidden', !v);
  }
  showEmote(text: string, mine: boolean) {
    const e = el('div', 'emote ' + (mine ? 'mine' : 'theirs'));
    e.textContent = text;
    this.root.append(e);
    setTimeout(() => e.remove(), 2200);
  }
  private replayBar: HTMLElement | null = null;
  showReplayBar(v: boolean, onClose?: () => void) {
    if (!this.replayBar) {
      this.replayBar = el('div', 'panel replaybar');
      for (const x of [0.25, 0.5, 1]) { const b = el('button', '', `${x}×`); b.onclick = () => this.h.replaySpeed(x); this.replayBar.append(b); }
      const close = el('button', 'primary', '리플레이 종료'); close.onclick = () => this.replayClose?.();
      this.replayBar.append(close);
      this.root.append(this.replayBar);
    }
    this.replayClose = onClose ?? null;
    this.replayBar.classList.toggle('hidden', !v);
  }
  private replayClose: (() => void) | null = null;
  /** 포토 모드: UI 전부 숨기고 탭하면 복귀 */
  setPhotoMode(on: boolean) {
    this.root.classList.toggle('photo', on);
    if (on) this.toast('포토 모드 — 화면을 탭/클릭하면 PNG 저장 · Esc 로 종료', '', 2500);
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
