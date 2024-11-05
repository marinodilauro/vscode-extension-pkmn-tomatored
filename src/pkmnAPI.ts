import fetch from "node-fetch";
import * as vscode from "vscode";

export interface Pokemon {
  name: string;
  sprites: { front_default: string };
  message?: vscode.MessageItem;
  isGray: boolean;
}

interface PokemonListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Array<{ name: string; url: string }>;
}

export async function getPokemonPage(
  url: string = "https://pokeapi.co/api/v2/pokemon?offset=0&limit=20"
): Promise<{
  pokemon: Pokemon[];
  pagination: {
    count: number;
    next: string | null;
    previous: string | null;
    currentPage: number;
    totalPages: number;
  };
}> {
  try {
    // Fetch the list of Pokemon from the paginated endpoint
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch Pokemon list: ${response.status}`);
    }
    const data = (await response.json()) as PokemonListResponse;

    // Calculate pagination info
    const currentPage =
      Math.floor(
        parseInt(new URL(url).searchParams.get("offset") || "0", 10) / 20
      ) + 1;

    // Fetch and filter Pokemon with sprites
    const pokemonDetails = (
      await Promise.all(
        data.results.map(async (pokemon) => {
          try {
            const detailResponse = await fetch(pokemon.url);
            if (!detailResponse.ok) {
              throw new Error(
                `Failed to fetch ${pokemon.name}: ${detailResponse.status}`
              );
            }

            const detail = (await detailResponse.json()) as Pokemon;

            // Only return Pokemon with valid sprites
            if (detail.sprites && detail.sprites.front_default) {
              return {
                name: detail.name,
                sprites: { front_default: detail.sprites.front_default },
                isGray: true,
              };
            }
            return null;
          } catch (error) {
            console.warn(`Failed to fetch details for ${pokemon.name}:`, error);
            return null;
          }
        })
      )
    ).filter((pokemon): pokemon is Pokemon => pokemon !== null);

    // Adjust pagination based on total count from API
    const totalPages = Math.ceil(data.count / 20);

    return {
      pokemon: pokemonDetails,
      pagination: {
        count: data.count,
        next: data.next,
        previous: data.previous,
        currentPage,
        totalPages,
      },
    };
  } catch (error) {
    console.error("Failed to fetch Pokemon list:", error);
    throw new Error("Failed to fetch Pokemon list");
  }
}

export async function searchPokemon(
  searchTerm: string,
  page: number = 1
): Promise<{
  pokemon: Pokemon[];
  pagination: {
    count: number;
    currentPage: number;
    totalPages: number;
    next: string | null;
    previous: string | null;
  };
}> {
  try {
    if (!searchTerm.trim() || searchTerm.length < 2) {
      return {
        pokemon: [],
        pagination: {
          count: 0,
          currentPage: 1,
          totalPages: 1,
          next: null,
          previous: null,
        },
      };
    }

    console.log(`Searching for Pokemon with term: ${searchTerm}`);

    // Fetch directly the specific Pokemon instead of filtering through the list
    try {
      const pokemonResponse = await fetch(
        `https://pokeapi.co/api/v2/pokemon/${searchTerm.toLowerCase()}`
      );

      if (!pokemonResponse.ok) {
        // If not found by exact name/id, fallback to filtering through the list
        console.log(
          "Pokemon not found by direct search, trying list filtering..."
        );
        const listResponse = await fetch(
          "https://pokeapi.co/api/v2/pokemon?limit=1025"
        );

        if (!listResponse.ok) {
          throw new Error(
            `Failed to fetch Pokemon list: ${listResponse.status}`
          );
        }

        const data = (await listResponse.json()) as PokemonListResponse;
        const matchedPokemon = data.results.filter((pokemon) =>
          pokemon.name.toLowerCase().startsWith(searchTerm.toLowerCase())
        );

        console.log(`Found ${matchedPokemon.length} matches in list`);

        // Pagination calculations
        const itemsPerPage = 10;
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const totalItems = matchedPokemon.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);

        // Get only current page items
        const currentPagePokemon = matchedPokemon.slice(startIndex, endIndex);

        // Fetch details in smaller batches
        const batchSize = 5;
        const pokemonDetails = [];

        for (let i = 0; i < currentPagePokemon.length; i += batchSize) {
          const batch = currentPagePokemon.slice(i, i + batchSize);
          const batchResults = await Promise.all(
            batch.map(async (pokemon) => {
              try {
                const detailResponse = await fetch(pokemon.url);
                if (!detailResponse.ok) {
                  return null;
                }
                const detail = (await detailResponse.json()) as Pokemon;
                return {
                  name: detail.name,
                  sprites: { front_default: detail.sprites.front_default },
                  isGray: true,
                } as Pokemon;
              } catch (error) {
                return null;
              }
            })
          );
          pokemonDetails.push(
            ...batchResults.filter((p): p is Pokemon => p !== null)
          );
        }

        const filteredPokemon = pokemonDetails.filter(
          (pokemon): pokemon is Pokemon => pokemon !== null
        );

        return {
          pokemon: filteredPokemon,
          pagination: {
            count: totalItems,
            currentPage: page,
            totalPages,
            next:
              page < totalPages
                ? `search?term=${searchTerm}&page=${page + 1}`
                : null,
            previous:
              page > 1 ? `search?term=${searchTerm}&page=${page - 1}` : null,
          },
        };
      }

      // Direct search succeeded
      const pokemonData = (await pokemonResponse.json()) as {
        name: string;
        sprites: { front_default: string };
      };

      return {
        pokemon: [
          {
            name: pokemonData.name,
            sprites: { front_default: pokemonData.sprites.front_default },
            isGray: true,
          },
        ],
        pagination: {
          count: 1,
          currentPage: 1,
          totalPages: 1,
          next: null,
          previous: null,
        },
      };
    } catch (error) {
      console.error("Search failed:", error);
      throw new Error("Failed to search Pokemon");
    }
  } catch (error) {
    console.error("Search failed:", error);
    return {
      pokemon: [], // Return empty array instead of throwing to stop the loading spinner
      pagination: {
        count: 0,
        currentPage: 1,
        totalPages: 1,
        next: null,
        previous: null,
      },
    };
  }
}

export async function getRandomPokemon(): Promise<{
  name: string;
  spriteUrl: string;
}> {
  const randomId = Math.floor(Math.random() * 1025) + 1; // Pokémon ID
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
