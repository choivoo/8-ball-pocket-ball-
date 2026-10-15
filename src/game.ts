import GUI from 'lil-gui';
import { TABLE, HEAD_X, FOOT_X } from './config/table';
import { defaultPhysics, clonePhysics } from './config/physics';
import { saveSettings, isMobile, defaultSettings, type Settings } from './config/settings';
import { World } from './physics/world';
import type { Ball, Shot } from './physics/types';
import { SCENARIOS, SCENE_SETUPS } from './physics/scenarios';
import { EightBall } from './game-rules/eightBall';
import { NineBall } from './game-rules/nineBall';
import { Algakki, BLACK, WHITE } from './game-rules/algakki';
import { AlgakkiAI } from './ai/algakkiAi';
import { Profile, levelFromXp } from './meta/profile';
import { launchConfetti } from './ui/confetti';
import { buildDrills, placeCfg, starsFor, freeSpot, type DrillDef, type DrillCfg } from './drills/drills';
import { ShotRecorder } from './game-rules/report';
import type { RuleSet, RuleState, PlayerIdx } from './game-rules/RuleSet';
import { groupOf } from './game-rules/RuleSet';
import { GameView } from './rendering/view';
import { computeAim } from './rendering/aimGuide';
import { Controls } from './input/controls';
import { AudioEngine } from './audio/engine';
import { UI } from './ui/ui';
import { PoolAI, type AiLevel, AI_LEVEL_NAMES } from './ai/ai';
import { OnlineSession, type NetMsg, type BallFull, type BallLite } from './net/online';

const R = TABLE.ballRadius;
type Mode = 'practice' | 'local' | 'ai' | 'online' | 'lab' | 'drill';
type Phase = 'menu' | 'placing' | 'aiming' | 'shooting' | 'simulating' | 'thinking' | 'remote' | 'replay' | 'over' | 'lab';

const EMOTES: Record<string, string> = { gg: 'GG', up: '👍', smile: '😀', sweat: '😅', fire: '🔥', think: '🤔' };
interface Match { rules: 'eight' | 'nine' | 'algakki'; raceTo: number; clock: number }
type Rps = 'rock' | 'paper' | 'scissors';
interface ShotRecord { before: Ball[]; shot: Shot; rng: number; shooter: PlayerIdx; ballId: number }

export class Game {
  rules: RuleSet = EightBall;
  world: World;
  view: GameView;
  audio = new AudioEngine();
  ui: UI;
  controls: Controls;
  state: RuleState = EightBall.init();
  mode: Mode = 'practice';
  phase: Phase = 'menu';
  names: [string, string] = ['플레이어', ''];
  subs: [string, string] = ['', ''];
  ai: PoolAI | null = null;
  aiLevel: AiLevel = 1;
  net: OnlineSession | null = null;
  mySeat: PlayerIdx = 0;
  firstTurn: PlayerIdx = 0;
  recorder = new ShotRecorder();
  lastShot: ShotRecord | null = null;
  lastAfter: Ball[] | null = null;
  private remoteShot = false;
  private pendingResult: Extract<NetMsg, { t: 'result' }> | null = null;
  private placePos = { x: HEAD_X, y: 0 };
  private placeValid = true;
  private shootAnim: { t: number; dur: number; from: number; shot: Shot; auto: boolean } | null = null;
  private followThrough = 0;
  private settleTimer = 0;
  private gaugePower = 0;
  private gaugeActive = false;
  private editing = false;
  private editBall = -1;
  private cine: { until: number; x: number; y: number; prevMode: string } | null = null;
  private cineCooldown = 0;
  private timeScale = 1;
  private aiAnim: { stage: 'aim' | 'pull' | 'wait'; t: number; shot: Shot; fromAngle: number } | null = null;
  private aiBusy = false;
  private replayRestore: (() => void) | null = null;
  private lastAimSend = 0;
  private remoteAim = { angle: 0, elev: 0, a: 0, b: 0, pull: 0 };
  private gui: GUI | null = null;
  private fpsAcc = 0; private fpsN = 0; private fps = 0;
  private visibleCuePull = 0;
  private roll = { sum: 0, n: 0 };
  private labShotPending: Shot | null = null;
  private labTimer = 0;
  private paused = false;
  profile = new Profile();
  match: Match = { rules: 'eight', raceTo: 1, clock: 0 };
  score: [number, number] = [0, 0];
  private matchOver = false;
  private clockLeft: number | null = null;
  private lastTickSec = -1;
  private run = 0;
  private gameFouls = 0;
  private maxDeficit = 0;
  private photo = false;
  private replaySpeed = 1;
  private lastBuzz = 0;
  private slowTime = 0;
  private profileSave = 0;
  private sawAir = false;
  private drills: DrillDef[] = buildDrills();
  private drill: { def: DrillDef; idx: number; points: number; cfg: DrillCfg | null } | null = null;
  private contactPos: { x: number; y: number } | null = null;
  private cue0 = { x: 0, y: 0 };
  private tutStep = -1;
  private blackSeat: PlayerIdx = 0;
  private algAI: AlgakkiAI | null = null;
  private rpsToken = 0;
  private rpsInbox: { commit: string[]; reveal: { c: string; salt: string }[] } = { commit: [], reveal: [] };
  private rpsWaiters: (() => void)[] = [];
  private drillNeedSetup = false;
  private timers: number[] = [];
  /** 지연 실행 (게임이 바뀌면 취소되어 이전 게임의 팝업이 새 게임 위에 뜨지 않는다) */
  private later(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }
  private clearTimers() { for (const t of this.timers) clearTimeout(t); this.timers = []; }

