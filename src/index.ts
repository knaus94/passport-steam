import { Strategy as OpenIDStrategy } from '@passport-next/passport-openid';
import SteamAPI from 'steamapi';
import { Request } from 'express';

export interface Profile {
    steamId32: string;
    steamId64: string;
    nickname: string;
    isProfilePublic: boolean;
    lastLogOffAt: Date;
    createdAt: Date;
    provider: string;
    avatarHash: string;
    accountLevel?: number;
    csgoHours?: number;
    dotaHours?: number;
    rustHours?: number;
}

interface Select {
    accountLevel: boolean;
    gameHours: boolean;
}

type ValidateCallback = (
    req: Request,
    identifier: string,
    profile: Profile,
    done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
) => void;

async function getUserProfile(
    key: string,
    steamID: string,
    select: Select,
    callback: (err?: Error | null, profile?: Profile) => void,
) {
    const steam = new SteamAPI(key);

    try {
        const { nickname, visibilityState, avatar, created, lastLogOff } =
            await steam.getUserSummary(steamID);

        let result: Profile = {
            provider: 'steam',
            steamId32: String(Number(steamID.slice(-16, 17)) - 6561197960265728),
            steamId64: steamID,
            nickname,
            isProfilePublic: visibilityState == 3,
            avatarHash: avatar.small.match(/[^/]*(?=\.[^.]+($|\?))/)[0],
            lastLogOffAt: new Date(lastLogOff * 1e3),
            createdAt: new Date(created * 1e3),
        };

        if (visibilityState === 3) {
            if (select.accountLevel) {
                const accountLevel = await steam.getUserLevel(steamID);

                result = {
                    ...result,
                    accountLevel,
                };
            }

            if (select.gameHours) {
                const games = await steam.getUserOwnedGames(steamID);

                const hours = (appID: number) => {
                    const game = games.find((game) => game.appID === appID);

                    if (!game) {
                        return;
                    }

                    return Math.ceil(game.playTime / 60);
                };

                result = {
                    ...result,
                    csgoHours: hours(730),
                    dotaHours: hours(570),
                    rustHours: hours(252490),
                };
            }
        }

        return callback(null, result);
    } catch (e) {
        callback(e);
    }
}

export class Strategy extends OpenIDStrategy {
    public name: string;
    public stateless: boolean;

    constructor(
        options: {
            providerURL?: string;
            stateless?: boolean;
            returnURL: string;
            apiKey: string;
            profile: boolean;
            realm: string;
            select: Select;
        },
        validate: ValidateCallback,
    ) {
        options.providerURL = options.providerURL || 'https://steamcommunity.com/openid';
        options.stateless = options.stateless ?? true;
        options.select = options.select || { accountLevel: false, gameHours: false };

        async function verify(
            req: Request,
            identifier: string,
            profile: Profile,
            done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
        ) {
            const validOpEndpoint = 'https://steamcommunity.com/openid/login';
            const identifierRegex = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;
            try {
                if (
                    req.query['openid.op_endpoint'] !== validOpEndpoint ||
                    !identifierRegex.test(identifier)
                ) {
                    return done(null, undefined, { message: 'Claimed identity is invalid.' });
                }

                const steamID = identifierRegex.exec(identifier)[1];

                if (options.profile) {
                    return getUserProfile(
                        options.apiKey,
                        steamID,
                        options.select,
                        (err, profile) => {
                            if (err) {
                                return done(err);
                            }
                            return validate(req, identifier, profile, done);
                        },
                    );
                }
                return validate(req, identifier, profile, done);
            } catch (err) {
                done(err);
            }
        }

        super({ ...options, passReqToCallback: true }, verify);

        this.name = 'steam';
        this.stateless = options.stateless;
    }
}
