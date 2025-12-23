export function createSfx() {
  // 단순 Audio 기반(요청 반영)
  const sfx = {
    bet: new Audio("assets/bet.mp3"),
    throw: new Audio("assets/throw.mp3"),
    flip: new Audio("assets/flip.mp3"),
    win: new Audio("assets/win.mp3"),
    lose: new Audio("assets/lose.mp3"),
    shuffle: new Audio("assets/shuffle.mp3")
  };

  function play(key) {
    const a = sfx[key];
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play();
    } catch {
      // autoplay 정책 등으로 실패할 수 있음: 조용히 무시
    }
  }

  // 최초 사용자 입력에서 한번 풀어주면(모바일) 안정적
  function unlockOnce() {
    const keys = Object.keys(sfx);
    for (const k of keys) {
      const a = sfx[k];
      try {
        a.muted = true;
        a.play().then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        }).catch(() => {
          a.muted = false;
        });
      } catch {}
    }
  }

  return { play, unlockOnce };
}
