import fetch from "node-fetch";
import * as vscode from "vscode";

export interface Pokemon {
  name: string;
  sprites: { front_default: string };
  message?: vscode.MessageItem;
  isGray?: boolean;
}

export async function getAllPokemon(): Promise<Pokemon[]> {
  const pokemonList: Pokemon[] = [];
  const totalPokemon = 1302;
  const batchSize = 50; // Process in smaller batches

  try {
    // Process in batches
    for (let i = 0; i < totalPokemon; i += batchSize) {
      const end = Math.min(i + batchSize, totalPokemon);
      console.log(`Fetching Pokemon ${i + 1} to ${end}`);

      const promises = Array.from({ length: end - i }, (_, index) =>
        fetch(`https://pokeapi.co/api/v2/pokemon/${i + index + 1}`)
          .then((res) => {
            if (!res.ok) {
              throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
          })
          .then((data) => {
            if (
              typeof data === "object" &&
              data !== null &&
              "name" in data &&
              "sprites" in data &&
              typeof data.sprites === "object" &&
              data.sprites !== null &&
              "front_default" in data.sprites
            ) {
              return {
                name: data.name as string,
                sprites: {
                  front_default: data.sprites.front_default as string,
                },
                isGray: true,
              };
            }
            throw new Error(
              `Invalid Pokemon data structure for ID ${i + index + 1}`
            );
          })
          .catch((error) => {
            console.error(`Error fetching Pokemon ${i + index + 1}:`, error);
            throw error;
          })
      );

      // Add delay between batches
      const results = await Promise.all(promises);
      pokemonList.push(...results);

      // Wait 1 second between batches to avoid rate limiting
      if (i + batchSize < totalPokemon) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return pokemonList;
  } catch (error) {
    console.error("Failed to fetch Pokemon list:", error);
    throw new Error("Failed to fetch Pokemon list");
  }
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
