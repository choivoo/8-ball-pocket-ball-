/** 플레이어 프로필: 통계, XP/레벨, 업적. localStorage 에 저장되고, 저장소를 못 쓰면 메모리로만 동작한다. */
export interface Stats {
  games: number; wins: number; losses: number;
  shots: number; pots: number; fouls: number; scratches: number;
  breaks: number; breakPots: number;
  bestRun: number; // 한 턴 최다 연속 포켓
  longestPot: number; // 최장 포켓 거리 (m)
  bankPots: number; // 쿠션 후 포켓
  jumps: number; massé: number;
  onlineGames: number; onlineWins: number;
  aiWins: [number, number, number];
  drillsDone: number;
  algakkiGames: number; algakkiWins: number;
  playSeconds: number;
  xp: number;
  achievements: Record<string, number>; // id → 달성 시각
  drillBest: Record<string, number>;
}

export const emptyStats = (): Stats => ({
  games: 0, wins: 0, losses: 0, shots: 0, pots: 0, fouls: 0, scratches: 0, breaks: 0, breakPots: 0,
  bestRun: 0, longestPot: 0, bankPots: 0, jumps: 0, massé: 0, onlineGames: 0, onlineWins: 0,
  aiWins: [0, 0, 0], drillsDone: 0, algakkiGames: 0, algakkiWins: 0, playSeconds: 0, xp: 0, achievements: {}, drillBest: {},
});

export interface Achievement { id: string; name: string; desc: string; xp: number; test: (s: Stats) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_shot', name: '첫 샷', desc: '첫 샷을 친다', xp: 20, test: (s) => s.shots >= 1 },
  { id: 'first_pot', name: '첫 포켓', desc: '공을 처음으로 포켓한다', xp: 30, test: (s) => s.pots >= 1 },
  { id: 'pots_25', name: '손맛', desc: '누적 25개 포켓', xp: 60, test: (s) => s.pots >= 25 },
  { id: 'pots_100', name: '포켓 머신', desc: '누적 100개 포켓', xp: 150, test: (s) => s.pots >= 100 },
  { id: 'pots_500', name: '포켓 마스터', desc: '누적 500개 포켓', xp: 400, test: (s) => s.pots >= 500 },
  { id: 'run_3', name: '3연속', desc: '한 턴에 3개 연속 포켓', xp: 60, test: (s) => s.bestRun >= 3 },
  { id: 'run_5', name: '5연속', desc: '한 턴에 5개 연속 포켓', xp: 120, test: (s) => s.bestRun >= 5 },
  { id: 'run_8', name: '런아웃', desc: '한 턴에 8개 연속 포켓', xp: 300, test: (s) => s.bestRun >= 8 },
  { id: 'win_1', name: '첫 승리', desc: '게임에서 처음 승리', xp: 80, test: (s) => s.wins >= 1 },
  { id: 'win_10', name: '10승', desc: '누적 10승', xp: 200, test: (s) => s.wins >= 10 },
  { id: 'win_50', name: '50승', desc: '누적 50승', xp: 500, test: (s) => s.wins >= 50 },
  { id: 'ai_easy', name: '초급 AI 격파', desc: 'AI 초급에게 승리', xp: 60, test: (s) => s.aiWins[0] >= 1 },
  { id: 'ai_mid', name: '중급 AI 격파', desc: 'AI 중급에게 승리', xp: 150, test: (s) => s.aiWins[1] >= 1 },
  { id: 'ai_hard', name: '고급 AI 격파', desc: 'AI 고급에게 승리', xp: 400, test: (s) => s.aiWins[2] >= 1 },
  { id: 'online_1', name: '온라인 데뷔', desc: '온라인 대전을 한 판 마친다', xp: 80, test: (s) => s.onlineGames >= 1 },
  { id: 'online_win', name: '온라인 승리', desc: '온라인 대전에서 승리', xp: 150, test: (s) => s.onlineWins >= 1 },
  { id: 'long_pot', name: '장거리 포', desc: '2m 이상 거리 포켓', xp: 100, test: (s) => s.longestPot >= 2 },
  { id: 'bank', name: '뱅크샷', desc: '쿠션을 맞고 들어가는 포켓', xp: 100, test: (s) => s.bankPots >= 1 },
  { id: 'bank_10', name: '뱅크 장인', desc: '뱅크샷 10회', xp: 250, test: (s) => s.bankPots >= 10 },
  { id: 'jump', name: '점프샷', desc: '공을 띄우는 점프샷', xp: 60, test: (s) => s.jumps >= 1 },
  { id: 'masse', name: '마세', desc: '엘리베이션+사이드 스핀으로 샷', xp: 60, test: (s) => s.massé >= 1 },
  { id: 'break_pot', name: '파워 브레이크', desc: '브레이크에서 공을 넣는다', xp: 80, test: (s) => s.breakPots >= 1 },
  { id: 'drill_1', name: '연습생', desc: '드릴을 하나 완료', xp: 40, test: (s) => s.drillsDone >= 1 },
  { id: 'drill_10', name: '성실한 연습', desc: '드릴 10회 완료', xp: 200, test: (s) => s.drillsDone >= 10 },
  { id: 'clean', name: '깨끗한 경기', desc: '파울 없이 한 게임 승리', xp: 150, test: (s) => s.achievements['_clean'] > 0 },
  { id: 'comeback', name: '역전승', desc: '상대 공이 3개 이상 더 많이 남은 상태에서 승리', xp: 250, test: (s) => s.achievements['_comeback'] > 0 },
  { id: 'alg_1', name: '알까기 입문', desc: '알까기에서 승리', xp: 60, test: (s) => s.algakkiWins >= 1 },
  { id: 'alg_10', name: '알까기 고수', desc: '알까기 10승', xp: 250, test: (s) => s.algakkiWins >= 10 },
  { id: 'hours_1', name: '단골', desc: '누적 플레이 1시간', xp: 120, test: (s) => s.playSeconds >= 3600 },
];

