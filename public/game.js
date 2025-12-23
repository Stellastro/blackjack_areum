import { flyChips } from "./anim.js";

export function createGame({ sfx, getRunId, getMode, onRoundOver, onMoneyChange } = {}) {
  const INITIAL_MONEY = 10000;
  // ---------- 덱(원본 동일) ----------
  let deck = [];
  function createDeck() {
    deck = [];
    const ranks = [
      0, 0, 0, 0,
      1, 1, 1, 1, 1,
      2, 2, 2, 2, 2,
      3, 3, 3, 3, 3,
      4, 4, 4, 4, 4,
      5, 5, 5, 5, 5, 5,
      6, 6, 6, 6, 6, 6,
      7, 7, 7, 7, 7, 7, 7, 7,
      7, 7, 7, 7, 7, 7, 7, 7
    ];
    for (let k = 0; k < 4; k++) {
      for (const r of ranks) deck.push({ rank: r });
    }
    shuffle(deck);
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }
  function drawCard() {
    if (deck.length === 0) createDeck();
    return deck.pop();
  }
  
  // ---------- 점수(원본 동일) ----------
  function cardValue(c) {
    return (c.rank === 0) ? 8 : c.rank;
  }
  function handValue(hand) {
    let value = 0;
    let aces = 0; // rank=0 개수
    for (const c of hand) {
      value += cardValue(c);
      if (c.rank === 0) aces++;
    }
    while (value > 15 && aces) {
      value -= 8;
      aces--;
    }
    return value;
  }
  function isBlackjack15_2cards(hand) {
    return (hand.length === 2 && handValue(hand) === 15);
  }
  
  // ---------- UI 참조 ----------
  const table = document.getElementById("table");
  
  const dealerHandEl = document.getElementById("dealerHand");
  const dealerSumEl = document.getElementById("dealerSum");
  
  const deckStackEl = document.getElementById("deckStack");
  const deckCountEl = document.getElementById("deckCount");
  
  const playerBlocksEl = document.getElementById("playerBlocks");
  const moneyEl = document.getElementById("money");
  const betEl = document.getElementById("bet");
  
  const betButtons = Array.from(document.querySelectorAll(".betBtn"));
  const btnDeal = document.getElementById("btnDeal");
  
  // ---------- 게임 상태 ----------
  let money = INITIAL_MONEY;
  let pendingBet = 0;     // ✅ 베팅은 0부터 시작(버튼으로만 증가)
  let baseBet = 0;        // 현재 라운드의 1핸드 베팅(스플릿 시 손패별로 동일)
  let phase = "betting";  // betting | resolvingSplit | playing | dealer | roundOver
  
  let dealerHand = [];
  let dealerHidden = true;
  let dealerBlackjack = false;
  
  let playerHands = [[]]; // 스플릿 시 [hand1, hand2]
  let playerBets = [];    // 각 핸드별 베팅
  let results = [];       // 'done' | 'stand'
  let outcomes = [];      // 'blackjack' | 'bust' | null (표시/정산 보조)
  let activeHandIdx = 0;
  
  // 핸드 DOM 참조 캐시(라운드 중 불필요한 재렌더 방지)
  let handEls = [];       // [#playerHand0, #playerHand1...]
  let actionEls = [];     // [#actions0, #actions1...]
  let sumEls = [];        // [#playerSum0, #playerSum1...]
  
  // ---------- 인디케이터 ----------
  function updateIndicators() {
    moneyEl.textContent = money.toLocaleString();
  
    // ✅ 베팅 표시: betting 단계에서는 pendingBet, 그 외엔 playerBets 합
    const shownBet = (phase === "betting" || phase === "roundOver")
      ? pendingBet
      : (playerBets.reduce((a, b) => a + b, 0));
  
    betEl.textContent = shownBet.toLocaleString();
    if (deckCountEl) deckCountEl.textContent = `DECK ${deck.length}`;
  }
  function setDealerSum() {
    dealerSumEl.textContent = dealerHidden ? "?" : String(handValue(dealerHand));
  }
  function setPlayerSums() {
    for (let i = 0; i < playerHands.length; i++) {
      if (sumEls[i]) sumEls[i].textContent = String(handValue(playerHands[i]));
    }
  }
  
  // ---------- 카드 DOM (img + flip) ----------
  function makeCardElement({ faceRank = null, faceUp = false }) {
    const card = document.createElement("div");
    card.className = "card";
  
    const inner = document.createElement("div");
    inner.className = "card-inner";
  
    const back = document.createElement("div");
    back.className = "card-back";
    const backImg = document.createElement("img");
    backImg.src = "cards/back.png"; // png로 바꾸면 back.png
    back.appendChild(backImg);
  
    const face = document.createElement("div");
    face.className = "card-face";
    const faceImg = document.createElement("img");
    if (faceRank !== null) faceImg.src = `cards/${faceRank}.png`; // png면 .png
    face.appendChild(faceImg);
  
    inner.appendChild(back);
    inner.appendChild(face);
    card.appendChild(inner);
  
    if (faceUp) card.classList.add("is-face");
    return card;
  }
  
  function flipCard(cardEl, rank) {
    const faceImg = cardEl.querySelector(".card-face img");
    if (rank !== undefined && rank !== null) {
      faceImg.src = `cards/${rank}.png`; // png면 .png
    }
    sfx?.play?.("flip");
    cardEl.classList.add("is-face");
    // sfx.flip?.play(); // 추후
  }
  
  // ---------- 좌표 유틸 ----------
  function viewportToTablePoint(pt) {
    const tr = table.getBoundingClientRect();
    return { x: pt.x - tr.left, y: pt.y - tr.top };
  }
  
  function getCenterViewport(el){
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  
  function getHandCenterTable(handEl){
    return viewportToTablePoint(getCenterViewport(handEl));
  }
  function getDeckCenterTable(){
    return viewportToTablePoint(getCenterViewport(deckStackEl));
  }
  
  function dealCardTo(handEl, { rank, keepFaceDown = true }) {
    const myRun = (getRunId ? getRunId() : 0);
    return new Promise((resolve) => {
      if (getRunId && getRunId() !== myRun) return resolve(null);
      // 카드 1장 분배 소리
      sfx?.play?.("throw");
      const flying = makeCardElement({
        faceRank: keepFaceDown ? null : rank,
        faceUp: !keepFaceDown
      });
  
      flying.classList.add("flying");
      table.appendChild(flying);
  
      // 시작/도착 좌표: 반드시 "table 로컬 좌표"
      const start = getDeckCenterTable();
      const end   = getHandCenterTable(handEl);
  
      // 요소 크기
      const w = flying.offsetWidth;
      const h = flying.offsetHeight;
  
      const startX = start.x - w / 2;
      const startY = start.y - h / 2;
      const endX   = end.x   - w / 2;
      const endY   = end.y   - h / 2;
  
      // 시작 위치 세팅 (transition 없이)
      flying.style.transition = "none";
      flying.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;
  
      // ✅ reflow 강제(이게 없으면 ‘안 움직임’이 재발할 수 있습니다)
      flying.getBoundingClientRect();
  
      // 이동 시작 (transition 복원)
      flying.style.transition = ""; // .flying CSS의 transition 사용
      requestAnimationFrame(() => {
        flying.style.transform = `translate3d(${endX}px, ${endY}px, 0)`;
      });
  
      flying.addEventListener("transitionend", (e) => {
        if (e.propertyName !== "transform") return;
        flying.classList.remove("flying");
        flying.style.transform = "";
        handEl.appendChild(flying);
        if (getRunId && getRunId() !== myRun) { try { flying.remove(); } catch {} return resolve(null); }
      resolve(flying);
      }, { once: true });
    });
  }
  
  // ---------- 라운드 종료 페이드아웃 ----------
  function fadeOutAndClear() {
    const allCards = table.querySelectorAll(".card");
    allCards.forEach(c => c.classList.add("fade-out"));
    requestAnimationFrame(() => allCards.forEach(c => c.classList.add("go")));
    return new Promise((resolve) => {
      setTimeout(() => {
        dealerHandEl.innerHTML = "";
        playerBlocksEl.innerHTML = "";
        resolve();
      }, 460);
    });
  }
  
  // ---------- 플레이어 블록 생성(스플릿 대응) ----------
  function initPlayerBlocks(nHands) {
    playerBlocksEl.innerHTML = "";
    handEls = [];
    actionEls = [];
    sumEls = [];
  
    for (let idx = 0; idx < nHands; idx++) {
      const block = document.createElement("div");
      block.className = "player-block";
      if (idx === activeHandIdx && phase === "playing") block.classList.add("active");
  
      const head = document.createElement("div");
      head.className = "player-head";
  
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = (nHands === 1) ? "PLAYER 0" : `PLAYER ${idx}`;
  
      const sum = document.createElement("div");
      sum.className = "sum";
      sum.id = `playerSum${idx}`;
      sum.textContent = "0";
  
      head.appendChild(label);
      head.appendChild(sum);
  
      const handEl = document.createElement("div");
      handEl.className = "hand";
      handEl.id = `playerHand${idx}`;
  
      const actions = document.createElement("div");
      actions.className = "player-actions";
      actions.id = `actions${idx}`;
  
      block.appendChild(head);
      block.appendChild(handEl);
      block.appendChild(actions);
      playerBlocksEl.appendChild(block);
  
      handEls[idx] = handEl;
      actionEls[idx] = actions;
      sumEls[idx] = sum;
    }
  }
  
  function markActiveBlock() {
    const blocks = playerBlocksEl.querySelectorAll(".player-block");
    blocks.forEach((b, idx) => {
      b.classList.toggle("active", phase === "playing" && idx === activeHandIdx);
    });
  }
  
  // ---------- 버튼 세트 설정 ----------
  function setBettingButtonsEnabled(enabled) {
    // betting UI는 updateBettingButtonsValidity()에서 통합 제어
    if (!enabled) {
      betButtons.forEach(b => b.disabled = true);
      btnDeal.disabled = true;
    }
  
  function updateBettingButtonsValidity() {
    const m = getMode ? getMode() : "play";
    const inBetting = (phase === "betting");
  
    if (m === "practice") {
      // +/- 비활성, DEAL만 허용(베팅은 0)
      betButtons.forEach(b => (b.disabled = true));
      btnDeal.disabled = !inBetting;
      return;
    }
  
    if (m !== "play" || !inBetting) {
      betButtons.forEach(b => (b.disabled = true));
      btnDeal.disabled = true;
      return;
    }
  
    for (const b of betButtons) {
      const delta = Number(b.dataset.delta || "0");
      const next = pendingBet + delta;
      b.disabled = !(next >= 0 && next <= money);
    }
    btnDeal.disabled = !(pendingBet > 0 && pendingBet <= money);
  }
  }
  
  function clearAllPlayerActions() {
    for (const el of actionEls) el.innerHTML = "";
  }
  
  function setSplitChoiceButtons() {
    // ✅ 스플릿 가능 시: SPLIT / DO NOT (PLAYER 0에만 표시)
    clearAllPlayerActions();
    const el = actionEls[0];
    if (!el) return;
  
    const b1 = document.createElement("button");
    b1.textContent = "SPLIT";
    b1.onclick = () => doSplit();
  
    const b2 = document.createElement("button");
    b2.textContent = "DO NOT";
    b2.onclick = () => cancelSplit();
  
    el.appendChild(b1);
    el.appendChild(b2);
  }
  
  function setPlayButtons() {
    // ✅ playing 시: 각 핸드에 HIT/STAND (+조건부 DOUBLE), 비활성은 disabled
    for (let i = 0; i < playerHands.length; i++) {
      const actionsEl = actionEls[i];
      if (!actionsEl) continue;
      actionsEl.innerHTML = "";
  
      const isActive = (phase === "playing" && i === activeHandIdx);
  
      const hit = document.createElement("button");
      hit.textContent = "HIT";
      hit.disabled = !isActive;
      hit.onclick = () => playerHit();
  
      const stand = document.createElement("button");
      stand.textContent = "STAND";
      stand.disabled = !isActive;
      stand.onclick = () => playerStand();
  
      actionsEl.appendChild(hit);
      actionsEl.appendChild(stand);
  
      // 더블: 원본처럼 “현재 핸드가 2장이고 money>=baseBet”일 때만 표시(또는 disabled)
      if (isActive && playerHands[i].length === 2) {
        const dbl = document.createElement("button");
        dbl.textContent = "DOUBLE";
        dbl.disabled = (money < baseBet);
        dbl.onclick = () => playerDouble();
        actionsEl.appendChild(dbl);
      }
    }
  }
  
  function showProceedButton() {
    // ✅ PROCEED 단일 버튼(PLAYER 0 actions에만)
    clearAllPlayerActions();
    const el = document.getElementById("actions0");
    if (!el) return;
  
    el.innerHTML = "";
    const btn = document.createElement("button");
    btn.textContent = "PROCEED";
    btn.onclick = async () => {
      await fadeOutAndClear();
      resetToBetting();
    };
    el.appendChild(btn);
  }
  
  // ---------- 상태 초기화 ----------
  function resetToBetting() {
    phase = "betting";
    baseBet = 0;
  
    dealerHand = [];
    dealerHidden = true;
    dealerBlackjack = false;
  
    playerHands = [[]];
    playerBets = [];
    results = [];
    outcomes = [];
    activeHandIdx = 0;
  
    pendingBet = 0; // ✅ 라운드 끝나면 베팅 0으로 초기화
  
    initPlayerBlocks(1); // 화면상 PLAYER 0 블록은 항상 준비
    setDealerSum();
    updateIndicators();
    setBettingButtonsEnabled(true);
  
    // betting 단계에서는 액션 버튼 없음
    clearAllPlayerActions();
  }
  
  // ---------- 베팅 버튼 ----------
  
  // (event listeners are attached in createGame)
  
  // ---------- 베팅 버튼 이벤트(부스 버전: 7개 버튼) ----------
  betButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (phase !== "betting") return;
      const m = getMode ? getMode() : "play";
      if (m !== "play") return;
  
      const delta = Number(btn.dataset.delta || "0");
      const next = pendingBet + delta;
      if (!(next >= 0 && next <= money)) return;
  
      // 베팅 버튼 소리
      sfx?.play?.("bet");
  
      pendingBet = next;
      updateIndicators();
    });
  });
  
  // ---------- DEAL 버튼 ----------
  btnDeal.addEventListener("click", async () => {
    if (phase !== "betting") return;
  
    const m = getMode ? getMode() : "play";
    const myRun = (getRunId ? getRunId() : 0);
  
    if (m === "play") {
      if (pendingBet <= 0) return;
      if (pendingBet > money) return;
    } else if (m === "practice") {
      // 연습은 bet=0으로 허용
    } else {
      return;
    }
  
    // DEAL 효과음 = bet
    sfx?.play?.("bet");
  
    // 라운드 시작
    if (deck.length === 0) createDeck();
    shuffle(deck); // 원본: 라운드 시작 시 셔플
    sfx?.play?.("shuffle");
  
    phase = "dealing";
    setBettingButtonsEnabled(false);
  
    baseBet = (m === "practice") ? 0 : pendingBet;
    pendingBet = 0;               // DEAL 누르면 입력 베팅은 0으로 리셋
  
    if (m === "play") {
      money -= baseBet;
    onMoneyChange?.(money);
      onMoneyChange?.(money);
  
      // 칩 애니메이션: 플레이어 핸드 -> 덱
      try {
        const fromEl = handEls[0] || playerBlocksEl;
        flyChips({ bet: baseBet, fromEl, toEl: deckStackEl, chipSrc: "assets/chip.png", getRunId });
      } catch {}
    }
  
    dealerHand = [];
    playerHands = [[]];
    playerBets = [baseBet];
    results = [];
    outcomes = [];
    dealerHidden = true;
  
    // UI 블록 1개 재생성(카드 DOM 정리)
    initPlayerBlocks(1);
  
    // 딜: “모두 뒷면으로” 덱에서 날아옴
    for (let t = 0; t < 2; t++) {
      if (getRunId && getRunId() !== myRun) return;
  
      const p = drawCard(); playerHands[0].push(p);
      await dealCardTo(handEls[0], { rank: p.rank, keepFaceDown: true });
      if (getRunId && getRunId() !== myRun) return;
  
      const d = drawCard(); dealerHand.push(d);
      await dealCardTo(dealerHandEl, { rank: d.rank, keepFaceDown: true });
      if (getRunId && getRunId() !== myRun) return;
    }
  
    // 공개 규칙:
    // 플레이어 2장 공개(뒤집기)
    const pCards = handEls[0].querySelectorAll(".card");
    flipCard(pCards[0], playerHands[0][0].rank);
    flipCard(pCards[1], playerHands[0][1].rank);
  
    // 딜러는 1장만 공개
    const dCards = dealerHandEl.querySelectorAll(".card");
    flipCard(dCards[0], dealerHand[0].rank);
  
    // 블랙잭(2장 15) 즉시 처리
    const pBJ = isBlackjack15_2cards(playerHands[0]);
    const dBJ = isBlackjack15_2cards(dealerHand);
    dealerBlackjack = dBJ;
  
    if (pBJ || dBJ) {
      dealerHidden = false;
      if (dCards[1]) flipCard(dCards[1], dealerHand[1].rank);
  
      // 결과 처리(원본 로직 유지)
      let text = "PUSH";
      if (pBJ && !dBJ) text = "BLACKJACK!!";
      else if (!pBJ && dBJ) text = "LOSE";
      else text = "PUSH";
  
      // 정산: BJ 승리=WIN로 취급(원본 유지)
      if (text === "BLACKJACK!!") {
        if (m === "play") money += baseBet * 2;
        onMoneyChange?.(money);
        sfx?.play?.("win");
      } else if (text === "LOSE") {
        sfx?.play?.("lose");
      } else {
        if (m === "play") money += baseBet;
        onMoneyChange?.(money);
      }
      onMoneyChange?.(money);
  
      if (sumEls[0]) sumEls[0].textContent = text;
  
      phase = "roundOver";
      markActiveBlock();
      showProceedButton();
  
      onRoundOver?.({ money, phase, outcome: text, mode: m });
      updateIndicators();
      return;
    }
  
    // 정상 진행
    phase = "playing";
    activeHandIdx = 0;
    markActiveBlock();
    setPlayButtons();
    updateIndicators();
  });
  
  // ---------- 시작(모듈) ----------
  createDeck();
  resetToBetting();
  updateIndicators();
  
  function resetSession({ money: m = INITIAL_MONEY } = {}) {
    money = m;
    pendingBet = 0;
    baseBet = 0;
    onMoneyChange?.(money);
    resetToBetting();
    updateIndicators();
  }
  
  return {
    resetSession,
    resetToBetting,
    getMoney: () => money,
    getPhase: () => phase
  };
}
