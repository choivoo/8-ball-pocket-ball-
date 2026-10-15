import type { PhysEvent } from '../physics/types';

export interface AudioSettings { master: number; sfx: number; ambience: number; ambienceOn: boolean; musicOn?: boolean; music?: number }

/** 샘플 교체 가능한 구조: bank 에 AudioBuffer 를 등록하면 합성 대신 사용된다 */
export type SampleName = 'cue' | 'ball' | 'cushion' | 'pocket' | 'drop';
export class SampleBank {
  private map = new Map<SampleName, AudioBuffer[]>();
  set(name: SampleName, bufs: AudioBuffer[]) { this.map.set(name, bufs); }
  get(name: SampleName): AudioBuffer | null {
    const a = this.map.get(name);
    return a && a.length ? a[Math.floor(Math.random() * a.length)] : null;
  }
  async load(ctx: AudioContext, name: SampleName, urls: string[]) {
    const bufs: AudioBuffer[] = [];
    for (const u of urls) {
      const r = await fetch(u);
      bufs.push(await ctx.decodeAudioData(await r.arrayBuffer()));
    }
    this.set(name, bufs);
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class AudioEngine {
  ctx: AudioContext | null = null;
  bank = new SampleBank();
  settings: AudioSettings = { master: 0.8, sfx: 1, ambience: 0.5, ambienceOn: true };
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private mus!: GainNode;
  private musicTimer = 0;
  private musicStep = 0;
  private noise!: AudioBuffer;
  private rollGain!: GainNode;
  private rollFilter!: BiquadFilterNode;
  private voices = 0;
  private readonly maxVoices = 22;
  private lastBallHit = 0;
  private ambNodes: AudioNode[] = [];

  /** 사용자 제스처 이후 호출 */
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.sfx = ctx.createGain(); this.amb = ctx.createGain(); this.mus = ctx.createGain();
    this.sfx.connect(this.master); this.amb.connect(this.master); this.mus.connect(this.master);
    this.master.connect(comp); comp.connect(ctx.destination);
    // 화이트노이즈 버퍼
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 구르는 소리 (연속)
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    this.rollFilter = ctx.createBiquadFilter(); this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 200; this.rollFilter.Q.value = 0.7;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    src.connect(this.rollFilter); this.rollFilter.connect(this.rollGain); this.rollGain.connect(this.sfx);
    src.start();
    this.apply();
    this.startAmbience();
    this.startMusic();
  }

  apply() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.master;
    this.sfx.gain.value = s.sfx;
    this.amb.gain.value = s.ambienceOn ? s.ambience * 0.5 : 0;
    this.mus.gain.value = s.musicOn === false ? 0 : (s.music ?? 0.35) * 0.5;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // 낮은 웅성거림 + 환풍기 험
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.06;
    src.connect(bp); bp.connect(g); g.connect(this.amb); src.start();
    const hum = ctx.createOscillator(); hum.frequency.value = 60; hum.type = 'sine';
    const hg = ctx.createGain(); hg.gain.value = 0.012;
    hum.connect(hg); hg.connect(this.amb); hum.start();
    this.ambNodes.push(src, hum);
    // 가끔 들리는 멀리서의 공 부딪히는 소리
    const tick = () => {
      if (this.ctx && this.settings.ambienceOn && Math.random() < 0.6) this.clack(0.04 + Math.random() * 0.05, 0.35, this.amb);
      setTimeout(tick, 2500 + Math.random() * 6000);
    };
    setTimeout(tick, 3000);
  }

