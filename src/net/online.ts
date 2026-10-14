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

  host(): Promise<string> {
    this.isHost = true;
    return new Promise((resolve, reject) => {
      const tryCode = (attempt: number) => {
        const code = randomCode();
        const peer = new Peer(PREFIX + code);
        peer.on('open', () => {
          this.peer = peer; this.code = code;
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

  join(code: string): Promise<void> {
    this.isHost = false;
    this.code = code.toUpperCase().trim();
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      const timer = setTimeout(() => reject(new Error('연결 시간 초과')), 15000);
      peer.on('open', () => {
        const c = peer.connect(PREFIX + this.code, { reliable: true });
        c.on('open', () => { clearTimeout(timer); this.bind(c); resolve(); });
        c.on('error', (e) => { clearTimeout(timer); reject(e); });
      });
      peer.on('error', (err: any) => { clearTimeout(timer); reject(new Error(err?.type === 'peer-unavailable' ? '방을 찾을 수 없습니다' : err?.type || 'peer error')); });
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
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
