import * as vscode from "vscode";
import { state, spawnPokemonForBreak } from "./extension";

export class PokemonViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "pokemonView";

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {
    console.log("PokemonViewProvider constructor called");
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    console.log("resolveWebviewView called");
    console.log("webviewView:", webviewView);
    console.log("webviewView.visible:", webviewView.visible);
    console.log("_context:", _context);
    console.log("_token:", _token);

    this._view = webviewView;

    webviewView.webview.options = {
      // Enable scripts in the webview
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this.getWebviewContent();
  }

  public refresh(): void {
    console.log("refresh called");
    if (this._view) {
      this._view.webview.html = this.getWebviewContent();
    }
  }

  private getWebviewContent(): string {
    console.log(
      "Updating webview content with current Pokémon:",
      state.currentPokemon
    );
    const pokemon = state.currentPokemon;
    const spriteHtml = pokemon
      ? `<h1>Wild ${
          pokemon.name.charAt(0).toUpperCase() + pokemon?.name.slice(1)
        } appeared!</h1><img src="${
          pokemon.spriteUrl
        }" id="pokemonSprite" style="max-width: 100px; position: relative;">`
      : `<h1>No Pokémon here!</h1>`;

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <style>
          body { display: flex; justify-content: center; align-items: center; height: 100%; overflow: hidden; }
          img { animation: move 1s infinite alternate; }
          @keyframes move {
            0% { transform: translate(0, 0); }
            100% { transform: translate(${Math.random() * 20 - 10}px, ${
      Math.random() * 20 - 10
    }px); }
          }
        </style>
      </head>
      <body>${spriteHtml}</body>
      </html>
    `;
  }
}
