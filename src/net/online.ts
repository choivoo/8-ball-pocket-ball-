import { Peer, type DataConnection } from 'peerjs';
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

const PREFIX = 'pool3d-8ball-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** WebRTC(PeerJS) 기반 1:1 세션. 서버 없이 방 코드만으로 연결된다 (정적 호스팅 가능). */
export class OnlineSession {
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  isHost = false;
  code = '';
  onMessage: (m: NetMsg) => void = () => {};
  onClose: () => void = () => {};
  onOpen: () => void = () => {};

  private wake: any = null;
  async keepScreenOn() {
    try { this.wake = await (navigator as any).wakeLock?.request('screen'); } catch { /* 미지원 */ }
  }

  host(): Promise<string> {
    this.isHost = true;
    void this.keepScreenOn();
    return new Promise((resolve, reject) => {
      const tryCode = (attempt: number) => {
        const code = randomCode();
        const peer = new Peer(PREFIX + code);
        peer.on('open', () => {
          this.peer = peer; this.code = code;
          // 모바일에서 화면이 꺼지거나 백그라운드로 가면 브로커 연결이 끊긴다 → 즉시 재연결
          peer.on('disconnected', () => this.keepAlive(peer));
          document.addEventListener('visibilitychange', this.onVisible);
          this.hb = window.setInterval(() => { if (peer.disconnected && !peer.destroyed) this.keepAlive(peer); }, 4000);
          peer.on('connection', (c) => {
            if (this.conn) { c.close(); return; }
            this.bind(c);
          });
          resolve(code);
        });
        peer.on('error', (err: any) => {
          if (err?.type === 'unavailable-id' && attempt < 5) { peer.destroy(); tryCode(attempt + 1); return; }
          reject(new Error(err?.type || 'peer error'));
        });
      };
      tryCode(0);
    });
  }

  private hb = 0;
  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.peer?.disconnected && !this.peer.destroyed) this.keepAlive(this.peer);
  };
  private keepAlive(peer: Peer) {
    try { peer.reconnect(); } catch { /* 다음 주기에 재시도 */ }
  }

  join(code: string): Promise<void> {
    this.isHost = false;
    this.code = code.toUpperCase().trim();
    void this.keepScreenOn();
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      let tries = 0, done = false;
      const fail = (e: Error) => { if (!done) { done = true; clearTimeout(timer); reject(e); } };
      const timer = setTimeout(() => fail(new Error('연결 시간 초과')), 25000);
      const attempt = () => {
        const c = peer.connect(PREFIX + this.code, { reliable: true });
        c.on('open', () => { if (done) return; done = true; clearTimeout(timer); this.bind(c); resolve(); });
        c.on('error', (e) => fail(e as Error));
      };
      peer.on('open', attempt);
      peer.on('error', (err: any) => {
        // 호스트가 잠시 끊겼다 재접속하는 경우를 위해 몇 번 재시도
        if (err?.type === 'peer-unavailable' && tries < 5 && !done) { tries++; setTimeout(attempt, 1500); return; }
        fail(new Error(err?.type === 'peer-unavailable' ? '방을 찾을 수 없습니다. 호스트가 대기 화면을 켜 둔 상태인지 확인하세요' : err?.type || 'peer error'));
      });
    });
  }

  private bind(c: DataConnection) {
    this.conn = c;
    c.on('data', (d) => this.onMessage(d as NetMsg));
    c.on('close', () => { this.conn = null; this.onClose(); });
    c.on('error', () => this.onClose());
    this.onOpen();
  }

  send(m: NetMsg) {
    if (this.conn && this.conn.open) this.conn.send(m);
  }

  close() {
    window.clearInterval(this.hb);
    try { this.wake?.release(); } catch { /* ignore */ }
    document.removeEventListener('visibilitychange', this.onVisible);
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
