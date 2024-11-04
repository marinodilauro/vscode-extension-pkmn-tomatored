import * as vscode from "vscode";
import { getRandomPokemon, getAllPokemon } from "./pkmnAPI";
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
  pokemonCache: Pokemon[];
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
  pokemonCache: [],
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

  const pokemon = {
    ...state.currentPokemon,
    isGray: false,
  };
  const capturedName = pokemon.name;

  try {
    // Update state
    state.capturedPokemons.push(pokemon);
    state.justCaptured = capturedName;
    state.currentPokemon = undefined;

    // Update status bar immediately after capture
    updateStatusBar(state.timeLeft);

    // Send message to webview to update specific Pokemon
    if (capturedPokemonsPanel) {
      capturedPokemonsPanel.webview.postMessage({
        command: "updatePokemon",
        pokemonName: capturedName,
      });
    }

    if (pokemonViewProvider) {
      pokemonViewProvider.refresh();
    }

    // Ensure view provider exists
    if (!pokemonViewProvider) {
      throw new Error("Pokemon view provider not initialized");
    }

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
async function showCapturedPokemons() {
  if (capturedPokemonsPanel) {
    // If panel exists, show it
    capturedPokemonsPanel.reveal();
    return;
  }

  try {
    // Create and show panel
    capturedPokemonsPanel = vscode.window.createWebviewPanel(
      "capturedPokemons",
      "Pokédex",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    // Show loading state
    updateLoadingState();

    // Use cached data or fetch new
    const allPokemon =
      state.pokemonCache.length > 0
        ? state.pokemonCache
        : await getAllPokemon();

    // Cache for future use
    if (state.pokemonCache.length === 0) {
      state.pokemonCache = allPokemon;
    }

    // Update captured status
    state.capturedPokemons.forEach((captured) => {
      const pokemon = allPokemon.find((p) => p.name === captured.name);
      if (pokemon) {
        pokemon.isGray = false;
      }
    });

    // Update panel content with all Pokemon
    updateCapturedPokemonsPanelWithAll(allPokemon);

    capturedPokemonsPanel.onDidDispose(() => {
      capturedPokemonsPanel = undefined;
    });
  } catch (error) {
    vscode.window.showErrorMessage("Failed to load Pokemon list");
  }
}

// Loading state function
function updateLoadingState() {
  if (!capturedPokemonsPanel) {
    return;
  }

  capturedPokemonsPanel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        .loader {
          text-align: center;
          padding: 20px;
        }
        .loading-text {
          font-size: 1.2em;
          color: white;
        }
      </style>
    </head>
    <body>
      <div class="loader">
        <h2 class="loading-text">Loading Pokédex...</h2>
      </div>
    </body>
    </html>
  `;
}

// Function to update panel with all Pokemon
function updateCapturedPokemonsPanelWithAll(pokemonList: Pokemon[]) {
  if (!capturedPokemonsPanel) {
    return;
  }

  capturedPokemonsPanel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: 'Segoe UI', sans-serif;
          padding: 20px;
          background: linear-gradient(135deg, #f5f7fa, #c3cfe2);
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
          gap: 16px;
          padding: 16px;
          border-radius: 15px;
        }
        
        .pokemon-card {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          background: white;
          border-radius: 15px;
          padding: 12px;
          text-align: center;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          width: 120px;
          height: 120px;
          margin: 0 auto;
        }
        
        .pokemon-card.captured {
          transition: transform 0.2s;
        }

        .pokemon-card.captured:hover {
          transform: translateY(-5px);
          box-shadow: 0 6px 12px rgba(0,0,0,0.15);
        }
        
        .pokemon-sprite {
          width: 80px;
          height: 80px;
          border-radius: 8px;
        }
        
        .pokemon-sprite.gray {
          filter: grayscale(100%);
          opacity: 0.5;
        }

        .pokemon-name {
          color: #000000;
          font-size: 1em;
          font-weight: 500;
        }
        
        .pokemon-name.gray {
          color: #888888;
        }
        
        .controls {
          display: flex;
          gap: 16px;
          margin-bottom: 20px;
          padding: 0 16px;
        }

        .search-container {
          flex: 1;
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-box {
          width: 100%;
          padding: 8px 12px;
          padding-right: 30px; /* Space for clear button */
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 1em;
          outline: none;
          transition: border-color 0.2s;
        }

        .clear-search {
          position: absolute;
          right: 8px;
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 4px;
          display: none;
          font-size: 1.2em;
        }

        .clear-search:hover {
          color: #64748b;
        }

        .search-box:focus {
          border-color: #63b3ed;
        }

        .filter-select {
          padding: 8px 12px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 1em;
          background-color: white;
          cursor: pointer;
        }

        .hidden {
          display: none !important;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <h1>🏆 Pokédex</h1>

      <div class="controls">
        <div class="search-container">
          <input 
            type="text" 
            class="search-box" 
            placeholder="Search Pokémon..." 
            id="searchInput"
          >
          <button class="clear-search" id="clearSearch">✕</button>
        </div>
        <select class="filter-select" id="statusFilter">
          <option value="all">All Pokémon</option>
          <option value="captured">Captured</option>
          <option value="uncaptured">Not Captured</option>
        </select>
      </div>

      <div class="pokemon-list">
        ${pokemonList
          .map(
            (pokemon) => `
          <div id="${pokemon.name}-card" 
               class="pokemon-card ${pokemon.isGray ? "" : "captured"}"
               data-name="${pokemon.name}"
               data-status="${pokemon.isGray ? "uncaptured" : "captured"}">
            <img id="${pokemon.name}-sprite" 
                 class="pokemon-sprite ${pokemon.isGray ? "gray" : ""}" 
                 loading="lazy"
                 src="${pokemon.sprites.front_default}" 
                 alt="${formatPokemonName(pokemon.name)}">
            <span id="${pokemon.name}-name" 
                  class="pokemon-name ${pokemon.isGray ? "gray" : ""}">
              ${formatPokemonName(pokemon.name)}
            </span>
          </div>
        `
          )
          .join("")}
      </div>       

      <script>
        window.addEventListener('message', event => {
          const message = event.data;
          if (message.command === 'updatePokemon') { 
            const card = document.getElementById(message.pokemonName + '-card');
            const sprite = document.getElementById(message.pokemonName + '-sprite');
            const name = document.getElementById(message.pokemonName + '-name');
            
            if (card && sprite && name) {
              card.classList.add('captured');
              card.dataset.status = 'captured';
              sprite.classList.remove('gray');
              name.classList.remove('gray');
            }
          }
        });

        // Search and filter functionality
        const searchInput = document.getElementById('searchInput');
        const statusFilter = document.getElementById('statusFilter');
        const pokemonCards = document.querySelectorAll('.pokemon-card');
        const clearButton = document.getElementById('clearSearch');
        
        function updateClearButton() {
          clearButton.style.display = searchInput.value ? 'block' : 'none';
        }

        function filterPokemon() {
          const searchTerm = searchInput.value.toLowerCase();
          const filterValue = statusFilter.value;

          pokemonCards.forEach(card => {
            const name = card.dataset.name;
            const status = card.dataset.status;
            const matchesSearch = name.startsWith(searchTerm);
            const matchesFilter = filterValue === 'all' || status === filterValue;

            card.classList.toggle('hidden', !matchesSearch || !matchesFilter);
          });
        }

        clearButton.addEventListener('click', () => {searchInput.value = ''; updateClearButton(); filterPokemon();});
        searchInput.addEventListener('input', () => {updateClearButton(); filterPokemon();});
        searchInput.addEventListener('input', filterPokemon);
        statusFilter.addEventListener('change', filterPokemon);

        // Initial state
        updateClearButton();
      </script>

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
