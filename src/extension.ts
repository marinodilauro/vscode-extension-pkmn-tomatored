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
  currentPhase: "work" | "shortBreak" | "longBreak";
  currentPokemon?: Pokemon;
  capturedPokemons: Pokemon[];
  justCaptured?: string;
  timeLeft: number;
  pokemonRunAway: boolean;
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
  timeLeft: 0,
  pokemonRunAway: false,
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
        startWorkSession();
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
    "capturedPokemons",
    "Captured Pokémon",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  // Generate content for the Webview
  const capturedPokemonsHtml = state.capturedPokemons
    .map(
      (pokemon) =>
        `<div style="display: flex; align-items: center; margin-bottom: 10px;">
           <img src="${
             pokemon.sprites.front_default
           }" style="width: 50px; height: 50px; margin-right: 10px;">
           <span>${formatPokemonName(pokemon.name)}</span>
         </div>`
    )
    .join("");

  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <style>
        h1 { text-align: center; }
        .pokemon-list { display: flex; flex-direction: column; align-items: flex-start; }
      </style>
    </head>
    <body>
      <h1>Captured Pokémon</h1>
      <div class="pokemon-list">
        ${capturedPokemonsHtml || "<h2>No Pokémon captured yet!</h2>"}
      </div>
    </body>
    </html>
  `;
}

function startWorkSession() {
  state.currentPhase = "work";
  console.log(state.currentPhase);
  state.pomodoroCount++; // Hide previous Pokémon messages
  const duration = TEST_MODE ? 5 : WORK_DURATION; // 1 minute in test mode
  startTimer(duration);

  vscode.window.showInformationMessage(
    `Starting work session ${
      Math.floor(state.pomodoroCount / 2) + 1
    } - Focus for ${TEST_MODE ? "1 minute" : "25 minutes"}!`
  );
}

async function startShortBreak() {
  state.currentPhase = "shortBreak";
  console.log(state.currentPhase);
  state.shortBreakCount++;

  // Spawn Pokémon in short breaks
  spawnPokemonForBreak();
  vscode.window.showInformationMessage(
    `Time for a short break (${TEST_MODE ? "10 seconds" : "5 minutes"})!`
  );

  const duration = TEST_MODE ? 10 : SHORT_BREAK;
  startTimer(duration);
}

async function startLongBreak() {
  state.currentPhase = "longBreak";
  console.log(state.currentPhase);
  state.longBreakCount++;
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
  state.timeLeft = timeLeft;

  // Update status bar every seconds
  updateStatusBar(timeLeft);

  state.currentInterval = setInterval(() => {
    timeLeft--;
    state.timeLeft = timeLeft;

    if (timeLeft <= 0) {
      clearInterval(state.currentInterval);

      if (state.currentPhase === "work") {
        // Check if long break is needed
        if (state.pomodoroCount % 4 === 0) {
          // Check if it's 4th pomodoro
          startLongBreak(); // Start long break
        } else {
          startShortBreak(); // Start short break
        }
      } else {
        // If it's break time, check if it's a long break
        if (state.currentPhase === "longBreak") {
          // Reset pomodoro and short breaks counters
          resetCounters();
        } else if (
          state.currentPhase === "shortBreak" &&
          state.currentPokemon
        ) {
          // If we're ending a short break and there was a Pokemon
          state.pokemonRunAway = true;
          state.currentPokemon = undefined;
          vscode.window.showInformationMessage("Oh no! The Pokémon ran away!");
        }
        startWorkSession(); // Start work session
      }
    } else {
      updateStatusBar(timeLeft);
      if (state.pokemonRunAway) {
        pokemonViewProvider.refresh(); // Update view to show current timer
      }
    }
  }, 1000);
}

function formatTimeRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatPokemonName(pokemonName: string): string {
  const formattedName =
    pokemonName.charAt(0).toUpperCase() + pokemonName.slice(1);

  return formattedName;
}

// Get the current view content
export function getCurrentViewContent(webview: vscode.Webview): string {
  let content;

  // Images
  const sleepPokemonUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      vscode.extensions.getExtension("dilamar.pkmn-tmtred")!.extensionUri,
      "src",
      "resources",
      "sleep-pokemon.gif"
    )
  );
  const psyduckFloatyUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      vscode.extensions.getExtension("dilamar.pkmn-tmtred")!.extensionUri,
      "src",
      "resources",
      "psyduck-floaty.gif"
    )
  );
  const pikachuSwimmingUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      vscode.extensions.getExtension("dilamar.pkmn-tmtred")!.extensionUri,
      "src",
      "resources",
      "pikachu-swimming-pool.gif"
    )
  );

  // If it's a short break and there is a Pokémon, show it
  if (state.currentPhase === "shortBreak" && state.currentPokemon) {
    content = `
      <div class="wild-pokemon">
        <h1>Wild ${formatPokemonName(state.currentPokemon.name)} appeared!</h1>
        <img src="${
          state.currentPokemon.sprites.front_default
        }" alt="${formatPokemonName(state.currentPokemon.name)}">
      </div>
    `;
  } else if (state.currentPhase === "work" && state.pokemonRunAway) {
    // If the Pokémon ran away and it's work session, show the message with the timer
    content = `
      <div style="text-align: center; padding: 20px;">
        <h2>Oh no! The Pokémon ran away!</h2>
        <p>Retry in ${formatTimeRemaining(state.timeLeft)}!</p>
      </div>
    `;
  } else if (state.currentPhase === "longBreak" && state.longBreakCount > 0) {
    content = `
    <div>
      <h1>Great job!</h1>
      <p>You've completed 4 Pomodoros. Now take a well-deserved long break.</p>
        <img src="${sleepPokemonUri}" alt="Psyduck relaxing" />
    </div>
    `;
  } else if (state.justCaptured) {
    // If the Pokémon ran away and it's work session, show the message with the timer
    content = `
      <div class="capture-success">
           <h1>Congratulations!</h1>
           <h2>You captured ${formatPokemonName(state.justCaptured)}!</h2>
      </div>`;
  } else {
    // Default state (no Pokémon)
    content = `
    <div>
      <h2>Focus on your work!</h2>
      <p>A wild Pokémon will appear during your break.</p>
    </div>`;
  }

  return `
       <!DOCTYPE html>
       <html lang="en">
       <head>
         <style>
           body {
             display: flex;
             flex-direction: column;
             justify-content: center;
             align-items: center;
             height: 100vh;
             margin: 0;
             padding: 20px;
             box-sizing: border-box;
             text-align: center;
             font-family: var(--vscode-font-family);
             color: var(--vscode-foreground);
           }
           .wild-pokemon img {
             animation: move 0.5s infinite ;
             width: 140px;
             height: 140px;
             position: relative;
           }
           .capture-success {
             animation: fadeIn 0.5s ease-in;
           }
           @keyframes move {
             0% { transform: translate(0, 0); }
             100% { transform: translate(${Math.random() * 20 - 10}px, ${
    Math.random() * 20 - 10
  }px); }
           }

           h1 { margin-bottom: 10px; }
           h2 { margin-top: 0; }
         </style>
       </head>
       <body>${content}</body>
       </html>
     `;
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
  state.pokemonRunAway = false;
}

function updateStatusBar(timeLeft: number) {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeString = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;

  const isShortBreak = state.currentPhase === "shortBreak";
  const isLongBreak = state.currentPhase === "longBreak";
  const phase = isShortBreak
    ? "Short Break"
    : isLongBreak
    ? "Long Break"
    : "Pomodoro";

  // Usa il contatore corretto per ogni fase
  const sessionCount = isLongBreak
    ? state.longBreakCount
    : isShortBreak
    ? state.shortBreakCount
    : state.pomodoroCount;

  let statusMessage = `${phase} ${sessionCount} | ${phase}: ${timeString}`;

  if (isShortBreak && state.currentPokemon) {
    statusMessage += ` 🎮 Wild ${state.currentPokemon.name} appeared!`;
  } else if (isLongBreak) {
    statusMessage += " 🎉";
  } else {
    statusMessage += " 🍅";
  }

  vscode.window.setStatusBarMessage(statusMessage);
}

export async function spawnPokemonForBreak() {
  try {
    const { name, spriteUrl } = await getRandomPokemon();
    console.log(`Spawned Pokémon: ${name}, Sprite URL: ${spriteUrl}`);
    state.currentPokemon = {
      name,
      sprites: { front_default: spriteUrl },
      message: undefined,
    };
    state.pokemonRunAway = false;
    pokemonViewProvider.refresh();

    // Bring the Pokemon view to front
    await vscode.commands.executeCommand(
      "workbench.view.extension.pokemon-tomatoRed-container"
    );

    // If we have access to the view through the provider, reveal it
    if (pokemonViewProvider._view) {
      pokemonViewProvider._view.show(true); // true means preserve focus
    }

    // Create a new message
    currentPokemonMessage = await vscode.window.showInformationMessage(
      `⭐ A wild ${formatPokemonName(
        state.currentPokemon.name
      )} appeared! You can try to catch it during your ${
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
