import SteamWebAPI from 'steamapi';
import Express from 'express';

export interface Profile extends SteamWebAPI.PlayerSummary {
    provider: 'steam';
}

export type ValidateCallback = (
    req: Express.Request,
    identifier: string,
    profile: Profile,
    done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
) => void;

export interface SteamOpenIDOptions {
    providerURL: string;
    stateless?: boolean;
    apiKey: string;
    profile: boolean;
}
