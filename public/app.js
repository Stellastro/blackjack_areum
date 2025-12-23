import { createSfx } from "./sound.js";
import { createLeaderboardClient } from "./leaderboardClient.js";
import { createGame } from "./game.js";

const screens = {
  name: document.getElementById("screenName"),
  prestart: document.getElementById("screenPrestart"),
  result: document.getElementById("screenResult")
};
const table = document.getElementById("table");

const nameInput = document.getElementById("nameInput");
const btnNameConfirm = document.getElementById("btnNameConfirm");

const prestartTimerEl = document.getElementById("prestartTimer");
const btnStart = document.getElementById("btnStart");

const playHud = document.getElementById("playHud");
const playTimerEl = document.getElementById("playTimer");
const leaderboardPanel = document.getElementById("leaderboardPanel");
const leaderboardList = document.getElementById("leaderboardList");

const resultScoreEl = document.getElementById("resultScore");
const resultRankEl = document.getElementById("resultRank");
const btnReturn = document.getElementById("btnReturn");

const moneyBoxEl = document.getElementById("moneyBox");

// -------------------- App state --------------------
let appStage = "NAME"; // NAME | PRACTICE | PRESTART | PLAY | RESULT
let runId = 1;

let playerName = "";
let practiceRoundsDone = 0;
let practiceCompletedPending = false;
let endAfterProceedReason = null;

let timerHandle = null;
let remaining = 120;
let pendingEndReason = null; // 'timeup'
let finalized = false;

const sfx = createSfx();
const lb = createLeaderboardClient();

function getRunId() { return runId; }
function mode() {
  if (appStage === "PRACTICE") return "practice";
  if (appStage === "PLAY") return "play";
  return "disabled";
}

// -------------------- Game instance --------------------
const game = createGame({
  sfx,
  getRunId,
  getMode: mode,

  // NOTE: do not finalize immediately on money change.
  // We finalize after the player sees the round outcome and clicks PROCEED.
  onMoneyChange: (_m) => {},

  onRoundOver: ({ money }) => {
    if (appStage === "PRACTICE") {
      practiceRoundsDone += 1;
      if (practiceRoundsDone >= 2) {
        // Wait for PROCEED before moving on to the 2-minute timer screen.
        practiceCompletedPending = true;
      }
      return;
    }

    if (appStage === "PLAY") {
      // If the timer expired during a round, or the player went broke, wait for PROCEED.
      if (pendingEndReason) {
        endAfterProceedReason = pendingEndReason;
        pendingEndReason = null;
      } else if (money === 0) {
        endAfterProceedReason = "broke";
      }
    }
  },

  // Called when the round-end PROCEED button is clicked.
  // Return true to indicate the app handled the transition.
  onProceed: ({ money }) => {
    if (appStage === "PRACTICE") {
      if (practiceCompletedPending) {
        practiceCompletedPending = false;
        goPrestart();
        return true;
      }
      return false; // default: reset to betting for next practice round
    }

    if (appStage === "PLAY") {
      if (endAfterProceedReason) {
        const r = endAfterProceedReason;
        endAfterProceedReason = null;
        finalizeSession(r);
        return true;
      }
      return false; // default: reset to betting for next round
    }

    return false;
  }
});

// -------------------- UI helpers --------------------
function showOnly(target) {
  for (const k of Object.keys(screens)) screens[k].classList.add("hidden");
  table.classList.add("hidden");

  if (target === "table") table.classList.remove("hidden");
  else screens[target]?.classList.remove("hidden");
}

function setPlayHudVisible(v) {
  playHud.classList.toggle("hidden", !v);
  leaderboardPanel.classList.toggle("hidden", !v);
}

