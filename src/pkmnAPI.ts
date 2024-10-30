import fetch from "node-fetch";
import * as vscode from "vscode";

export interface Pokemon {
  name: string;
  sprites: { front_default: string };
  message?: vscode.MessageItem;
}

export async function getRandomPokemon(): Promise<{
  name: string;
  spriteUrl: string;
}> {
  const randomId = Math.floor(Math.random() * 898) + 1; // Pokémon ID
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`);

  if (!response.ok) {
    throw new Error("Failed to fetch Pokémon");
  }

  const pokemonData = (await response.json()) as Pokemon;
  return {
    name: pokemonData.name, // Return Pokémon name
    spriteUrl: pokemonData.sprites.front_default, // Return Pokémon sprite URL
  };
}
