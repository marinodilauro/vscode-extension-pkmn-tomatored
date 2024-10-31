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
  captureTimeout?: NodeJS.Timeout;
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
  captureTimeout: undefined,
};

// Reference to the current message
let currentPokemonMessage: vscode.MessageItem | undefined;

// References to the views
let pokemonViewProvider: PokemonViewProvider;
let capturedPokemonsPanel: vscode.WebviewPanel | undefined;

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
    if (!name || !spriteUrl) {
      throw new Error("Invalid Pokemon data received");
    }

    state.currentPokemon = {
      name,
      sprites: { front_default: spriteUrl },
      message: undefined,
    };
    vscode.window.showInformationMessage(`A wild ${name} appeared!`);

    if (!pokemonViewProvider) {
      throw new Error("Pokemon view provider not initialized");
    }
    pokemonViewProvider.refresh();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch a Pokémon";
    vscode.window.showErrorMessage(message);
  }
}

// //Command to catch the Pokémon
function capturePokemon() {
  // Validate state and pokemon existence
  if (!state || !state.currentPokemon) {
    vscode.window.showErrorMessage("No Pokemon available to capture!");
    return;
  }

  const pokemon = state.currentPokemon;
  const capturedName = pokemon.name;

  try {
    // Update state
    state.capturedPokemons.push(pokemon);
    state.justCaptured = capturedName;
    state.currentPokemon = undefined;

    // Update status bar immediately after capture
    updateStatusBar(state.timeLeft);

    // Update captured pokemon panel if it exists
    if (capturedPokemonsPanel) {
      updateCapturedPokemonsPanel();
    }

    // Ensure view provider exists
    if (!pokemonViewProvider) {
      throw new Error("Pokemon view provider not initialized");
    }

    pokemonViewProvider.refresh();
    vscode.window.showInformationMessage(
      `Gotcha! ${capturedName} was captured!`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to capture Pokemon";
    vscode.window.showErrorMessage(message);
  }
}

// Update showCapturedPokemons function
function showCapturedPokemons() {
  if (capturedPokemonsPanel) {
    // If panel exists, show it
    capturedPokemonsPanel.reveal();
    return;
  }

  capturedPokemonsPanel = vscode.window.createWebviewPanel(
    "capturedPokemons",
    "Captured Pokémon",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    }
  );

  // Update panel content
  updateCapturedPokemonsPanel();

  // Handle panel disposal
  capturedPokemonsPanel.onDidDispose(() => {
    capturedPokemonsPanel = undefined;
  });
}

