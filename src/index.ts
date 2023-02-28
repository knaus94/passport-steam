import { Strategy as OpenIDStrategy } from '@passport-next/passport-openid';
import SteamWebAPI from 'steamapi';
import { Request } from 'express';

export interface Profile extends SteamWebAPI.PlayerSummary {
    provider: string;
}

type ValidateCallback = (
    req: Request,
    identifier: string,
    profile: Profile,
    done: (error: Error | null, user?: Profile, info?: { message: string }) => void,
) => void;

interface SteamOpenIDOptions {
    providerURL: string;
    stateless?: boolean;
    apiKey: string;
    profile: boolean;
}

export default class Strategy extends OpenIDStrategy {
    public name = 'steam';

    constructor(options: SteamOpenIDOptions, validate: ValidateCallback) {
        options.providerURL = options.providerURL || 'https://steamcommunity.com/openid';
        options.stateless = options.stateless ?? true;

        super(options, async (req: Request, identifier: string, profile: Profile, done) => {
            const validOpEndpoint = 'https://steamcommunity.com/openid/login';
            const identifierRegex = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

            if (
                req.query['openid.op_endpoint'] !== validOpEndpoint ||
                !identifierRegex.test(identifier)
            ) {
                return done(null, undefined, { message: 'Claimed identity is invalid.' });
            }

            const steamID = identifierRegex.exec(identifier)?.[1];

            if (options.profile) {
                const steam = new SteamWebAPI(options.apiKey);
                try {
                    const result = await steam.getUserSummary(steamID);
                    const userProfile: Profile = {
                        provider: this.name,
                        ...result,
                    };
                    validate(req, identifier, userProfile, done);
                } catch (err) {
                    done(err);
                }
            } else {
                validate(req, identifier, profile, done);
            }
        });
    }
}
