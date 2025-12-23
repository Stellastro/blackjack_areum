export function flyChips({ bet, fromEl, toEl, chipSrc = "assets/chip.png", getRunId }) {
  const n = Math.min(20, Math.floor(bet / 100));
  if (!fromEl || !toEl || n <= 0) return;

  const runId = getRunId?.() ?? 0;

  const from = fromEl.getBoundingClientRect();
  const to = toEl.getBoundingClientRect();

  // 출발점: fromEl 중앙 근처
  const startX = from.left + from.width * 0.5;
  const startY = from.top + from.height * 0.5;

  // 1단계 목표: 화면 중앙 근처(약간 랜덤)
  const midX = window.innerWidth * 0.5;
  const midY = window.innerHeight * 0.55;

  // 2단계 목표: toEl 중앙
  const endX = to.left + to.width * 0.5;
  const endY = to.top + to.height * 0.5;

  const chips = [];
  for (let i = 0; i < n; i++) {
    const img = document.createElement("img");
    img.src = chipSrc;
    img.className = "chip-fly";
    document.body.appendChild(img);
    chips.push(img);

    // 약간 산개
    const dx = (Math.random() - 0.5) * 40;
    const dy = (Math.random() - 0.5) * 28;

    img.style.left = (startX - 13 + dx) + "px";
    img.style.top  = (startY - 13 + dy) + "px";
  }

  requestAnimationFrame(() => {
    if (getRunId && getRunId() !== runId) {
      chips.forEach(c => c.remove());
      return;
    }
    for (const img of chips) {
      img.style.opacity = "1";
      img.style.transform = `translate3d(${midX - parseFloat(img.style.left) - 13}px, ${midY - parseFloat(img.style.top) - 13}px, 0) scale(1.05)`;
    }
  });

  // 2단계: 덱으로 이동하며 fade
  setTimeout(() => {
    if (getRunId && getRunId() !== runId) {
      chips.forEach(c => c.remove());
      return;
    }
    for (const img of chips) {
      img.style.opacity = "0";
      img.style.transform = `translate3d(${endX - parseFloat(img.style.left) - 13}px, ${endY - parseFloat(img.style.top) - 13}px, 0) scale(.9)`;
    }
  }, 330);

  // 제거
  setTimeout(() => {
    chips.forEach(c => c.remove());
  }, 820);
}