  constructor(canvas: HTMLCanvasElement, public settings: Settings, root: HTMLElement) {
    this.world = new World(clonePhysics(defaultPhysics));
    this.view = new GameView(canvas, settings.quality);
    this.audio.settings = { master: settings.master, sfx: settings.sfx, ambience: settings.ambience, ambienceOn: settings.ambienceOn, musicOn: settings.musicOn, music: settings.music };
    this.world.listeners.push((e) => { this.audio.handle(e); this.onPhysEvent(e); });
    this.ui = new UI(root, settings, {
      startPractice: () => this.startPractice(),
      startLocal: (a, b) => this.startLocal(a, b),
      startAI: (l, n) => this.startAI(l, n),
      hostOnline: (n) => this.hostOnline(n),
      joinOnline: (c, n) => this.joinOnline(c, n),
      cancelOnline: () => this.closeNet(),
      openLab: () => this.openLab(),
      runScene: (k) => this.runScene(k),
      resume: () => { this.paused = false; },
      quitToMenu: () => this.quitToMenu(),
      rematch: () => this.rematch(),
      replay: () => this.startReplay(),
      toggleTop: () => this.toggleTop(),
      settingsChanged: () => this.applySettings(),
      placeConfirm: () => this.confirmPlace(),
      setHit: (a, b) => { this.controls.aim.a = a; this.controls.aim.b = b; },
      elevDelta: (d) => { this.controls.changeElevation(d); },
      gauge: (p, v) => this.onGauge(p, v),
      togglePracticeEdit: () => this.toggleEdit(),
      rerack: () => this.rerack(),
      toggleDebug: () => this.toggleDebug(),
      openProfile: () => this.ui.showProfile(),
      openCustomize: () => this.ui.showCustomize(levelFromXp(this.profile.stats.xp).level),
      openDrills: () => this.openDrills(),
      startDrill: (id) => this.startDrill(id),
      openHelp: () => { this.ui.showHelp(); if (this.ui.inGame && this.mode !== 'online') this.paused = true; },
      startTutorial: () => this.startTutorial(),
      photoMode: () => this.togglePhoto(),
      fullscreen: () => this.toggleFullscreen(),
      emote: (id) => this.sendEmote(id),
      replaySpeed: (x) => { this.replaySpeed = x; },
      camPreset: (n) => { this.view.rig.mode = n; },
      lookChanged: (look) => { this.settings.look = look; saveSettings(this.settings); this.view.applyLook(look); },
      nextGame: () => this.startFollowup((Date.now() & 0xffff) + 1, true),
      resetSettings: () => { const keep = { playerName: this.settings.playerName, tutorialDone: this.settings.tutorialDone, look: this.settings.look }; Object.assign(this.settings, defaultSettings, keep); this.applySettings(); this.view.applyLook(this.settings.look); },
    });
    this.ui.profile = this.profile;
    this.profile.onUnlock = (a) => { this.ui.toast(`🏆 업적 달성: ${a.name}  (+${a.xp} XP)`, 'good', 3800); this.audio.chime(true); };
    this.profile.onLevelUp = (lv) => this.ui.toast(`⭐ 레벨 ${lv} 달성!`, 'good', 3800);
    this.view.applyLook(this.settings.look);
    this.applySettings();
    canvas.addEventListener('click', () => { if (this.photo) this.savePhoto(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { this.profile.save(); if (this.mode !== 'online' && this.phase !== 'menu' && !this.ui.menuOpen) this.pause(); }
    });
    this.controls = new Controls(canvas, this.view, () => this.settings);
    this.controls.onFire = (V) => this.fireStroke(V);
    this.controls.onPlaceMove = (x, y) => this.movePlace(x, y);
    this.controls.onPlaceClick = (x, y) => { this.movePlace(x, y); this.confirmPlace(); };
    this.controls.onEditPointer = (t, x, y) => this.editPointer(t, x, y);
    this.controls.onAimChanged = () => this.onAimChanged();
    this.controls.onToggleTop = () => this.toggleTop();
    this.controls.onPause = () => { if (this.photo) this.togglePhoto(); else this.pause(); };
    this.controls.onHelp = () => { if (!this.ui.menuOpen) this.ui.showHelp(); };
    this.controls.onFullscreen = () => this.toggleFullscreen();
    this.controls.onPhoto = () => this.togglePhoto();
    this.controls.onReplay = () => this.startReplay();
    this.controls.onConfirm = () => (this.phase === 'lab' ? this.labRerun() : this.confirmPlace());
    window.addEventListener('pointerdown', () => { this.audio.init(); this.audio.apply(); }, { capture: true });
    this.controls.onUserInteract = () => { this.audio.init(); this.audio.apply(); };
    this.resetTable(1);
    this.ui.showMenu();
    window.addEventListener('resize', () => this.view.resize());
    if (new URLSearchParams(location.search).has('debug')) this.toggleDebug();
  }

  // ================================================================== 시작/종료
  private resetTable(seed: number) {
    this.rules.setupRack(this.world, seed);
    this.world.rng.state = seed * 7919 + 13;
    this.state = this.rules.init();
    this.state.turn = this.firstTurn;
    this.lastShot = null; this.lastAfter = null;
    this.remoteShot = false; this.pendingResult = null;
  }

  /** 지금 샷을 치는 공 번호 (일반: 큐볼 0, 알까기: 차례인 플레이어의 공) */
  private get activeId(): number { return this.state.ballOf ? this.state.ballOf[this.state.turn] : 0; }
  private get cueBall(): Ball { return this.world.balls[this.activeId]; }

  private matchFromSettings(): Match {
    return { rules: this.settings.rules, raceTo: Math.max(1, this.settings.raceTo), clock: this.settings.shotClock };
  }

  private beginGame(mode: Mode, names: [string, string], subs: [string, string], seed: number, match?: Match, keepScore = false) {
    this.clearTimers();
    this.match = match ? { ...match } : this.matchFromSettings();
    if (mode === 'practice' || mode === 'drill') this.match = { ...this.match, raceTo: 1, clock: 0 };
    if (mode === 'practice' && this.match.rules === 'algakki') this.match = { ...this.match, rules: 'eight' };
    this.rules = this.match.rules === 'nine' ? NineBall : this.match.rules === 'algakki' ? Algakki : EightBall;
    if (this.ai) this.ai = new PoolAI(this.world.cfg, this.aiLevel, this.rules);
    this.algAI = mode === 'ai' && this.rules === Algakki ? new AlgakkiAI(this.world.cfg, this.aiLevel) : null;
    if (!keepScore) this.score = [0, 0];
    this.matchOver = false;
    this.run = 0; this.gameFouls = 0; this.maxDeficit = 0;
    this.ui.inGame = true;
    this.ui.setScore(this.score, this.match.raceTo);
    this.ui.setOnlineTools(mode === 'online');
    this.ui.setDrillHud(null);
    this.mode = mode;
    this.names = names; this.subs = subs;
    this.ui.closeOverlay();
    this.ui.setGameUiVisible(true);
    this.ui.setPracticeTools(mode === 'practice');
    this.ui.showReplayBar(false);
    this.editing = false; this.controls.editing = false; this.ui.setEditActive(false);
    this.firstTurn = this.rules === Algakki ? this.blackSeat : this.firstTurn;
    this.resetTable(seed);
    if (this.rules === Algakki) this.state.ballOf = this.blackSeat === 0 ? [BLACK, WHITE] : [WHITE, BLACK];
    this.view.setTargetRing(null);
    if (mode === 'drill' && this.drill) { this.state = EightBall.init(); this.setupDrillAttempt(); }
    this.view.syncBalls(this.world.balls, this.world.time);
    this.paused = false;
    this.view.rig.distance = 1.15; this.view.rig.pitch = 0.42;
    this.refreshHud();
    this.beginTurn();
  }

  private startPractice(tutorial = false) {
    this.ai = null; this.net = null; this.firstTurn = 0;
    this.drill = null;
    this.beginGame('practice', [this.settings.playerName, ''], ['', ''], (Date.now() & 0xffff) + 1);
    if (tutorial || !this.settings.tutorialDone) { this.tutStep = 0; this.showTutStep(); }
    else this.ui.toast('연습 모드 — ✋로 공을 자유롭게 옮길 수 있어요', '');
  }
  private startLocal(a: string, b: string) {
    this.ai = null; this.net = null;
    const seed = (Date.now() & 0xffff) + 1;
    if (this.settings.rules === 'algakki') { void this.algakkiStart('local', [a, b], ['', ''], seed, this.matchFromSettings()); return; }
    this.beginGame('local', [a, b], ['', ''], seed);
  }
  private startAI(level: AiLevel, name: string) {
    this.aiLevel = level;
    this.ai = new PoolAI(this.world.cfg, level, this.rules);
    this.net = null; this.firstTurn = 0;
    const seed = (Date.now() & 0xffff) + 1;
    if (this.settings.rules === 'algakki') { void this.algakkiStart('ai', [name, `AI ${AI_LEVEL_NAMES[level]}`], ['', ''], seed, this.matchFromSettings()); return; }
    this.beginGame('ai', [name, `AI ${AI_LEVEL_NAMES[level]}`], ['', ''], seed);
  }
  private quitToMenu() {
    this.rpsToken++; this.flushRps();
    this.clearTimers();
    this.closeNet();
    this.drill = null; this.ui.setDrillHud(null); this.ui.setClock(null); this.ui.inGame = false; this.ui.coach(null); this.tutStep = -1;
    this.view.setTargetRing(null); this.ui.showReplayBar(false); this.ui.setOnlineTools(false);
    this.phase = 'menu';
    this.aiBusy = false; this.aiAnim = null; this.shootAnim = null;
    this.controls.enabled = false; this.controls.placing = false;
    this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
    this.view.aim.hide(); this.view.setGhostBall(null);
    this.view.rig.mode = 'aim';
    this.ui.showMenu();
  }
  private rematch() {
    if (this.mode === 'drill') { this.retryDrill(); return; }
    const seed = (Date.now() & 0xffff) + 1;
    if (this.mode === 'online' && this.net) this.net.send({ t: 'rematch', seed });
    this.startFollowup(seed, false);
  }

  /** 다음 게임(매치 진행 중이면 점수 유지) 또는 새 매치 시작. 온라인에서는 양쪽이 같은 규칙으로 호출된다 */
  private startFollowup(seed: number, announce: boolean) {
    const keep = !this.matchOver && this.match.raceTo > 1;
    this.firstTurn = this.mode === 'practice' ? 0 : (this.firstTurn === 0 ? 1 : 0);
    if (this.match.rules === 'algakki') this.blackSeat = this.blackSeat === 0 ? 1 : 0; // 알까기: 판마다 검은 공(선공)을 교대
    if (announce && this.mode === 'online' && this.net) this.net.send({ t: 'rematch', seed });
    this.beginGame(this.mode, this.names, this.subs, seed, this.match, keep);
  }
  private rerack() {
    this.state = this.rules.init(); this.state.turn = 0;
    this.rules.setupRack(this.world, (Date.now() & 0xffff) + 1);
    this.refreshHud();
    this.beginTurn();
  }

  // ================================================================== 온라인
  private closeNet() {
    if (this.net) { this.net.onClose = () => {}; this.net.close(); this.net = null; }
  }
  private async hostOnline(name: string): Promise<string> {
    this.closeNet();
    this.settings.playerName = name; saveSettings(this.settings);
    const net = new OnlineSession();
    this.net = net;
    const code = await net.host();
    let guestName = '친구';
    net.onMessage = (m) => {
      if (m.t === 'hello') {
        guestName = m.name;
        const seed = (Date.now() & 0xffff) + 1;
        const mc = this.matchFromSettings();
        net.send({ t: 'start', seed, hostName: name, rules: mc.rules, raceTo: mc.raceTo, clock: mc.clock });
        this.mySeat = 0; this.firstTurn = 0;
        this.ai = null;
        this.bindNetGame(net);
        if (mc.rules === 'algakki') void this.algakkiStart('online', [name, guestName], ['나', '상대'], seed, mc);
        else this.beginGame('online', [name, guestName], ['나', '상대'], seed, mc);
      }
    };
    net.onClose = () => this.onNetClosed();
    return code;
  }
  private async joinOnline(code: string, name: string) {
    this.closeNet();
    this.settings.playerName = name; saveSettings(this.settings);
    const net = new OnlineSession();
    this.net = net;
    net.onMessage = (m) => {
      if (m.t === 'start') {
        this.mySeat = 1; this.firstTurn = 0; this.ai = null;
        this.bindNetGame(net);
        const mc: Match = { rules: m.rules, raceTo: m.raceTo, clock: m.clock };
        if (mc.rules === 'algakki') void this.algakkiStart('online', [m.hostName, name], ['상대', '나'], m.seed, mc);
        else this.beginGame('online', [m.hostName, name], ['상대', '나'], m.seed, mc);
      }
    };
    net.onClose = () => this.onNetClosed();
    await net.join(code);
    net.send({ t: 'hello', name });
    this.ui.showWaiting('호스트의 시작을 기다리는 중...', () => this.closeNet());
  }
  private bindNetGame(net: OnlineSession) {
    net.onMessage = (m) => this.onNetMessage(m);
    net.onStatus = (st) => this.ui.setNetStatus(st === 'online' ? null : '⚠ 연결 불안정 — 재연결 중... (메시지는 자동 재전송됩니다)');
  }
  private queuedShot: Extract<NetMsg, { t: 'shot' }> | null = null;
  private startRemoteShot(m: Extract<NetMsg, { t: 'shot' }>) {
    // 상대 샷: 정지 상태를 동기화한 뒤 같은 샷을 재현
    for (const b of m.balls) {
      const w = this.world.balls[b.id];
      w.x = b.x; w.y = b.y; w.pocketed = b.pocketed; w.pocketIndex = b.pocketIndex;
      w.vx = w.vy = w.vz = w.wx = w.wy = w.wz = 0; w.z = 0;
    }
    if (this.state.game !== 'algakki') this.world.balls[0].pocketed = false;
    this.world.rng.state = m.rng;
    this.remoteShot = true;
    this.pendingResult = this.pendingResult && this.pendingResult.rules.shots > m.no ? this.pendingResult : null;
    this.waitingRemote = false;
    this.lastShot = { before: this.world.snapshot(), shot: m.shot, rng: m.rng, shooter: this.state.turn, ballId: this.activeId };
    this.shootAnim = { t: 0, dur: 0.45, from: 0.12 + Math.min(0.25, m.shot.speed * 0.03), shot: m.shot, auto: true };
    this.phase = 'shooting';
    this.controls.enabled = false;
    this.view.aim.hide();
  }

  /** 상대와 상태가 어긋났을 때 전체 상태로 강제 동기화 */
  private applyFullState(rules: RuleState, balls: BallFull[]) {
    for (const f of balls) Object.assign(this.world.balls[f.id], f);
    this.state = rules;
    this.remoteShot = false; this.pendingResult = null; this.waitingRemote = false; this.afterEvalPending = false;
    this.world.idle(0);
    this.beginTurn();
  }

  private onNetClosed() {
    if (this.phase === 'menu') return;
    this.net = null;
    this.phase = 'over';
    this.controls.enabled = false;
    this.ui.showInfo('연결 끊김', '상대와의 연결이 끊어졌습니다.', '메인 메뉴', () => this.quitToMenu());
  }
  private lite(): BallLite[] {
    return this.world.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, pocketed: b.pocketed, pocketIndex: b.pocketIndex }));
  }
  private full(): BallFull[] {
    return this.world.balls.map((b) => ({ ...b }));
  }
  private onNetMessage(m: NetMsg) {
    switch (m.t) {
      case 'aim':
        this.remoteAim = { angle: m.angle, elev: m.elev, a: m.a, b: m.b, pull: m.pull };
        if (m.bih && this.phase === 'remote' && this.state.ballInHand) {
          this.world.balls[0].x = m.bih.x; this.world.balls[0].y = m.bih.y; this.world.balls[0].pocketed = false;
        }
        break;
      case 'shot':
        if (m.no < this.state.shots) break; // 이미 처리한 샷 (중복)
        if (this.phase === 'remote') this.startRemoteShot(m);
        else this.queuedShot = m; // 아직 이전 턴 정리 중 → 다음 beginTurn 에서 처리
        break;
      case 'need':
        this.net?.send({ t: 'state', rules: this.state, balls: this.full() });
        break;
      case 'state':
        if (m.rules.shots >= this.state.shots) this.applyFullState(m.rules, m.balls);
        break;
      case 'turnover':
        if (m.rules.shots >= this.state.shots) { this.applyFullState(m.rules, m.balls); this.ui.toast(m.text, 'foul', 3000); }
        break;
      case 'result':
        if (m.rules.shots <= this.state.shots) break; // 중복
        this.pendingResult = m;
        if (this.phase === 'simulating' && !this.world.isMoving()) this.applyRemoteResult();
        break;
      case 'rematch':
        this.ui.closeOverlay();
        this.startFollowup(m.seed, false);
        break;
      case 'emote':
        this.ui.showEmote(EMOTES[m.id] ?? '👍', false);
        break;
      case 'rps-commit':
        this.rpsInbox.commit.push(m.h); this.flushRps();
        break;
      case 'rps-reveal':
        this.rpsInbox.reveal.push({ c: m.c, salt: m.salt }); this.flushRps();
        break;
      case 'quit':
        this.onNetClosed();
        break;
    }
  }

  // ================================================================== 턴 관리
  private controller(turn: PlayerIdx): 'human' | 'ai' | 'remote' {
    if (this.mode === 'ai') return turn === 0 ? 'human' : 'ai';
    if (this.mode === 'online') return turn === this.mySeat ? 'human' : 'remote';
    return 'human';
  }

  private onTableIds(): number[] {
    return this.world.balls.filter((b) => !b.pocketed && b.id !== 0).map((b) => b.id);
  }

  private refreshHud() {
    const on = this.onTableIds();
    this.ui.setScore(this.score, this.match.raceTo);
    this.ui.setPlayers(this.state, this.names, this.subs, on);
    if (this.state.game === 'eightball' && this.state.groups[0]) {
      const me = this.mode === 'online' ? this.mySeat : 0;
      const left = (g: 'solid' | 'stripe' | null) => on.filter((id) => id !== 8 && groupOf(id) === g).length;
      this.maxDeficit = Math.max(this.maxDeficit, left(this.state.groups[me]) - left(this.state.groups[me === 0 ? 1 : 0]));
    }
  }

  private beginTurn() {
    if (this.drillNeedSetup && this.drill) { this.drillNeedSetup = false; this.setupDrillAttempt(); }
    if (this.state.winner !== null) { this.finishGame(); return; }
    this.refreshHud();
    this.view.setGhostBall(null);
    this.controls.cancel();
    this.shootAnim = null; this.aiAnim = null; this.followThrough = 0;
    this.gaugeActive = false; this.gaugePower = 0; this.ui.setPower(0);
    const who = this.controller(this.state.turn);
    const cue = this.cueBall;
    this.view.rig.mode = 'aim';
    this.cine = null; this.timeScale = 1;
    if (who === 'human') {
      if (this.state.ballInHand) this.startPlacing(); else this.startAiming();
    } else if (who === 'ai') {
      this.phase = 'thinking';
      this.controls.enabled = false;
      this.ui.showGauge(false); this.ui.setAimControlsVisible(false);
      this.ui.setStatus(`${this.names[this.state.turn]} 생각 중...`);
      void this.runAI();
    } else {
      this.phase = 'remote';
      this.controls.enabled = false; this.controls.placing = false;
      this.ui.showGauge(false); this.ui.setAimControlsVisible(false); this.ui.showPlaceBar(false);
      this.ui.setStatus(`${this.names[this.state.turn]}의 차례`);
      if (this.state.ballInHand) { cue.pocketed = false; cue.x = HEAD_X; cue.y = 0; }
      if (this.queuedShot) { const q = this.queuedShot; this.queuedShot = null; if (q.no >= this.state.shots) this.startRemoteShot(q); }
    }
    this.view.rig.setTargetPhys(cue.x, cue.y);
    this.view.rig.aimYaw = this.controls.aim.angle;
    // 샷 클락: AI 차례에는 없음. 온라인 상대 차례는 표시만 하고 상대 쪽에서 판정한다.
    this.clockLeft = this.match.clock > 0 && this.mode !== 'practice' && this.mode !== 'drill' && this.mode !== 'lab' && who !== 'ai' ? this.match.clock : null;
    this.lastTickSec = -1;
    if (this.clockLeft === null) this.ui.setClock(null);
  }

  private startAiming() {
    this.phase = 'aiming';
    const cue = this.cueBall;
    this.controls.enabled = true; this.controls.placing = false;
    this.ui.showPlaceBar(false);
    this.ui.setAimControlsVisible(true);
    const gauge = this.settings.control === 'gauge' || isMobile();
    this.ui.showGauge(gauge);
    // 기본 조준 방향: 가장 가까운 합법 공
    const targets = this.rules.legalTargets(this.state, [0, ...this.onTableIds()]);
    let best = -1, bd = 1e9;
    for (const t of targets) { const b = this.world.balls[t]; const d = Math.hypot(b.x - cue.x, b.y - cue.y); if (d < bd) { bd = d; best = t; } }
    if (best >= 0) this.controls.aim.angle = Math.atan2(this.world.balls[best].y - cue.y, this.world.balls[best].x - cue.x);
    this.controls.aim.elevation = 0;
    this.ui.setElevation(0);
    this.view.rig.aimYaw = this.controls.aim.angle;
    this.view.rig.distance = Math.min(1.8, Math.max(this.view.rig.distance, 0.8));
    this.view.rig.mode = 'aim';
    this.ui.setStatus(`${this.names[this.state.turn]}의 차례${this.state.ballInHand ? '' : ''}`);
    this.ui.setHint(gauge ? '드래그: 조준 · 오른쪽 게이지를 아래로 당겼다 놓으면 발사' : '드래그: 조준 · 우클릭(또는 Space) 누른 채 마우스를 아래로 당겼다 위로 밀면 발사 · Shift: 미세 조준');
    this.syncAimUi();
    if (this.mode !== 'practice' && this.mode !== 'drill') this.ui.toast(`${this.names[this.state.turn]}의 차례`, '', 1400);
  }

  private startPlacing() {
    this.phase = 'placing';
    const cue = this.world.balls[0];
    cue.pocketed = false;
    this.controls.enabled = false; this.controls.placing = true;
    this.ui.showGauge(false); this.ui.setAimControlsVisible(false);
    const head = this.state.inHandZone === 'head';
    this.placePos = { x: head ? HEAD_X : this.state.breakDone ? 0 : HEAD_X, y: 0 };
    this.fixPlace();
    cue.x = this.placePos.x; cue.y = this.placePos.y;
    this.view.rig.mode = 'top';
    this.ui.showPlaceBar(true);
    this.ui.setStatus(`${this.names[this.state.turn]}: 큐볼 배치 ${head ? '(헤드스트링 뒤)' : '(어디든)'}`);
    this.ui.setHint('마우스/터치로 큐볼을 옮기고 클릭 또는 Enter 로 확정');
    if (this.state.breakDone) this.ui.toast('볼 인 핸드 — 큐볼을 직접 놓으세요', 'good', 1800);
  }

  private fixPlace() {
    const head = this.state.inHandZone === 'head';
    const lx = TABLE.halfL - R * 1.05, ly = TABLE.halfW - R * 1.05;
    this.placePos.x = Math.max(-lx, Math.min(head ? HEAD_X : lx, this.placePos.x));
    this.placePos.y = Math.max(-ly, Math.min(ly, this.placePos.y));
    this.placeValid = true;
    for (const b of this.world.balls) {
      if (b.id === 0 || b.pocketed) continue;
      if (Math.hypot(b.x - this.placePos.x, b.y - this.placePos.y) < 2 * R * 1.001) { this.placeValid = false; break; }
    }
  }
  private movePlace(x: number, y: number) {
    if (this.phase !== 'placing') return;
    this.placePos = { x, y };
    this.fixPlace();
    const cue = this.world.balls[0];
    cue.x = this.placePos.x; cue.y = this.placePos.y;
    this.sendAim();
  }
  private confirmPlace() {
    if (this.phase !== 'placing') return;
    if (!this.placeValid) { this.ui.toast('다른 공과 겹칩니다', 'foul', 1000); return; }
    const cue = this.world.balls[0];
    cue.x = this.placePos.x; cue.y = this.placePos.y;
    this.ui.showPlaceBar(false);
    this.state.ballInHand = false;
    this.view.setGhostBall(null);
    this.startAiming();
    this.view.rig.snap();
  }

  private syncAimUi() {
    const a = this.controls.aim;
    this.ui.setHitPoint(a.a, a.b);
    this.ui.setElevation((a.elevation * 180) / Math.PI);
  }
  private onAimChanged() {
    this.view.rig.aimYaw = this.controls.aim.angle;
    this.syncAimUi();
  }

  // ================================================================== 샷
  private onGauge(phase: 'down' | 'move' | 'up', v: number) {
    if (this.phase !== 'aiming') return;
    if (phase === 'down') { this.gaugeActive = true; this.audio.init(); }
    if (!this.gaugeActive) return;
    this.gaugePower = v;
    this.ui.setPower(v);
    if (phase === 'up') {
      this.gaugeActive = false;
      if (v < 0.04) { this.gaugePower = 0; this.ui.setPower(0); return; }
      const V = Math.pow(v, 1.5) * this.world.cfg.maxCueSpeed;
      this.fireGauge(Math.max(0.3, V), v);
    }
  }

  private makeShot(V: number): Shot {
    const a = this.controls.aim;
    return { angle: a.angle, speed: V, a: a.a, b: a.b, elevation: a.elevation };
  }

  /** 스트로크 입력: 큐가 이미 공에 닿는 순간 */
  private fireStroke(V: number) {
    if (this.phase !== 'aiming') return;
    const shot = this.makeShot(Math.min(V, this.world.cfg.maxCueSpeed * 1.15));
    this.shootAnim = { t: 0, dur: 0.001, from: 0, shot, auto: false };
    this.phase = 'shooting';
    this.controls.enabled = false;
    this.ui.showGauge(false);
  }
  private fireGauge(V: number, power: number) {
    const shot = this.makeShot(Math.min(V, this.world.cfg.maxCueSpeed * 1.15));
    const from = 0.04 + 0.34 * power;
    const dur = Math.max(0.06, Math.min(0.45, from / (V * 0.8)));
    this.shootAnim = { t: 0, dur, from, shot, auto: false };
    this.phase = 'shooting';
    this.controls.enabled = false;
    this.ui.showGauge(false);
  }

  private doStrike(shot: Shot) {
    const w = this.world;
    this.audio.init();
    this.settleTimer = 0;
    if (!this.remoteShot && this.phase !== 'replay') {
      this.lastShot = { before: w.snapshot(), shot: { ...shot }, rng: w.rng.state, shooter: this.state.turn, ballId: this.activeId };
      if (this.net && this.mode === 'online') {
        this.net.send({ t: 'shot', shot, balls: this.lite(), rng: w.rng.state, no: this.state.shots });
      }
    }
    if (!this.remoteShot && this.phase !== 'replay') { this.recorder.attach(w); }
    w.strike({ ...shot, ball: this.activeId });
    this.settleHandled = false;
    this.sawAir = false;
    this.contactPos = null;
    this.cue0 = { x: this.cueBall.x, y: this.cueBall.y };
    this.strikeAt = w.time;
    this.view.rig.kick(Math.min(1, shot.speed / 6));
    this.followThrough = 1;
    this.phase = this.phase === 'replay' ? 'replay' : 'simulating';
    this.ui.setStatus('');
    this.view.aim.hide();
    this.applyShotCamera();
  }

  private applyShotCamera() {
    const mode = this.settings.cameraAfterShot;
    if (mode === 'top') this.view.rig.mode = 'top';
    else if (mode === 'follow') this.view.rig.mode = 'follow';
  }

  private onPhysEvent(e: import('./physics/types').PhysEvent) {
    if (e.type === 'cue') this.buzz(e.miscue ? [12, 20, 12] : 14);
    else if (e.type === 'ballBall' && e.speed > 1.5) this.buzz(8);
    else if (e.type === 'pocket') this.buzz([10, 30, 22]);
    if (e.type === 'land') this.sawAir = true;
    if (e.type === 'ballBall' && (e.a === 0 || e.b === 0) && !this.contactPos) this.contactPos = { x: this.world.balls[0].x, y: this.world.balls[0].y };
    if (e.type === 'cushion' || e.type === 'ballBall') {
      this.view.rig.kick(Math.min(0.4, e.speed * 0.05));
    }
    if (!this.settings.cinematic || this.phase === 'menu' || this.cineCooldown > 0) return;
    // 아슬아슬한 포켓: 낮은 속도로 포켓되거나, 포켓 입구 근처에서 jaw 에 부딪힘
    let trigger: { x: number; y: number } | null = null;
    if (e.type === 'pocket' && e.speed < 1.3 && e.id !== 0) {
      const p = this.world.geom.pockets[e.pocket]; trigger = { x: p.mx, y: p.my };
    } else if (e.type === 'pocket' && e.id === 8) {
      const p = this.world.geom.pockets[e.pocket]; trigger = { x: p.mx, y: p.my };
    } else if (e.type === 'jaw' && e.speed < 2.4) {
      const near = this.world.geom.pockets.find((p) => Math.hypot(p.mx - e.x, p.my - e.y) < 0.12);
      if (near) trigger = { x: near.mx, y: near.my };
    }
    if (trigger && (this.phase === 'simulating')) {
      this.cine = { until: performance.now() + 1500, x: trigger.x, y: trigger.y, prevMode: this.view.rig.mode };
      this.cineCooldown = 4;
    }
  }

  // ================================================================== 시뮬레이션 종료/규칙
  private onSettled() {
    const w = this.world;
    this.recorder.detach();
    this.lastAfter = w.snapshot();
    if (this.remoteShot) {
      this.remoteShot = false;
      this.phase = 'simulating';
      if (this.pendingResult) this.applyRemoteResult();
      else { this.ui.setStatus('상대의 결과를 기다리는 중...'); this.waitingRemote = true; }
      return;
    }
    const rep = this.recorder.report;
    if (this.mode === 'drill' && this.drill) { this.drillSettled(rep); return; }
    const res = this.rules.evaluate(this.state, rep);
    this.recordStats(rep, this.state, res);
    this.applyEvaluation(res.state, res.fouls, res.messages, res.respot);
    if (this.net && this.mode === 'online') {
      this.net.send({ t: 'result', rules: this.state, balls: this.full(), fouls: res.fouls, messages: res.messages, respot: res.respot });
    }
    this.afterEvaluation();
  }
  private waitingRemote = false;

  /** 내 샷의 결과를 프로필 통계/업적/XP 에 반영 */
  private recordStats(rep: import('./game-rules/RuleSet').ShotReport, before: RuleState, res: import('./game-rules/RuleSet').EvalResult) {
    const shooter = before.turn;
    if (this.mode === 'lab' || this.mode === 'drill' || this.state.game === 'algakki' || this.controller(shooter) !== 'human') return;
    const obj = rep.pocketed.filter((id) => id !== 0);
    const ls = this.lastShot;
    const shot = ls?.shot;
    this.gameFouls += res.fouls.length;
    const keepsTurn = !res.fouls.length && res.state.turn === shooter && res.state.winner === null;
    this.run = !res.fouls.length && obj.length > 0 ? this.run + obj.length : 0;
    let longest = 0, banks = 0;
    for (const id of obj) {
      const o0 = ls?.before[id], c0 = ls?.before[0];
      const pi = this.world.balls[id].pocketIndex;
      const pk = this.world.geom.pockets[pi];
      if (o0 && c0 && pk) longest = Math.max(longest, Math.hypot(c0.x - o0.x, c0.y - o0.y) + Math.hypot(o0.x - pk.mx, o0.y - pk.my));
      if (rep.railBalls.includes(id)) banks++;
    }
    void keepsTurn;
    const wasBreak = !before.breakDone;
    this.profile.update((s) => {
      s.shots++; s.pots += obj.length; s.fouls += res.fouls.length;
      if (rep.pocketed.includes(0)) s.scratches++;
      if (wasBreak) { s.breaks++; if (obj.length) s.breakPots++; }
      s.bestRun = Math.max(s.bestRun, this.run);
      s.longestPot = Math.max(s.longestPot, longest);
      s.bankPots += banks;
      if (shot && this.sawAir && shot.elevation > 0.5) s.jumps++;
      if (shot && shot.elevation > 0.35 && Math.abs(shot.a) > 0.25) s.massé++;
    });
    if (banks) this.ui.toast('🎯 뱅크샷!', 'good', 1600);
    else if (longest > 2) this.ui.toast('🎯 장거리 포켓!', 'good', 1600);
    if (this.run >= 3) this.ui.toast(`🔥 ${this.run}연속 포켓!`, 'good', 1600);
    if (obj.length) this.profile.addXp(obj.length * 5);
    this.profile.save();
  }

  private applyEvaluation(next: RuleState, fouls: string[], msgs: string[], respot: number | null) {
    const w = this.world;
    const prevTurn = this.state.turn;
    this.state = next;
    if (this.mode === 'practice') { this.state.turn = 0; if (this.state.winner !== null) { this.practiceCleared(); } }
    // 큐볼 스크래치: 큐볼 복귀 (볼 인 핸드)
    const cue = w.balls[0];
    if (this.state.game !== 'algakki' && (cue.pocketed || Math.abs(cue.x) > 5)) { cue.pocketed = false; cue.x = HEAD_X; cue.y = 0; cue.vx = cue.vy = 0; }
    if (respot !== null) this.respotBall(respot);
    for (const m of msgs) this.ui.toast(m, 'good', 2400);
    for (const f of fouls) this.ui.toast(f, 'foul', 3200);
    if (fouls.length) {
      this.audio.chime(false);
      if (this.mode !== 'practice') this.ui.toast(`파울 — ${this.names[this.state.turn]} 볼 인 핸드`, 'foul', 3200);
      else this.state.ballInHand = true;
    }
    void prevTurn;
  }

  private practiceCleared() {
    this.state.winner = null;
    this.ui.toast('8번 공 — 라운드 종료! 다시 랙합니다', 'good', 2500);
    this.later(() => { if (this.mode === 'practice' && this.phase !== 'menu') this.rerack(); }, 2600);
  }

  private respotBall(id: number) {
    const b = this.world.balls[id];
    b.pocketed = false; b.vx = b.vy = 0;
    let x = FOOT_X; const y = 0;
    const free = (xx: number) => this.world.balls.every((o) => o.id === id || o.pocketed || Math.hypot(o.x - xx, o.y - y) > 2.05 * R);
    while (!free(x) && x < TABLE.halfL - R * 1.5) x += R * 0.5;
    b.x = x; b.y = y;
  }

  private applyRemoteResult() {
    const m = this.pendingResult!;
    this.pendingResult = null; this.waitingRemote = false;
    for (const f of m.balls) Object.assign(this.world.balls[f.id], f);
    this.state = m.rules;
    for (const t of m.messages) this.ui.toast(t, 'good', 2400);
    for (const f of m.fouls) this.ui.toast(f, 'foul', 3200);
    if (m.fouls.length) this.audio.chime(false);
    this.afterEvaluation();
  }

  private afterEvaluation() {
    this.refreshHud();
    const delay = this.state.winner !== null ? 900 : 700;
    this.phase = 'simulating';
    this.settleTimer = -delay / 1000; // 잠깐 결과를 보여준 뒤 다음 턴
    this.afterEvalPending = true;
  }
  private afterEvalPending = false;

  private finishGame() {
    this.phase = 'over';
    this.controls.enabled = false;
    this.clockLeft = null; this.ui.setClock(null);
    this.ui.showGauge(false); this.ui.setAimControlsVisible(false); this.ui.showPlaceBar(false);
    this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
    const win = this.state.winner as PlayerIdx;
    const wn = this.names[win];
    let youWon: boolean | null = null;
    if (this.mode === 'ai') youWon = win === 0;
    if (this.mode === 'online') youWon = win === this.mySeat;
    this.score[win]++;
    this.matchOver = this.score[win] >= this.match.raceTo;
    this.ui.setScore(this.score, this.match.raceTo);
    this.refreshHud();
    let xp = 0;
    if (this.mode !== 'practice' && this.mode !== 'lab') {
      xp = 20 + (youWon ? 60 + (this.mode === 'ai' ? this.aiLevel * 30 : this.mode === 'online' ? 40 : 0) : 0) + (this.matchOver && this.match.raceTo > 1 && youWon ? 60 : 0);
      this.profile.update((s) => {
        s.games++;
        if (this.mode === 'online') { s.onlineGames++; if (youWon) s.onlineWins++; }
        if (this.state.game === 'algakki') { s.algakkiGames++; if (youWon) s.algakkiWins++; }
        if (youWon === true) { s.wins++; if (this.mode === 'ai') s.aiWins[this.aiLevel]++; if (this.gameFouls === 0) s.achievements['_clean'] = Date.now(); if (this.maxDeficit >= 3) s.achievements['_comeback'] = Date.now(); }
        else if (youWon === false) s.losses++;
      });
      this.profile.addXp(xp);
      this.profile.save();
    }
    this.audio.chime(youWon !== false);
    if (youWon !== false) { this.audio.fanfare(); launchConfetti(); }
    this.buzz([30, 40, 60]);
    this.view.rig.mode = 'top';
    const match = { score: [...this.score] as [number, number], raceTo: this.match.raceTo, names: this.names, matchOver: this.matchOver, xp };
    this.later(() => this.ui.showResult(wn, this.state.endReason, youWon, this.state.shots, match), 900);
  }

  // ================================================================== AI
  private async runAI() {
    if (this.aiBusy || !this.ai) return;
    if (this.algAI) { await this.runAlgakkiAI(); return; }
    this.aiBusy = true;
    const turnAtStart = this.state.turn;
    const w = this.world;
    await new Promise((r) => setTimeout(r, 500));
    if (this.phase !== 'thinking') { this.aiBusy = false; return; }
    if (this.state.ballInHand) {
      const pos = this.ai.chooseCuePosition(w, this.state, this.state.inHandZone);
      const cue = w.balls[0];
      cue.pocketed = false; cue.x = pos.x; cue.y = pos.y;
      this.state.ballInHand = false;
      this.view.rig.setTargetPhys(cue.x, cue.y);
    }
    const cue = w.balls[0];
    let shot: Shot;
    try {
      shot = await this.ai.chooseShot(w, this.state, { x: cue.x, y: cue.y });
    } catch (err) {
      console.error(err);
      shot = { angle: Math.random() * 6.28, speed: 2, a: 0, b: 0, elevation: 0 };
    }
    this.aiBusy = false;
    if (this.phase !== 'thinking' || this.state.turn !== turnAtStart) return;
    this.controls.aim.angle = Math.atan2(Math.sin(this.controls.aim.angle), Math.cos(this.controls.aim.angle));
    this.aiAnim = { stage: 'aim', t: 0, shot, fromAngle: this.controls.aim.angle };
    this.ui.setStatus(`${this.names[this.state.turn]} 조준 중...`);
    this.controls.aim.a = shot.a; this.controls.aim.b = shot.b;
  }

  // ================================================================== 알까기 / 가위바위보
  private flushRps() { const w = this.rpsWaiters; this.rpsWaiters = []; for (const f of w) f(); }
  private async rpsWait<T>(get: () => T | undefined): Promise<T> {
    for (;;) {
      const v = get();
      if (v !== undefined) return v;
      await new Promise<void>((r) => this.rpsWaiters.push(r));
    }
  }
  private static async hash(text: string): Promise<string> {
    try {
      if (crypto?.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch { /* 폴백 */ }
    let h = 2166136261; // FNV-1a (보안 컨텍스트가 아닐 때만)
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  private static rpsJudge(a: Rps, b: Rps): 0 | 1 | 2 {
    if (a === b) return 0;
    return (a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock') ? 1 : 2;
  }

  /** 가위바위보로 검은 공(선공)을 가질 좌석을 정한다. 비기면 다시. 취소되면 null */
  private async runRps(mode: Mode, names: [string, string]): Promise<PlayerIdx | null> {
    const token = this.rpsToken;
    const cancelled = () => token !== this.rpsToken;
    const picks: Rps[] = ['rock', 'paper', 'scissors'];
    this.rpsInbox = { commit: [], reveal: [] };
    for (;;) {
      let c0: Rps, c1: Rps;
      if (mode === 'local') {
        c0 = await this.ui.askRps(`${names[0]} 차례`, '상대가 보지 않게 선택하세요');
        if (cancelled()) return null;
        c1 = await this.ui.askRps(`${names[1]} 차례`, '이제 상대가 선택하세요');
      } else if (mode === 'ai') {
        c0 = await this.ui.askRps('가위바위보', '이긴 사람이 <b>검은 공(선공)</b>을 가집니다');
        c1 = picks[Math.floor(Math.random() * 3)];
      } else {
        const me = await this.ui.askRps('가위바위보', '이긴 사람이 <b>검은 공(선공)</b>을 가집니다');
        if (cancelled() || !this.net) return null;
        const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
        const h = await Game.hash(`${me}:${salt}`);
        this.net.send({ t: 'rps-commit', h });
        this.ui.showWait('상대의 선택을 기다리는 중');
        const peerHash = await this.rpsWait(() => this.rpsInbox.commit.shift());
        if (cancelled() || !this.net) return null;
        this.net.send({ t: 'rps-reveal', c: me, salt });
        const rev = await this.rpsWait(() => this.rpsInbox.reveal.shift());
        if (cancelled()) return null;
        if (!picks.includes(rev.c as Rps) || (await Game.hash(`${rev.c}:${rev.salt}`)) !== peerHash) {
          this.ui.showInfo('부정 행위 감지', '상대의 선택이 사전에 보낸 값과 달라 대결을 중단합니다.', '메인 메뉴', () => this.quitToMenu());
          return null;
        }
        const peer = rev.c as Rps;
        c0 = this.mySeat === 0 ? me : peer;
        c1 = this.mySeat === 0 ? peer : me;
      }
      if (cancelled()) return null;
      const r = Game.rpsJudge(c0, c1);
      const win: PlayerIdx | null = r === 0 ? null : r === 1 ? 0 : 1;
      await this.ui.revealRps({ name: names[0], pick: c0 }, { name: names[1], pick: c1 }, win === null ? '비겼어요! 다시 한 번' : `${names[win]} 승! ⚫ 검은 공 · 선공`);
      if (cancelled()) return null;
      if (win !== null) return win;
    }
  }

  private async algakkiStart(mode: Mode, names: [string, string], subs: [string, string], seed: number, match: Match) {
    const token = ++this.rpsToken;
    this.ui.closeOverlay();
    const winner = await this.runRps(mode, names);
    if (winner === null || token !== this.rpsToken) return;
    this.blackSeat = winner;
    this.beginGame(mode, names, subs, seed, match);
    this.ui.toast(`⚫ ${names[winner]}: 검은 공 · 선공`, 'good', 2600);
  }

  private async runAlgakkiAI() {
    if (this.aiBusy || !this.algAI) return;
    this.aiBusy = true;
    const turnAtStart = this.state.turn;
    await new Promise((r) => setTimeout(r, 500));
    if (this.phase !== 'thinking') { this.aiBusy = false; return; }
    const me = this.state.ballOf![turnAtStart], opp = this.state.ballOf![turnAtStart === 0 ? 1 : 0];
    let shot: Shot;
    try { shot = await this.algAI.chooseShot(this.world, me, opp); }
    catch (err) { console.error(err); const m = this.world.balls[me], o = this.world.balls[opp]; shot = { angle: Math.atan2(o.y - m.y, o.x - m.x), speed: 3, a: 0, b: 0, elevation: 0 }; }
    this.aiBusy = false;
    if (this.phase !== 'thinking' || this.state.turn !== turnAtStart) return;
    this.controls.aim.angle = Math.atan2(Math.sin(this.controls.aim.angle), Math.cos(this.controls.aim.angle));
    this.aiAnim = { stage: 'aim', t: 0, shot, fromAngle: this.controls.aim.angle };
    this.ui.setStatus(`${this.names[this.state.turn]} 조준 중...`);
    this.controls.aim.a = shot.a; this.controls.aim.b = shot.b;
  }

  // ================================================================== 리플레이
  private startReplay() {
    if (!this.lastShot || this.ui.menuOpen && this.phase !== 'over') return;
    if (!['aiming', 'placing', 'over', 'remote'].includes(this.phase)) return;
    const prev = this.phase;
    const restoreSnap = this.world.snapshot();
    const restoreTime = this.world.time;
    const wasEnabled = this.controls.enabled;
    this.ui.closeOverlay();
    this.phase = 'replay';
    this.controls.enabled = false; this.controls.placing = false;
    this.ui.showGauge(false); this.ui.showPlaceBar(false);
    this.view.aim.hide();
    const ls = this.lastShot;
    this.world.restore(ls.before);
    this.world.rng.state = ls.rng;
    this.view.rig.mode = this.settings.cameraAfterShot === 'follow' ? 'follow' : 'top';
    this.ui.setStatus('리플레이');
    this.ui.toast('리플레이', '', 1000);
    this.replaySettle = 0;
    this.replayStrikeIn = 0.8;
    this.replayRestore = () => {
      this.world.restore(restoreSnap);
      void restoreTime;
      this.phase = prev;
      this.controls.enabled = wasEnabled;
      this.controls.placing = prev === 'placing';
      this.view.rig.mode = 'aim';
      this.ui.setStatus('');
      if (prev === 'aiming') { this.ui.showGauge(this.settings.control === 'gauge' || isMobile()); }
      if (prev === 'placing') this.ui.showPlaceBar(true);
      if (prev === 'over') this.ui.showResult(this.names[this.state.winner as number], this.state.endReason, null, this.state.shots);
      this.refreshHud();
    };
  }
  private replaySettle = 0;
  private replayStrikeIn = 0;

  // ================================================================== 카메라/배치/연습
  private toggleTop() {
    const r = this.view.rig;
    if (['aiming', 'placing'].includes(this.phase)) {
      r.mode = r.mode === 'top' ? 'aim' : 'top';
    } else {
      r.mode = r.mode === 'top' ? 'follow' : 'top';
    }
  }
  private toggleEdit() {
    if (this.mode !== 'practice') return;
    this.editing = !this.editing;
    this.controls.editing = this.editing;
    this.ui.setEditActive(this.editing);
    this.ui.toast(this.editing ? '공을 드래그해 배치하세요' : '배치 모드 종료', '', 1400);
  }
  private editPointer(type: 'down' | 'move' | 'up', x: number, y: number): boolean {
    if (!this.editing || !['aiming', 'placing'].includes(this.phase)) return false;
    const w = this.world;
    if (type === 'down') {
      let best = -1, bd = 1.6 * R;
      for (const b of w.balls) { if (b.pocketed) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b.id; } }
      this.editBall = best;
      return best >= 0;
    }
    if (this.editBall < 0) return false;
    const b = w.balls[this.editBall];
    if (type === 'move') {
      const lx = TABLE.halfL - R * 1.05, ly = TABLE.halfW - R * 1.05;
      const nx = Math.max(-lx, Math.min(lx, x)), ny = Math.max(-ly, Math.min(ly, y));
      let ok = true;
      for (const o of w.balls) if (o.id !== b.id && !o.pocketed && Math.hypot(o.x - nx, o.y - ny) < 2 * R) { ok = false; break; }
      if (ok) { b.x = nx; b.y = ny; b.vx = b.vy = 0; }
      if (b.id === 0) { this.view.rig.setTargetPhys(b.x, b.y); }
    } else this.editBall = -1;
    return true;
  }

  private pause() {
    if (this.phase === 'menu' || this.ui.menuOpen) return;
    if (this.mode !== 'online') this.paused = true; // 온라인에서는 시간이 멈추지 않는다
    this.ui.showPause();
  }

  private applySettings() {
    saveSettings(this.settings);
    this.audio.settings = { master: this.settings.master, sfx: this.settings.sfx, ambience: this.settings.ambience, ambienceOn: this.settings.ambienceOn, musicOn: this.settings.musicOn, music: this.settings.music };
    this.ui.root.style.setProperty('--ui', String(this.settings.uiScale));
    this.view.setAimColor(this.settings.aimColor);
    this.view.rig.reduceMotion = this.settings.reduceMotion;
    this.audio.apply();
    if (this.settings.quality !== this.view.quality.name) this.view.setQuality(this.settings.quality);
    if (this.phase === 'aiming') this.ui.showGauge(this.settings.control === 'gauge' || isMobile());
  }

  // ================================================================== 테스트 랩 / 디버그
  private openLab() {
    const rows = Object.entries(SCENARIOS).map(([k, fn]) => { const r = fn(this.world.cfg); return { key: k, name: r.name, desc: r.description, pass: r.pass, detail: r.detail }; });
    this.ui.showLab(rows);
  }
  private runScene(key: string) {
    const s = SCENE_SETUPS[key];
    if (!s) return;
    this.mode = 'lab'; this.phase = 'lab';
    this.ai = null; this.closeNet();
    this.ui.setGameUiVisible(true);
    this.ui.setPracticeTools(false);
    this.ui.setAimControlsVisible(false); this.ui.showGauge(false);
    this.state = this.rules.init(); this.state.breakDone = true;
    const w = this.world;
    for (const b of w.balls) { b.pocketed = true; b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0; b.z = 0; b.qx = b.qy = b.qz = 0; b.qw = 1; }
    if (key === 'break') {
      this.rules.setupRack(w, 3); this.state.breakDone = false;
    } else {
      for (const [id, x, y] of s.balls) { const b = w.balls[id]; b.pocketed = false; b.x = x; b.y = y; }
    }
    this.names = [s.name, '']; this.subs = ['물리 테스트', ''];
    this.ui.setPlayers(this.state, this.names, this.subs, this.onTableIds(), false);
    this.ui.setStatus(`${s.name} — Enter 로 다시 실행`);
    this.view.rig.mode = 'top';
    this.labShotPending = s.shot;
    this.settleHandled = true;
    this.labTimer = 1.2;
    this.lastLabKey = key;
    this.controls.enabled = false;
    this.ui.setHint('Enter: 다시 실행 · Esc: 메뉴');
    this.view.syncBalls(w.balls, w.time);
  }
  private lastLabKey = '';

  private toggleDebug() {
    if (this.gui) { this.gui.destroy(); this.gui = null; return; }
    const g = new GUI({ title: '물리 파라미터 (실시간)' });
    g.domElement.style.cssText += ';left:10px;right:auto;top:130px;';
    const c = this.world.cfg;
    const fold = (name: string, items: [keyof typeof c, number, number, number?][]) => {
      const f = g.addFolder(name);
      for (const [k, min, max, step] of items) f.add(c as any, k as string, min, max, step ?? (max - min) / 200).onChange(() => this.world.refresh());
      f.close();
      return f;
    };
    fold('마찰', [['muSliding', 0, 0.6], ['muRolling', 0, 0.05], ['rollingViscous', 0, 0.2], ['spinDecel', 0, 50]]).open();
    fold('공-공', [['restBallBall', 0.5, 1], ['muBallBallBase', 0, 0.2], ['muBallBallVar', 0, 0.3], ['muBallBallDecay', 0, 4]]);
    fold('쿠션', [['restCushion0', 0.4, 1], ['restCushionSlope', 0, 0.15], ['restCushionMin', 0.2, 0.9], ['muCushion', 0, 0.6], ['cushionHeightRatio', 0.5, 0.75]]);
    fold('포켓 jaw', [['restJaw', 0.2, 0.95], ['muJaw', 0, 0.6]]);
    fold('큐', [['cueMass', 0.3, 1], ['cueEndMass', 0.005, 0.1], ['cueRestitution', 0.3, 1], ['muTip', 0.2, 1.2], ['squirtScale', 0, 3], ['maxCueSpeed', 3, 12]]);
    fold('점프', [['restTable', 0, 0.8], ['bounceThreshold', 0, 1]]);
    g.add({ reset: () => { Object.assign(c, clonePhysics(defaultPhysics)); this.world.refresh(); g.controllersRecursive().forEach((x) => x.updateDisplay()); } }, 'reset').name('기본값 복원');
    this.gui = g;
  }

  private timeoutTurn() {
    const me = this.state.turn, opp: PlayerIdx = me === 0 ? 1 : 0;
    const st: RuleState = { ...this.state, groups: [...this.state.groups] as RuleState['groups'], pocketed: [...this.state.pocketed], log: [...this.state.log, '파울: 시간 초과'] };
    st.shots++; st.turn = opp; st.ballInHand = true; st.inHandZone = st.breakDone ? 'any' : 'head';
    this.state = st;
    this.controls.cancel(); this.view.aim.hide();
    this.gameFouls++;
    this.audio.chime(false);
    this.ui.toast('시간 초과! 파울 — 상대 볼 인 핸드', 'foul', 2800);
    if (this.mode === 'online' && this.net) this.net.send({ t: 'turnover', rules: st, balls: this.full(), text: '상대가 시간 초과 — 볼 인 핸드' });
    this.refreshHud();
    this.beginTurn();
  }

  // ================================================================== 드릴
  private openDrills() {
    this.drills = buildDrills();
    this.ui.showDrills(this.drills.map((d) => ({ id: d.id, name: d.name, desc: d.desc, attempts: d.attempts, best: this.profile.stats.drillBest[d.id] ?? 0 })));
  }

  private startDrill(id: string) {
    const def = this.drills.find((d) => d.id === id);
    if (!def) return;
    this.ai = null; this.net = null; this.firstTurn = 0;
    this.drill = { def, idx: 0, points: 0, cfg: null };
    this.beginGame('drill', [def.name, ''], ['드릴', ''], 5, { rules: 'eight', raceTo: 1, clock: 0 });
  }
  private retryDrill() { if (this.drill) this.startDrill(this.drill.def.id); }

  /** 드릴의 현재 시도 배치 */
  private setupDrillAttempt() {
    const d = this.drill!;
    const w = this.world;
    this.state = EightBall.init();
    this.state.breakDone = true; this.state.ballInHand = false; this.state.turn = 0;
    if (d.def.id === 'break') {
      EightBall.setupRack(w, 11 + d.idx * 7);
      this.state.breakDone = false; this.state.ballInHand = false;
      d.cfg = null;
    } else {
      const cfg = d.def.setup(w, d.idx);
      if (cfg) d.cfg = cfg;
    }
    this.view.setTargetRing(d.cfg?.target ?? null);
    this.updateDrillHud();
  }
  private updateDrillHud() {
    const d = this.drill!;
    this.ui.setDrillHud(`<b>${d.def.name}</b> · 시도 ${Math.min(d.idx + 1, d.def.attempts)}/${d.def.attempts} · 점수 ${d.points.toFixed(d.points % 1 ? 1 : 0)}/${d.def.maxPoints}`);
  }

  /** 드릴 샷 판정 */
  private drillSettled(rep: import('./game-rules/RuleSet').ShotReport) {
    const d = this.drill!;
    const res = d.def.judge({ rep, world: this.world, contact: this.contactPos, cue0: this.cue0, cfg: d.cfg });
    d.points += res.points;
    d.idx++;
    this.ui.toast(res.msg, res.points >= 1 ? 'good' : res.points > 0 ? '' : 'foul', 1800);
    const cue = this.world.balls[0];
    const finished = d.idx >= d.def.attempts || (d.def.done?.(this.world, d.points) ?? false);
    if (finished) { this.finishDrill(); return; }
    if (d.def.persistent) {
      if (cue.pocketed) { cue.pocketed = false; const p = freeSpot(this.world); cue.x = p.x; cue.y = p.y; }
      cue.vx = cue.vy = 0;
    } else this.drillNeedSetup = true;
    this.updateDrillHud();
    this.afterEvalPending = true; this.settleTimer = -0.8; this.phase = 'simulating';
  }

  private finishDrill() {
    const d = this.drill!;
    const stars = starsFor(d.points, d.def.maxPoints);
    const prev = this.profile.stats.drillBest[d.def.id] ?? 0;
    this.profile.update((s) => { if (stars >= 1) s.drillsDone++; if (stars > (s.drillBest[d.def.id] ?? 0)) s.drillBest[d.def.id] = stars; });
    if (stars > prev) this.profile.addXp(40 * (stars - prev));
    this.profile.save();
    if (stars >= 1) { this.audio.fanfare(); if (stars === 3) launchConfetti(2500); }
    this.phase = 'over'; this.controls.enabled = false;
    this.view.setTargetRing(null);
    this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
    this.ui.setDrillHud(null);
    this.ui.showGauge(false); this.ui.setAimControlsVisible(false);
    const name = d.def.name;
    this.later(() => this.ui.showDrillResult(name, stars, `점수 ${d.points.toFixed(1)} / ${d.def.maxPoints}${stars > prev && stars > 0 ? ` · 새 기록! +${40 * (stars - prev)} XP` : ''}`, () => this.retryDrill(), () => { this.quitToMenu(); this.openDrills(); }), 700);
  }

  // ================================================================== 튜토리얼
  private startTutorial() {
    this.startPractice(true);
  }
  private static TUT = [
    '<b>환영합니다!</b><br>화면을 <b>드래그</b>해서 조준 방향을 돌려보세요. (Shift = 미세 조준, ←→ 키도 가능)',
    '왼쪽 아래 <b>흰 공(타점)</b>을 눌러 스핀을 줄 수 있어요. 위=밀어치기, 아래=끌어치기, 좌우=회전. 점선 원 밖은 <b>미스큐</b>!',
    '<b>↑↓ 키</b>(또는 +/−)로 큐 각도를 올리면 <b>점프·마세</b> 샷을 칠 수 있어요.',
    '<b>발사:</b> 우클릭(또는 Space)을 누른 채 마우스를 <b>아래로 당겼다가 위로 확</b> 밀어요. 미는 속도가 파워! 모바일은 오른쪽 <b>게이지</b>를 아래로 당겼다 놓으세요.',
    '공을 넣으면 계속 칠 수 있어요. 첫 포켓으로 <b>솔리드/스트라이프</b>가 정해집니다. 파울이면 상대가 큐볼을 원하는 곳에 놓아요.',
    '<b>T</b> 카메라 전환 · <b>P</b> 리플레이 · <b>H</b> 도움말 · <b>F2</b> 포토 모드. 이제 즐겨보세요! 🎱',
  ];
  private showTutStep() {
    if (this.tutStep < 0) { this.ui.coach(null); return; }
    if (this.tutStep >= Game.TUT.length) {
      this.tutStep = -1; this.ui.coach(null);
      this.settings.tutorialDone = true; saveSettings(this.settings);
      return;
    }
    const last = this.tutStep === Game.TUT.length - 1;
    this.ui.coach(Game.TUT[this.tutStep], last ? '시작하기' : '다음', () => { this.tutStep++; this.showTutStep(); });
  }

  // ================================================================== 편의 기능
  private togglePhoto() {
    if (this.phase === 'menu') return;
    this.photo = !this.photo;
    this.ui.setPhotoMode(this.photo);
  }
  private savePhoto() {
    try {
      const url = this.view.capture();
      const a = document.createElement('a');
      a.href = url; a.download = `pool3d-${Date.now()}.png`;
      document.body.append(a); a.click(); a.remove();
      this.ui.toast('사진을 저장했습니다 📷', 'good', 1500);
    } catch { this.ui.toast('사진 저장에 실패했습니다', 'foul', 1500); }
  }
  private toggleFullscreen() {
    const d = document as any, root = document.documentElement as any;
    if (d.fullscreenElement) void d.exitFullscreen?.();
    else if (root.requestFullscreen) void root.requestFullscreen().catch(() => this.ui.toast('전체화면을 사용할 수 없습니다', 'foul', 1500));
    else this.ui.toast('이 브라우저는 전체화면을 지원하지 않습니다 (홈 화면에 추가해 보세요)', '', 2500);
  }
  private sendEmote(id: string) {
    this.ui.showEmote(EMOTES[id] ?? '👍', true);
    if (this.net && this.mode === 'online') this.net.send({ t: 'emote', id });
  }
  private buzz(pattern: number | number[]) {
    if (!this.settings.haptics || !navigator.vibrate) return;
    const now = performance.now();
    if (now - this.lastBuzz < 60) return;
    this.lastBuzz = now;
    try { navigator.vibrate(pattern); } catch { /* 미지원 */ }
  }

  // ================================================================== 프레임
  private sendAim() {
    if (!this.net || this.mode !== 'online') return;
    const now = performance.now();
    if (now - this.lastAimSend < 45) return;
    this.lastAimSend = now;
    const a = this.controls.aim;
    const bih = this.phase === 'placing' ? { x: this.placePos.x, y: this.placePos.y } : null;
    this.net.send({ t: 'aim', angle: a.angle, elev: a.elevation, a: a.a, b: a.b, pull: this.controls.pull, bih });
  }

  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 0.05);
    this.fps = this.fps * 0.95 + (1 / Math.max(dtRaw, 1e-3)) * 0.05;
    if (this.cineCooldown > 0) this.cineCooldown -= dt;
    if (this.phase !== 'menu' && !this.paused) {
      this.profile.stats.playSeconds += dt;
      this.profileSave += dt;
      if (this.profileSave > 20) { this.profileSave = 0; this.profile.save(); }
      // 샷 클락
      if (this.clockLeft !== null && (this.mode === 'online' || !this.ui.menuOpen) && ['aiming', 'placing', 'remote'].includes(this.phase)) {
        this.clockLeft -= dt;
        this.ui.setClock(this.clockLeft);
        const sec = Math.ceil(this.clockLeft);
        if (this.clockLeft <= 5 && sec !== this.lastTickSec && sec > 0 && this.phase !== 'remote') { this.lastTickSec = sec; this.audio.tick(); this.buzz(10); }
        if (this.clockLeft <= 0 && this.phase !== 'remote') { this.clockLeft = null; this.ui.setClock(null); this.timeoutTurn(); return; }
      } else if (['shooting', 'simulating', 'thinking', 'replay'].includes(this.phase)) this.ui.setClock(null);
      // 자동 품질 조절: 연속으로 느리면 한 단계 낮춘다
      if (this.settings.autoQuality && dtRaw < 0.25) {
        this.slowTime = dtRaw > 1 / 24 ? this.slowTime + dtRaw : Math.max(0, this.slowTime - dtRaw * 2);
        if (this.slowTime > 4 && this.settings.quality !== 'low') {
          this.settings.quality = this.settings.quality === 'high' ? 'medium' : 'low';
          this.slowTime = 0; saveSettings(this.settings);
          this.view.setQuality(this.settings.quality);
          this.ui.toast(`성능을 위해 그래픽 품질을 '${this.settings.quality === 'medium' ? '중간' : '낮음'}'으로 낮췄습니다`, '', 3000);
        }
      }
    }
    for (const b of this.world.balls) if (b.z > 0.01) { this.sawAir = true; break; }
    const w = this.world;
    const cue = this.cueBall;
    const rig = this.view.rig;

    if (this.paused) { this.view.render(dt); return; }
    this.controls.update(dt);

    // ---------------- 위상별 처리
    switch (this.phase) {
      case 'aiming': {
        this.sendAim();
        const a = this.controls.aim;
        rig.aimYaw = a.angle;
        rig.setTargetPhys(cue.x, cue.y);
        let pull = this.controls.pull;
        if (this.gaugeActive) pull = 0.04 + this.gaugePower * 0.34;
        this.visibleCuePull += (pull - this.visibleCuePull) * Math.min(1, dt * 30);
        this.drawCue(cue, a.angle, a.elevation, a.a, a.b, this.visibleCuePull);
        const info = computeAim(w.balls, a.angle, this.activeId);
        this.view.aim.update(cue, info, this.settings.aimLevel);
        if (this.controls.stroking) this.ui.setPower(Math.min(1, this.controls.pull / 0.4));
        else if (!this.gaugeActive) this.ui.setPower(0);
        break;
      }
      case 'placing': {
        rig.setTargetPhys(cue.x, cue.y);
        this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
        this.view.setGhostBall(this.placePos.x, this.placePos.y, this.placeValid);
        cue.x = this.placePos.x; cue.y = this.placePos.y;
        this.view.aim.hide();
        break;
      }
      case 'shooting': {
        const sa = this.shootAnim!;
        sa.t += dt;
        const k = Math.min(1, sa.t / sa.dur);
        const ease = k * k;
        const pull = sa.from * (1 - ease);
        this.drawCue(cue, sa.shot.angle, sa.shot.elevation, sa.shot.a, sa.shot.b, pull);
        rig.aimYaw = sa.shot.angle;
        this.visibleCuePull = pull;
        if (k >= 1) {
          this.shootAnim = null;
          this.doStrike(sa.shot);
        }
        break;
      }
      case 'thinking': {
        rig.setTargetPhys(cue.x, cue.y);
        const aa = this.aiAnim;
        if (aa) {
          aa.t += dt;
          if (aa.stage === 'aim') {
            const k = Math.min(1, aa.t / 1.0);
            const e = 1 - Math.pow(1 - k, 3);
            let d = aa.shot.angle - aa.fromAngle;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            this.controls.aim.angle = aa.fromAngle + d * e;
            this.controls.aim.elevation = aa.shot.elevation * e;
            if (k >= 1) { aa.stage = 'pull'; aa.t = 0; }
          } else if (aa.stage === 'pull') {
            const k = Math.min(1, aa.t / 0.5);
            this.visibleCuePull = (0.04 + Math.min(0.3, aa.shot.speed * 0.045)) * k;
            if (k >= 1) {
              this.shootAnim = { t: 0, dur: Math.max(0.07, Math.min(0.3, this.visibleCuePull / (aa.shot.speed * 0.8))), from: this.visibleCuePull, shot: aa.shot, auto: true };
              this.aiAnim = null;
              this.phase = 'shooting';
            }
          }
          rig.aimYaw = this.controls.aim.angle;
          this.drawCue(cue, this.controls.aim.angle, this.controls.aim.elevation, aa.shot.a, aa.shot.b, this.visibleCuePull);
        } else {
          this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
        }
        break;
      }
      case 'remote': {
        const ra = this.remoteAim;
        rig.setTargetPhys(cue.x, cue.y);
        rig.aimYaw = ra.angle;
        this.visibleCuePull += (ra.pull - this.visibleCuePull) * Math.min(1, dt * 20);
        this.drawCue(cue, ra.angle, ra.elev, ra.a, ra.b, this.visibleCuePull);
        if (this.state.ballInHand) this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
        break;
      }
      case 'simulating':
      case 'replay':
      case 'lab': this.updateSim(dt); break;
      default: break;
    }

    if (this.phase === 'menu' || this.phase === 'over') {
      // 메뉴 배경: 느린 카메라 회전
      if (this.phase === 'menu') { rig.mode = 'aim'; rig.aimYaw += dt * 0.08; rig.setTargetPhys(0.3, 0); rig.distance = 1.9; rig.pitch = 0.5; }
      w.idle(dt);
    }

    // 구르는 소리 + 카메라 follow 대상
    let rs = 0, rn = 0, fx = 0, fy = 0, fw = 0;
    for (const b of w.balls) {
      if (b.pocketed) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0.01 && b.z === 0) { rs += sp; rn++; }
      if (sp > 0.02) { fx += b.x * sp; fy += b.y * sp; fw += sp; }
    }
    this.audio.updateRoll(rs, rn);
    if (fw > 0) rig.followTarget.set(fx / fw, R, -(fy / fw));
    else rig.followTarget.set(cue.x, R, -cue.y);

    // 시네마틱
    if (this.cine) {
      if (performance.now() > this.cine.until) { rig.mode = this.cine.prevMode as any; this.cine = null; this.timeScale = 1; }
      else { rig.mode = 'closeup'; rig.closeTarget.set(this.cine.x, R, -this.cine.y); this.timeScale = 0.3; }
    }

    this.view.syncBalls(w.balls, w.time);
    this.view.render(dt);
    this.fpsAcc += dtRaw; this.fpsN++;
    if (this.fpsAcc > 0.5) { this.ui.setStats(this.gui || this.settings.showFps ? `${(this.fpsN / this.fpsAcc).toFixed(0)} fps · ${this.view.quality.name}` : ''); this.fpsAcc = 0; this.fpsN = 0; }
  }

  private drawCue(cue: Ball, angle: number, elev: number, a: number, b: number, pull: number) {
    this.view.setCue({ visible: true, x: cue.x, y: cue.y, z: cue.z, angle, elevation: elev, a, b, pull });
  }

  private updateSim(dt: number) {
    const w = this.world;
    const rig = this.view.rig;
    // 후속 큐 연출
    if (this.followThrough > 0) {
      this.followThrough -= dt * 2.2;
      const cue = w.balls[this.lastShot?.ballId ?? 0];
      const s = this.lastShot?.shot;
      if (s && this.followThrough > 0 && !cue.pocketed) {
        this.drawCue({ ...cue, x: this.lastShot!.before[this.lastShot!.ballId].x, y: this.lastShot!.before[this.lastShot!.ballId].y, z: 0 }, s.angle, s.elevation, s.a, s.b, -0.04 * (1 - this.followThrough));
      } else this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });
    } else this.view.setCue({ visible: false, x: 0, y: 0, z: 0, angle: 0, elevation: 0, a: 0, b: 0, pull: 0 });

    if (this.phase === 'lab') {
      if (this.labShotPending) {
        this.labTimer -= dt;
        if (this.labTimer <= 0) {
          const shot = this.labShotPending; this.labShotPending = null;
          const prev = this.phase; void prev;
          this.world.strike({ ...shot, ball: this.activeId });
          this.settleHandled = false;
          this.followThrough = 0;
        }
        return;
      }
    }
    if (this.phase === 'replay' && this.replayStrikeIn > 0) {
      this.replayStrikeIn -= dt;
      if (this.replayStrikeIn <= 0 && this.lastShot) {
        this.world.strike({ ...this.lastShot.shot, ball: this.lastShot.ballId });
        this.settleHandled = false;
        this.followThrough = 1;
      }
      w.idle(dt);
      return;
    }
    if (this.afterEvalPending) {
      this.settleTimer += dt;
      w.idle(dt);
      if (this.settleTimer >= 0) { this.afterEvalPending = false; this.beginTurn(); }
      return;
    }
    // 안전장치: 비정상적으로 오래 굴러가는 시뮬레이션은 강제 정지
    if (this.phase === 'simulating' && w.time - this.strikeAt > 60) {
      for (const b of w.balls) { b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0; b.z = 0; }
    }
    // 상대 결과가 오래 안 오면 전체 상태 재요청
    if (this.waitingRemote) {
      this.waitT += dt;
      if (this.waitT > 6) { this.waitT = 0; this.net?.send({ t: 'need' }); }
    } else this.waitT = 0;
    const moving = w.isMoving();
    const adv = w.advance(dt, this.timeScale);
    if (adv === 0) w.idle(dt * this.timeScale);
    if (moving) { this.settleTimer = 0; return; }
    if (this.settleHandled || this.waitingRemote) {
      if (this.waitingRemote && this.pendingResult) this.applyRemoteResult();
      return;
    }
    this.settleTimer += dt;
    if (this.settleTimer < 0.35) return;
    this.settleTimer = 0;
    this.settleHandled = true;
    if (this.phase === 'replay') { this.replayRestore?.(); this.replayRestore = null; return; }
    if (this.phase === 'lab') { this.ui.toast('완료 — Enter 로 다시 실행', 'good', 1800); return; }
    this.onSettled();
  }

  private settleHandled = true;
  private strikeAt = 0;
  private waitT = 0;

  /** Enter: 랩 재실행 */
  labRerun() {
    if (this.phase === 'lab' || this.mode === 'lab') this.runScene(this.lastLabKey);
  }
}