/** 레벨 곡선: 레벨 n 에 필요한 누적 XP = 100·n·(n-1)/2 + 100·(n-1) */
export function levelFromXp(xp: number): { level: number; cur: number; next: number } {
  let level = 1;
  const need = (n: number) => 50 * n * (n - 1) + 100 * (n - 1);
  while (xp >= need(level + 1)) level++;
  return { level, cur: xp - need(level), next: need(level + 1) - need(level) };
}

const RANKS = ['입문자', '아마추어', '동호인', '클럽 선수', '세미프로', '프로', '마스터', '그랜드마스터', '레전드'];
export const rankOf = (level: number) => RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 4))];

const KEY = 'pool3d.profile.v1';

export class Profile {
  stats: Stats = emptyStats();
  onUnlock: (a: Achievement) => void = () => {};
  onLevelUp: (level: number) => void = () => {};
  private store: Storage | null;

  constructor(store: Storage | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.store = store;
    try {
      const raw = this.store?.getItem(KEY);
      if (raw) this.stats = { ...emptyStats(), ...JSON.parse(raw) };
    } catch { /* 손상된 저장 데이터는 무시 */ }
  }

  save() { try { this.store?.setItem(KEY, JSON.stringify(this.stats)); } catch { /* ignore */ } }

  addXp(n: number) {
    const before = levelFromXp(this.stats.xp).level;
    this.stats.xp += n;
    const after = levelFromXp(this.stats.xp).level;
    if (after > before) this.onLevelUp(after);
  }

  /** 통계를 갱신하고 새로 달성한 업적을 반환한다 */
  update(fn: (s: Stats) => void): Achievement[] {
    fn(this.stats);
    const got: Achievement[] = [];
    for (const a of ACHIEVEMENTS) {
      if (!this.stats.achievements[a.id] && a.test(this.stats)) {
        this.stats.achievements[a.id] = Date.now();
        this.addXp(a.xp);
        got.push(a);
        this.onUnlock(a);
      }
    }
    this.save();
    return got;
  }

  reset() { this.stats = emptyStats(); this.save(); }
}
