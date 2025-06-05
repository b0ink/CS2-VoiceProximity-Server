import { decode } from '@msgpack/msgpack';
import { PlayerPositionApiData } from '../types';

export function decodePlayerData(data: Buffer<ArrayBufferLike>): PlayerPositionApiData[] {
  const decoded = decode(new Uint8Array(data));
  const players = decoded as Array<
    [
      string, // steamId
      string, // name
      boolean, // isAdmin
      number, // originX
      number, // originY
      number, // originZ
      number, // lookAtX
      number, // lookAtY
      number, // lookAtZ
      number, // team
      boolean, // isAlive
      boolean, // spectatingC4
    ]
  >;

  const localPlayerData: PlayerPositionApiData[] = [];

  for (const player of players) {
    const [steamId, name, isAdmin, ox, oy, oz, lx, ly, lz, team, isAlive, spectatingC4] = player;

    // Cast to PlayerData interface
    const playerData: PlayerPositionApiData = {
      steamId,
      name,
      isAdmin,
      // The server plugin scales our Origin/LookAt floats to integers so that we're not dealing with decimals
      // Now we need to scale them down
      originX: ox / 10000,
      originY: oy / 10000,
      originZ: oz / 10000,
      lookAtX: lx / 10000,
      lookAtY: ly / 10000,
      lookAtZ: lz / 10000,
      team,
      isAlive,
      spectatingC4,
    };
    localPlayerData.push(playerData);
  }

  return localPlayerData;
}