  // ------------------------------------------------------------ 배경 음악 (생성형 라운지 재즈)
  /** ii–V–I–vi 코드 진행 위에 패드 / 베이스 / 펜타토닉 멜로디를 무작위로 얹는다. 외부 음원 불필요. */
  private startMusic() {
    const ctx = this.ctx!;
    const bpm = 72, beat = 60 / bpm;
    const prog = [
      [50, 53, 57, 60, 64], // Dm9
      [43, 53, 57, 59, 64], // G13
      [48, 52, 55, 59, 62], // Cmaj9
      [45, 52, 55, 58, 63], // A7alt
    ];
    const scale = [62, 65, 67, 69, 72, 74, 77, 79];
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    let next = ctx.currentTime + 0.5;
    const note = (m: number, t: number, dur: number, vol: number, type: OscillatorType, attack = 0.01, lp = 3000) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(g); g.connect(this.mus);
      o.start(t); o.stop(t + dur + 0.05);
    };
    const schedule = () => {
      if (!this.ctx) return;
      while (next < ctx.currentTime + 2.5) {
        const bar = Math.floor(this.musicStep / 4) % 4, b = this.musicStep % 4;
        const chord = prog[bar];
        if (b === 0) for (const m of chord) note(m, next, beat * 4.2, 0.05, 'triangle', 0.35, 1200);
        if (b === 0 || b === 2) note(chord[0] - 12, next, beat * 1.8, 0.16, 'sine', 0.02, 500);
        // 멜로디: 확률적으로, 스윙 느낌의 오프셋
        if (Math.random() < 0.5) note(scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.2 ? -12 : 0), next + (b % 2 ? beat * 0.17 : 0), beat * 1.6, 0.07, 'sine', 0.005, 2400);
        if (Math.random() < 0.18) note(scale[Math.floor(Math.random() * scale.length)], next + beat * 0.5, beat * 1.2, 0.05, 'triangle', 0.005, 2000);
        next += beat;
        this.musicStep++;
      }
    };
    schedule();
    this.musicTimer = window.setInterval(schedule, 800);
  }

  tick() { if (this.ctx) this.tone(1400, 0.05, 0.12, 'square'); }
  fanfare() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.45, 0.14, 'triangle', undefined, i * 0.12));
  }

  // ------------------------------------------------------------ 이벤트 연결
  handle(e: PhysEvent) {
    if (!this.ctx) return;
    switch (e.type) {
      case 'cue': this.cueHit(e.speed, e.miscue); break;
      case 'ballBall': this.ballHit(e.speed); break;
      case 'cushion': this.cushionHit(e.speed); break;
      case 'jaw': this.jawHit(e.speed); break;
      case 'pocket': this.pocketDrop(e.speed); break;
      case 'land': this.clack(clamp(e.speed / 2, 0.05, 0.5), 0.8); break;
    }
  }

  /** 매 프레임: 구르는 공들의 속도 합으로 럼블 음량/음색 갱신 */
  updateRoll(rollingSpeedSum: number, count: number) {
    if (!this.ctx) return;
    const v = Math.min(rollingSpeedSum, 8);
    const g = Math.min(0.2, Math.pow(v, 0.8) * 0.028 + count * 0.002) * (v > 0.02 ? 1 : 0);
    const t = this.ctx.currentTime;
    this.rollGain.gain.setTargetAtTime(g, t, 0.05);
    this.rollFilter.frequency.setTargetAtTime(110 + Math.min(v, 5) * 90, t, 0.08);
  }

  // ------------------------------------------------------------ 합성
  private voice(): boolean {
    if (this.voices >= this.maxVoices) return false;
    this.voices++;
    return true;
  }
  private release(ms: number) {
    setTimeout(() => { this.voices = Math.max(0, this.voices - 1); }, ms);
  }

  private playSample(name: SampleName, vol: number, rate = 1, dest?: AudioNode): boolean {
    const b = this.bank.get(name);
    if (!b || !this.ctx) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(g); g.connect(dest ?? this.sfx);
    s.start();
    return true;
  }

  private noiseBurst(dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, dest?: AudioNode, when = 0) {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const off = Math.random() * 1.5;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest ?? this.sfx);
    s.start(t, off, dur + 0.02);
  }

  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', dest?: AudioNode, when = 0, endFreq?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(); o.type = type;
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest ?? this.sfx);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** 공끼리 부딪히는 날카로운 "딱" 소리 */
  private clack(vol: number, pitchScale: number, dest?: AudioNode) {
    if (!this.voice()) return;
    const p = (0.92 + Math.random() * 0.16) * pitchScale;
    this.tone(2350 * p, 0.05, vol * 0.55, 'sine', dest);
    this.tone(3900 * p, 0.03, vol * 0.25, 'sine', dest);
    this.tone(1180 * p, 0.09, vol * 0.3, 'triangle', dest);
    this.noiseBurst(0.012, vol * 0.7, 'highpass', 3200, 0.7, dest);
    this.release(120);
  }

  ballHit(speed: number) {
    const now = this.ctx!.currentTime;
    // 동시 충돌 폭주 방지: 브레이크 시 너무 많이 겹치지 않도록 간격 제한
    if (now - this.lastBallHit < 0.006) return;
    this.lastBallHit = now;
    const v = clamp(speed / 5, 0.02, 1);
    const vol = Math.pow(v, 0.75) * 0.9;
    if (this.playSample('ball', vol, 0.9 + Math.random() * 0.2)) return;
    this.clack(vol, 0.85 + v * 0.3);
  }

  cushionHit(speed: number) {
    const v = clamp(speed / 4, 0.03, 1);
    const vol = Math.pow(v, 0.8) * 0.7;
    if (this.playSample('cushion', vol, 0.9 + Math.random() * 0.2)) return;
    if (!this.voice()) return;
    this.noiseBurst(0.09, vol * 0.9, 'lowpass', 700 + v * 500, 0.8);
    this.tone(95 + Math.random() * 20, 0.11, vol * 0.9, 'sine', undefined, 0, 60);
    this.tone(300, 0.04, vol * 0.2, 'triangle');
    this.release(160);
  }

  jawHit(speed: number) {
    const v = clamp(speed / 3, 0.05, 1);
    if (!this.voice()) return;
    this.tone(1700 + Math.random() * 300, 0.07, v * 0.3, 'square');
    this.noiseBurst(0.05, v * 0.4, 'bandpass', 1800, 2);
    this.tone(260, 0.1, v * 0.3, 'triangle');
    this.release(140);
  }

  cueHit(speed: number, miscue: boolean) {
    const v = clamp(speed / 7, 0.05, 1);
    const vol = 0.35 + v * 0.65;
    if (this.playSample('cue', vol)) return;
    if (!this.voice()) return;
    if (miscue) {
      this.noiseBurst(0.12, 0.5, 'bandpass', 3500, 1.5);
      this.tone(1300, 0.06, 0.25, 'sawtooth');
    } else {
      // 팁이 공을 치는 "탁": 파워가 클수록 저음 비중과 음량이 커진다
      this.noiseBurst(0.03, vol * 0.8, 'bandpass', 1800 + v * 900, 1.2);
      this.tone(300 - v * 80, 0.08, vol * 0.6, 'sine', undefined, 0, 170);
      this.tone(2100 + v * 600, 0.025, vol * 0.3, 'sine');
    }
    this.release(160);
  }

  /** 포켓 낙하: 가죽 망/레일 속을 굴러가는 소리까지 */
  pocketDrop(speed: number) {
    if (!this.ctx) return;
    const v = clamp(speed / 4, 0.1, 1);
    if (this.playSample('pocket', 0.7 + v * 0.3)) return;
    if (!this.voice()) return;
    this.tone(180, 0.14, 0.5 * (0.5 + v), 'sine', undefined, 0.04, 70);
    this.noiseBurst(0.08, 0.35, 'bandpass', 1200, 1.4, undefined, 0.02);
    // 포켓 안 레일을 구르는 소리: 낮아지는 럼블 + 마지막 탁
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    const t = ctx.currentTime + 0.15;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    s.connect(f); f.connect(g); g.connect(this.sfx);
    s.start(t, Math.random(), 1);
    this.tone(220, 0.12, 0.3, 'sine', undefined, 1.0, 120);
    this.noiseBurst(0.05, 0.25, 'lowpass', 600, 1, undefined, 1.0);
    this.release(1200);
  }

  click() {
    if (!this.ctx) return;
    this.tone(880, 0.05, 0.08, 'sine');
  }
  chime(good: boolean) {
    if (!this.ctx) return;
    if (good) { this.tone(660, 0.25, 0.15, 'sine'); this.tone(880, 0.3, 0.15, 'sine', undefined, 0.12); }
    else { this.tone(300, 0.3, 0.18, 'triangle', undefined, 0, 200); }
  }
}
