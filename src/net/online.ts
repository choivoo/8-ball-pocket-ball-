import mqtt from 'mqtt';
import type { Shot } from '../physics/types';
import type { RuleState } from '../game-rules/RuleSet';

export interface BallLite { id: number; x: number; y: number; pocketed: boolean; pocketIndex: number }
export interface BallFull extends BallLite {
  z: number; vx: number; vy: number; vz: number; wx: number; wy: number; wz: number; qx: number; qy: number; qz: number; qw: number; pocketTime: number;
}

export type NetMsg =
  | { t: 'hello'; name: string }
  | { t: 'start'; seed: number; hostName: string }
  | { t: 'aim'; angle: number; elev: number; a: number; b: number; pull: number; bih: { x: number; y: number } | null }
  | { t: 'shot'; shot: Shot; balls: BallLite[]; rng: number }
  | { t: 'result'; rules: RuleState; balls: BallFull[]; fouls: string[]; messages: string[]; respot: boolean }
  | { t: 'rematch'; seed: number }
  | { t: 'quit' };

/**
 * 공개 MQTT(WebSocket) 브로커를 메시지 중계로 쓰는 1:1 세션.
 * WebRTC 직접 연결은 이동통신망/NAT 에서 자주 실패하므로, 샷 정보만 주고받는 턴제 게임에는 중계 방식이 더 안정적이다.
 * 방 코드 = 브로커 번호 1글자 + 무작위 4글자. 서버 없이 정적 호스팅 가능.
 */
const BROKERS: string[] = (globalThis as any).__MQTT_BROKERS ?? ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const BROKER_LETTERS = 'ABC';
const ALPHABET = 'DEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(brokerIdx: number): string {
  let s = BROKER_LETTERS[brokerIdx];
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

type Wire = { n: string; q: number; m: unknown };

export class OnlineSession {
  client: mqtt.MqttClient | null = null;
  isHost = false;
  code = '';
  onMessage: (m: NetMsg) => void = () => {};
  onClose: () => void = () => {};
  onOpen: () => void = () => {};
  private nonce = Math.random().toString(36).slice(2, 10);
  private peerNonce = '';
  private seq = 0;
  private lastSeen = 0;
  private lastRecvSeq = -1;
  private timer = 0;
  private opened = false;
  private wake: any = null;

  private async keepScreenOn() {
    try { this.wake = await (navigator as any).wakeLock?.request('screen'); } catch { /* 미지원 */ }
  }

  private topic(role: 'h' | 'g') { return `pool3d/v1/${this.code}/${role}`; }

  private connect(idx: number): Promise<mqtt.MqttClient> {
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(BROKERS[idx], { connectTimeout: 7000, reconnectPeriod: 2000, clean: true, keepalive: 20, clientId: 'pool3d_' + this.nonce });
      const t = setTimeout(() => { c.end(true); reject(new Error('timeout')); }, 8000);
      c.once('connect', () => { clearTimeout(t); resolve(c); });
      c.once('error', () => { /* 타임아웃에서 처리 */ });
    });
  }

  private async connectAny(prefer?: number): Promise<{ c: mqtt.MqttClient; idx: number }> {
    const order = prefer !== undefined ? [prefer] : BROKERS.map((_, i) => i);
    let lastErr: unknown = null;
    for (const idx of order) {
      try { return { c: await this.connect(idx), idx }; } catch (e) { lastErr = e; }
    }
    throw new Error('중계 서버에 연결할 수 없습니다 (' + (lastErr as Error)?.message + ')');
  }

  private attach(c: mqtt.MqttClient, listenRole: 'h' | 'g') {
    this.client = c;
    c.subscribe(this.topic(listenRole), { qos: 1 });
    c.on('message', (_t, payload) => {
      let w: Wire;
      try { w = JSON.parse(payload.toString()); } catch { return; }
      if (!w || w.n === this.nonce) return;
      this.handle(w);
    });
    this.lastSeen = Date.now();
    // 상대 생존 확인: 4초마다 ping, 25초간 아무 신호 없으면 끊김으로 간주
    this.timer = window.setInterval(() => {
      this.raw({ t: '__ping' });
      if (this.opened && Date.now() - this.lastSeen > 25000) { this.opened = false; this.onClose(); }
    }, 4000);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState === 'visible') { this.client?.reconnect?.(); this.raw({ t: '__ping' }); }
  };

  private raw(m: unknown) {
    if (!this.client || !this.client.connected) return;
    const w: Wire = { n: this.nonce, q: this.seq++, m };
    this.client.publish(this.topic(this.isHost ? 'h' : 'g'), JSON.stringify(w), { qos: 1 });
  }

  private handle(w: Wire) {
    const m = w.m as any;
    this.lastSeen = Date.now();
    if (m?.t === '__ping') return;
    if (this.isHost && m?.t === '__join') {
      if (!this.peerNonce) this.peerNonce = w.n;
      if (this.peerNonce !== w.n) return;
      this.raw({ t: '__ack', to: w.n });
      if (!this.opened) { this.opened = true; this.onOpen(); }
      return;
    }
    if (!this.isHost && m?.t === '__ack') {
      if (m.to !== this.nonce) return;
      if (!this.opened) { this.opened = true; this.joinedResolve?.(); this.onOpen(); }
      return;
    }
    if (m?.t?.startsWith?.('__')) return;
    if (this.peerNonce && this.isHost && w.n !== this.peerNonce) return;
    // 중복 제거 (QoS1 재전송)
    const key = w.q;
    if (key <= this.lastRecvSeq && this.peerNonce === w.n) return;
    if (this.isHost) this.peerNonce = w.n; else this.peerNonce = w.n;
    this.lastRecvSeq = key;
    this.onMessage(m as NetMsg);
  }

  private joinedResolve: (() => void) | null = null;

  async host(): Promise<string> {
    this.isHost = true;
    void this.keepScreenOn();
    const { c, idx } = await this.connectAny();
    this.code = randomCode(idx);
    this.attach(c, 'g');
    return this.code;
  }

  async join(code: string): Promise<void> {
    this.isHost = false;
    this.code = code.toUpperCase().trim();
    const idx = BROKER_LETTERS.indexOf(this.code[0]);
    if (idx < 0 || this.code.length !== 5) throw new Error('방 코드가 올바르지 않습니다');
    void this.keepScreenOn();
    const { c } = await this.connectAny(idx);
    this.attach(c, 'h');
    await new Promise<void>((resolve, reject) => {
      this.joinedResolve = resolve;
      let tries = 0;
      const t = window.setInterval(() => {
        if (this.opened) { clearInterval(t); return; }
        if (++tries > 10) { clearInterval(t); reject(new Error('방을 찾을 수 없습니다. 호스트가 대기 화면을 켜 둔 상태인지 확인하세요')); return; }
        this.raw({ t: '__join' });
      }, 1500);
      this.raw({ t: '__join' });
    });
  }

  send(m: NetMsg) {
    this.raw(m);
  }

  close() {
    window.clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
    try { this.wake?.release(); } catch { /* ignore */ }
    this.opened = false;
    try { this.client?.end(true); } catch { /* ignore */ }
    this.client = null;
  }
}
