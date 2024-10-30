import * as vscode from "vscode";
import { state } from "./extension";
import { getCurrentViewContent } from "./extension";

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

    return getCurrentViewContent();
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
