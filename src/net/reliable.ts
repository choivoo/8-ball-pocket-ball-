/**
 * 손실/중복/순서 뒤바뀜이 있는 링크 위에서 "정확히 한 번, 순서대로" 전달을 보장하는 얇은 계층.
 * 모든 메시지는 누적 ack(a)를 싣고 다니며, 미확인 메시지는 tick() 마다 재전송된다.
 */
export interface WireMsg { q: number; a: number; m: unknown }

export class ReliableChannel {
  private nextSend = 0;
  private outbox: { q: number; m: unknown }[] = [];
  private nextRecv = 0;
  private buffer = new Map<number, unknown>();

  constructor(private transmit: (w: WireMsg) => void, private deliver: (m: unknown) => void) {}

  get pending() { return this.outbox.length; }

  send(m: unknown) {
    const q = this.nextSend++;
    this.outbox.push({ q, m });
    this.transmit({ q, a: this.nextRecv - 1, m });
  }

  receive(w: WireMsg) {
    if (w.a >= 0) this.outbox = this.outbox.filter((o) => o.q > w.a);
    if (w.q < 0) return;
    if (w.q >= this.nextRecv && !this.buffer.has(w.q)) this.buffer.set(w.q, w.m);
    while (this.buffer.has(this.nextRecv)) {
      const m = this.buffer.get(this.nextRecv);
      this.buffer.delete(this.nextRecv);
      this.nextRecv++;
      this.deliver(m);
    }
    // 중복/지연 수신에도 상대가 ack 를 받을 수 있게 즉시 ack
    this.transmit({ q: -1, a: this.nextRecv - 1, m: { t: '__ack' } });
  }

  /** 주기적으로 호출: 미확인 메시지 재전송 (없으면 ack 만 갱신) */
  tick() {
    const a = this.nextRecv - 1;
    if (this.outbox.length === 0) { this.transmit({ q: -1, a, m: { t: '__ping' } }); return; }
    for (const o of this.outbox.slice(0, 24)) this.transmit({ q: o.q, a, m: o.m });
  }
}
