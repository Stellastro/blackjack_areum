import { flyChips } from "./anim.js";

/**
 * Booth Blackjack game engine (client-side).
 * - Modified deck: ranks 0..7 (0 is "ace" valued 8, can drop by 8 if busting)
 * - Bust: > 15
 * - Dealer hits while < 12
 * - Practice: bet=0, money hidden by app (app.js)
 * - Play: betting via buttons, DEAL starts round
 * - Supports SPLIT (same rank) and DOUBLE (exactly 2 cards)
 */
export function createGame({ sfx, getRunId, getMode, onRoundOver, onMoneyChange } = {}) {
  const INITIAL_MONEY = 10000;

  // ---------- Deck ----------
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
    // 4 decks (kept as-is from your earlier ratio)
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

  // ---------- Scoring ----------
  function cardValue(c) { return (c.rank === 0) ? 8 : c.rank; }
  function handValue(hand) {
    let value = 0;
    let aces = 0; // rank=0 count
    for (const c of hand) {
      value += cardValue(c);
      if (c.rank === 0) aces++;
    }
    // "soft" adjustment: each ace can drop by 8 (8 -> 0)
    while (value > 15 && aces) {
      value -= 8;
      aces--;
    }
    return value;
  }
  function isBlackjack15_2cards(hand) {
    return hand.length === 2 && handValue(hand) === 15;
  }

  // ---------- DOM refs ----------
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

  if (!table || !dealerHandEl || !dealerSumEl || !deckStackEl || !playerBlocksEl || !moneyEl || !betEl || !btnDeal) {
    console.error("Missing required DOM elements for game.js");
  }

  // ---------- Game state ----------
  let money = INITIAL_MONEY;

  let pendingBet = 0;    // shown while phase===betting
  let baseBet = 0;       // bet for the first hand (and default for others)

  let dealerHand = [];
  let dealerHidden = true;
  let dealerBlackjack = false;

  let playerHands = [[]];   // array of hands
  let playerBets = [];      // per-hand bet (aligned with playerHands)
  let results = [];         // per-hand result tags
  let outcomes = [];        // optional output text

  let activeHandIdx = 0;

  // betting | resolvingSplit | playing | dealer | roundOver
  let phase = "betting";

  // UI caches
  let handEls = [];
  let actionEls = [];
  let sumEls = [];

  function currentRunId() { return (getRunId ? getRunId() : 0); }

  // ---------- Indicators ----------
  function updateIndicators() {
    if (moneyEl) moneyEl.textContent = money.toLocaleString();

    const shownBet = (phase === "betting" || phase === "roundOver")
      ? pendingBet
      : playerBets.reduce((a, b) => a + b, 0);

    if (betEl) betEl.textContent = shownBet.toLocaleString();
    if (deckCountEl) deckCountEl.textContent = `DECK ${deck.length}`;
  }
  function setDealerSum() {
    if (!dealerSumEl) return;
    dealerSumEl.textContent = dealerHidden ? "?" : String(handValue(dealerHand));
  }
  function setPlayerSums() {
    for (let i = 0; i < playerHands.length; i++) {
      if (sumEls[i]) sumEls[i].textContent = String(handValue(playerHands[i]));
    }
  }

  // ---------- Card DOM (flip) ----------
  function makeCardElement({ faceRank = null, faceUp = false }) {
    const card = document.createElement("div");
    card.className = "card";

    const inner = document.createElement("div");
    inner.className = "card-inner";

    const back = document.createElement("div");
    back.className = "card-back";
    const backImg = document.createElement("img");
    backImg.src = "cards/back.png";
    back.appendChild(backImg);

    const face = document.createElement("div");
    face.className = "card-face";
    const faceImg = document.createElement("img");
    if (faceRank !== null) faceImg.src = `cards/${faceRank}.png`;
    face.appendChild(faceImg);

    inner.appendChild(back);
    inner.appendChild(face);
    card.appendChild(inner);

    if (faceUp) card.classList.add("is-face");
    return card;
  }

  function flipCard(cardEl, rank) {
    if (!cardEl) return;
    const faceImg = cardEl.querySelector(".card-face img");
    if (faceImg && rank !== undefined && rank !== null) {
      faceImg.src = `cards/${rank}.png`;
    }
    sfx?.play?.("flip");
    cardEl.classList.add("is-face");
  }

  // ---------- Geometry helpers ----------
  function viewportToTablePoint(pt) {
    const t = table.getBoundingClientRect();
    return { x: pt.x - t.left, y: pt.y - t.top };
  }
  function elCenterInViewport(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.5 };
  }
  function getDeckCenterTable() {
    return viewportToTablePoint(elCenterInViewport(deckStackEl));
  }
  function getHandCenterTable(handEl) {
    return viewportToTablePoint(elCenterInViewport(handEl));
  }

  // ---------- Deal animation ----------
  function dealCardTo(handEl, { rank, keepFaceDown = true }) {
    const myRun = currentRunId();
    return new Promise((resolve) => {
      if (currentRunId() !== myRun) return resolve(null);

      sfx?.play?.("throw");

      const flying = makeCardElement({
        faceRank: keepFaceDown ? null : rank,
        faceUp: !keepFaceDown
      });

      flying.classList.add("flying");
      table.appendChild(flying);

      const start = getDeckCenterTable();
      const end = getHandCenterTable(handEl);

      // randomized landing inside hand
      const jitterX = (Math.random() - 0.5) * 26;
      const jitterY = (Math.random() - 0.5) * 14;

      flying.style.left = `${start.x - 40}px`;
      flying.style.top = `${start.y - 60}px`;
      flying.style.transform = "translate3d(0,0,0) rotate(0deg)";
      flying.style.opacity = "1";

      // let layout happen then animate
      requestAnimationFrame(() => {
        if (currentRunId() !== myRun) {
          flying.remove();
          return resolve(null);
        }
        const dx = (end.x - 40 + jitterX) - (start.x - 40);
        const dy = (end.y - 60 + jitterY) - (start.y - 60);
        flying.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${(Math.random()-0.5)*14}deg)`;
      });

      // after transition, move into hand
      setTimeout(() => {
        if (currentRunId() !== myRun) {
          flying.remove();
          return resolve(null);
        }
        flying.classList.remove("flying");
        flying.style.left = "";
        flying.style.top = "";
        flying.style.transform = "";
        flying.style.opacity = "";

        handEl.appendChild(flying);
        resolve(flying);
      }, 430);
    });
  }

  async function fadeOutAndClear() {
    const myRun = currentRunId();
    const cards = table.querySelectorAll(".card");
    cards.forEach(c => (c.style.opacity = "0"));
    await new Promise(r => setTimeout(r, 260));
    if (currentRunId() !== myRun) return;
    cards.forEach(c => c.remove());
  }

  // ---------- Player blocks ----------
  function initPlayerBlocks(nHands) {
    playerBlocksEl.innerHTML = "";
    handEls = [];
    actionEls = [];
    sumEls = [];

    for (let idx = 0; idx < nHands; idx++) {
      const block = document.createElement("div");
      block.className = "player-block";
      block.dataset.idx = String(idx);

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

      handEls.push(handEl);
      actionEls.push(actions);
      sumEls.push(sum);
    }
  }

  function markActiveBlock() {
    const blocks = Array.from(playerBlocksEl.querySelectorAll(".player-block"));
    blocks.forEach(b => b.classList.remove("active"));
    if (phase === "playing" || phase === "resolvingSplit") {
      const b = blocks[activeHandIdx] || blocks[0];
      b?.classList.add("active");
    } else if (phase === "betting") {
      blocks[0]?.classList.add("active");
    }
  }

  // ---------- Betting buttons enable ----------
  function setBettingButtonsEnabled(enable) {
    const m = getMode ? getMode() : "play";
    const inBetting = (phase === "betting");

    if (m === "practice") {
      betButtons.forEach(b => (b.disabled = true));
      btnDeal.disabled = !inBetting;
      return;
    }

    if (!enable || m !== "play" || !inBetting) {
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

  function clearAllPlayerActions() {
    for (const el of actionEls) el.innerHTML = "";
  }

  function setSplitChoiceButtons() {
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

      // DOUBLE: only if active hand has 2 cards and enough money to match bet
      if (isActive && playerHands[i].length === 2) {
        const dbl = document.createElement("button");
        dbl.textContent = "DOUBLE";
        dbl.disabled = !(money >= (playerBets[i] || baseBet));
        dbl.onclick = () => playerDouble();
        actionsEl.appendChild(dbl);
      }
    }
  }

  function showProceedButton() {
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

  // ---------- Reset ----------
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

    pendingBet = 0;

    initPlayerBlocks(1);
    dealerHandEl.innerHTML = "";
    setDealerSum();
    updateIndicators();
    setBettingButtonsEnabled(true);
    clearAllPlayerActions();
    markActiveBlock();
  }

  // ---------- Split / Double helpers ----------
  function canSplitNow() {
    const m = getMode ? getMode() : "play";
    if (m !== "play") return false;
    if (playerHands.length !== 1) return false;
    if (playerHands[0].length !== 2) return false;
    const [a, b] = playerHands[0];
    if (a.rank !== b.rank) return false;
    // need to be able to place another baseBet
    return money >= baseBet && baseBet > 0;
  }

  async function doSplit() {
    if (phase !== "resolvingSplit") return;
    const myRun = currentRunId();

    // take second bet
    money -= baseBet;
    onMoneyChange?.(money);

    // create 2 hands from the original 2 cards
    const c1 = playerHands[0][0];
    const c2 = playerHands[0][1];
    playerHands = [[c1], [c2]];
    playerBets = [baseBet, baseBet];
    results = [];
    outcomes = [];
    activeHandIdx = 0;

    // rebuild blocks UI to 2 hands and move existing 2 cards into them
    initPlayerBlocks(2);
    markActiveBlock();

    // clear existing cards from dealer/player areas and re-deal visuals (simplest, consistent)
    dealerHandEl.innerHTML = "";
    // re-render dealer cards from state (2 cards already exist)
    for (let i = 0; i < dealerHand.length; i++) {
      const keepDown = (i === 1) && dealerHidden;
      const cardEl = makeCardElement({ faceRank: keepDown ? null : dealerHand[i].rank, faceUp: !keepDown });
      dealerHandEl.appendChild(cardEl);
      if (!keepDown) cardEl.classList.add("is-face");
    }

    // render split player cards (face up)
    for (let h = 0; h < 2; h++) {
      const cardEl = makeCardElement({ faceRank: playerHands[h][0].rank, faceUp: true });
      cardEl.classList.add("is-face");
      handEls[h].appendChild(cardEl);
    }

    // each hand draws one extra card (face-down flight, then flip)
    for (let h = 0; h < 2; h++) {
      if (currentRunId() !== myRun) return;
      const c = drawCard();
      playerHands[h].push(c);
      const el = await dealCardTo(handEls[h], { rank: c.rank, keepFaceDown: true });
      if (currentRunId() !== myRun) return;
      flipCard(el, c.rank);
    }

    setPlayerSums();
    setDealerSum();

    phase = "playing";
    activeHandIdx = 0;
    markActiveBlock();
    setPlayButtons();
    updateIndicators();
  }

  function cancelSplit() {
    if (phase !== "resolvingSplit") return;
    phase = "playing";
    activeHandIdx = 0;
    markActiveBlock();
    setPlayButtons();
    updateIndicators();
  }

  // ---------- Player actions ----------
  async function playerHit() {
    if (phase !== "playing") return;
    const myRun = currentRunId();
    const i = activeHandIdx;

    const c = drawCard();
    playerHands[i].push(c);

    const el = await dealCardTo(handEls[i], { rank: c.rank, keepFaceDown: true });
    if (currentRunId() !== myRun) return;

    flipCard(el, c.rank);
    setPlayerSums();

    if (handValue(playerHands[i]) > 15) {
      // bust this hand
      results[i] = "bust";
      if (sumEls[i]) sumEls[i].textContent = "BUST";
      await advanceOrDealer();
    } else {
      setPlayButtons();
      updateIndicators();
    }
  }

  async function playerStand() {
    if (phase !== "playing") return;
    results[activeHandIdx] = "stand";
    await advanceOrDealer();
  }

  async function playerDouble() {
    if (phase !== "playing") return;
    const i = activeHandIdx;

    // only allow on 2 cards
    if (playerHands[i].length !== 2) return;

    const add = (playerBets[i] || baseBet);
    if (money < add) return;

    money -= add;
    playerBets[i] = (playerBets[i] || baseBet) + add; // double
    onMoneyChange?.(money);

    // one hit then stand
    await playerHit();
    if (phase !== "playing") return;
    results[i] = "stand";
    await advanceOrDealer();
  }

  async function advanceOrDealer() {
    // move to next unfinished hand, else dealer turn
    for (let j = activeHandIdx + 1; j < playerHands.length; j++) {
      if (!results[j]) {
        activeHandIdx = j;
        markActiveBlock();
        setPlayButtons();
        updateIndicators();
        return;
      }
    }
    // all hands done
    phase = "dealer";
    markActiveBlock();
    clearAllPlayerActions();
    await dealerTurnAndResolve();
  }

  // ---------- Dealer turn & resolve ----------
  async function dealerTurnAndResolve() {
    const myRun = currentRunId();

    // reveal hidden card
    dealerHidden = false;
    setDealerSum();
    const dCards = dealerHandEl.querySelectorAll(".card");
    if (dCards[1]) flipCard(dCards[1], dealerHand[1]?.rank);

    // dealer hits while < 12 (unless blackjack already)
    if (!dealerBlackjack) {
      while (handValue(dealerHand) < 12) {
        if (currentRunId() !== myRun) return;
        const c = drawCard();
        dealerHand.push(c);

        const el = await dealCardTo(dealerHandEl, { rank: c.rank, keepFaceDown: true });
        if (currentRunId() !== myRun) return;

        flipCard(el, c.rank);
        setDealerSum();
      }
    }

    // resolve
    const m = getMode ? getMode() : "play";
    const dealerScore = handValue(dealerHand);
    const dealerBust = dealerScore > 15;

    let anyWin = false;
    let anyLose = false;

    for (let i = 0; i < playerHands.length; i++) {
      // if bust already
      if (results[i] === "bust") {
        if (sumEls[i]) sumEls[i].textContent = "LOSE";
        anyLose = true;
        continue;
      }

      const score = handValue(playerHands[i]);

      let res = "PUSH";
      if (dealerBust) res = "WIN";
      else if (score > dealerScore) res = "WIN";
      else if (score < dealerScore) res = "LOSE";
      else res = "PUSH";

      if (sumEls[i]) sumEls[i].textContent = res;

      if (m === "play") {
        const bet = playerBets[i] ?? baseBet;
        if (res === "WIN") money += bet * 2;
        else if (res === "PUSH") money += bet;
        onMoneyChange?.(money);
      }

      if (res === "WIN") anyWin = true;
      if (res === "LOSE") anyLose = true;
    }

    if (anyWin && !anyLose) sfx?.play?.("win");
    else if (anyLose) sfx?.play?.("lose");

    phase = "roundOver";
    markActiveBlock();
    showProceedButton();

    onRoundOver?.({ money, phase, outcome: anyWin ? "WIN" : "LOSE", mode: m });
    updateIndicators();
  }

  // ---------- Betting handlers ----------
  betButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (phase !== "betting") return;
      const m = getMode ? getMode() : "play";
      if (m !== "play") return;

      const delta = Number(btn.dataset.delta || "0");
      const next = pendingBet + delta;
      if (!(next >= 0 && next <= money)) return;

      sfx?.play?.("bet");
      pendingBet = next;
      updateIndicators();
      setBettingButtonsEnabled(true);
    });
  });

  btnDeal.addEventListener("click", async () => {
    if (phase !== "betting") return;

    const m = getMode ? getMode() : "play";
    const myRun = currentRunId();

    if (m === "play") {
      if (pendingBet <= 0) return;
      if (pendingBet > money) return;
    } else if (m === "practice") {
      // allow bet=0
    } else {
      return;
    }

    // DEAL sound = bet
    sfx?.play?.("bet");

    // round start shuffle
    if (deck.length === 0) createDeck();
    shuffle(deck);
    sfx?.play?.("shuffle");

    phase = "dealer"; // temporarily block betting
    setBettingButtonsEnabled(false);

    baseBet = (m === "practice") ? 0 : pendingBet;
    pendingBet = 0;

    if (m === "play") {
      money -= baseBet;
      onMoneyChange?.(money);

      // chip fly
      try {
        const fromEl = handEls[0] || playerBlocksEl;
        flyChips({ bet: baseBet, fromEl, toEl: deckStackEl, chipSrc: "assets/chip.png", getRunId });
      } catch {}
    }

    // reset round state
    dealerHand = [];
    playerHands = [[]];
    playerBets = [baseBet];
    results = [];
    outcomes = [];
    dealerHidden = true;
    dealerBlackjack = false;
    activeHandIdx = 0;

    // reset DOM areas
    dealerHandEl.innerHTML = "";
    initPlayerBlocks(1);
    markActiveBlock();

    // deal 2 rounds (face down flights)
    for (let t = 0; t < 2; t++) {
      if (currentRunId() !== myRun) return;

      const p = drawCard(); playerHands[0].push(p);
      await dealCardTo(handEls[0], { rank: p.rank, keepFaceDown: true });
      if (currentRunId() !== myRun) return;

      const d = drawCard(); dealerHand.push(d);
      await dealCardTo(dealerHandEl, { rank: d.rank, keepFaceDown: true });
      if (currentRunId() !== myRun) return;
    }

    // flip: player both, dealer first only
    const pCards = handEls[0].querySelectorAll(".card");
    flipCard(pCards[0], playerHands[0][0].rank);
    flipCard(pCards[1], playerHands[0][1].rank);

    const dCards = dealerHandEl.querySelectorAll(".card");
    flipCard(dCards[0], dealerHand[0].rank);

    setPlayerSums();
    setDealerSum();

    // blackjack check
    const pBJ = isBlackjack15_2cards(playerHands[0]);
    const dBJ = isBlackjack15_2cards(dealerHand);
    dealerBlackjack = dBJ;

    if (pBJ || dBJ) {
      dealerHidden = false;
      if (dCards[1]) flipCard(dCards[1], dealerHand[1].rank);
      setDealerSum();

      let text = "PUSH";
      if (pBJ && !dBJ) text = "BLACKJACK!!";
      else if (!pBJ && dBJ) text = "LOSE";
      else text = "PUSH";

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

      if (sumEls[0]) sumEls[0].textContent = text;

      phase = "roundOver";
      markActiveBlock();
      showProceedButton();
      onRoundOver?.({ money, phase, outcome: text, mode: m });
      updateIndicators();
      return;
    }

    // if splittable, ask
    if (canSplitNow()) {
      phase = "resolvingSplit";
      activeHandIdx = 0;
      markActiveBlock();
      setSplitChoiceButtons();
      updateIndicators();
      return;
    }

    // normal play
    phase = "playing";
    activeHandIdx = 0;
    markActiveBlock();
    setPlayButtons();
    updateIndicators();
  });

  // ---------- init ----------
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

  return { resetSession };
}