// Command to show captured Pokémons
function updateCapturedPokemonsPanel() {
  if (!capturedPokemonsPanel) {
    return;
  }

  capturedPokemonsPanel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <style>
        body {
          font-family: 'Segoe UI', sans-serif;
          padding: 20px;
          background: #c3cfe2;
          border-radius: 15px;
        }
        
        h1 {
          text-align: center;
          color: #2c3e50;
          font-size: 2em;
          margin-bottom: 30px;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }
        
        .pokemon-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 20px;
          padding: 20px;
          border-radius: 15px;
        }
        
        .pokemon-card {
          background: white;
          border-radius: 15px;
          padding: 15px;
          text-align: center;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          transition: transform 0.2s;
          width: 100px;
          height: 100px;
          animation: fadeIn 0.5s ease-in;
        }
        
        .pokemon-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 6px 12px rgba(0,0,0,0.15);
        }
        
        .pokemon-sprite {
          width: 90px;
          height: 90px;
          border-radius: 10px;
        }
        
        .pokemon-name {
          color: #000000;
          font-size: 1em;
          font-weight: 500;
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <h1>🏆 Captured Pokémon</h1>
      <div class="pokemon-list">
        ${
          state.capturedPokemons
            .map(
              (pokemon) => `
          <div class="pokemon-card">
            <img class="pokemon-sprite" src="${
              pokemon.sprites.front_default
            }" alt="${formatPokemonName(pokemon.name)}">
            <span class="pokemon-name">${formatPokemonName(pokemon.name)}</span>
          </div>
        `
            )
            .join("") ||
          "<h2 style='text-align:center;grid-column:1/-1;color:#7f8c8d'>No Pokémon captured yet!</h2>"
        }
      </div>
    </body>
    </html>
  `;
}

function startWorkSession() {
  state.currentPhase = "work";
  state.pomodoroCount++; // Hide previous Pokémon messages
  const duration = TEST_MODE ? 5 : WORK_DURATION; // 1 minute in test mode

  // Clear capture-related states when starting work
  state.justCaptured = undefined;
  state.pokemonRunAway = false;

  if (pokemonViewProvider) {
    pokemonViewProvider.refresh();
  }

  startTimer(duration);
  updateStatusBar(duration);

  vscode.window.showInformationMessage(
    `Starting work session ${
      Math.floor(state.pomodoroCount / 2) + 1
    } - Focus for ${TEST_MODE ? "1 minute" : "25 minutes"}!`
  );
}

async function startShortBreak() {
  state.currentPhase = "shortBreak";
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
  state.longBreakCount++;

  const duration = TEST_MODE ? 15 : LONG_BREAK;
  startTimer(duration);

  if (pokemonViewProvider) {
    pokemonViewProvider.refresh();
  }

  vscode.window.showInformationMessage(
    `Great job! Time for a long break (${
      TEST_MODE ? "15 seconds" : "15 minutes"
    })!`
  );
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
          startWorkSession();
          if (pokemonViewProvider) {
            pokemonViewProvider.refresh();
          }
        } else if (state.currentPhase === "shortBreak") {
          // If we're ending a short break and there was a Pokemon
          if (state.currentPokemon) {
            state.pokemonRunAway = true;
            state.currentPokemon = undefined;
            vscode.window.showInformationMessage(
              "Oh no! The Pokémon ran away!"
            );
          }
          startWorkSession();
        } else {
          startWorkSession();
        }
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

  // Add Pokemon-themed background colors and styles based on session type
  let sessionStyle = "";
  switch (state.currentPhase) {
    case "work":
      sessionStyle = `
        background: linear-gradient(135deg, #ff9966, #ff5e62);
        border-radius: 15px;
        padding: 30px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      `;
      break;
    case "shortBreak":
      sessionStyle = `
        background: linear-gradient(135deg, #89f7fe, #66a6ff);
        border-radius: 15px;
        padding: 30px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      `;
      break;
    case "longBreak":
      sessionStyle = `
        display: flex;
        flex-direction: column;
        align-items: center;
        background: linear-gradient(135deg, #a8edea, #fed6e3);
        border-radius: 15px;
        padding: 30px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      `;
      break;
  }

  if (state.currentPhase === "shortBreak" && state.currentPokemon) {
    content = `
      <div class="wild-pokemon" style="${sessionStyle}">
        <h1 class="pokemon-title">Wild ${formatPokemonName(
          state.currentPokemon.name
        )} appeared!</h1>
        <div class="pokemon-sprite">
          <img src="${state.currentPokemon.sprites.front_default}" 
               alt="${formatPokemonName(state.currentPokemon.name)}">
        </div>
      </div>
    `;
  } else if (state.currentPhase === "work" && state.pokemonRunAway) {
    content = `
      <div style="${sessionStyle}">
        <h2 class="message">Oh no! The Pokémon ran away!</h2>
        <p class="timer">Retry in ${formatTimeRemaining(state.timeLeft)}!</p>
      </div>
    `;
  } else if (state.currentPhase === "longBreak") {
    content = `
      <div style="${sessionStyle}">
        <h1 class="congrats">Great job!</h1>
        <p class="break-message">You've completed 4 Pomodoros. Take a well-deserved long break.</p>
        <img src="${sleepPokemonUri}" alt="Relaxing Pokemon" class="break-image" />
      </div>
    `;
  } else if (state.justCaptured) {
    content = `
      <div style="${sessionStyle}" class="container">
        <div class="capture-success">
          <h1 class="congrats">Congratulations!</h1>
          <p class="capture-message">You captured ${formatPokemonName(
            state.justCaptured
          )}!</p>
          <div class="sparkles">✨</div>
        </div>
      </div>`;
  } else {
    content = `
      <div style="${sessionStyle}">
        <h2 class="focus-message">Focus on your work!</h2>
        <p class="hint">A wild Pokémon will appear during your break.</p>
      </div>`;
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <style>
        body {
          display: flex;
          justify-content: center;
          height: 100vh;
          margin: 0;
          font-family: 'Segoe UI', sans-serif;
          background: transparent;
        }
        
        .wild-pokemon {
          text-align: center;
          animation: fadeIn 0.5s ease-in;
        }
        
        .pokemon-sprite img {
          width: 180px;
          height: 180px;
          animation: bounce 1s infinite;
        }
        
        .pokemon-title {
          font-size: 2em;
          color: #2c3e50;
          margin-bottom: 20px;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }
        
        .container {
          width: 100%;
          max-width: 400px;
          margin: 0 auto;
        }

        .capture-success {
          text-align: center;
          animation: fadeIn 0.5s ease-in;
          padding: 20px;
        }

        .congrats {
          color: #2c3e50;
          font-size: 1.8em;
          margin-bottom: 15px;
        }

        .capture-message {
          color: #34495e;
          font-size: 1.2em;
          margin: 10px 0;
        }
        
        .focus-message {
          color: #2c3e50;
          font-size: 2em;
          margin-bottom: 15px;
        }
        
        .hint {
          color: white;
          font-size: 1.2em;
        }
        
        .break-image {
          max-width: 200px;
          border-radius: 10px;
          margin-top: 20px;
        }
        
        .break-message {
        color: black;
        }

        .sparkles {
          font-size: 2em;
          animation: sparkle 1s infinite;
        }
        
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes sparkle {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
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
  let statusText = "";
  const sessionCount =
    state.currentPhase === "work"
      ? Math.floor(state.pomodoroCount / 2) + 1
      : state.currentPhase === "shortBreak"
      ? state.shortBreakCount
      : state.longBreakCount;

  switch (state.currentPhase) {
    case "work":
      statusText = `Pomodoro ${sessionCount} | Pomodoro ${formatTimeRemaining(
        timeLeft
      )} 🍅`;
      break;

    case "shortBreak":
      statusText = `Short Break ${sessionCount} | Short Break ${formatTimeRemaining(
        timeLeft
      )}`;
      if (state.justCaptured) {
        statusText += ` | Congratulations! You captured ${formatPokemonName(
          state.justCaptured
        )}!`;
      } else if (state.currentPokemon) {
        statusText += ` | 🎮 Wild ${formatPokemonName(
          state.currentPokemon.name
        )} appeared!`;
      }
      break;

    case "longBreak":
      statusText = `Long Break ${sessionCount} | Long Break ${formatTimeRemaining(
        timeLeft
      )} 🎉`;
      break;
  }

  vscode.window.setStatusBarMessage(statusText);
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
