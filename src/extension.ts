import * as vscode from "vscode";
import { getRandomPokemon } from "./pkmnAPI";
import { PokemonViewProvider } from "./pokemonViewProvider";
import { Pokemon } from "./pkmnAPI";

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
  currentPokemon?: Pokemon;
  capturedPokemons: Pokemon[];
  justCaptured?: string;
}

export const state: PomodoroState = {
  isRunning: false,
  currentInterval: undefined,
  pomodoroCount: 0,
  shortBreakCount: 0,
  longBreakCount: 0,
  currentPhase: "work",
  currentPokemon: undefined,
  capturedPokemons: [],
  justCaptured: undefined,
};

// Reference to the current message
let currentPokemonMessage: vscode.MessageItem | undefined;
let pokemonViewProvider: PokemonViewProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log("activate function called");

  pokemonViewProvider = new PokemonViewProvider(context.extensionUri);

  console.log("Registering webview view provider");
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PokemonViewProvider.viewType,
      pokemonViewProvider
    )
  );

  console.log("Forcing initial update");
  pokemonViewProvider.refresh();

  const startPomodoro = vscode.commands.registerCommand(
    "pkmn-tmtred.startPomodoro",
    () => {
      if (!state.isRunning) {
        state.isRunning = true;
        vscode.window.showInformationMessage(
          "Pomodoro Timer started! Let's focus!"
        );
        startWorkSession(pokemonViewProvider);
      } else {
        vscode.window.showInformationMessage(
          "Pomodoro Timer is already running!"
        );
      }
    }
  );

  const stopPomodoro = vscode.commands.registerCommand(
    "pkmn-tmtred.stopPomodoro",
    () => {
      stopTimer();
      vscode.window.showInformationMessage("Pomodoro Timer stopped!");
    }
  );

  context.subscriptions.push(startPomodoro, stopPomodoro);

  // Register view commands with their implementations
  const viewCommands = [
    vscode.commands.registerCommand("pkmn-tmtred.refresh", () => {
      vscode.window.showInformationMessage("Refreshing Pokémon...");
      refreshPokemon();
    }),
    vscode.commands.registerCommand("pkmn-tmtred.capture", () => {
      capturePokemon();
    }),
    vscode.commands.registerCommand(
      "pkmn-tmtred.showCapturedPokemons",
      showCapturedPokemons
    ),
  ];

  // Add all commands to subscriptions
  context.subscriptions.push(startPomodoro, stopPomodoro, ...viewCommands);
}

// Command to refresh the view and spawn another Pokémon
async function refreshPokemon() {
  try {
    const { name, spriteUrl } = await getRandomPokemon();
    state.currentPokemon = {
      name,
      sprites: { front_default: spriteUrl },
      message: undefined,
    };
    vscode.window.showInformationMessage(`A wild ${name} appeared!`);

    // Refresh the view
    pokemonViewProvider.refresh();
  } catch (error) {
    vscode.window.showErrorMessage("Failed to fetch a Pokémon.");
  }
}

// //Command to catch the Pokémon
function capturePokemon() {
  const pokemon = state.currentPokemon;
  if (pokemon) {
    // Store pokemon before clearing current
    const capturedName = pokemon.name;
    // Update state
    state.capturedPokemons.push(pokemon);
    state.justCaptured = capturedName;
    state.currentPokemon = undefined; // Remove current Pokémon from the view

    console.log("State after capture:", {
      justCaptured: state.justCaptured,
      currentPokemon: state.currentPokemon,
      capturedPokemonsCount: state.capturedPokemons.length,
    });

    // Force view refresh
    pokemonViewProvider.refresh();
    console.log("Refreshing view after capture");

    // Reset capture state after delay
    setTimeout(() => {
      console.log("Resetting justCaptured state");
      state.justCaptured = undefined;
      if (pokemonViewProvider) {
        pokemonViewProvider.refresh();
      }
    }, 2000);

    // Show success message in the status bar
    vscode.window.showInformationMessage(
      `Gotcha! ${capturedName} was captured!`
    );
  } else {
    vscode.window.showInformationMessage("No Pokémon to capture!");
  }
}

