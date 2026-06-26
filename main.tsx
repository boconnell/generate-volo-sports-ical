import { blob } from "https://esm.town/v/std/blob";
import { gql, request as graphqlRequest } from "npm:graphql-request";
import { ICalCalendar } from "npm:ical-generator";
// @deno-types="npm:@types/ramda"
import * as R from "npm:ramda";

const EMAIL = Deno.env.get("EMAIL");
const PASSWORD = Deno.env.get("PASSWORD");

type LoginResponse = {
  login: {
    token: string;
  };
};

const loginMutation = gql`
mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    token
  }
}
`;

type CurrentUserGamesResponse = {
  currentUser: {
    game_rsvps: {
      gameByGame: {
        _id: string;
        start_time: string;
        end_time: string;
        venueByVenue: {
          shorthand_name: string;
          formatted_address: string;
          latitude: number;
          longitude: number;
        };
        leagueByLeague: {
          sportBySport: {
            name: string;
          };
        };
      };
    }[];
  };
};

const query = gql`
query CurrentUserGames {
  currentUser {
    game_rsvps {
      gameByGame {
        _id
        start_time
        end_time
        venueByVenue {
          shorthand_name
          formatted_address
          latitude
          longitude
        }
        leagueByLeague {
          sportBySport {
            name
          }
        }
      }
    }
  }
}
`;

export async function makeAndStoreVoloIcal() {
  const authToken = await getAuthToken();
  const games = await fetchGames(authToken);
  writeIcal("voloIcal", games);
}

async function getAuthToken() {
  const response = await graphqlRequest<LoginResponse>(
    "https://volosports.com/hapi/v1/graphql",
    loginMutation,
    {
      email: EMAIL,
      password: PASSWORD,
    },
  );
  return response.login.token;
}

async function fetchGames(authToken: string) {
  const authorizationHeader = {
    authorization: `Bearer ${authToken}`,
  };
  const result = await graphqlRequest<CurrentUserGamesResponse>(
    "https://volosports.com/hapi/v1/graphql",
    query,
    undefined,
    authorizationHeader,
  );

  const games = result.currentUser.game_rsvps
    .map((gameRsvp) => {
      const game = gameRsvp.gameByGame;
      return {
        id: game._id,
        sport: game.leagueByLeague.sportBySport.name,
        venue: game.venueByVenue,
        start_time: new Date(game.start_time),
        end_time: new Date(game.end_time),
      };
    });

  const gamesByLocation = R.groupBy(
    (game) => `${game.venue.shorthand_name}|${game.sport}`,
    games,
  );
  const mergedGames = R.values(gamesByLocation).flatMap((games) => {
    if (!games) {
      return [];
    }
    const sortedGames = R.sort(
      (g1, g2) => g1.start_time.getTime() - g2.start_time.getTime(),
      games,
    );
    const mergedGames: FinalGame[] = [];
    for (const game of sortedGames) {
      if (mergedGames.length === 0) {
        mergedGames.push(game);
      } else {
        const lastGame = mergedGames[mergedGames.length - 1];
        if (lastGame.end_time.getTime() === game.start_time.getTime()) {
          lastGame.end_time = game.end_time;
        } else {
          mergedGames.push(game);
        }
      }
    }
    return mergedGames;
  });
  return mergedGames;
}

type FinalGame = {
  id: string;
  sport: string;
  venue: {
    formatted_address: string;
    shorthand_name: string;
    latitude: number;
    longitude: number;
  };
  start_time: Date;
  end_time: Date;
};

function writeIcal(fileName: string, games: FinalGame[]) {
  const calendar = new ICalCalendar({
    events: games.map((game) => {
      return {
        id: game.id,
        start: game.start_time,
        end: game.end_time,
        summary: game.sport,
        location: {
          title: game.venue.shorthand_name,
          address: game.venue.formatted_address,
          geo: {
            lat: game.venue.latitude,
            lon: game.venue.longitude,
          },
        },
      };
    }),
  });

  const iCalContents = calendar.toString();
  blob.set(fileName, iCalContents);
}