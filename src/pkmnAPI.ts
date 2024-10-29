import fetch from "node-fetch";

interface Pokemon {
  name: string;
  // Aggiungi altre proprietà se necessario
}

export async function getRandomPokemon(): Promise<string> {
  const randomId = Math.floor(Math.random() * 898) + 1; // Pokémon ID
  const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${randomId}`);

  if (!response.ok) {
    throw new Error("Failed to fetch Pokémon");
  }

  const pokemonData = (await response.json()) as Pokemon;
  return pokemonData.name; // Return Pokémon name
}