// Command to show captured Pokémons
function showCapturedPokemons() {
  const panel = vscode.window.createWebviewPanel(
    "capturedPokemons", // Identificatore univoco per la webview
    "Captured Pokémon", // Titolo della webview
    vscode.ViewColumn.One, // Colonna in cui aprire la webview
    {
      enableScripts: true, // Abilita JavaScript nella webview
    }
  );

  // Generate content for the Webview
  const capturedPokemonsHtml = state.capturedPokemons
    .map(
      (pokemon) =>
        `<div style="display: flex; align-items: center; margin-bottom: 10px;">
           <img src="${pokemon.sprites.front_default}" style="width: 50px; height: 50px; margin-right: 10px;">
           <span>${pokemon.name}</span>
         </div>`
    )
    .join("");

  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { text-align: center; }
        .pokemon-list { display: flex; flex-direction: column; align-items: flex-start; }
      </style>
    </head>
    <body>
      <h1>Captured Pokémon</h1>
      <div class="pokemon-list">
        ${capturedPokemonsHtml || "<p>No Pokémon captured yet!</p>"}
      </div>
    </body>
    </html>
  `;
}

function startWorkSession(pokemonViewProvider: PokemonViewProvider) {
  state.currentPhase = "work";
  state.pomodoroCount++; // Hide previous Pokémon messages
  const duration = TEST_MODE ? 5 : WORK_DURATION; // 1 minute in test mode
  startTimer(duration, pokemonViewProvider);

  vscode.window.showInformationMessage(
    `Starting work session ${
      Math.floor(state.pomodoroCount / 2) + 1
    } - Focus for ${TEST_MODE ? "1 minute" : "25 minutes"}!`
  );
}

async function startShortBreak(pokemonViewProvider: PokemonViewProvider) {
  state.currentPhase = "break";
  state.shortBreakCount++;

  // Spawn Pokémon in short breaks
  spawnPokemonForBreak(pokemonViewProvider);
  vscode.window.showInformationMessage(
    `Time for a short break (${TEST_MODE ? "10 seconds" : "5 minutes"})!`
  );

  const duration = TEST_MODE ? 10 : SHORT_BREAK;
  startTimer(duration, pokemonViewProvider);
}

async function startLongBreak(pokemonViewProvider: PokemonViewProvider) {
  state.currentPhase = "break";
  state.longBreakCount++;

  vscode.window.showInformationMessage(
    `Excellent work! You've completed 4 Pomodoros. Time for a long break (${
      TEST_MODE ? "15 seconds" : "15 minutes"
    })!`
  );

  const duration = TEST_MODE ? 15 : LONG_BREAK;
  startTimer(duration, pokemonViewProvider);
}

function startTimer(
  duration: number,
  pokemonViewProvider: PokemonViewProvider
) {
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
          startLongBreak(pokemonViewProvider); // Start long break
        } else {
          startShortBreak(pokemonViewProvider); // Start short break
        }
      } else {
        // If it's break time, check if it's a long break
        if (state.currentPhase === "break" && state.longBreakCount > 0) {
          // Reset pomodoro and short breaks counters
          resetCounters();
        }
        startWorkSession(pokemonViewProvider); // Start work session
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
  vscode.window.setStatusBarMessage("");
}

function resetCounters() {
  state.pomodoroCount = 0;
  state.shortBreakCount = 0;
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

export async function spawnPokemonForBreak(
  pokemonViewProvider: PokemonViewProvider
) {
  try {
    const { name, spriteUrl } = await getRandomPokemon();
    console.log(`Spawned Pokémon: ${name}, Sprite URL: ${spriteUrl}`);
    state.currentPokemon = {
      name,
      sprites: { front_default: spriteUrl },
      message: undefined,
    };
    pokemonViewProvider.refresh();

    // Bring the Pokemon view to front
    await vscode.commands.executeCommand(
      "workbench.view.extension.pokemon-tomatoRed-container"
    );

    // If we have access to the view through the provider, reveal it
    if (pokemonViewProvider._view) {
      pokemonViewProvider._view.show(true); // true means preserve focus
    }

    pokemonViewProvider.refresh();

    // Formatting Pokémon name
    const formattedName =
      state.currentPokemon!.name.charAt(0).toUpperCase() +
      state.currentPokemon!.name.slice(1);

    // Create a new message
    currentPokemonMessage = await vscode.window.showInformationMessage(
      `⭐ A wild ${formattedName} appeared! You can try to catch it during your ${
        TEST_MODE ? "10 seconds" : "5 minutes"
      } break! ⭐`,
      { modal: false },
      { title: "Catch" }, // MessageItem for catching the Pokémon
      { title: "Run" } // MessageItem for running away
    );
  } catch (error) {
    vscode.window.showErrorMessage("Failed to fetch a Pokémon.");
  }
}

export function deactivate() {
  stopTimer();
}
