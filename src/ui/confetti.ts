/** 승리 연출용 컨페티 (캔버스 2D, 외부 의존 없음) */
export function launchConfetti(duration = 3500) {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = window.innerWidth; c.height = window.innerHeight;
  document.body.append(c);
  const ctx = c.getContext('2d')!;
  const colors = ['#ffbf5e', '#5ec8ff', '#ff6b5e', '#7bdc8a', '#f4f1e8', '#b58cff'];
  const parts = Array.from({ length: 160 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: 4 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    col: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const step = (t: number) => {
    const el = t - t0;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.03;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.globalAlpha = Math.max(0, 1 - el / duration);
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (el < duration) requestAnimationFrame(step); else c.remove();
  };
  requestAnimationFrame(step);
}
