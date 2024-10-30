import * as vscode from "vscode";
import { state } from "./extension";

export class PokemonViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "pokemonView";
  public _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {
    console.log("PokemonViewProvider constructor called");
  }

  private getWebviewContent(): string {
    console.log("getWebviewContent called with state:", {
      currentPokemon: state.currentPokemon?.name,
      justCaptured: state.justCaptured,
    });

    let content;

    if (state.justCaptured) {
      console.log("Showing capture success message for:", state.justCaptured);
      content = `
        <div class="capture-success">
          <h1>Congratulations!</h1>
          <h2>You captured ${state.justCaptured}!</h2>
        </div>`;
    } else if (state.currentPokemon) {
      console.log("Showing wild pokemon:", state.currentPokemon.name);
      content = `
        <div class="wild-pokemon">
          <h1>Wild ${
            state.currentPokemon.name.charAt(0).toUpperCase() +
            state.currentPokemon.name.slice(1)
          } appeared!</h1>
          <img src="${state.currentPokemon.sprites.front_default}" 
               id="pokemonSprite" 
               style="max-width: 100px; position: relative;">
        </div>`;
    } else {
      console.log("No pokemon to show");
      content = `
        <div class="no-pokemon">
          <h1>No Pokémon here!</h1>
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
            animation: move 1s infinite alternate; 
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
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          h1 { margin-bottom: 10px; }
          h2 { margin-top: 0; }
        </style>
      </head>
      <body>${content}</body>
      </html>
    `;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    console.log("resolveWebviewView called");
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    this.refresh();
  }

  public refresh(): void {
    console.log("refresh called on PokemonViewProvider");
    if (this._view) {
      this._view.webview.html = this.getWebviewContent();
      console.log("View content updated");
    } else {
      console.log("Warning: _view is undefined during refresh");
    }
  }
}
