// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { getRandomPokemon } from "./pkmnAPI";

// Timer constants
const WORK_DURATION = 25 * 60;
const SHORT_BREAK = 5 * 60;
const LONG_BREAK = 15 * 60;
const TEST_MODE = true; // Set to true for testing with shorter timers

// Pomodoro state
interface PomodoroState {
  isRunning: boolean;
  currentInterval: NodeJS.Timeout | undefined;
  pomodoroCount: number;
  shortBreakCount: number;
  longBreakCount: number;
  currentPhase: "work" | "break";
  currentPokemon?: {
    name: string;
    message: vscode.MessageItem | undefined;
  };
}

const state: PomodoroState = {
  isRunning: false,
  currentInterval: undefined,
  pomodoroCount: 0,
  shortBreakCount: 0,
  longBreakCount: 0,
  currentPhase: "work",
  currentPokemon: undefined,
};

// Reference to the current message
let currentPokemonMessage: vscode.MessageItem | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Command to activate Pomodoro Timer
  const startPomodoro = vscode.commands.registerCommand(
    "pkmn-tmtred.startPomodoro",
    () => {
      if (!state.isRunning) {
        state.isRunning = true;
        vscode.window.showInformationMessage(
          "Pomodoro Timer started! Let's focus for 25 minutes!"
        );
        startWorkSession();
      } else {
        vscode.window.showInformationMessage(
          "Pomodoro Timer is already running!"
        );
      }
    }
  );

  // Command to stop Pomodoro Timer
  const stopPomodoro = vscode.commands.registerCommand(
    "pkmn-tmtred.stopPomodoro",
    () => {
      stopTimer();
      vscode.window.showInformationMessage("Pomodoro Timer stopped!");
    }
  );

  context.subscriptions.push(startPomodoro, stopPomodoro);
}

function startWorkSession() {
  state.currentPhase = "work";
  state.pomodoroCount++;
  hideCurrentPokemonMessage(); // Hide previous Pokémon messages
  const duration = TEST_MODE ? 5 : WORK_DURATION; // 1 minute in test mode
  startTimer(duration);

  vscode.window.showInformationMessage(
    `Starting work session ${
      Math.floor(state.pomodoroCount / 2) + 1
    } - Focus for ${TEST_MODE ? "1 minute" : "25 minutes"}!`
  );
}

async function startShortBreak() {
  state.currentPhase = "break";
  state.shortBreakCount++;

  hideCurrentPokemonMessage();

  // Spawn Pokémon in short breaks
  spawnPokemonForBreak();
  vscode.window.showInformationMessage(
    `Time for a short break (${TEST_MODE ? "10 seconds" : "5 minutes"})!`
  );

  const duration = TEST_MODE ? 10 : SHORT_BREAK;
  startTimer(duration);
}

async function startLongBreak() {
  state.currentPhase = "break";
  state.longBreakCount++;

  hideCurrentPokemonMessage();

  vscode.window.showInformationMessage(
    `Excellent work! You've completed 4 Pomodoros. Time for a long break (${
      TEST_MODE ? "15 seconds" : "15 minutes"
    })!`
  );

  const duration = TEST_MODE ? 15 : LONG_BREAK;
  startTimer(duration);
}

function startTimer(duration: number) {
  let timeLeft = duration;

  // Update status bar every seconds
  updateStatusBar(timeLeft);

  state.currentInterval = setInterval(() => {
    timeLeft--;

    if (timeLeft <= 0) {
      clearInterval(state.currentInterval);

      if (state.currentPhase === "work") {
        // Check if long break is needed
        if (state.pomodoroCount === 4) {
          // Check if it's 4th pomodoro
          startLongBreak(); // Start long break
        } else {
          startShortBreak(); // Start short break
        }
      } else {
        startWorkSession(); // Start work session
      }
    } else {
      updateStatusBar(timeLeft);
    }
  }, 1000);
}

function stopTimer() {
  if (state.currentInterval) {
    clearInterval(state.currentInterval);
    state.currentInterval = undefined;
  }
  state.isRunning = false;
  state.pomodoroCount = 0;
  state.shortBreakCount = 0;
  state.currentPhase = "work";
  state.currentPokemon = undefined;
  hideCurrentPokemonMessage();
  vscode.window.setStatusBarMessage("");
}

function updateStatusBar(timeLeft: number) {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeString = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;

  const isBreak = state.currentPhase === "break";
  const isLongBreak = isBreak && state.pomodoroCount === 4;
  const phase = isBreak
    ? isLongBreak
      ? "Long Break"
      : "Short Break"
    : "Pomodoro";

  // Usa il contatore corretto per ogni fase
  const sessionCount = isLongBreak
    ? state.longBreakCount
    : isBreak
    ? state.shortBreakCount
    : state.pomodoroCount;

  let statusMessage = `${phase} ${sessionCount} | ${phase}: ${timeString}`;

  if (isBreak && !isLongBreak && state.currentPokemon) {
    statusMessage += ` 🎮 Wild ${state.currentPokemon.name} appeared!`;
  } else {
    statusMessage += " 🍅";
  }

  vscode.window.setStatusBarMessage(statusMessage);
}

async function spawnPokemonForBreak() {
  try {
    const pokemonName = await getRandomPokemon();
    const formattedName =
      pokemonName.charAt(0).toUpperCase() + pokemonName.slice(1);
    state.currentPokemon = {
      name: formattedName,
      message: undefined,
    };

    // Create a new message
    currentPokemonMessage = await vscode.window.showInformationMessage(
      `⭐ A wild ${formattedName} appeared! You can try to catch it during your ${
        TEST_MODE ? "10 seconds" : "5 minutes"
      } break! ⭐`,
      { modal: false },
      { title: "Catch" }, // MessageItem for catching the Pokémon
      { title: "Run" } // MessageItem for running away
    );

    // If the user interacts with the message
    if (currentPokemonMessage?.title === "Catch") {
      handlePokemonCatch(formattedName);
    } else if (currentPokemonMessage?.title === "Run") {
      vscode.window.showInformationMessage(
        `Got away safely! Continue your break!`,
        "OK"
      );
    } else {
      console.error("Unexpected message interaction");
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      "Failed to fetch a Pokémon. Don't worry, take your break anyway!"
    );
  }

  // TODO: Function to show animated sprites and catch it
}

function hideCurrentPokemonMessage() {
  if (currentPokemonMessage) {
    // Hide current message (if exist)
    currentPokemonMessage = undefined;
  }
}

function handlePokemonCatch(pokemonName: string) {
  const catchSuccess = Math.random() > 0; // Set the chance to capture the Pokémon. Is 0 for test

  if (catchSuccess) {
    vscode.window.showInformationMessage(
      `🎉 Gotcha! ${pokemonName} was caught! Continue your break!`,
      "OK"
    );
    // TODO: Add the Pokémon to the user's collection
  } else {
    vscode.window.showInformationMessage(
      `Oh no! ${pokemonName} broke free! Maybe try again during this break!`,
      "OK"
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  stopTimer();
}
