// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Command to activate Pomodoro Timer
  const startPomodoro = vscode.commands.registerCommand(
    "pkmn-tmtred.startPomodoro",
    () => {
      vscode.window.showInformationMessage("Pomodoro Timer started!");
      startTimer(1 * 60); // 1 minute timer for testing
    }
  );

  context.subscriptions.push(startPomodoro);
}

function startTimer(duration: number) {
  let timeLeft = duration;
  const interval = setInterval(() => {
    if (timeLeft <= 0) {
      clearInterval(interval);
      vscode.window.showInformationMessage(
        "Time for a break! A Pokémon is appearing..."
      );
    } else {
      timeLeft--;
    }
  }, 1000); // Update the timer every second
}

// This method is called when your extension is deactivated
export function deactivate() {}
