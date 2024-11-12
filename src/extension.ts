import * as vscode from "vscode";
import { getRandomPokemon, getPokemonPage, searchPokemon } from "./pkmnAPI";
import { PokemonViewProvider } from "./pokemonViewProvider";
import { Pokemon } from "./pkmnAPI";

// Timer constants
const WORK_DURATION = 25 * 60;
const SHORT_BREAK = 5 * 60;
const LONG_BREAK = 15 * 60;
const TEST_MODE = true; // Set to true for testing with shorter timers

interface PomodoroState {
  isRunning: boolean;
  currentInterval: NodeJS.Timeout | undefined;
  pomodoroCount: number;
  shortBreakCount: number;
  longBreakCount: number;
  currentPhase: "work" | "shortBreak" | "longBreak";
  currentPokemon?: Pokemon;
  capturedPokemons: Pokemon[];
  capturedPokemonNames: Set<string>;
  justCaptured?: string;
  timeLeft: number;
  pokemonRunAway: boolean;
  captureTimeout?: NodeJS.Timeout;
  pokemonCache: Pokemon[];
}

/**
 * Global state object for managing Pomodoro and Pokemon state
 * @type {PomodoroState}
 */
export const state: PomodoroState = {
  isRunning: false,
  currentInterval: undefined,
  pomodoroCount: 0,
  shortBreakCount: 0,
  longBreakCount: 0,
  currentPhase: "work",
  currentPokemon: undefined,
  capturedPokemons: [],
  capturedPokemonNames: new Set(),
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

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context - The extension context provided by VS Code
 * @returns {void}
 * @throws {Error} When extension activation fails
 */
export function activate(context: vscode.ExtensionContext): void {
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

/**
 * Refreshes the current Pokemon with a new random Pokemon
 * @returns {Promise<void>}
 * @throws {Error} If Pokemon fetch fails or view provider is not initialized
 * @private
 */
async function refreshPokemon(): Promise<void> {
  try {
    const { name, spriteUrl } = await getRandomPokemon();
    if (!name || !spriteUrl) {
      throw new Error("Invalid Pokemon data received");
    }

    state.currentPokemon = {
      name,
      sprites: { front_default: spriteUrl },
      message: undefined,
      isGray: true,
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

/**
 * Captures the current Pokemon and updates relevant state
 * @returns {void}
 * @throws {Error} If Pokemon capture fails or view provider is not initialized
 * @private
 */
function capturePokemon(): void {
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
    state.capturedPokemonNames.add(pokemon.name);
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

/**
 * Shows the captured Pokemons panel
 * @returns {Promise<void>}
 * @throws {Error} If panel creation or Pokemon list loading fails
 */
async function showCapturedPokemons(): Promise<void> {
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

    // Fetch first page
    const { pokemon, pagination } = await getPokemonPage();
    updateCapturedPokemonsPanelWithAll(pokemon, pagination);

    // Handle messages from webview
    capturedPokemonsPanel.webview.onDidReceiveMessage(async (message) => {
      try {
        const searchState = {
          term: message.searchState?.term || "",
          filter: message.searchState?.filter || "all",
        };

        switch (message.command) {
          case "fetchPage":
            const { pokemon, pagination } = await getPokemonPage(message.url);
            updateCapturedPokemonsPanelWithAll(
              pokemon,
              pagination,
              searchState
            );
            break;
          case "search":
            const searchResults = await searchPokemon(message.searchTerm);
            updateCapturedPokemonsPanelWithAll(
              searchResults.pokemon,
              null,
              searchState
            );
            break;
          case "filter":
            const filteredResults = await getPokemonPage(message.currentUrl);
            const filteredPokemon = filteredResults.pokemon.filter(
              (pokemon) => {
                switch (message.filter) {
                  case "captured":
                    return state.capturedPokemonNames.has(pokemon.name);
                  case "uncaptured":
                    return !state.capturedPokemonNames.has(pokemon.name);
                  default:
                    return true; // 'all' case
                }
              }
            );
            updateCapturedPokemonsPanelWithAll(
              filteredPokemon,
              filteredResults.pagination,
              searchState
            );
            break;
          case "updatePokemon":
            const currentPageData = await getPokemonPage(
              message.currentUrl || undefined
            );
            updateCapturedPokemonsPanelWithAll(
              currentPageData.pokemon,
              currentPageData.pagination,
              searchState
            );
            break;
        }
      } catch (error) {
        vscode.window.showErrorMessage("Failed to handle request");
      }
    });

    capturedPokemonsPanel.onDidDispose(() => {
      capturedPokemonsPanel = undefined;
    });
  } catch (error) {
    vscode.window.showErrorMessage("Failed to load Pokemon list");
  }
}

/**
 * Updates the loading state of the captured Pokemons panel
 * @returns {void}
 * @private
 */
function updateLoadingState(): void {
  if (!capturedPokemonsPanel) {
    return;
  }
  capturedPokemonsPanel.webview.html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          background-color: #1e1e1e;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          font-family: Arial, sans-serif;
        }

        .loader-container {
          text-align: center;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
        }

        .loading-text {
          font-size: 1.5em;
          color: white;
          margin-bottom: 20px;
        }

        .pokeball {
          width: 60px;
          height: 60px;
          background-color: #fff;
          border-radius: 50%;
          position: relative;
          animation: shake 1.25s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
          transform: translate3d(0, 0, 0);
        }

        .pokeball::before {
          content: "";
          position: absolute;
          transform: translate(-50%,0%);
          width: 60px;
          height: 30px;
          background-color: #ff1c1c;
          border-radius: 30px 30px 0 0;
          top: 0;
        }

        .pokeball::after {
          content: "";
          position: absolute;
          width: 20px;
          height: 20px;
          background-color: #fff;
          border-radius: 50%;
          top: 20px;
          left: 20px;
          border: 4px solid #000;
          box-sizing: border-box;
        }

        @keyframes shake {
          0% {
            transform: translate3d(0, 0, 0) rotate(0);
          }
          20% {
            transform: translate3d(-10px, 0, 0) rotate(-20deg);
          }
          30% {
            transform: translate3d(10px, 0, 0) rotate(20deg);
          }
          50% {
            transform: translate3d(-10px, 0, 0) rotate(-10deg);
          }
          60% {
            transform: translate3d(10px, 0, 0) rotate(10deg);
          }
          100% {
            transform: translate3d(0, 0, 0) rotate(0);
          }
        }

        .dots {
          display: inline-block;
          width: 20px;
          text-align: left;
        }

        @keyframes dots {
          0%,
          20% {
            content: ".";
          }
          40% {
            content: "..";
          }
          60%,
          100% {
            content: "...";
          }
        }

        .dots::after {
          content: "...";
          animation: dots 1.5s steps(1, end) infinite;
        }

      </style>
    </head>
    <body>
      <div class="loader-container">
        <h2 class="loading-text">Loading Pokédex<span class="dots"></span></h2>
        <div class="pokeball"></div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates pagination numbers for the Pokemon list
 * @param {number} currentPage - Current page number
 * @param {number} totalPages - Total number of pages
 * @returns {string} HTML string containing pagination buttons
 * @private
 */
function generatePageNumbers(currentPage: number, totalPages: number): string {
  const pages = [];
  const showPages = 10;
  let start = Math.max(1, currentPage - Math.floor(showPages / 2));
  let end = Math.min(totalPages, start + showPages - 1);

  if (end - start + 1 < showPages) {
    start = Math.max(1, end - showPages + 1);
  }

  // First page button
  const firstPageBtn = `
    <button class="page-btn ${currentPage === 1 ? "disabled" : ""}" 
            data-url="https://pokeapi.co/api/v2/pokemon?offset=0&limit=20"
            title="Go to first page">
      «
    </button>
  `;

  // Last page button
  const lastPageBtn = `
    <button class="page-btn ${currentPage === totalPages ? "disabled" : ""}" 
            data-url="https://pokeapi.co/api/v2/pokemon?offset=${
              (totalPages - 1) * 20
            }&limit=20"
            title="Go to last page">
      »
    </button>
  `;

  for (let i = start; i <= end; i++) {
    pages.push(`
      <button class="page-btn ${i === currentPage ? "active" : ""}" 
              data-url="https://pokeapi.co/api/v2/pokemon?offset=${
                (i - 1) * 20
              }&limit=20">
        ${i}
      </button>
    `);
  }

  return firstPageBtn + pages.join("") + lastPageBtn;
}

/**
 * Updates the captured Pokemons panel with all Pokemon data
 * @param {Pokemon[]} pokemonList - List of Pokemon to display
 * @param {Object} [pagination] - Pagination information
 * @param {Object} [searchState] - Current search state
 * @param {string} [searchState.term] - Search term
 * @param {string} [searchState.filter] - Filter type
 * @returns {void}
 * @private
 */
function updateCapturedPokemonsPanelWithAll(
  pokemonList: Pokemon[],
  pagination?: any,
  searchState: { term?: string; filter?: string } = {
    term: "",
    filter: "all",
  }
): void {
  if (!capturedPokemonsPanel) {
    return;
  }

  const searchInput = searchState?.term || "";
  const filterValue = searchState?.filter || "all";

  // Pagination controls
  const paginationHTML =
    filterValue !== "captured" && pagination
      ? `
      <div class="pagination">
        <button class="page-btn ${!pagination.previous ? "disabled" : ""}" 
                data-url="https://pokeapi.co/api/v2/pokemon?offset=${
                  (pagination.currentPage - 2) * 20
                }&limit=20"
                ${!pagination.previous ? "disabled" : ""}>
          Previous
        </button>
        
        <div class="page-numbers">
          ${generatePageNumbers(pagination.currentPage, pagination.totalPages)}
        </div>

        <button class="page-btn ${!pagination.next ? "disabled" : ""}" 
                data-url="https://pokeapi.co/api/v2/pokemon?offset=${
                  pagination.currentPage * 20
                }&limit=20"
                ${!pagination.next ? "disabled" : ""}>
          Next
        </button>
      </div>`
      : "";

  // When filter is "captured", show all captured Pokemon
  const displayedPokemon =
    filterValue === "captured" ? state.capturedPokemons : pokemonList;

  const paginationScript = `
    document.addEventListener('click', (e) => {
      if (e.target.matches('.page-btn:not(.disabled)')) {
        const url = e.target.dataset.url;
        if (url) {
          showLoading();
          
          if (url.startsWith('search')) {
            const params = new URLSearchParams(url.split('?')[1]);
            vscode.postMessage({
              command: 'search',
              searchTerm: params.get('term'),
              page: parseInt(params.get('page') || '1'),
              filter: statusFilter.value,
              searchState: {
                term: params.get('term'),
                filter: statusFilter.value
              }
            });
          } else {
            // Handle both numbered pages and Next/Previous
            vscode.postMessage({
              command: 'fetchPage',
              url: url,
              searchState: {
                term: searchInput.value,
                filter: statusFilter.value
              }
            });
          }
        }
      }
    });
  `;

  const updatePokemonScript = `
    function updatePokemonCard(pokemonName) {
      console.log('Looking for pokemon:', pokemonName);

      const card = document.querySelector(\`[data-pokemon-name="\${pokemonName}"]\`);
      
      if (card) {
        // Update card when found
        card.classList.add('captured');
        card.dataset.status = 'captured';
        
        const sprite = card.querySelector('.pokemon-sprite');
        if (sprite) sprite.classList.remove('gray');
        
        const name = card.querySelector('.pokemon-name');
        if (name) name.classList.remove('gray');
        
        console.log('Successfully updated card for:', pokemonName);
      }
      
    }

    window.addEventListener('message', event => {
      const message = event.data;
      console.log('Received update message:', message);
      
      if (message.command === 'updatePokemon') {
        updatePokemonCard(message.pokemonName);
      }
    });
  `;

  const searchScript = ` 
    // Search input
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const clearButton = document.getElementById('clearSearch');


    // Update clear button visibility
    function updateClearButton() {
      clearButton.classList.toggle('visible', searchInput.value.length > 0);
    }

    // Clear search and return to first page
    clearButton.addEventListener('click', () => {
      searchInput.value = '';
      updateClearButton();
      vscode.postMessage({
        command: 'fetchPage',
        url: 'https://pokeapi.co/api/v2/pokemon?offset=0&limit=20',
        searchState: {
          term: '',
          filter: statusFilter.value
        }
      });
    });

    // Keep search term state when searching
    searchInput.addEventListener('input', () => {
      updateClearButton();
      clearTimeout(searchTimeout);
      
      const searchTerm = searchInput.value;
      
      // Clear previous search timeout
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
      
      // Hide loading spinner if search term is too short
      if (searchTerm.length < 2) {
        hideLoading();
        return;
      }
      
      searchTimeout = setTimeout(() => {
        const filter = statusFilter.value;
        showLoading();
        vscode.postMessage({
          command: 'search',
          searchTerm: searchTerm,
          filter: filter,
          searchState: {
            term: searchTerm,
            filter: filter
          }
        });
      }, 300);
    });
  `;

  const filterScript = ` 
    let currentUrl = 'https://pokeapi.co/api/v2/pokemon?offset=0&limit=20';
    statusFilter.addEventListener('change', () => {
      const filter = statusFilter.value;
      const searchTerm = searchInput.value;
      
      vscode.postMessage({
        command: 'filter',
        filter: filter,
        currentUrl: currentUrl,
        searchState: {
          term: searchInput.value,
          filter: filter
        }
      });
    });

    // Add filter functionality
  function filterPokemon() {
    const filter = statusFilter.value;
    const cards = document.querySelectorAll('.pokemon-card');
    const capturedPokemon = [];
    
    cards.forEach(card => {
      switch(filter) {
        case 'captured':
          if (card.dataset.status === 'captured') {
            capturedPokemon.push(card.dataset.pokemonName);
            card.style.display = '';
          } else {
            card.style.display = 'none';
          }
          break;
        case 'uncaptured':
          card.style.display = card.dataset.status === 'uncaptured' ? '' : 'none';
          break;
        default: // 'all'
          card.style.display = '';
      }
    });

    // Log captured Pokemon when that filter is selected
    if (filter === 'captured') {
      console.log('Captured Pokemon:', capturedPokemon);
      console.log('Total captured:', capturedPokemon.length);
    }
  }

    // Add initial filter
    filterPokemon();

  `;

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
          background-color: #f3f5f9;
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
          padding-right: 30px;
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
          transition: color 0.2s;
        }

        .clear-search:hover {
          color: #64748b;
        }

        .clear-search.visible {
          display: block;
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

        .pagination {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          margin: 20px 0;
        }

        .page-numbers {
          display: flex;
          gap: 5px;
        }

        .page-btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          background: #4a90e2;
          color: white;
          cursor: pointer;
          min-width: 40px;
          transition: background-color 0.2s, transform 0.1s;
        }

        .page-btn:hover:not(.disabled) {
          background: #357abd;
          transform: translateY(-1px);
        }

        .page-btn.disabled {
          background: #cccccc;
          cursor: not-allowed;
          opacity: 0.7;
        }

        .page-btn.active {
          background: #2c3e50;
          font-weight: bold;
        }

        .page-btn[title^="Go to"] {
          font-weight: bold;
          padding: 8px 12px;
        }

        .loading-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: none;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .loading-overlay.active {
          display: flex;
        }

        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 5px solid #f3f3f3;
          border-top: 5px solid #3498db;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    </head>
    <body>
      <div class="loading-overlay">
        <div class="loading-spinner"></div>
      </div>

      <h1>🏆 Pokédex</h1>

      <div class="controls">
        <div class="search-container">
          <input 
            type="text" 
            class="search-box" 
            placeholder="Search Pokémon..." 
            id="searchInput"
            value="${searchInput}"
          >
          <button class="clear-search ${
            searchInput ? "visible" : ""
          }" id="clearSearch">
            ✕
          </button>
        </div>
        <select class="filter-select" id="statusFilter">
          <option value="all" ${
            filterValue === "all" ? "selected" : ""
          }>All Pokémon</option>
          <option value="captured" ${
            filterValue === "captured" ? "selected" : ""
          }>Captured</option>
          <option value="uncaptured" ${
            filterValue === "uncaptured" ? "selected" : ""
          }>Not Captured</option>
        </select>
      </div>

      <div class="pokemon-list">
        ${displayedPokemon
          .map(
            (pokemon) => `
            <div class="pokemon-card ${
              state.capturedPokemonNames.has(pokemon.name) ? "captured" : ""
            }"
                data-pokemon-name="${pokemon.name}"
                data-status="${
                  state.capturedPokemonNames.has(pokemon.name)
                    ? "captured"
                    : "uncaptured"
                }">
              <img class="pokemon-sprite ${
                state.capturedPokemonNames.has(pokemon.name) ? "" : "gray"
              }" 
                  loading="lazy"
                  src="${pokemon.sprites.front_default}" 
                  alt="${formatPokemonName(pokemon.name)}">
              <span class="pokemon-name ${
                state.capturedPokemonNames.has(pokemon.name) ? "" : "gray"
              }">
                ${formatPokemonName(pokemon.name)}
              </span>
            </div>`
          )
          .join("")} 
        </div>    

        ${paginationHTML}

      <script>
        const vscode = acquireVsCodeApi();
        let searchTimeout;  
        
        const currentState = {
          searchTerm: "${searchState.term}",
          filter: "${searchState.filter}"
        };
        
        // Loading overlay
        const loadingOverlay = document.querySelector('.loading-overlay');
        
        function showLoading() {
          loadingOverlay.classList.add('active');
        }

        function hideLoading() {
          loadingOverlay.classList.remove('active');
        }

        
        // Search script
        ${searchScript}
        
        // Filter script
        ${filterScript}
        
        // Update Pokemon card on capture
        ${updatePokemonScript}
        
        // Pagination
        ${paginationScript}

        // Initial state
        updateClearButton();

      </script>

    </body>
    </html>
  `;
}

/**
 * Starts a work session in the Pomodoro timer
 * @returns {void}
 * @private
 */
function startWorkSession(): void {
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

/**
 * Starts a short break session in the Pomodoro timer
 * @returns {Promise<void>}
 * @private
 */
async function startShortBreak(): Promise<void> {
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

/**
 * Starts a long break session in the Pomodoro timer
 * @returns {Promise<void>}
 * @private
 */
async function startLongBreak(): Promise<void> {
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

/**
 * Starts the timer for a given duration
 * @param {number} duration - Duration in seconds
 * @returns {void}
 * @private
 */
function startTimer(duration: number): void {
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

/**
 * Stops the Pomodoro timer and resets all states
 * @returns {void}
 * @private
 */
function stopTimer(): void {
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

/**
 * Formats time remaining into MM:SS format
 * @param {number} seconds - Number of seconds
 * @returns {string} Formatted time string
 */
function formatTimeRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Formats Pokemon name with first letter capitalized
 * @param {string} pokemonName - Name of the Pokemon
 * @returns {string} Formatted Pokemon name
 */
function formatPokemonName(pokemonName: string): string {
  const formattedName =
    pokemonName.charAt(0).toUpperCase() + pokemonName.slice(1);

  return formattedName;
}

/**
 * Gets the current view content for the webview
 * @param {vscode.Webview} webview - VS Code webview instance
 * @returns {string} HTML content for the webview
 */
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
        display: flex;
        flex-direction: column;
        align-items: center;
        background: linear-gradient(135deg, #ff9966, #ff5e62);
        border-radius: 15px;
        padding: 30px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      `;
      break;
    case "shortBreak":
      sessionStyle = `
        display: flex;
        flex-direction: column;
        align-items: center;
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
        <div style="${sessionStyle}" class="capture-success">
          <h1 class="congrats">Congratulations!</h1>
          <p class="capture-message">You captured ${formatPokemonName(
            state.justCaptured
          )}!</p>
          <div class="sparkles">✨</div>
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
          text-align: center;
          animation: fadeIn 0.5s ease-in;
        }

        .capture-success {
          text-align: center;
          animation: fadeIn 0.5s ease-in;
        }

        .congrats {
          font-size: 1.8em;
          color: #2c3e50;
          margin-bottom: 20px;
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
          max-width: 190px;
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
          from { opacity: 0;}
          to { opacity: 1;}
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

/**
 * Resets all counters in the Pomodoro state
 * @returns {void}
 * @private
 */
function resetCounters(): void {
  state.pomodoroCount = 0;
  state.shortBreakCount = 0;
  state.pokemonRunAway = false;
}

/**
 * Updates the VS Code status bar with current timer information
 * @param {number} timeLeft - Time remaining in seconds
 * @returns {void}
 * @private
 */
function updateStatusBar(timeLeft: number): void {
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

/**
 * Spawns a random Pokemon during break sessions
 * @returns {Promise<void>}
 * @throws {Error} If Pokemon fetching fails
 */
export async function spawnPokemonForBreak(): Promise<void> {
  try {
    const { name, spriteUrl } = await getRandomPokemon();
    console.log(`Spawned Pokémon: ${name}, Sprite URL: ${spriteUrl}`);
    state.currentPokemon = {
      name,
      sprites: { front_default: spriteUrl },
      message: undefined,
      isGray: true,
    };
    state.pokemonRunAway = false;
    pokemonViewProvider.refresh();

    // Focus the sidebar view
    await vscode.commands.executeCommand(
      "workbench.view.extension.pokemon-tomatoRed-container"
    );

    // Bring the Pokemon view to front
    await vscode.commands.executeCommand(
      "workbench.view.extension.pokemon-tomatoRed-container"
    );

    // If we have access to the view through the provider, reveal it
    if (pokemonViewProvider._view) {
      pokemonViewProvider._view.show(true); // true means preserve focus
    }
  } catch (error) {
    vscode.window.showErrorMessage("Failed to fetch a Pokémon.");
  }
}

/**
 * Deactivates the extension and cleans up resources
 * @returns {void}
 */
export function deactivate(): void {
  stopTimer();
}