function fmtTime(sec) {
  sec = Math.max(0, sec);
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// -------------------- Leaderboard UI --------------------
function renderLeaderboard(items) {
  leaderboardList.innerHTML = "";
  (items || []).slice(0, 5).forEach((it, idx) => {
    const li = document.createElement("li");
    li.textContent = `${it.player} : ${it.score}`;
    leaderboardList.appendChild(li);
  });
}

async function refreshLeaderboard() {
  const myRun = runId;
  try {
    const data = await lb.getTop5();
    if (runId !== myRun) return;
    renderLeaderboard(data.items);
  } catch {
    // 실패 시 조용히
  }
}

// -------------------- Stage transitions --------------------
function bumpRunId() { runId += 1; finalized = false; pendingEndReason = null; endAfterProceedReason = null; practiceCompletedPending = false; }

function goName() {
  bumpRunId();
  stopTimer();

  appStage = "NAME";
  practiceRoundsDone = 0;
  playerName = "";
  nameInput.value = "";

  setPlayHudVisible(false);
  showOnly("name");
  resultRankEl.classList.add("hidden");

  // 게임 상태도 리셋(다음 사용자를 위해)
  game.resetSession({ money: 10000 });
}

function goPractice() {
  bumpRunId();
  stopTimer();

  appStage = "PRACTICE";
  practiceRoundsDone = 0;

  setPlayHudVisible(false);
  showOnly("table");

  // 연습: 돈 표시 숨김
  moneyBoxEl.classList.add("hidden");
  game.resetSession({ money: 10000 });
}

function goPrestart() {
  bumpRunId();
  stopTimer();

  appStage = "PRESTART";
  setPlayHudVisible(false);
  showOnly("prestart");

  prestartTimerEl.textContent = "02:00";

  // money 표시 복귀(본게임에서 사용)
  moneyBoxEl.classList.remove("hidden");

  // 게임 UI는 다음 시작을 위해 betting 상태로
  game.resetToBetting();
}

async function goPlay() {
  bumpRunId();
  stopTimer();

  appStage = "PLAY";
  remaining = 120;
  playTimerEl.textContent = fmtTime(remaining);

  showOnly("table");
  setPlayHudVisible(true);

  // 본게임 시작: money 10000 고정 리셋
  game.resetSession({ money: 10000 });

  // 랭킹 로드(우측 표시)
  await refreshLeaderboard();

  startTimer();
}

function goResult({ finalMoney, entered, rank, leaderboard }) {
  bumpRunId();
  stopTimer();

  appStage = "RESULT";
  setPlayHudVisible(false);
  showOnly("result");

  resultScoreEl.textContent = `최종 소지금: ${finalMoney}`;

  if (entered) {
    resultRankEl.textContent = `당신의 순위 : ${rank}위`;
    resultRankEl.classList.remove("hidden");
  } else {
    resultRankEl.classList.add("hidden");
  }

  // 결과 화면에서도 우측 패널은 숨기지만, 데이터는 갱신해둠(다음 PLAY에서 즉시 보이도록)
  if (leaderboard) renderLeaderboard(leaderboard);
}

// -------------------- Timer --------------------
function startTimer() {
  const myRun = runId;
  timerHandle = setInterval(() => {
    if (runId !== myRun) return; // 무효화
    if (appStage !== "PLAY") return;

    remaining -= 1;
    playTimerEl.textContent = fmtTime(remaining);

    if (remaining <= 0) {
      // betting 단계면 즉시 종료, 아니면 라운드 종료 후 종료
      const ph = game.getPhase();
      if (ph === "betting") {
        finalizeSession("timeup");
      } else {
        pendingEndReason = "timeup";
      }
    }
  }, 1000);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
  remaining = 120;
  pendingEndReason = null;
}

// -------------------- Finalize session --------------------
async function finalizeSession(reason) {
  if (finalized) return;
  if (appStage !== "PLAY") return;
  finalized = true;

  stopTimer();

  const finalMoney = game.getMoney();

  // 서버 제출 + 랭킹 갱신
  const myRun = runId;
  let entered = false;
  let rank = null;
  let leaderboard = null;

  try {
    const res = await lb.submit(playerName, finalMoney);
    if (runId !== myRun) return; // RETURN 등으로 무효화됐으면 중단
    entered = !!res.entered;
    rank = res.rank ?? null;
    leaderboard = res.leaderboard ?? null;
  } catch {
    // 서버 실패 시에도 결과 화면은 보여준다
  }

  goResult({ finalMoney, entered, rank, leaderboard });
}

// -------------------- Input handlers --------------------
function confirmName() {
  const name = (nameInput.value || "").trim();
  if (!name) return;

  playerName = name;
  // 오디오 unlock(최초 입력 시)
  sfx.unlockOnce();

  goPractice();
}

btnNameConfirm.addEventListener("click", confirmName);
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") confirmName();
});

btnStart.addEventListener("click", () => goPlay());

btnReturn.addEventListener("click", () => goName());

// -------------------- Boot --------------------
goName();
